use crate::jsonl::entry::RawEntry;
use crate::jsonl::meta::SubAgentMeta;
use crate::model::replay::{
    ReplayData, ReplayEvent, ReplayEventKind, ReplaySessionMeta, ReplaySubagent,
};
use chrono::DateTime;

/// Maximum number of characters kept from a user prompt / spawn description.
pub(crate) const EXCERPT_CHARS: usize = 200;

/// A subagent spawn recorded from an Agent/Task tool_use (in the main file or,
/// for nested delegation, in another subagent's file), waiting to be linked to
/// a sub JSONL file in assemble().
#[derive(Debug, Clone)]
pub struct PendingSpawn {
    pub at_ms: f64,
    pub subagent_type: Option<String>,
    pub description: Option<String>,
    /// The Agent tool_use's block id (matched against the sidecar meta's toolUseId).
    pub tool_use_id: Option<String>,
    /// agent_id of the spawning subagent. None = the main session (orchestrator).
    pub caller: Option<String>,
}

/// One subagent transcript handed to assemble(): its id, sidecar meta (when the
/// agent-{id}.meta.json exists), and the folded event stream.
pub struct SubFile {
    pub agent_id: String,
    pub meta: Option<SubAgentMeta>,
    pub built: BuiltFile,
}

/// The result of folding one JSONL file. Event timestamps are absolute epoch ms
/// here; assemble() rebases them onto the session start.
#[derive(Debug, Default)]
pub struct BuiltFile {
    pub events: Vec<ReplayEvent>,
    /// Spawns recorded from Agent/Task tool_use blocks (main and sub files alike;
    /// a sub file's spawns are nested delegation).
    pub spawns: Vec<PendingSpawn>,
    pub first_ts_ms: Option<f64>,
    pub last_ts_ms: Option<f64>,
    // Session meta (main file only; sub files leave these None).
    pub cwd: Option<String>,
    pub slug: Option<String>,
    pub git_branch: Option<String>,
    pub first_prompt: Option<String>,
    /// Sub file only: the runtime model (assistant entry's message.model).
    pub model: Option<String>,
    /// Sub file only: whether a SubagentStop was emitted (assemble synthesizes
    /// one at last_ts_ms otherwise, so the log always shows the departure).
    pub saw_stop: bool,
}

/// Streaming fold turning one JSONL file's entries into replay events.
/// Mirrors the live pipeline: hook events via session_tracker::reconstruct,
/// activity rows via timeline::row_for / next_skill (same classify results as live).
pub struct ReplayBuilder {
    agent_id: Option<String>,
    /// The most recent tool name (for PostToolUse), same carryover as Session.current.tool_name.
    last_tool: Option<String>,
    active_skill: Option<String>,
    out: BuiltFile,
}

impl ReplayBuilder {
    pub fn new_main() -> Self {
        Self {
            agent_id: None,
            last_tool: None,
            active_skill: None,
            out: BuiltFile::default(),
        }
    }

    pub fn new_sub(agent_id: &str) -> Self {
        Self {
            agent_id: Some(agent_id.to_string()),
            last_tool: None,
            active_skill: None,
            out: BuiltFile::default(),
        }
    }

    /// Folds one entry into 0..=2 events. Entries without a parsable timestamp are skipped.
    pub fn push(&mut self, e: &RawEntry) {
        let Some(at_ms) = e.timestamp.as_deref().and_then(epoch_ms) else {
            return;
        };
        self.out.first_ts_ms.get_or_insert(at_ms);
        self.out.last_ts_ms = Some(at_ms);
        self.absorb_meta(e);
        self.record_spawns(e, at_ms);

        self.active_skill = super::timeline::next_skill(e, self.active_skill.take());

        // Activity first, hook flash second: mirrors live order where the sessions
        // snapshot (sync) lands together with the lifecycle event (applyHooks).
        if let Some(row) = super::timeline::row_for(e) {
            self.out.events.push(ReplayEvent {
                at_ms,
                kind: ReplayEventKind::Activity,
                agent_id: self.agent_id.clone(),
                work: Some(row.kind),
                tool_name: row.tool_name.clone(),
                detail: row.detail,
                active_skill: self.active_skill.clone(),
                ..Default::default()
            });
            // row_for returns Some(tool) rows for tool_use, None-tool rows for
            // prompt/turn_end/thinking, and None for TodoWrite/text/tool_result —
            // exactly the updates classify_entry applies to Session.current.tool_name.
            self.last_tool = row.tool_name;
        }

        if let Some(ev) = super::session_tracker::reconstruct(
            e,
            "",
            self.agent_id.as_deref(),
            self.last_tool.clone(),
            self.agent_id.is_some(),
        ) {
            use crate::hook_events::HookOutcome;
            let (kind, text) = match ev.event.as_str() {
                // Only a real human prompt maps to UserPrompt; a recorded
                // UserPromptSubmit hook execution (blocked/cancelled attachment)
                // must not fabricate an empty prompt row in the log.
                "UserPromptSubmit" if ev.outcome.is_none() => (
                    ReplayEventKind::UserPrompt,
                    e.user_prompt_text().map(|s| excerpt(s, EXCERPT_CHARS)),
                ),
                "PreToolUse" => (ReplayEventKind::PreToolUse, None),
                "PostToolUse" => (ReplayEventKind::PostToolUse, None),
                "Stop" => (ReplayEventKind::TurnEnd, None),
                "SubagentStop" => {
                    // A blocked stop means the agent keeps working; only a real
                    // departure suppresses the synthesized final SubagentStop.
                    if ev.outcome != Some(HookOutcome::Blocked) {
                        self.out.saw_stop = true;
                    }
                    (ReplayEventKind::SubagentStop, None)
                }
                // Hook records for lifecycles outside the replay vocabulary
                // (e.g. a cancelled Notification hook) are dropped rather than
                // shoehorned into a wrong kind.
                _ => return,
            };
            // A recorded run with a duration gets a synthesized start marker at
            // (completion - duration), so playback latches the hook while the run
            // was genuinely in flight. assemble() sorts events, so pushing the
            // earlier timestamp afterwards is fine. Clamped to the file's first
            // entry to keep at_ms non-negative after rebasing.
            if let Some(d) = ev.duration_ms {
                self.out.events.push(ReplayEvent {
                    at_ms: (at_ms - d).max(self.out.first_ts_ms.unwrap_or(at_ms)),
                    kind: ReplayEventKind::HookRunStart,
                    agent_id: self.agent_id.clone(),
                    duration_ms: Some(d),
                    hook_command: ev.hook_command.clone(),
                    ..Default::default()
                });
            }
            self.out.events.push(ReplayEvent {
                at_ms,
                kind,
                agent_id: self.agent_id.clone(),
                tool_name: ev.tool_name,
                correlation_id: ev.correlation_id,
                is_error: ev.is_error,
                text,
                outcome: ev.outcome,
                duration_ms: ev.duration_ms,
                hook_command: ev.hook_command,
                block_reason: ev.block_reason,
                ..Default::default()
            });
        }
    }

