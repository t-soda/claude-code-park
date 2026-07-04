use crate::jsonl::entry::RawEntry;
use crate::model::replay::{
    ReplayData, ReplayEvent, ReplayEventKind, ReplaySessionMeta, ReplaySubagent,
};
use chrono::DateTime;

/// Maximum number of characters kept from a user prompt / spawn description.
pub(crate) const EXCERPT_CHARS: usize = 200;

/// A subagent spawn recorded from the main file's Agent/Task tool_use,
/// waiting to be linked to a sub JSONL file in assemble().
#[derive(Debug, Clone)]
pub struct PendingSpawn {
    pub at_ms: f64,
    pub subagent_type: Option<String>,
    pub description: Option<String>,
}

/// The result of folding one JSONL file. Event timestamps are absolute epoch ms
/// here; assemble() rebases them onto the session start.
#[derive(Debug, Default)]
pub struct BuiltFile {
    pub events: Vec<ReplayEvent>,
    /// Main file only: spawns recorded from Agent/Task tool_use blocks.
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
        self.absorb_meta(e, at_ms);

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
                correlation_id: None,
                is_error: None,
                text: None,
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
            let (kind, text) = match ev.event.as_str() {
                "UserPromptSubmit" => (
                    ReplayEventKind::UserPrompt,
                    e.user_prompt_text().map(|s| excerpt(s, EXCERPT_CHARS)),
                ),
                "PreToolUse" => (ReplayEventKind::PreToolUse, None),
                "PostToolUse" => (ReplayEventKind::PostToolUse, None),
                "Stop" => (ReplayEventKind::TurnEnd, None),
                "SubagentStop" => {
                    self.out.saw_stop = true;
                    (ReplayEventKind::SubagentStop, None)
                }
                _ => return,
            };
            self.out.events.push(ReplayEvent {
                at_ms,
                kind,
                agent_id: self.agent_id.clone(),
                work: None,
                tool_name: ev.tool_name,
                detail: None,
                active_skill: None,
                correlation_id: ev.correlation_id,
                is_error: ev.is_error,
                text,
            });
        }
    }

    pub fn finish(self) -> BuiltFile {
        self.out
    }

    fn absorb_meta(&mut self, e: &RawEntry, at_ms: f64) {
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
        // Agent/Task tool_use -> a subagent spawn (main session only).
        if let Some(tb) = e.last_tool_use() {
            let name = tb.name.as_deref().unwrap_or("");
            if name == "Agent" || name == "Task" {
                let subagent_type = input_str(tb, "subagent_type");
                let description = input_str(tb, "description");
                self.out.spawns.push(PendingSpawn {
                    at_ms,
                    subagent_type: subagent_type.clone(),
                    description: description.clone(),
                });
                self.out.events.push(ReplayEvent {
                    at_ms,
                    kind: ReplayEventKind::SubagentSpawn,
                    agent_id: None,
                    work: None,
                    tool_name: None,
                    detail: subagent_type,
                    active_skill: None,
                    correlation_id: None,
                    is_error: None,
                    text: description.map(|d| excerpt(&d, EXCERPT_CHARS)),
                });
            }
        }
    }
}

/// Assembles the main file and its sub files into a single ReplayData:
/// links spawns to sub files chronologically (offline equivalent of the live
/// arrival-order heuristic in find_or_create_run), rebases all timestamps onto
/// the session start, and merge-sorts the event streams.
/// Returns None when the main file yielded no timestamped entries.
pub fn assemble(session_id: &str, main: BuiltFile, subs: Vec<(String, BuiltFile)>) -> Option<ReplayData> {
    let started_at_ms = main.first_ts_ms?;
    let mut ended_at_ms = main.last_ts_ms.unwrap_or(started_at_ms);

    let mut events: Vec<ReplayEvent> = Vec::with_capacity(1 + main.events.len());
    events.push(ReplayEvent {
        at_ms: started_at_ms,
        kind: ReplayEventKind::SessionStart,
        agent_id: None,
        work: None,
        tool_name: None,
        detail: None,
        active_skill: None,
        correlation_id: None,
        is_error: None,
        text: None,
    });
    events.extend(main.events);

    // Chronological zip: spawns in main-file order vs sub files by first entry ts.
    let mut spawns = main.spawns;
    spawns.sort_by(|a, b| a.at_ms.total_cmp(&b.at_ms));
    let mut sub_files: Vec<(String, BuiltFile)> = subs
        .into_iter()
        .filter(|(_, b)| b.first_ts_ms.is_some())
        .collect();
    sub_files.sort_by(|a, b| a.1.first_ts_ms.unwrap().total_cmp(&b.1.first_ts_ms.unwrap()));

    let mut subagents: Vec<ReplaySubagent> = Vec::new();
    let n_linked = spawns.len().min(sub_files.len());
    for (i, (agent_id, mut built)) in sub_files.into_iter().enumerate() {
        let spawn = spawns.get(i);
        let spawn_ms = spawn
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
                work: None,
                tool_name: None,
                detail: None,
                active_skill: None,
                correlation_id: None,
                is_error: None,
                text: None,
            });
        }
        events.extend(built.events);
        subagents.push(ReplaySubagent {
            agent_id,
            subagent_type: spawn.and_then(|s| s.subagent_type.clone()),
            description: spawn.and_then(|s| s.description.clone()),
            model: built.model,
            spawn_ms,
            stop_ms,
        });
    }
    // Spawns with no sub file (e.g. inline agents that never wrote a transcript):
    // log-only, no sprite (empty agent_id, mirroring the live unlinked-run convention).
    for spawn in spawns.into_iter().skip(n_linked) {
        subagents.push(ReplaySubagent {
            agent_id: String::new(),
            subagent_type: spawn.subagent_type,
            description: spawn.description,
            model: None,
            spawn_ms: spawn.at_ms,
            stop_ms: spawn.at_ms,
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
            vec![("A".into(), sub_a.finish()), ("B".into(), sub_b.finish())],
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
    }

    /// A sub file without a turn_end gets a synthesized SubagentStop at its last ts.
    #[test]
    fn synthesizes_subagent_stop() {
        let main = build_main(&[&format!(
            r#"{{"type":"assistant","timestamp":"{T0}","message":{{"role":"assistant","content":[{{"type":"tool_use","id":"c1","name":"Agent","input":{{"subagent_type":"worker"}}}}]}}}}"#
        )]);
        let mut sub = ReplayBuilder::new_sub("A");
        sub.push(&e(&format!(r#"{{"type":"assistant","timestamp":"{T1}","message":{{"role":"assistant","content":[{{"type":"tool_use","id":"s1","name":"Bash","input":{{"command":"ls"}}}}]}}}}"#)));

        let data = assemble("SID", main, vec![("A".into(), sub.finish())]).expect("assembles");
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
        let data = assemble("SID", main, vec![("A".into(), sub.finish())]).expect("assembles");
        let stops = data
            .events
            .iter()
            .filter(|ev| ev.kind == ReplayEventKind::SubagentStop)
            .count();
        assert_eq!(stops, 1);
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