    pub fn finish(self) -> BuiltFile {
        self.out
    }

    /// Agent/Task tool_use -> a subagent spawn. One assistant entry may spawn
    /// several agents in parallel, so scan every block. Sub files record these
    /// too: a subagent spawning an agent is nested delegation, and this builder's
    /// agent_id becomes the caller.
    fn record_spawns(&mut self, e: &RawEntry, at_ms: f64) {
        for tb in e.blocks() {
            if tb.block_type.as_deref() != Some("tool_use") {
                continue;
            }
            if !matches!(tb.name.as_deref(), Some("Agent") | Some("Task")) {
                continue;
            }
            let subagent_type = input_str(tb, "subagent_type");
            let description = input_str(tb, "description");
            self.out.spawns.push(PendingSpawn {
                at_ms,
                subagent_type: subagent_type.clone(),
                description: description.clone(),
                tool_use_id: tb.id.clone(),
                caller: self.agent_id.clone(),
            });
            self.out.events.push(ReplayEvent {
                at_ms,
                kind: ReplayEventKind::SubagentSpawn,
                agent_id: self.agent_id.clone(),
                detail: subagent_type,
                text: description.map(|d| excerpt(&d, EXCERPT_CHARS)),
                ..Default::default()
            });
        }
    }

    fn absorb_meta(&mut self, e: &RawEntry) {
        if self.agent_id.is_some() {
            // Record the model the assistant entry actually used, like apply_sub does
            // (set as soon as known, then keep updating with later values).
            if let Some(model) = e.model() {
                self.out.model = Some(model.to_string());
            }
            return;
        }
        if let Some(cwd) = &e.cwd {
            self.out.cwd = Some(cwd.clone());
        }
        if e.git_branch.is_some() {
            self.out.git_branch = e.git_branch.clone();
        }
        if e.slug.is_some() {
            self.out.slug = e.slug.clone();
        }
        if let Some(text) = e.user_prompt_text() {
            // Prefer the first human-looking prompt as the session title: slash
            // commands and harness wrappers arrive as "<command-message>…" /
            // "<local-command-caveat>…" markup, which makes an ugly title. Keep
            // the first prompt as a fallback, replace it once a real one shows up.
            let stored_is_markup = self
                .out
                .first_prompt
                .as_deref()
                .is_some_and(is_markup_prompt);
            if self.out.first_prompt.is_none() || (stored_is_markup && !is_markup_prompt(text)) {
                self.out.first_prompt = Some(excerpt(text, EXCERPT_CHARS));
            }
        }
    }
}

/// Assembles the main file and its sub files into a single ReplayData:
/// links spawns to sub files by the sidecar meta's toolUseId when available
/// (exact, any nesting depth), falling back to the chronological zip for legacy
/// sessions without sidecars (offline equivalent of the live linking in
/// find_or_create_run). Rebases all timestamps onto the session start and
/// merge-sorts the event streams.
/// Returns None when the main file yielded no timestamped entries.
pub fn assemble(session_id: &str, main: BuiltFile, subs: Vec<SubFile>) -> Option<ReplayData> {
    let started_at_ms = main.first_ts_ms?;
    let mut ended_at_ms = main.last_ts_ms.unwrap_or(started_at_ms);

    let mut events: Vec<ReplayEvent> = Vec::with_capacity(1 + main.events.len());
    events.push(ReplayEvent {
        at_ms: started_at_ms,
        kind: ReplayEventKind::SessionStart,
        ..Default::default()
    });
    events.extend(main.events);

    // All spawns: the main file's plus each sub file's (nested delegation).
    let mut spawns = main.spawns;
    for sub in &subs {
        spawns.extend(sub.built.spawns.iter().cloned());
    }
    spawns.sort_by(|a, b| a.at_ms.total_cmp(&b.at_ms));
    let mut claimed = vec![false; spawns.len()];

    let mut sub_files: Vec<SubFile> = subs
        .into_iter()
        .filter(|s| s.built.first_ts_ms.is_some())
        .collect();
    sub_files.sort_by(|a, b| {
        a.built
            .first_ts_ms
            .unwrap()
            .total_cmp(&b.built.first_ts_ms.unwrap())
    });

    // Pass 1: the sidecar meta names the exact spawning tool_use.
    let mut spawn_idx: Vec<Option<usize>> = vec![None; sub_files.len()];
    for (si, sub) in sub_files.iter().enumerate() {
        let Some(tid) = sub.meta.as_ref().and_then(|m| m.tool_use_id.as_deref()) else {
            continue;
        };
        let hit = spawns
            .iter()
            .enumerate()
            .find_map(|(i, s)| (!claimed[i] && s.tool_use_id.as_deref() == Some(tid)).then_some(i));
        if let Some(i) = hit {
            claimed[i] = true;
            spawn_idx[si] = Some(i);
        }
    }
    // Pass 2: legacy chronological zip for sub files without a sidecar. A sidecar
    // naming an unseen call keeps its file unlinked rather than stealing another
    // spawn (mirrors the live find_or_create_run behavior).
    let mut next = 0usize;
    for (si, sub) in sub_files.iter().enumerate() {
        if spawn_idx[si].is_some()
            || sub.meta.as_ref().and_then(|m| m.tool_use_id.as_ref()).is_some()
        {
            continue;
        }
        while next < spawns.len() && claimed[next] {
            next += 1;
        }
        if next >= spawns.len() {
            break;
        }
        claimed[next] = true;
        spawn_idx[si] = Some(next);
    }

    let mut subagents: Vec<ReplaySubagent> = Vec::new();
    for (si, sub) in sub_files.into_iter().enumerate() {
        let SubFile {
            agent_id,
            meta,
            mut built,
        } = sub;
        let spawn = spawn_idx[si].map(|i| spawns[i].clone());
        let spawn_ms = spawn
            .as_ref()
            .map(|s| s.at_ms)
            .unwrap_or_else(|| built.first_ts_ms.unwrap());
        let stop_ms = built.last_ts_ms.unwrap_or(spawn_ms);
        ended_at_ms = ended_at_ms.max(stop_ms);
        if !built.saw_stop {
            // Abnormal termination (no turn_end in the sub file): synthesize the
            // departure so the log and the sprite despawn still happen.
            built.events.push(ReplayEvent {
                at_ms: stop_ms,
                kind: ReplayEventKind::SubagentStop,
                agent_id: Some(agent_id.clone()),
                ..Default::default()
            });
        }
        events.extend(built.events);
        subagents.push(ReplaySubagent {
            agent_id,
            subagent_type: spawn
                .as_ref()
                .and_then(|s| s.subagent_type.clone())
                .or_else(|| meta.as_ref().and_then(|m| m.agent_type.clone())),
            description: spawn
                .as_ref()
                .and_then(|s| s.description.clone())
                .or_else(|| meta.as_ref().and_then(|m| m.description.clone())),
            model: built.model,
            spawn_ms,
            stop_ms,
            parent_agent_id: spawn.as_ref().and_then(|s| s.caller.clone()),
            spawn_depth: meta.as_ref().and_then(|m| m.spawn_depth),
        });
    }
    // Spawns with no sub file (e.g. inline agents that never wrote a transcript):
    // log-only, no sprite (empty agent_id, mirroring the live unlinked-run convention).
    for (i, spawn) in spawns.into_iter().enumerate() {
        if claimed[i] {
            continue;
        }
        subagents.push(ReplaySubagent {
            agent_id: String::new(),
            subagent_type: spawn.subagent_type,
            description: spawn.description,
            model: None,
            spawn_ms: spawn.at_ms,
            stop_ms: spawn.at_ms,
            parent_agent_id: spawn.caller,
            spawn_depth: None,
        });
    }

    events.sort_by(|a, b| a.at_ms.total_cmp(&b.at_ms));
    for ev in &mut events {
        ev.at_ms -= started_at_ms;
    }
    for sub in &mut subagents {
        sub.spawn_ms -= started_at_ms;
        sub.stop_ms -= started_at_ms;
    }
    subagents.sort_by(|a, b| a.spawn_ms.total_cmp(&b.spawn_ms));

    Some(ReplayData {
        meta: ReplaySessionMeta {
            session_id: session_id.to_string(),
            project: main.cwd.unwrap_or_default(),
            slug: main.slug,
            git_branch: main.git_branch,
            first_prompt: main.first_prompt,
            started_at_ms,
            ended_at_ms,
            status: super::session_tracker::status_from_epoch_ms(ended_at_ms, chrono::Utc::now()),
        },
        subagents,
        events,
    })
}

/// Parses an ISO8601/RFC3339 timestamp into epoch milliseconds.
pub fn epoch_ms(ts: &str) -> Option<f64> {
    DateTime::parse_from_rfc3339(ts)
        .ok()
        .map(|dt| dt.timestamp_millis() as f64)
}

/// Known harness/slash-command wrapper tags (see is_markup_prompt).
const MARKUP_PREFIXES: &[&str] = &[
    "<command-message>",
    "<command-name>",
    "<command-args>",
    "<local-command-stdout>",
    "<local-command-caveat>",
];

/// Whether a prompt is harness/slash-command markup rather than human text
/// ("<command-message>…", "<local-command-caveat>…"). Used to pick a nicer
/// session title, never to drop the prompt from the event stream. Only matches
/// known wrapper tags, not any text that happens to start with '<' (e.g. a human
/// prompt pasting HTML/XML).
pub fn is_markup_prompt(text: &str) -> bool {
    let trimmed = text.trim_start();
    MARKUP_PREFIXES.iter().any(|tag| trimmed.starts_with(tag))
}

/// Char-boundary-safe excerpt of the first `chars` characters.
pub(crate) fn excerpt(s: &str, chars: usize) -> String {
    let trimmed = s.trim();
    if trimmed.chars().count() <= chars {
        trimmed.to_string()
    } else {
        let mut out: String = trimmed.chars().take(chars).collect();
        out.push('…');
        out
    }
}

fn input_str(tb: &crate::jsonl::entry::ContentBlock, key: &str) -> Option<String> {
    tb.input
        .as_ref()
        .and_then(|v| v.get(key))
        .and_then(|v| v.as_str())
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::activity::WorkKind;

    fn e(json: &str) -> RawEntry {
        serde_json::from_str(json).expect("fixture should parse")
    }

    fn build_main(jsons: &[&str]) -> BuiltFile {
        let mut b = ReplayBuilder::new_main();
        for j in jsons {
            b.push(&e(j));
        }
        b.finish()
    }

    /// SubFile with no sidecar meta (legacy chronological-zip path).
    fn sub_nometa(agent_id: &str, built: BuiltFile) -> SubFile {
        SubFile {
            agent_id: agent_id.to_string(),
            meta: None,
            built,
        }
    }

    /// SubFile whose sidecar meta names the spawning tool_use id and spawn depth.
    fn sub_meta(agent_id: &str, tool_use_id: &str, depth: u32, built: BuiltFile) -> SubFile {
        SubFile {
            agent_id: agent_id.to_string(),
            meta: Some(SubAgentMeta {
                agent_type: None,
                description: None,
                tool_use_id: Some(tool_use_id.to_string()),
                spawn_depth: Some(depth),
            }),
            built,
        }
    }

    const T0: &str = "2026-06-25T01:00:00.000Z";
    const T1: &str = "2026-06-25T01:00:05.000Z";
    const T2: &str = "2026-06-25T01:00:10.000Z";
    const T3: &str = "2026-06-25T01:00:15.000Z";

    /// prompt -> tool_use -> tool_result -> turn_end produces the ordered replay
    /// stream with SessionStart first and relative at_ms values.
    #[test]
    fn builds_ordered_stream() {
        let main = build_main(&[
            &format!(r#"{{"type":"user","timestamp":"{T0}","message":{{"role":"user","content":"fix the bug"}}}}"#),
            &format!(r#"{{"type":"assistant","timestamp":"{T1}","message":{{"role":"assistant","content":[{{"type":"tool_use","id":"c1","name":"Read","input":{{"file_path":"/a/Button.tsx"}}}}]}}}}"#),
            &format!(r#"{{"type":"user","timestamp":"{T2}","message":{{"role":"user","content":[{{"type":"tool_result","tool_use_id":"c1","is_error":false}}]}}}}"#),
            &format!(r#"{{"type":"system","subtype":"turn_duration","timestamp":"{T3}"}}"#),
        ]);
        let data = assemble("SID", main, vec![]).expect("assembles");

        let kinds: Vec<ReplayEventKind> = data.events.iter().map(|ev| ev.kind).collect();
        assert_eq!(
            kinds,
            vec![
                ReplayEventKind::SessionStart,
                ReplayEventKind::Activity,   // prompt -> Thinking
                ReplayEventKind::UserPrompt,
                ReplayEventKind::Activity,   // Read
                ReplayEventKind::PreToolUse,
                ReplayEventKind::PostToolUse,
                ReplayEventKind::Activity,   // turn_end -> Idle
                ReplayEventKind::TurnEnd,
            ]
        );
        assert_eq!(data.events[0].at_ms, 0.0);
        assert_eq!(data.events[3].at_ms, 5000.0);
        assert_eq!(data.events[3].work, Some(WorkKind::Reading));
        assert_eq!(data.events[3].detail.as_deref(), Some("Button.tsx"));
        assert_eq!(data.events[4].correlation_id.as_deref(), Some("c1"));
        // PostToolUse carries the most recent tool name and the pairing id.
        assert_eq!(data.events[5].tool_name.as_deref(), Some("Read"));
        assert_eq!(data.events[5].correlation_id.as_deref(), Some("c1"));
        assert_eq!(data.events[5].is_error, Some(false));
        assert_eq!(data.meta.first_prompt.as_deref(), Some("fix the bug"));
        assert_eq!(data.meta.started_at_ms, epoch_ms(T0).unwrap());
        assert_eq!(data.meta.ended_at_ms, epoch_ms(T3).unwrap());
        // These fixtures are long in the past, so assemble's status (computed
        // against the real current time) must read as Ended.
        assert_eq!(data.meta.status, crate::model::session::SessionStatus::Ended);
    }

    /// The Skill tool sets active_skill on subsequent Activity events.
    #[test]
    fn carries_active_skill() {
        let main = build_main(&[
            &format!(r#"{{"type":"assistant","timestamp":"{T0}","message":{{"role":"assistant","content":[{{"type":"tool_use","id":"c1","name":"Skill","input":{{"skill":"superpowers:brainstorming"}}}}]}}}}"#),
            &format!(r#"{{"type":"assistant","timestamp":"{T1}","message":{{"role":"assistant","content":[{{"type":"tool_use","id":"c2","name":"Edit","input":{{"file_path":"/a/x.ts"}}}}]}}}}"#),
        ]);
        let edit = main
            .events
            .iter()
            .find(|ev| ev.tool_name.as_deref() == Some("Edit") && ev.kind == ReplayEventKind::Activity)
            .expect("edit activity");
        assert_eq!(edit.active_skill.as_deref(), Some("brainstorming"));
    }

    /// The builder's first_prompt also prefers human text over command markup.
    #[test]
    fn builder_prefers_human_first_prompt() {
        let main = build_main(&[
            &format!(r#"{{"type":"user","timestamp":"{T0}","message":{{"role":"user","content":"<command-message>review</command-message>"}}}}"#),
            &format!(r#"{{"type":"user","timestamp":"{T1}","message":{{"role":"user","content":"review this branch please"}}}}"#),
        ]);
        assert_eq!(main.first_prompt.as_deref(), Some("review this branch please"));
    }

    /// Only known harness/slash-command wrapper tags count as markup: a human prompt
    /// that happens to start with '<' (pasted HTML/XML) must not be treated as such.
    #[test]
    fn is_markup_prompt_matches_only_known_tags() {
        assert!(is_markup_prompt("<command-message>review</command-message>"));
        assert!(is_markup_prompt("<local-command-caveat>Caveat: ...</local-command-caveat>"));
        assert!(!is_markup_prompt("<div>fix this html snippet</div>"));
        assert!(!is_markup_prompt("<script>alert(1)</script> is XSS, please review"));
    }

    /// Entries without a parsable timestamp are skipped entirely.
    #[test]
    fn skips_untimestamped_entries() {
        let main = build_main(&[
            r#"{"type":"user","message":{"role":"user","content":"no ts"}}"#,
            &format!(r#"{{"type":"user","timestamp":"{T0}","message":{{"role":"user","content":"ok"}}}}"#),
        ]);
        assert_eq!(main.first_ts_ms, epoch_ms(T0));
        assert_eq!(main.first_prompt.as_deref(), Some("ok"));
    }

    /// Agent tool_use emits SubagentSpawn and assemble links sub files chronologically.
    #[test]
    fn links_subagents_chronologically() {
        let main = build_main(&[
            &format!(r#"{{"type":"assistant","timestamp":"{T0}","message":{{"role":"assistant","content":[{{"type":"tool_use","id":"c1","name":"Agent","input":{{"subagent_type":"reviewer","description":"review the diff"}}}}]}}}}"#),
            &format!(r#"{{"type":"assistant","timestamp":"{T1}","message":{{"role":"assistant","content":[{{"type":"tool_use","id":"c2","name":"Task","input":{{"subagent_type":"explorer","description":"scan files"}}}}]}}}}"#),
        ]);
        assert_eq!(main.spawns.len(), 2);

        let mut sub_a = ReplayBuilder::new_sub("A");
        sub_a.push(&e(&format!(r#"{{"type":"assistant","timestamp":"{T2}","message":{{"role":"assistant","model":"claude-haiku-4-5","content":[{{"type":"tool_use","id":"s1","name":"Read","input":{{"file_path":"/a/y.ts"}}}}]}}}}"#)));
        let mut sub_b = ReplayBuilder::new_sub("B");
        sub_b.push(&e(&format!(r#"{{"type":"assistant","timestamp":"{T1}","message":{{"role":"assistant","content":[{{"type":"tool_use","id":"s2","name":"Grep","input":{{"pattern":"foo"}}}}]}}}}"#)));

        // Passed out of order on purpose: assemble must sort by first entry ts,
        // so B (earlier) links to the first spawn (reviewer).
        let data = assemble(
            "SID",
            main,
            vec![sub_nometa("A", sub_a.finish()), sub_nometa("B", sub_b.finish())],
        )
        .expect("assembles");

        assert_eq!(data.subagents.len(), 2);
        assert_eq!(data.subagents[0].agent_id, "B");
        assert_eq!(data.subagents[0].subagent_type.as_deref(), Some("reviewer"));
        assert_eq!(data.subagents[1].agent_id, "A");
        assert_eq!(data.subagents[1].subagent_type.as_deref(), Some("explorer"));
        assert_eq!(data.subagents[1].model.as_deref(), Some("claude-haiku-4-5"));

        let spawn_events: Vec<&ReplayEvent> = data
            .events
            .iter()
            .filter(|ev| ev.kind == ReplayEventKind::SubagentSpawn)
            .collect();
        assert_eq!(spawn_events.len(), 2);
        assert_eq!(spawn_events[0].detail.as_deref(), Some("reviewer"));
        assert_eq!(spawn_events[0].text.as_deref(), Some("review the diff"));
        // Both were spawned by the main session, so neither has a parent.
        assert!(data.subagents.iter().all(|s| s.parent_agent_id.is_none()));
    }

    /// The sidecar meta's toolUseId links each transcript to its exact spawn,
    /// even when the chronological order would pair them differently.
    #[test]
    fn links_subagents_by_sidecar_tool_use_id() {
        let main = build_main(&[
            &format!(r#"{{"type":"assistant","timestamp":"{T0}","message":{{"role":"assistant","content":[{{"type":"tool_use","id":"c1","name":"Agent","input":{{"subagent_type":"reviewer","description":"review"}}}},{{"type":"tool_use","id":"c2","name":"Agent","input":{{"subagent_type":"explorer","description":"scan"}}}}]}}}}"#),
        ]);
        assert_eq!(main.spawns.len(), 2);

        // A starts later but its sidecar names c1 (reviewer); B starts earlier but
        // names c2 (explorer). Chronological zip would swap them — sidecars must win.
        let mut sub_a = ReplayBuilder::new_sub("A");
        sub_a.push(&e(&format!(r#"{{"type":"assistant","timestamp":"{T2}","message":{{"role":"assistant","content":[{{"type":"tool_use","id":"s1","name":"Read","input":{{"file_path":"/a/y.ts"}}}}]}}}}"#)));
        let mut sub_b = ReplayBuilder::new_sub("B");
        sub_b.push(&e(&format!(r#"{{"type":"assistant","timestamp":"{T1}","message":{{"role":"assistant","content":[{{"type":"tool_use","id":"s2","name":"Grep","input":{{"pattern":"foo"}}}}]}}}}"#)));

        let data = assemble(
            "SID",
            main,
            vec![
                sub_meta("A", "c1", 1, sub_a.finish()),
                sub_meta("B", "c2", 1, sub_b.finish()),
            ],
        )
        .expect("assembles");

        let a = data.subagents.iter().find(|s| s.agent_id == "A").unwrap();
        assert_eq!(a.subagent_type.as_deref(), Some("reviewer"), "c1 -> reviewer");
        assert_eq!(a.spawn_depth, Some(1));
        assert_eq!(a.parent_agent_id, None);
        let b = data.subagents.iter().find(|s| s.agent_id == "B").unwrap();
        assert_eq!(b.subagent_type.as_deref(), Some("explorer"), "c2 -> explorer");
    }

    /// A subagent that spawns another agent records itself as the parent, and the
    /// child's sidecar links it to that nested Agent call (any depth).
    #[test]
    fn links_nested_delegation() {
        let main = build_main(&[
            &format!(r#"{{"type":"assistant","timestamp":"{T0}","message":{{"role":"assistant","content":[{{"type":"tool_use","id":"c1","name":"Agent","input":{{"subagent_type":"lead","description":"drive"}}}}]}}}}"#),
        ]);

        // The lead (A) spawns a child via nested Agent call c9.
        let mut lead = ReplayBuilder::new_sub("A");
        lead.push(&e(&format!(r#"{{"type":"assistant","timestamp":"{T1}","message":{{"role":"assistant","content":[{{"type":"tool_use","id":"c9","name":"Agent","input":{{"subagent_type":"explore","description":"dig"}}}}]}}}}"#)));
        // The child (B), its sidecar naming c9 at depth 2.
        let mut child = ReplayBuilder::new_sub("B");
        child.push(&e(&format!(r#"{{"type":"assistant","timestamp":"{T2}","message":{{"role":"assistant","content":[{{"type":"tool_use","id":"s1","name":"Bash","input":{{"command":"ls"}}}}]}}}}"#)));

        let data = assemble(
            "SID",
            main,
            vec![
                sub_meta("A", "c1", 1, lead.finish()),
                sub_meta("B", "c9", 2, child.finish()),
            ],
        )
        .expect("assembles");

        let a = data.subagents.iter().find(|s| s.agent_id == "A").unwrap();
        assert_eq!(a.parent_agent_id, None, "lead spawned by the orchestrator");
        let b = data.subagents.iter().find(|s| s.agent_id == "B").unwrap();
        assert_eq!(b.parent_agent_id.as_deref(), Some("A"), "child spawned by the lead");
        assert_eq!(b.spawn_depth, Some(2));
        assert_eq!(b.subagent_type.as_deref(), Some("explore"));
    }

    /// A sub file without a turn_end gets a synthesized SubagentStop at its last ts.
    #[test]
    fn synthesizes_subagent_stop() {
        let main = build_main(&[&format!(
            r#"{{"type":"assistant","timestamp":"{T0}","message":{{"role":"assistant","content":[{{"type":"tool_use","id":"c1","name":"Agent","input":{{"subagent_type":"worker"}}}}]}}}}"#
        )]);
        let mut sub = ReplayBuilder::new_sub("A");
        sub.push(&e(&format!(r#"{{"type":"assistant","timestamp":"{T1}","message":{{"role":"assistant","content":[{{"type":"tool_use","id":"s1","name":"Bash","input":{{"command":"ls"}}}}]}}}}"#)));

        let data = assemble("SID", main, vec![sub_nometa("A", sub.finish())]).expect("assembles");
        let stop = data
            .events
            .iter()
            .find(|ev| ev.kind == ReplayEventKind::SubagentStop)
            .expect("stop synthesized");
        assert_eq!(stop.agent_id.as_deref(), Some("A"));
        assert_eq!(stop.at_ms, 5000.0);
        assert_eq!(data.subagents[0].stop_ms, 5000.0);
        // The sub's last activity extends the session end.
        assert_eq!(data.meta.ended_at_ms, epoch_ms(T1).unwrap());
    }

    /// A sub file whose turn_end is present does not get a duplicate stop.
    #[test]
    fn keeps_real_subagent_stop() {
        let main = build_main(&[&format!(
            r#"{{"type":"user","timestamp":"{T0}","message":{{"role":"user","content":"go"}}}}"#
        )]);
        let mut sub = ReplayBuilder::new_sub("A");
        sub.push(&e(&format!(r#"{{"type":"system","subtype":"turn_duration","timestamp":"{T1}"}}"#)));
        let data = assemble("SID", main, vec![sub_nometa("A", sub.finish())]).expect("assembles");
        let stops = data
            .events
            .iter()
            .filter(|ev| ev.kind == ReplayEventKind::SubagentStop)
            .count();
        assert_eq!(stops, 1);
    }

    /// A stop_hook_summary yields a HookRunStart marker durationMs before the
    /// TurnEnd, so playback latches the hook exactly while the run was in flight.
    #[test]
    fn synthesizes_hook_run_start_before_summary() {
        use crate::hook_events::HookOutcome;
        let main = build_main(&[
            &format!(r#"{{"type":"user","timestamp":"{T0}","message":{{"role":"user","content":"go"}}}}"#),
            &format!(r#"{{"type":"system","subtype":"stop_hook_summary","hookInfos":[{{"command":"afplay Funk.aiff","durationMs":2900}}],"hookErrors":[],"preventedContinuation":false,"stopReason":"","timestamp":"{T1}"}}"#),
        ]);
        let data = assemble("SID", main, vec![]).expect("assembles");

        let start = data
            .events
            .iter()
            .find(|ev| ev.kind == ReplayEventKind::HookRunStart)
            .expect("start marker synthesized");
        let end = data
            .events
            .iter()
            .find(|ev| ev.kind == ReplayEventKind::TurnEnd)
            .expect("turn end kept");
        assert_eq!(end.at_ms, 5000.0);
        assert_eq!(start.at_ms, 5000.0 - 2900.0);
        assert_eq!(start.duration_ms, Some(2900.0));
        assert_eq!(start.hook_command.as_deref(), Some("afplay Funk.aiff"));
        assert_eq!(end.outcome, Some(HookOutcome::Completed));
        assert_eq!(end.duration_ms, Some(2900.0));
        // Events stay sorted, so the start marker is crossed before the end.
        let si = data.events.iter().position(|ev| ev.kind == ReplayEventKind::HookRunStart);
        let ei = data.events.iter().position(|ev| ev.kind == ReplayEventKind::TurnEnd);
        assert!(si < ei);
    }

    /// A run longer than the transcript so far clamps its start marker to the
    /// file's first entry (at_ms must not go negative after rebasing).
    #[test]
    fn hook_run_start_clamps_to_session_start() {
        let main = build_main(&[
            &format!(r#"{{"type":"user","timestamp":"{T0}","message":{{"role":"user","content":"go"}}}}"#),
            &format!(r#"{{"type":"system","subtype":"stop_hook_summary","hookInfos":[{{"command":"slow.sh","durationMs":99999}}],"timestamp":"{T1}"}}"#),
        ]);
        let data = assemble("SID", main, vec![]).expect("assembles");
        let start = data
            .events
            .iter()
            .find(|ev| ev.kind == ReplayEventKind::HookRunStart)
            .expect("start marker synthesized");
        assert_eq!(start.at_ms, 0.0);
    }

    /// A blocked stop summary still yields its TurnEnd marker (with the blocked
    /// outcome and run start), but no Idle activity row — the turn kept going.
    #[test]
    fn blocked_summary_keeps_activity_but_reports_stop() {
        use crate::hook_events::HookOutcome;
        let main = build_main(&[
            &format!(r#"{{"type":"assistant","timestamp":"{T0}","message":{{"role":"assistant","content":[{{"type":"tool_use","id":"c1","name":"Edit","input":{{"file_path":"/a/x.ts"}}}}]}}}}"#),
            &format!(r#"{{"type":"system","subtype":"stop_hook_summary","hookInfos":[{{"command":"./gate.sh","durationMs":900}}],"preventedContinuation":true,"stopReason":"keep going","timestamp":"{T1}"}}"#),
        ]);
        let data = assemble("SID", main, vec![]).expect("assembles");
        let end = data
            .events
            .iter()
            .find(|ev| ev.kind == ReplayEventKind::TurnEnd)
            .expect("the Stop lifecycle fired and is reported");
        assert_eq!(end.outcome, Some(HookOutcome::Blocked));
        assert_eq!(end.block_reason.as_deref(), Some("keep going"));
        assert!(
            data.events.iter().any(|ev| ev.kind == ReplayEventKind::HookRunStart),
            "the run interval is still synthesized"
        );
        assert!(
            !data
                .events
                .iter()
                .any(|ev| ev.kind == ReplayEventKind::Activity && ev.work == Some(WorkKind::Idle)),
            "no Idle row: the turn did not end"
        );
    }

    /// A recorded hook execution for a lifecycle outside the replay vocabulary
    /// (e.g. a cancelled UserPromptSubmit hook) is dropped instead of fabricating
    /// an empty prompt row.
    #[test]
    fn foreign_lifecycle_records_do_not_fabricate_rows() {
        let main = build_main(&[
            &format!(r#"{{"type":"user","timestamp":"{T0}","message":{{"role":"user","content":"go"}}}}"#),
            &format!(r#"{{"type":"attachment","attachment":{{"type":"hook_cancelled","hookName":"UserPromptSubmit","hookEvent":"UserPromptSubmit","command":"lint.sh","durationMs":150}},"timestamp":"{T1}"}}"#),
        ]);
        let prompts = main
            .events
            .iter()
            .filter(|ev| ev.kind == ReplayEventKind::UserPrompt)
            .count();
        assert_eq!(prompts, 1, "only the real human prompt appears");
    }

    /// A blocked SubagentStop does not count as the sub's departure: the
    /// synthesized final stop still marks the real end of the transcript.
    #[test]
    fn blocked_subagent_stop_does_not_suppress_synthesized_stop() {
        use crate::hook_events::HookOutcome;
        let main = build_main(&[&format!(
            r#"{{"type":"assistant","timestamp":"{T0}","message":{{"role":"assistant","content":[{{"type":"tool_use","id":"c1","name":"Agent","input":{{"subagent_type":"worker"}}}}]}}}}"#
        )]);
        let mut sub = ReplayBuilder::new_sub("A");
        sub.push(&e(&format!(
            r#"{{"type":"system","subtype":"stop_hook_summary","hookInfos":[{{"command":"./gate.sh","durationMs":100}}],"preventedContinuation":true,"stopReason":"more","timestamp":"{T1}"}}"#
        )));
        sub.push(&e(&format!(r#"{{"type":"assistant","timestamp":"{T2}","message":{{"role":"assistant","content":[{{"type":"tool_use","id":"s1","name":"Bash","input":{{"command":"ls"}}}}]}}}}"#)));

        let data = assemble("SID", main, vec![sub_nometa("A", sub.finish())]).expect("assembles");
        let stops: Vec<_> = data
            .events
            .iter()
            .filter(|ev| ev.kind == ReplayEventKind::SubagentStop)
            .collect();
        assert_eq!(stops.len(), 2, "blocked marker + synthesized departure");
        assert_eq!(stops[0].outcome, Some(HookOutcome::Blocked));
        assert_eq!(stops[1].at_ms, 10000.0, "departure at the last entry");
    }

    /// A blocked PreToolUse (hook rejection in the tool_result) flows its outcome
    /// and reason into the replay stream.
    #[test]
    fn pre_hook_block_flows_into_replay() {
        use crate::hook_events::HookOutcome;
        let main = build_main(&[
            &format!(r#"{{"type":"assistant","timestamp":"{T0}","message":{{"role":"assistant","content":[{{"type":"tool_use","id":"c1","name":"Read","input":{{"file_path":"/x.txt"}}}}]}}}}"#),
            &format!(r#"{{"type":"user","timestamp":"{T1}","message":{{"role":"user","content":[{{"type":"tool_result","content":"PreToolUse:Read hook error: [deny.sh]: nope","is_error":true,"tool_use_id":"c1"}}]}}}}"#),
        ]);
        let data = assemble("SID", main, vec![]).expect("assembles");
        let blocked = data
            .events
            .iter()
            .find(|ev| ev.kind == ReplayEventKind::PreToolUse && ev.outcome.is_some())
            .expect("blocked Pre in stream");
        assert_eq!(blocked.outcome, Some(HookOutcome::Blocked));
        assert_eq!(blocked.correlation_id.as_deref(), Some("c1"));
        assert_eq!(blocked.hook_command.as_deref(), Some("deny.sh"));
        assert_eq!(blocked.block_reason.as_deref(), Some("nope"));
        assert!(
            !data.events.iter().any(|ev| ev.kind == ReplayEventKind::PostToolUse),
            "a rejected tool has no Post"
        );
    }

    /// Excerpts cut on char boundaries (multi-byte safe) and add an ellipsis.
    #[test]
    fn excerpt_is_char_boundary_safe() {
        let long: String = "あ".repeat(300);
        let cut = excerpt(&long, EXCERPT_CHARS);
        assert_eq!(cut.chars().count(), EXCERPT_CHARS + 1);
        assert!(cut.ends_with('…'));
        assert_eq!(excerpt("  short  ", EXCERPT_CHARS), "short");
    }

    /// An empty main file yields None instead of a bogus zero-length session.
    #[test]
    fn empty_main_returns_none() {
        assert!(assemble("SID", BuiltFile::default(), vec![]).is_none());
    }

    /// A still-running session (last event moments ago) is tagged Active by
    /// assemble, not excluded — replay works on live sessions too.
    #[test]
    fn assemble_tags_a_recent_session_active() {
        let now = chrono::Utc::now();
        let ts = now.to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let main = build_main(&[&format!(
            r#"{{"type":"user","timestamp":"{ts}","message":{{"role":"user","content":"go"}}}}"#
        )]);
        let data = assemble("SID", main, vec![]).expect("assembles");
        assert_eq!(data.meta.status, crate::model::session::SessionStatus::Active);
    }
}
