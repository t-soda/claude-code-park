use super::classify::{basename, classify_tool, skill_name};
use crate::jsonl::entry::RawEntry;
use crate::jsonl::meta::SubAgentMeta;
use crate::model::activity::{ActivityState, WorkKind};
use crate::model::session::{Session, SessionStatus, SubAgentRun};
use crate::state::World;
use chrono::{DateTime, Utc};

/// Once no events occur for longer than this many seconds, become Idle; beyond that, Ended.
/// A normal "work finished" is handled by the JSONL turn_end marker (turn_duration/stop_hook_summary),
/// which drops to Idle immediately, so this time-based check is a fallback for abnormal termination.
/// During extended thinking or long tool runs, writes to the main session can pause for several minutes
/// (up to ~3 minutes observed), so 90 seconds would wrongly show a working session as idle. Allow extra margin.
const ACTIVE_SECS: i64 = 5 * 60;
const IDLE_SECS: i64 = 15 * 60;

/// Leading text of the tool_result returned immediately when an agent is spawned
/// with run_in_background: the agent is still working, so this must not be taken
/// as its completion. If a future CLI changes the wording, the fallback is a brief
/// wrong Ended that the next transcript append revives, so detection degrades soft.
const ASYNC_LAUNCH_ACK: &str = "Async agent launched successfully";

/// Applies the diff entries of the main session JSONL to the World. Returns true if anything changed.
/// Pushes the reconstructed lifecycle events onto `out`.
pub fn apply_main(
    world: &mut World,
    session_id: &str,
    entries: &[RawEntry],
    out: &mut Vec<crate::hook_events::HookEvent>,
) -> bool {
    if entries.is_empty() {
        return false;
    }
    let is_new = !world.sessions.contains_key(session_id);
    if is_new {
        out.push(crate::hook_events::HookEvent {
            session_id: session_id.to_string(),
            agent_id: None,
            event: "SessionStart".to_string(),
            tool_name: None,
            ts: entries[0].timestamp.clone().unwrap_or_default(),
            correlation_id: None,
            is_error: None,
        });
    }
    let session = world
        .sessions
        .entry(session_id.to_string())
        .or_insert_with(|| new_session(session_id));

    for e in entries {
        absorb_meta(session, e);
        // Agent tool_use -> record each spawned sub agent clocking in. One assistant
        // entry may spawn several agents in parallel, so scan every block.
        register_agent_calls(session, e, None);
        // The spawning tool_use's tool_result / a task-notification marks the
        // matching run as completed the moment the CLI records it.
        finalize_completed_runs(session, e);
        let last_tool = session.current.tool_name.clone();
        let skill = next_active_skill(e, session.current.active_skill.clone());
        let todos = next_todos(e, session.current.todos.clone());
        if let Some(mut state) = classify_entry(e) {
            state.active_skill = skill;
            state.todos = todos;
            session.current = state;
        } else {
            // Keep the work kind unchanged, but apply skill / todos updates (including clear/set).
            session.current.active_skill = skill;
            session.current.todos = todos;
        }
        if let Some(ev) = reconstruct(e, session_id, None, last_tool, false) {
            out.push(ev);
        }
    }
    true
}

/// Applies the diff entries of a sub agent JSONL to the SubAgentRun under the parent session.
pub fn apply_sub(
    world: &mut World,
    parent_id: &str,
    agent_id: &str,
    meta: Option<&SubAgentMeta>,
    entries: &[RawEntry],
    out: &mut Vec<crate::hook_events::HookEvent>,
) -> bool {
    if entries.is_empty() {
        return false;
    }
    let session = world
        .sessions
        .entry(parent_id.to_string())
        .or_insert_with(|| new_session(parent_id));

    // Find an existing run: match by agent_id -> else by the sidecar meta's spawning
    // tool_use id -> else the latest run with no agent_id assigned -> else create new.
    let idx = find_or_create_run(session, agent_id, meta);
    absorb_run_meta(&mut session.subagents[idx], meta);

    for e in entries {
        if let Some(ts) = e.timestamp.clone() {
            session.subagents[idx].started_at.get_or_insert(ts.clone());
            session.subagents[idx].last_event_at = Some(ts.clone());
            session.last_event_at = Some(ts);
        }
        // A subagent can itself spawn agents (nested delegation); record those
        // calls with this agent as the parent.
        register_agent_calls(session, e, Some(agent_id));
        // This transcript also carries the tool_results / notifications that end
        // the agents this subagent spawned.
        finalize_completed_runs(session, e);
        // Record the model the assistant entry actually used (to pick the sprite by the
        // runtime model rather than the static model in the definition). Set it as soon as it is known, then update with later values.
        if let Some(model) = e.model() {
            session.subagents[idx].model = Some(model.to_string());
        }
        let last_tool = session.subagents[idx].current.tool_name.clone();
        let skill = next_active_skill(e, session.subagents[idx].current.active_skill.clone());
        let todos = next_todos(e, session.subagents[idx].current.todos.clone());
        if let Some(mut state) = classify_entry(e) {
            state.active_skill = skill;
            state.todos = todos;
            session.subagents[idx].current = state;
        } else {
            session.subagents[idx].current.active_skill = skill;
            session.subagents[idx].current.todos = todos;
        }
        if let Some(ev) = reconstruct(e, parent_id, Some(agent_id), last_tool, true) {
            out.push(ev);
        }
    }
    // Completed runs come back to life only on genuinely later activity (a resumed
    // background agent). Trailing writes stamped before the parent's tool_result —
    // the transcript and the parent append near-simultaneously, so the watcher may
    // process them in either order — must not revive a finished run.
    let run = &mut session.subagents[idx];
    let revived = match (run.completed_at.as_deref(), run.last_event_at.as_deref()) {
        (Some(completed), Some(last)) => ts_after(last, completed),
        (Some(_), None) => false,
        (None, _) => true,
    };
    if revived {
        run.completed_at = None;
        run.status = SessionStatus::Active;
    }
    true
}

/// The lifecycle event reconstructed from a single entry.
/// For PostToolUse, the caller passes the most recent tool name as `post_tool`
/// (handled the same for main/sub). If is_sub=true, turn_end becomes SubagentStop.
pub(crate) fn reconstruct(
    e: &RawEntry,
    session_id: &str,
    agent_id: Option<&str>,
    post_tool: Option<String>,
    is_sub: bool,
) -> Option<crate::hook_events::HookEvent> {
    let ts = e.timestamp.clone().unwrap_or_default();
    let (event, tool_name, correlation_id, is_error): (
        &str,
        Option<String>,
        Option<String>,
        Option<bool>,
    ) = if e.is_user_prompt() && !is_sub {
        ("UserPromptSubmit", None, None, None)
    } else if let Some(tb) = e.last_tool_use() {
        ("PreToolUse", tb.name.clone(), tb.id.clone(), None)
    } else if let Some(tr) = e.tool_results().next() {
        ("PostToolUse", post_tool, tr.tool_use_id.clone(), tr.is_error)
    } else if e.is_turn_end() {
        (if is_sub { "SubagentStop" } else { "Stop" }, None, None, None)
    } else {
        return None;
    };
    Some(crate::hook_events::HookEvent {
        session_id: session_id.to_string(),
        agent_id: agent_id.map(str::to_string),
        event: event.to_string(),
        tool_name,
        ts,
        correlation_id,
        is_error,
    })
}

/// Creates an active main session.
fn new_session(id: &str) -> Session {
    Session {
        session_id: id.to_string(),
        is_main: true,
        status: SessionStatus::Active,
        ..Default::default()
    }
}

/// Determines the current work state from a single entry. Entries that do not change
/// the state (text responses, tool_result, etc.) return None and keep the previous state.
/// - Turn complete -> idle (Idle) / tool run -> kind / extended thinking -> thinking
fn classify_entry(e: &RawEntry) -> Option<ActivityState> {
    if e.is_turn_end() {
        return Some(ActivityState {
            kind: WorkKind::Idle,
            tool_name: None,
            detail: None,
            since: e.timestamp.clone(),
            active_skill: None,
            todos: Vec::new(),
        });
    }
    // Receiving a prompt = work begins. Show as working even before the first assistant entry appears.
    if e.is_user_prompt() {
        return Some(ActivityState {
            kind: WorkKind::Thinking,
            tool_name: None,
            detail: None,
            since: e.timestamp.clone(),
            active_skill: None,
            todos: Vec::new(),
        });
    }
    if let Some(tb) = e.last_tool_use() {
        let name = tb.name.as_deref().unwrap_or("");
        if name == "TodoWrite" {
            // Bookkeeping. Does not change the work kind (the todos update is handled by next_todos).
            return None;
        }
        let (kind, detail) = classify_tool(name, tb.input.as_ref());
        return Some(ActivityState {
            kind,
            tool_name: Some(name.to_string()),
            detail,
            since: e.timestamp.clone(),
            active_skill: None,
            todos: Vec::new(),
        });
    }
    if e.has_thinking() {
        return Some(ActivityState {
            kind: WorkKind::Thinking,
            tool_name: None,
            detail: None,
            since: e.timestamp.clone(),
            active_skill: None,
            todos: Vec::new(),
        });
    }
    None
}

/// Decides the next active_skill. Cleared on turn end / new prompt,
/// set by the Skill tool, otherwise carries over the previous value.
fn next_active_skill(e: &RawEntry, prev: Option<String>) -> Option<String> {
    if e.is_turn_end() || e.is_user_prompt() {
        return None;
    }
    if let Some(tb) = e.last_tool_use() {
        if tb.name.as_deref() == Some("Skill") {
            return skill_name(tb.input.as_ref());
        }
    }
    prev
}

/// Decides the next todos. Cleared on turn_end / new prompt, set by TodoWrite,
/// otherwise carries over the previous value (symmetric with next_active_skill).
fn next_todos(e: &RawEntry, prev: Vec<crate::model::activity::TodoItem>) -> Vec<crate::model::activity::TodoItem> {
    if e.is_turn_end() || e.is_user_prompt() {
        return Vec::new();
    }
    if let Some(tb) = e.last_tool_use() {
        if tb.name.as_deref() == Some("TodoWrite") {
            return crate::pipeline::classify::parse_todos(tb.input.as_ref());
        }
    }
    prev
}

/// Absorbs meta information (cwd/branch/slug/timestamp) into the session.
fn absorb_meta(session: &mut Session, e: &RawEntry) {
    if let Some(cwd) = &e.cwd {
        session.project = cwd.clone();
    }
    if e.git_branch.is_some() {
        session.git_branch = e.git_branch.clone();
    }
    if e.slug.is_some() {
        session.slug = e.slug.clone();
    }
    // Keep the entrypoint once it is known (do not overwrite, since later entries do not carry it).
    if e.entrypoint.is_some() {
        session.entrypoint = e.entrypoint.clone();
    }
    if let Some(ts) = e.timestamp.clone() {
        if session.started_at.is_none() {
            session.started_at = Some(ts.clone());
        }
        session.last_event_at = Some(ts);
    }
}

/// Marks runs whose completion this entry records: a tool_result answering the
/// spawning Agent tool_use (except the run_in_background launch ack, which arrives
/// while the agent works), or a task-notification saying a background agent stopped.
/// Completion pins the run to Ended until the transcript proves later activity.
fn finalize_completed_runs(session: &mut Session, e: &RawEntry) {
    let Some(result_ts) = e.timestamp.as_deref() else {
        // Without a timestamp the revival comparison cannot work; leave the run
        // to the time-decay fallback.
        return;
    };
    for tr in e.tool_results() {
        if tr.result_text().is_some_and(|t| t.starts_with(ASYNC_LAUNCH_ACK)) {
            continue;
        }
        let Some(tid) = tr.tool_use_id.as_deref() else {
            continue;
        };
        if let Some(run) = session
            .subagents
            .iter_mut()
            .find(|r| r.tool_use_id.as_deref() == Some(tid))
        {
            finalize_run(run, result_ts);
        }
    }
    if let Some(n) = e.task_notification() {
        if let Some(run) = session.subagents.iter_mut().find(|r| {
            (!r.agent_id.is_empty() && r.agent_id == n.task_id)
                || (r.tool_use_id.is_some() && r.tool_use_id == n.tool_use_id)
        }) {
            finalize_run(run, result_ts);
        }
    }
}

fn finalize_run(run: &mut SubAgentRun, result_ts: &str) {
    // The transcript already shows activity past this completion record (a
    // background agent that was resumed before we read the notification).
    if run
        .last_event_at
        .as_deref()
        .is_some_and(|last| ts_after(last, result_ts))
    {
        return;
    }
    run.completed_at = Some(result_ts.to_string());
    run.status = SessionStatus::Ended;
    mark_idle(&mut run.current);
}

/// Whether timestamp `a` is strictly later than `b`. Falls back to string order
/// when either does not parse (Claude Code stamps are uniform RFC3339 UTC, so
/// lexicographic order matches chronological order).
fn ts_after(a: &str, b: &str) -> bool {
    match (
        DateTime::parse_from_rfc3339(a),
        DateTime::parse_from_rfc3339(b),
    ) {
        (Ok(pa), Ok(pb)) => pa > pb,
        _ => a > b,
    }
}

/// Registers a SubAgentRun for every Agent tool_use in the entry.
/// `caller` is the spawning subagent's id (None when the main session spawns).
fn register_agent_calls(session: &mut Session, e: &RawEntry, caller: Option<&str>) {
    for tb in e.blocks() {
        if tb.block_type.as_deref() != Some("tool_use") {
            continue;
        }
        if matches!(tb.name.as_deref(), Some("Agent") | Some("Task")) {
            register_subagent(session, tb, e.timestamp.as_deref(), caller);
        }
    }
}

fn register_subagent(
    session: &mut Session,
    tb: &crate::jsonl::entry::ContentBlock,
    ts: Option<&str>,
    caller: Option<&str>,
) {
    let subagent_type = tb
        .input
        .as_ref()
        .and_then(|v| v.get("subagent_type"))
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let description = tb
        .input
        .as_ref()
        .and_then(|v| v.get("description"))
        .and_then(|v| v.as_str())
        .map(str::to_string);
    // The spawned transcript may have been read before this call (startup scans and
    // live tails don't order caller vs callee). Its sidecar meta already recorded
    // this tool_use id, so enrich that run instead of duplicating it.
    if let Some(tid) = tb.id.as_deref() {
        if let Some(i) = session
            .subagents
            .iter()
            .position(|r| r.tool_use_id.as_deref() == Some(tid))
        {
            let run = &mut session.subagents[i];
            if run.parent_agent_id.is_none() {
                run.parent_agent_id = caller.map(str::to_string);
            }
            if run.subagent_type.is_none() {
                run.subagent_type = subagent_type;
            }
            if run.description.is_none() {
                run.description = description;
            }
            if run.started_at.is_none() {
                run.started_at = ts.map(str::to_string);
            }
            return;
        }
    }
    session.subagents.push(SubAgentRun {
        agent_id: String::new(),
        subagent_type,
        description,
        model: None,
        started_at: ts.map(str::to_string),
        last_event_at: None,
        completed_at: None,
        status: SessionStatus::Active,
        current: ActivityState::default(),
        tool_use_id: tb.id.clone(),
        parent_agent_id: caller.map(str::to_string),
        spawn_depth: None,
    });
}

/// Merges sidecar meta into the run. Fields already learned from the caller's
/// Agent tool_use win; the sidecar fills whatever registration could not know
/// (spawn_depth always, everything else when the caller's transcript was never read).
fn absorb_run_meta(run: &mut SubAgentRun, meta: Option<&SubAgentMeta>) {
    let Some(m) = meta else { return };
    if run.spawn_depth.is_none() {
        run.spawn_depth = m.spawn_depth;
    }
    if run.tool_use_id.is_none() {
        run.tool_use_id = m.tool_use_id.clone();
    }
    if run.subagent_type.is_none() {
        run.subagent_type = m.agent_type.clone();
    }
    if run.description.is_none() {
        run.description = m.description.clone();
    }
}

fn find_or_create_run(session: &mut Session, agent_id: &str, meta: Option<&SubAgentMeta>) -> usize {
    if let Some(i) = session
        .subagents
        .iter()
        .position(|r| r.agent_id == agent_id)
    {
        return i;
    }
    // Exact link: the sidecar meta names the spawning tool_use, so claim the pending
    // run registered from that call (robust when several spawns are in flight).
    if let Some(tid) = meta.and_then(|m| m.tool_use_id.as_deref()) {
        if let Some(i) = session
            .subagents
            .iter()
            .position(|r| r.agent_id.is_empty() && r.tool_use_id.as_deref() == Some(tid))
        {
            session.subagents[i].agent_id = agent_id.to_string();
            return i;
        }
        // The named call was never seen (caller's transcript outside the restore
        // window). Don't steal another spawn's pending run; start a fresh one.
    } else if let Some(i) = session
        .subagents
        .iter()
        .rposition(|r| r.agent_id.is_empty())
    {
        // No sidecar: fall back to the latest run with no agent_id assigned
        // (arrival-order heuristic, as before sidecar metas existed).
        session.subagents[i].agent_id = agent_id.to_string();
        return i;
    }
    session.subagents.push(SubAgentRun {
        agent_id: agent_id.to_string(),
        status: SessionStatus::Active,
        ..Default::default()
    });
    session.subagents.len() - 1
}

/// Whether this session may be displayed/counted as a clocked-in main session.
/// Excludes sdk-cli (non-interactive sessions launched by SDK/eval). Interactive launches (cli) and
/// unknown entrypoint (older versions) are displayed.
pub fn is_displayable(session: &Session) -> bool {
    session.entrypoint.as_deref() != Some("sdk-cli")
}

/// Determines the status from last_event_at (ISO8601) and the current time.
pub fn status_from_last(last_event_at: Option<&str>, now: DateTime<Utc>) -> SessionStatus {
    let Some(ts) = last_event_at else {
        return SessionStatus::Ended;
    };
    let Ok(dt) = DateTime::parse_from_rfc3339(ts) else {
        return SessionStatus::Idle;
    };
    status_from_age_secs(now.signed_duration_since(dt.with_timezone(&Utc)).num_seconds())
}

/// Same thresholds as status_from_last, for callers that already have the last
/// event time as epoch milliseconds (e.g. the replay pipeline, which never
/// round-trips through an ISO string).
pub fn status_from_epoch_ms(last_event_at_ms: f64, now: DateTime<Utc>) -> SessionStatus {
    let age_secs = now.timestamp_millis() - last_event_at_ms as i64;
    status_from_age_secs(age_secs / 1000)
}

fn status_from_age_secs(age: i64) -> SessionStatus {
    if age <= ACTIVE_SECS {
        SessionStatus::Active
    } else if age <= IDLE_SECS {
        SessionStatus::Idle
    } else {
        SessionStatus::Ended
    }
}

/// Recomputes the status of all sessions/subagents in the World relative to the current time.
/// Once no longer Active, resets the work kind to Idle (💤 waiting) (prevents the last tool from lingering) —
/// unless it's genuinely still waiting on the user (see `keeps_awaiting_state`).
pub fn recompute_statuses(world: &mut World, now: DateTime<Utc>) {
    for s in world.sessions.values_mut() {
        s.status = status_from_last(s.last_event_at.as_deref(), now);
        if s.status != SessionStatus::Active && !keeps_awaiting_state(s.status, s.current.kind) {
            mark_idle(&mut s.current);
        }
        // A killed CLI never records its subagents' tool_results, so an Ended
        // parent drags every run down with it (no orphans working in the ruins).
        let parent_ended = s.status == SessionStatus::Ended;
        for r in &mut s.subagents {
            // A recorded completion pins the run to Ended regardless of how
            // recent its last transcript entry is (apply_sub lifts the pin when
            // genuinely later activity arrives).
            if parent_ended || r.completed_at.is_some() {
                r.status = SessionStatus::Ended;
                mark_idle(&mut r.current);
                continue;
            }
            let last = r
                .last_event_at
                .as_deref()
                .or(r.current.since.as_deref())
                .or(r.started_at.as_deref());
            r.status = status_from_last(last, now);
            if r.status != SessionStatus::Active && !keeps_awaiting_state(r.status, r.current.kind) {
                mark_idle(&mut r.current);
            }
        }
    }
}

/// Whether recompute_statuses should leave `current` alone despite the
/// session/subagent going inactive.
///
/// A session blocked on an explicit question or plan approval (AwaitingUser)
/// is expected to sit without new JSONL events for as long as the user takes
/// to decide — that's the entire point of the tray's "waiting for your
/// reply" indicator. Without this exemption, `mark_idle` would silently
/// clear it after the same 5-minute inactivity window used for every other
/// work kind, so stepping away for a coffee would make the icon (and its
/// menu entry) disappear while the question is still genuinely unanswered.
/// Once status reaches Ended (the existing "session probably abandoned"
/// threshold), treat it like any other stale state instead of waiting forever.
fn keeps_awaiting_state(status: SessionStatus, kind: WorkKind) -> bool {
    status != SessionStatus::Ended && kind == WorkKind::AwaitingUser
}

/// A session currently blocked on an explicit question or plan approval,
/// with the bits the tray menu needs to display it and jump to its terminal.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AwaitingSession {
    pub session_id: String,
    pub project: String,
    /// Display label: the slug if the session has one, else the project's
    /// basename (mirrors the frontend's `slug ?? project.split('/').pop()`
    /// convention used for the office/replay session labels).
    pub label: String,
}

/// Sessions blocked on an explicit question or plan approval (AwaitingUser).
/// Drives the menu-bar attention animation and its "jump to this session"
/// menu.
///
/// Deliberately excludes plain Idle (turn ended normally): that is the
/// resting state after every single turn, including the session driving
/// the very conversation the user is having right now, so treating it as
/// "waiting for a reply" made the icon animate constantly regardless of
/// whether anything actually needed attention.
pub fn sessions_awaiting_reply(sessions: &[Session]) -> Vec<AwaitingSession> {
    sessions
        .iter()
        .filter(|s| s.current.kind == WorkKind::AwaitingUser)
        .map(|s| AwaitingSession {
            session_id: s.session_id.clone(),
            project: s.project.clone(),
            label: s
                .slug
                .clone()
                .unwrap_or_else(|| basename(&s.project).to_string()),
        })
        .collect()
}

/// Resets the work state to idle (Idle).
fn mark_idle(current: &mut ActivityState) {
    current.kind = WorkKind::Idle;
    current.tool_name = None;
    current.detail = None;
    current.active_skill = None;
    current.todos.clear();
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::jsonl::entry::RawEntry;
    use crate::model::activity::WorkKind;

    fn e(json: &str) -> RawEntry {
        serde_json::from_str(json).expect("fixture should parse")
    }

    /// In the main session, going Read -> Edit makes the current state Editing with the detail being the file name.
    #[test]
    fn main_session_tracks_latest_tool() {
        let mut w = World::default();
        let read = e(r#"{"type":"assistant","timestamp":"2026-06-21T16:17:32.496Z","sessionId":"S","cwd":"/proj","gitBranch":"main","slug":"x","message":{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"Read","input":{"file_path":"/a/b/Button.tsx"}}]}}"#);
        let edit = e(r#"{"type":"assistant","timestamp":"2026-06-21T16:18:00.000Z","sessionId":"S","cwd":"/proj","message":{"role":"assistant","content":[{"type":"tool_use","id":"t2","name":"Edit","input":{"file_path":"/a/b/handler.ts"}}]}}"#);

        assert!(apply_main(&mut w, "S", &[read, edit], &mut Vec::new()));
        let s = w.sessions.get("S").unwrap();
        assert_eq!(s.current.kind, WorkKind::Editing);
        assert_eq!(s.current.detail.as_deref(), Some("handler.ts"));
        assert_eq!(s.project, "/proj");
        assert!(s.is_main);
    }

    /// An Agent tool_use registers a sub agent, which is then linked by the contents of the subagent file.
    #[test]
    fn agent_call_registers_and_links_subagent() {
        let mut w = World::default();
        let delegate = e(r#"{"type":"assistant","timestamp":"2026-06-21T16:20:00.000Z","sessionId":"S","cwd":"/proj","message":{"role":"assistant","content":[{"type":"tool_use","id":"t3","name":"Agent","input":{"subagent_type":"Explore","description":"investigate"}}]}}"#);
        apply_main(&mut w, "S", &[delegate], &mut Vec::new());
        {
            let s = w.sessions.get("S").unwrap();
            assert_eq!(s.current.kind, WorkKind::Delegating);
            assert_eq!(s.subagents.len(), 1);
            assert_eq!(s.subagents[0].subagent_type.as_deref(), Some("Explore"));
            assert!(s.subagents[0].agent_id.is_empty());
        }

        let sub_work = e(r#"{"type":"assistant","isSidechain":true,"agentId":"aid1","timestamp":"2026-06-21T16:20:30.000Z","sessionId":"S","message":{"role":"assistant","content":[{"type":"tool_use","id":"t4","name":"Bash","input":{"command":"npm test","description":"run tests"}}]}}"#);
        apply_sub(&mut w, "S", "aid1", None, &[sub_work], &mut Vec::new());

        let s = w.sessions.get("S").unwrap();
        assert_eq!(s.subagents.len(), 1, "attaches to the unassigned run, so it does not increase");
        assert_eq!(s.subagents[0].agent_id, "aid1");
        assert_eq!(s.subagents[0].current.kind, WorkKind::Running);
        assert_eq!(s.subagents[0].current.detail.as_deref(), Some("run tests"));
    }

    fn meta(tool_use_id: &str, depth: u32) -> SubAgentMeta {
        SubAgentMeta {
            agent_type: Some("general-purpose".into()),
            description: None,
            tool_use_id: Some(tool_use_id.into()),
            spawn_depth: Some(depth),
        }
    }

    /// One assistant entry can spawn several agents in parallel; every Agent
    /// tool_use registers a run (not just the last block).
    #[test]
    fn parallel_agent_calls_register_every_run() {
        let mut w = World::default();
        let delegate = e(
            r#"{"type":"assistant","timestamp":"2026-06-21T16:20:00.000Z","sessionId":"S","cwd":"/proj","message":{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"Agent","input":{"subagent_type":"Explore","description":"a"}},{"type":"tool_use","id":"t2","name":"Agent","input":{"subagent_type":"Plan","description":"b"}}]}}"#,
        );
        apply_main(&mut w, "S", &[delegate], &mut Vec::new());
        let s = w.sessions.get("S").unwrap();
        assert_eq!(s.subagents.len(), 2);
        assert_eq!(s.subagents[0].tool_use_id.as_deref(), Some("t1"));
        assert_eq!(s.subagents[1].tool_use_id.as_deref(), Some("t2"));
        assert!(s.subagents.iter().all(|r| r.parent_agent_id.is_none()));
    }

    /// A subagent spawning another agent records itself as the caller, and the
    /// child's sidecar meta links the transcript to that exact call.
    #[test]
    fn nested_agent_call_links_child_to_caller() {
        let mut w = World::default();
        let root = e(
            r#"{"type":"assistant","timestamp":"2026-06-21T16:20:00.000Z","sessionId":"S","cwd":"/proj","message":{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"Agent","input":{"subagent_type":"lead","description":"drive"}}]}}"#,
        );
        apply_main(&mut w, "S", &[root], &mut Vec::new());

        // X's transcript arrives (sidecar names t1) and spawns a child via t9.
        let x_spawn = e(
            r#"{"type":"assistant","isSidechain":true,"timestamp":"2026-06-21T16:20:30.000Z","sessionId":"S","message":{"role":"assistant","content":[{"type":"tool_use","id":"t9","name":"Agent","input":{"subagent_type":"Explore","description":"dig"}}]}}"#,
        );
        apply_sub(&mut w, "S", "X", Some(&meta("t1", 1)), &[x_spawn], &mut Vec::new());

        // The child's transcript arrives, its sidecar naming t9 at depth 2.
        let child_work = e(
            r#"{"type":"assistant","isSidechain":true,"timestamp":"2026-06-21T16:21:00.000Z","sessionId":"S","message":{"role":"assistant","content":[{"type":"tool_use","id":"t20","name":"Bash","input":{"command":"ls","description":"list"}}]}}"#,
        );
        apply_sub(&mut w, "S", "C", Some(&meta("t9", 2)), &[child_work], &mut Vec::new());

        let s = w.sessions.get("S").unwrap();
        assert_eq!(s.subagents.len(), 2);
        let x = s.subagents.iter().find(|r| r.agent_id == "X").unwrap();
        assert_eq!(x.parent_agent_id, None);
        assert_eq!(x.spawn_depth, Some(1));
        let c = s.subagents.iter().find(|r| r.agent_id == "C").unwrap();
        assert_eq!(c.parent_agent_id.as_deref(), Some("X"));
        assert_eq!(c.spawn_depth, Some(2));
        assert_eq!(c.subagent_type.as_deref(), Some("Explore"));
    }

    /// The sidecar's toolUseId claims the matching pending run even when the
    /// transcripts arrive in the opposite order of the spawn calls.
    #[test]
    fn sidecar_links_exact_run_out_of_order() {
        let mut w = World::default();
        let delegate = e(
            r#"{"type":"assistant","timestamp":"2026-06-21T16:20:00.000Z","sessionId":"S","cwd":"/proj","message":{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"Agent","input":{"subagent_type":"Explore","description":"first"}},{"type":"tool_use","id":"t2","name":"Agent","input":{"subagent_type":"Plan","description":"second"}}]}}"#,
        );
        apply_main(&mut w, "S", &[delegate], &mut Vec::new());

        let work = r#"{"type":"assistant","isSidechain":true,"timestamp":"2026-06-21T16:20:30.000Z","sessionId":"S","message":{"role":"assistant","content":[{"type":"tool_use","id":"t30","name":"Bash","input":{"command":"ls","description":"list"}}]}}"#;
        // The t2 agent's transcript arrives before the t1 agent's.
        apply_sub(&mut w, "S", "B", Some(&meta("t2", 1)), &[e(work)], &mut Vec::new());
        apply_sub(&mut w, "S", "A", Some(&meta("t1", 1)), &[e(work)], &mut Vec::new());

        let s = w.sessions.get("S").unwrap();
        assert_eq!(s.subagents.len(), 2);
        let a = s.subagents.iter().find(|r| r.agent_id == "A").unwrap();
        assert_eq!(a.description.as_deref(), Some("first"));
        let b = s.subagents.iter().find(|r| r.agent_id == "B").unwrap();
        assert_eq!(b.description.as_deref(), Some("second"));
    }

    /// When the spawned transcript is read before the caller's Agent tool_use
    /// (startup scans don't order caller vs callee), the later call must enrich
    /// the existing run — filling in the parent — instead of duplicating it.
    #[test]
    fn caller_call_after_transcript_enriches_instead_of_duplicating() {
        let mut w = World::default();
        // The child's transcript arrives first: fresh run with meta only.
        let child_work = e(
            r#"{"type":"assistant","isSidechain":true,"timestamp":"2026-06-21T16:21:00.000Z","sessionId":"S","message":{"role":"assistant","content":[{"type":"tool_use","id":"t20","name":"Bash","input":{"command":"ls","description":"list"}}]}}"#,
        );
        apply_sub(&mut w, "S", "C", Some(&meta("t9", 2)), &[child_work], &mut Vec::new());
        assert_eq!(
            w.sessions.get("S").unwrap().subagents[0].parent_agent_id,
            None
        );

        // The caller's transcript (spawning t9) is read afterwards.
        let x_spawn = e(
            r#"{"type":"assistant","isSidechain":true,"timestamp":"2026-06-21T16:20:30.000Z","sessionId":"S","message":{"role":"assistant","content":[{"type":"tool_use","id":"t9","name":"Agent","input":{"subagent_type":"Explore","description":"dig"}}]}}"#,
        );
        apply_sub(&mut w, "S", "X", Some(&meta("t1", 1)), &[x_spawn], &mut Vec::new());

        let s = w.sessions.get("S").unwrap();
        assert_eq!(s.subagents.len(), 2, "no duplicate pending run for t9");
        let c = s.subagents.iter().find(|r| r.agent_id == "C").unwrap();
        assert_eq!(c.parent_agent_id.as_deref(), Some("X"), "parent filled retroactively");
    }

    /// A sidecar naming a call that was never seen (caller transcript outside the
    /// restore window) must not steal another spawn's pending run.
    #[test]
    fn sidecar_with_unseen_call_creates_fresh_run() {
        let mut w = World::default();
        let delegate = e(
            r#"{"type":"assistant","timestamp":"2026-06-21T16:20:00.000Z","sessionId":"S","cwd":"/proj","message":{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"Agent","input":{"subagent_type":"Explore","description":"pending"}}]}}"#,
        );
        apply_main(&mut w, "S", &[delegate], &mut Vec::new());

        let work = e(
            r#"{"type":"assistant","isSidechain":true,"timestamp":"2026-06-21T16:20:30.000Z","sessionId":"S","message":{"role":"assistant","content":[{"type":"tool_use","id":"t31","name":"Bash","input":{"command":"ls","description":"list"}}]}}"#,
        );
        apply_sub(&mut w, "S", "Z", Some(&meta("t99", 2)), &[work], &mut Vec::new());

        let s = w.sessions.get("S").unwrap();
        assert_eq!(s.subagents.len(), 2, "the pending t1 run stays reserved");
        assert!(s.subagents.iter().any(|r| r.agent_id.is_empty()));
        let z = s.subagents.iter().find(|r| r.agent_id == "Z").unwrap();
        assert_eq!(z.spawn_depth, Some(2));
        assert_eq!(z.tool_use_id.as_deref(), Some("t99"));
        assert_eq!(z.parent_agent_id, None, "caller unknown, so no parent is claimed");
    }

    /// The parent's tool_result for the spawning Agent call ends the run the moment
    /// it is recorded — no waiting out the inactivity decay — and recompute keeps it
    /// Ended even though its last transcript entry is seconds old.
    #[test]
    fn parent_tool_result_ends_run_immediately() {
        let mut w = World::default();
        let delegate = e(
            r#"{"type":"assistant","timestamp":"2026-06-21T16:20:00.000Z","sessionId":"S","cwd":"/proj","message":{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"Agent","input":{"subagent_type":"Explore","description":"dig"}}]}}"#,
        );
        apply_main(&mut w, "S", &[delegate], &mut Vec::new());
        let work = e(
            r#"{"type":"assistant","isSidechain":true,"timestamp":"2026-06-21T16:20:30.000Z","sessionId":"S","message":{"role":"assistant","content":[{"type":"tool_use","id":"t5","name":"Bash","input":{"command":"ls","description":"list"}}]}}"#,
        );
        apply_sub(&mut w, "S", "A", Some(&meta("t1", 1)), &[work], &mut Vec::new());
        assert_eq!(w.sessions.get("S").unwrap().subagents[0].status, SessionStatus::Active);

        let result = e(
            r#"{"type":"user","timestamp":"2026-06-21T16:20:40.000Z","sessionId":"S","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t1","content":"all done"}]}}"#,
        );
        apply_main(&mut w, "S", &[result], &mut Vec::new());
        {
            let r = &w.sessions.get("S").unwrap().subagents[0];
            assert_eq!(r.status, SessionStatus::Ended, "ends when the result is recorded");
            assert_eq!(r.current.kind, WorkKind::Idle);
            assert_eq!(r.completed_at.as_deref(), Some("2026-06-21T16:20:40.000Z"));
        }

        // 30 seconds later the decay rule alone would say Active; the pin must win.
        let now = DateTime::parse_from_rfc3339("2026-06-21T16:21:10.000Z")
            .unwrap()
            .with_timezone(&Utc);
        recompute_statuses(&mut w, now);
        assert_eq!(
            w.sessions.get("S").unwrap().subagents[0].status,
            SessionStatus::Ended,
            "a completed run must not come back via time-based recompute"
        );
    }

    /// Transcript writes stamped before the parent's tool_result can be processed
    /// after it (the watcher orders files arbitrarily); they must not revive the run.
    #[test]
    fn trailing_writes_do_not_revive_completed_run() {
        let mut w = World::default();
        let delegate = e(
            r#"{"type":"assistant","timestamp":"2026-06-21T16:20:00.000Z","sessionId":"S","cwd":"/proj","message":{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"Agent","input":{"subagent_type":"Explore","description":"dig"}}]}}"#,
        );
        let result = e(
            r#"{"type":"user","timestamp":"2026-06-21T16:20:40.000Z","sessionId":"S","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t1","content":"done"}]}}"#,
        );
        apply_main(&mut w, "S", &[delegate, result], &mut Vec::new());

        // The final transcript flush (stamped before the result) arrives afterwards.
        let trailing = e(
            r#"{"type":"assistant","isSidechain":true,"timestamp":"2026-06-21T16:20:39.000Z","sessionId":"S","message":{"role":"assistant","content":[{"type":"text","text":"summary"}]}}"#,
        );
        apply_sub(&mut w, "S", "A", Some(&meta("t1", 1)), &[trailing], &mut Vec::new());
        let r = &w.sessions.get("S").unwrap().subagents[0];
        assert_eq!(r.status, SessionStatus::Ended, "older writes must not revive the run");
        assert!(r.completed_at.is_some());
    }

    /// The tool_result returned right away for run_in_background is a launch ack,
    /// not the agent's completion; the run keeps working.
    #[test]
    fn async_launch_ack_does_not_end_run() {
        let mut w = World::default();
        let delegate = e(
            r#"{"type":"assistant","timestamp":"2026-06-21T16:20:00.000Z","sessionId":"S","cwd":"/proj","message":{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"Agent","input":{"subagent_type":"Explore","description":"dig"}}]}}"#,
        );
        let ack = e(
            r#"{"type":"user","timestamp":"2026-06-21T16:20:02.000Z","sessionId":"S","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t1","content":[{"type":"text","text":"Async agent launched successfully. (internal metadata)\nagentId: abc"}]}]}}"#,
        );
        apply_main(&mut w, "S", &[delegate, ack], &mut Vec::new());
        let r = &w.sessions.get("S").unwrap().subagents[0];
        assert_eq!(r.status, SessionStatus::Active, "the launch ack is not a completion");
        assert!(r.completed_at.is_none());
    }

    /// A background agent's stop is recorded as a task-notification queue-operation;
    /// that ends the run, and a resumed agent (later transcript entries) revives it.
    #[test]
    fn task_notification_ends_and_resume_revives() {
        let mut w = World::default();
        let delegate = e(
            r#"{"type":"assistant","timestamp":"2026-06-21T16:20:00.000Z","sessionId":"S","cwd":"/proj","message":{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"Agent","input":{"subagent_type":"Explore","description":"dig"}}]}}"#,
        );
        apply_main(&mut w, "S", &[delegate], &mut Vec::new());
        let work = e(
            r#"{"type":"assistant","isSidechain":true,"timestamp":"2026-06-21T16:20:30.000Z","sessionId":"S","message":{"role":"assistant","content":[{"type":"tool_use","id":"t5","name":"Bash","input":{"command":"ls","description":"list"}}]}}"#,
        );
        apply_sub(&mut w, "S", "aid1", Some(&meta("t1", 1)), &[work], &mut Vec::new());

        let notify = e(
            r#"{"type":"queue-operation","operation":"enqueue","timestamp":"2026-06-21T16:21:00.000Z","sessionId":"S","content":"<task-notification>\n<task-id>aid1</task-id>\n<tool-use-id>t1</tool-use-id>\n<status>completed</status>\n<summary>done</summary>\n</task-notification>"}"#,
        );
        apply_main(&mut w, "S", &[notify], &mut Vec::new());
        assert_eq!(
            w.sessions.get("S").unwrap().subagents[0].status,
            SessionStatus::Ended,
            "the stop notification ends the background run"
        );

        // The user sends it another message: genuinely later transcript activity.
        let resumed = e(
            r#"{"type":"assistant","isSidechain":true,"timestamp":"2026-06-21T16:25:00.000Z","sessionId":"S","message":{"role":"assistant","content":[{"type":"tool_use","id":"t9","name":"Read","input":{"file_path":"/a/b.ts"}}]}}"#,
        );
        apply_sub(&mut w, "S", "aid1", Some(&meta("t1", 1)), &[resumed], &mut Vec::new());
        let r = &w.sessions.get("S").unwrap().subagents[0];
        assert_eq!(r.status, SessionStatus::Active, "a resumed agent clocks back in");
        assert!(r.completed_at.is_none(), "the completion pin is lifted");
    }

    /// A task-notification still ends the run when the task-id doesn't match any
    /// agent_id (e.g. the transcript was never read, so the run only knows its
    /// spawning tool_use id) — the tool-use-id side of the match is the safety net.
    #[test]
    fn task_notification_matches_by_tool_use_id() {
        let mut w = World::default();
        let delegate = e(
            r#"{"type":"assistant","timestamp":"2026-06-21T16:20:00.000Z","sessionId":"S","cwd":"/proj","message":{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"Agent","input":{"subagent_type":"Explore","description":"dig"}}]}}"#,
        );
        apply_main(&mut w, "S", &[delegate], &mut Vec::new());
        assert!(w.sessions.get("S").unwrap().subagents[0].agent_id.is_empty());

        let notify = e(
            r#"{"type":"queue-operation","operation":"enqueue","timestamp":"2026-06-21T16:21:00.000Z","sessionId":"S","content":"<task-notification>\n<task-id>never-read</task-id>\n<tool-use-id>t1</tool-use-id>\n<status>completed</status>\n</task-notification>"}"#,
        );
        apply_main(&mut w, "S", &[notify], &mut Vec::new());
        assert_eq!(
            w.sessions.get("S").unwrap().subagents[0].status,
            SessionStatus::Ended,
            "matched via tool-use-id despite the unknown task-id"
        );
    }

    /// A killed CLI records no tool_results: once the parent decays to Ended,
    /// every run under it ends too instead of haunting the park.
    #[test]
    fn ended_parent_cascades_to_runs() {
        let mut w = World::default();
        let session = w
            .sessions
            .entry("S".to_string())
            .or_insert_with(|| new_session("S"));
        session.last_event_at = Some("2026-06-21T16:00:00.000Z".to_string());
        session.subagents.push(SubAgentRun {
            agent_id: "A".to_string(),
            status: SessionStatus::Active,
            last_event_at: Some("2026-06-21T16:59:00.000Z".to_string()),
            ..Default::default()
        });

        let now = DateTime::parse_from_rfc3339("2026-06-21T17:00:00.000Z")
            .unwrap()
            .with_timezone(&Utc);
        recompute_statuses(&mut w, now);
        let s = w.sessions.get("S").unwrap();
        assert_eq!(s.status, SessionStatus::Ended);
        assert_eq!(s.subagents[0].status, SessionStatus::Ended, "no orphan runs under an ended parent");
    }

    /// Status decay uses the run's own last_event_at: entries that don't change the
    /// work kind (tool_results, text) still count as signs of life.
    #[test]
    fn sub_decay_uses_last_event_at() {
        let mut w = World::default();
        let work = e(
            r#"{"type":"assistant","isSidechain":true,"timestamp":"2026-06-21T16:20:00.000Z","sessionId":"S","message":{"role":"assistant","content":[{"type":"tool_use","id":"t5","name":"Bash","input":{"command":"sleep 300","description":"wait"}}]}}"#,
        );
        // Six minutes later only a tool_result lands (classify keeps the old state,
        // so current.since stays at 16:20).
        let result = e(
            r#"{"type":"user","isSidechain":true,"timestamp":"2026-06-21T16:26:00.000Z","sessionId":"S","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t5","content":"ok"}]}}"#,
        );
        apply_sub(&mut w, "S", "A", None, &[work, result], &mut Vec::new());

        let now = DateTime::parse_from_rfc3339("2026-06-21T16:27:00.000Z")
            .unwrap()
            .with_timezone(&Utc);
        recompute_statuses(&mut w, now);
        assert_eq!(
            w.sessions.get("S").unwrap().subagents[0].status,
            SessionStatus::Active,
            "the since-based approximation would say Idle; last_event_at keeps it Active"
        );
    }

    /// Verifies running a real session JSONL through the full parse -> classify -> state-tracking pipeline.
    /// Run with `cargo test -- --ignored real_session`, pointing CT_SESSION_FILE at a real file.
    #[test]
    #[ignore]
    fn real_session_pipeline() {
        use crate::jsonl::TailReader;
        let Ok(path) = std::env::var("CT_SESSION_FILE") else {
            eprintln!("CT_SESSION_FILE not set, skipping");
            return;
        };
        let mut tail = TailReader::new();
        let entries = tail.read_new(std::path::Path::new(&path));
        assert!(!entries.is_empty(), "could not read a single entry from the real file");

        let mut w = World::default();
        apply_main(&mut w, "REAL", &entries, &mut Vec::new());
        let s = w.sessions.get("REAL").unwrap();

        // Print the distribution of classified tool kinds (for visual inspection).
        use std::collections::BTreeMap;
        let mut dist: BTreeMap<String, usize> = BTreeMap::new();
        for e in &entries {
            if let Some(tb) = e.last_tool_use() {
                if let Some(name) = &tb.name {
                    let (kind, _) = crate::pipeline::classify::classify_tool(name, tb.input.as_ref());
                    *dist.entry(format!("{kind:?}")).or_default() += 1;
                }
            }
        }
        eprintln!("== real session analysis ==");
        eprintln!("total entries: {}", entries.len());
        eprintln!("cwd: {} / branch: {:?}", s.project, s.git_branch);
        eprintln!("final state: {:?} {}", s.current.kind, s.current.detail.as_deref().unwrap_or(""));
        eprintln!("sub agent launches: {}", s.subagents.len());
        eprintln!("WorkKind distribution: {dist:?}");
        assert!(!dist.is_empty(), "could not classify a single tool_use");
    }

    /// Right after receiving a human prompt, it shows "working" (does not stay 💤 waiting).
    /// The JSONL writes a user entry when the prompt is received, but the first assistant entry
    /// does not appear until generation completes. Prevents the regression where it looks like waiting from the previous turn's turn_end the whole time.
    #[test]
    fn user_prompt_starts_working_state() {
        let mut w = World::default();
        let turn_end = e(r#"{"type":"system","subtype":"turn_duration","timestamp":"2026-06-22T01:08:42.000Z","sessionId":"S"}"#);
        apply_main(&mut w, "S", &[turn_end], &mut Vec::new());
        assert_eq!(w.sessions.get("S").unwrap().current.kind, WorkKind::Idle);

        let prompt = e(r#"{"type":"user","timestamp":"2026-06-22T01:09:27.000Z","sessionId":"S","message":{"role":"user","content":"any recommendations?"}}"#);
        apply_main(&mut w, "S", &[prompt], &mut Vec::new());
        assert_eq!(
            w.sessions.get("S").unwrap().current.kind,
            WorkKind::Thinking,
            "from receiving a prompt until the first response should be working, not waiting"
        );
    }

    /// A tool_result (type:user but not a human prompt) does not change the work state.
    #[test]
    fn tool_result_is_not_a_prompt() {
        let mut w = World::default();
        let edit = e(r#"{"type":"assistant","timestamp":"2026-06-22T01:00:00.000Z","sessionId":"S","message":{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"Edit","input":{"file_path":"/a/x.ts"}}]}}"#);
        apply_main(&mut w, "S", &[edit], &mut Vec::new());
        let tr = e(r#"{"type":"user","timestamp":"2026-06-22T01:00:01.000Z","sessionId":"S","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t1","content":"ok"}]}}"#);
        apply_main(&mut w, "S", &[tr], &mut Vec::new());
        assert_eq!(
            w.sessions.get("S").unwrap().current.kind,
            WorkKind::Editing,
            "on tool_result, keep the previous Editing"
        );
    }

    /// An active session stays "working" (does not drop to 💤 waiting) even if JSONL writes
    /// pause for several minutes due to extended thinking or long tool runs. In real sessions,
    /// no-write gaps over 90 seconds occur routinely (up to ~3 minutes observed), so treating
    /// these as Idle would regress to the main session showing as waiting throughout active work.
    #[test]
    fn working_session_survives_thinking_gap() {
        let mut w = World::default();
        let edit = e(r#"{"type":"assistant","timestamp":"2026-06-22T01:00:00.000Z","sessionId":"S","cwd":"/proj","message":{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"Edit","input":{"file_path":"/a/b/x.ts"}}]}}"#);
        apply_main(&mut w, "S", &[edit], &mut Vec::new());
        assert_eq!(w.sessions.get("S").unwrap().current.kind, WorkKind::Editing);

        // Still working even 150 seconds after the last event (a natural gap of thinking + long tools).
        let now = DateTime::parse_from_rfc3339("2026-06-22T01:02:30.000Z")
            .unwrap()
            .with_timezone(&Utc);
        recompute_statuses(&mut w, now);

        let s = w.sessions.get("S").unwrap();
        assert_eq!(s.status, SessionStatus::Active);
        assert_eq!(
            s.current.kind,
            WorkKind::Editing,
            "a few minutes without writes must not drop an active work kind to waiting"
        );
    }

    /// An AwaitingUser session is expected to sit without new events for as
    /// long as the user takes to answer — that's the whole point of the
    /// tray's "waiting for your reply" indicator. It must survive past the
    /// ordinary 5-minute inactivity window (which would otherwise clobber it
    /// back to Idle via mark_idle, making the icon/menu vanish while the
    /// question is still genuinely unanswered), but should still give up
    /// once the session reaches Ended (here, 20 minutes: past IDLE_SECS).
    #[test]
    fn awaiting_user_survives_five_minutes_but_not_ended() {
        let mut w = World::default();
        let question = e(r#"{"type":"assistant","timestamp":"2026-06-22T01:00:00.000Z","sessionId":"S","cwd":"/proj","message":{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"AskUserQuestion","input":{}}]}}"#);
        apply_main(&mut w, "S", &[question], &mut Vec::new());
        assert_eq!(w.sessions.get("S").unwrap().current.kind, WorkKind::AwaitingUser);

        // 10 minutes later: status has decayed to Idle, but the question is still unanswered.
        let ten_min_later = DateTime::parse_from_rfc3339("2026-06-22T01:10:00.000Z")
            .unwrap()
            .with_timezone(&Utc);
        recompute_statuses(&mut w, ten_min_later);
        let s = w.sessions.get("S").unwrap();
        assert_eq!(s.status, SessionStatus::Idle);
        assert_eq!(
            s.current.kind,
            WorkKind::AwaitingUser,
            "an unanswered question must not be cleared just because the user hasn't replied yet"
        );

        // 20 minutes later: now Ended, so it's treated as abandoned like anything else.
        let twenty_min_later = DateTime::parse_from_rfc3339("2026-06-22T01:20:00.000Z")
            .unwrap()
            .with_timezone(&Utc);
        recompute_statuses(&mut w, twenty_min_later);
        let s = w.sessions.get("S").unwrap();
        assert_eq!(s.status, SessionStatus::Ended);
        assert_eq!(s.current.kind, WorkKind::Idle);
    }

    /// sessions_awaiting_reply: only an explicit AwaitingUser (question /
    /// plan approval) session appears, labeled by its slug (falling back to
    /// the project's basename). A plain turn-ended Idle session doesn't
    /// appear, since that is the normal resting state after every turn
    /// (including the session driving the current conversation) and must
    /// not itself trigger the "needs attention" animation/menu. A
    /// still-working session doesn't appear either.
    #[test]
    fn sessions_awaiting_reply_only_includes_explicit_awaiting_user() {
        fn session(session_id: &str, project: &str, slug: Option<&str>, kind: WorkKind) -> Session {
            Session {
                session_id: session_id.to_string(),
                project: project.to_string(),
                slug: slug.map(str::to_string),
                current: ActivityState {
                    kind,
                    ..Default::default()
                },
                ..Default::default()
            }
        }
        let sessions = vec![
            session("s1", "/proj", None, WorkKind::Idle), // turn just ended -> not included
            session("s2", "/Users/x/my-project", None, WorkKind::AwaitingUser), // no slug -> basename
            session("s3", "/proj", Some("custom-slug"), WorkKind::AwaitingUser), // slug wins
            session("s4", "/proj", None, WorkKind::Editing), // still working -> not included
        ];
        let awaiting = sessions_awaiting_reply(&sessions);
        assert_eq!(awaiting.len(), 2);
        assert_eq!(awaiting[0].session_id, "s2");
        assert_eq!(awaiting[0].label, "my-project");
        assert_eq!(awaiting[1].session_id, "s3");
        assert_eq!(awaiting[1].label, "custom-slug");
        assert!(sessions_awaiting_reply(&[]).is_empty());
    }

    /// The Skill tool sets active_skill, which carries over through a subsequent Edit.
    #[test]
    fn active_skill_persists_across_tools() {
        let mut w = World::default();
        let skill = e(r#"{"type":"assistant","timestamp":"2026-06-22T02:00:00.000Z","sessionId":"S","cwd":"/p","message":{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"Skill","input":{"skill":"superpowers:brainstorming"}}]}}"#);
        let edit = e(r#"{"type":"assistant","timestamp":"2026-06-22T02:00:10.000Z","sessionId":"S","message":{"role":"assistant","content":[{"type":"tool_use","id":"t2","name":"Edit","input":{"file_path":"/a/x.ts"}}]}}"#);
        apply_main(&mut w, "S", &[skill, edit], &mut Vec::new());
        let s = w.sessions.get("S").unwrap();
        assert_eq!(s.current.kind, WorkKind::Editing);
        assert_eq!(s.current.active_skill.as_deref(), Some("brainstorming"));
    }

    /// turn_end clears active_skill.
    #[test]
    fn active_skill_cleared_on_turn_end() {
        let mut w = World::default();
        let skill = e(r#"{"type":"assistant","timestamp":"2026-06-22T02:00:00.000Z","sessionId":"S","cwd":"/p","message":{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"Skill","input":{"skill":"deep-research"}}]}}"#);
        let end = e(r#"{"type":"system","subtype":"turn_duration","timestamp":"2026-06-22T02:01:00.000Z","sessionId":"S"}"#);
        apply_main(&mut w, "S", &[skill, end], &mut Vec::new());
        let s = w.sessions.get("S").unwrap();
        assert_eq!(s.current.kind, WorkKind::Idle);
        assert_eq!(s.current.active_skill, None);
    }

    /// A new user prompt clears active_skill.
    #[test]
    fn active_skill_cleared_on_new_prompt() {
        let mut w = World::default();
        let skill = e(r#"{"type":"assistant","timestamp":"2026-06-22T02:00:00.000Z","sessionId":"S","cwd":"/p","message":{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"Skill","input":{"skill":"deep-research"}}]}}"#);
        let prompt = e(r#"{"type":"user","timestamp":"2026-06-22T02:02:00.000Z","sessionId":"S","message":{"role":"user","content":"next request"}}"#);
        apply_main(&mut w, "S", &[skill, prompt], &mut Vec::new());
        assert_eq!(w.sessions.get("S").unwrap().current.active_skill, None);
    }

    /// active_skill carries over in a sub agent too.
    #[test]
    fn sub_agent_active_skill_persists() {
        let mut w = World::default();
        let skill = e(r#"{"type":"assistant","isSidechain":true,"agentId":"aid1","timestamp":"2026-06-22T02:00:00.000Z","sessionId":"S","message":{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"Skill","input":{"skill":"example-tools:slack-post"}}]}}"#);
        let read = e(r#"{"type":"assistant","isSidechain":true,"agentId":"aid1","timestamp":"2026-06-22T02:00:05.000Z","sessionId":"S","message":{"role":"assistant","content":[{"type":"tool_use","id":"t2","name":"Read","input":{"file_path":"/a/y.ts"}}]}}"#);
        apply_sub(&mut w, "S", "aid1", None, &[skill, read], &mut Vec::new());
        let s = w.sessions.get("S").unwrap();
        assert_eq!(s.subagents[0].current.kind, WorkKind::Reading);
        assert_eq!(s.subagents[0].current.active_skill.as_deref(), Some("slack-post"));
    }

    /// Captures the runtime model (message.model) from a sub agent's assistant entry
    /// into SubAgentRun.model, so the displayed sprite can be chosen by the "model that
    /// actually ran" rather than the "static model in the definition".
    #[test]
    fn sub_agent_captures_runtime_model() {
        let mut w = World::default();
        let work = e(r#"{"type":"assistant","isSidechain":true,"agentId":"aid1","timestamp":"2026-06-25T01:00:00.000Z","sessionId":"S","message":{"role":"assistant","model":"claude-sonnet-4-6","content":[{"type":"tool_use","id":"t1","name":"Read","input":{"file_path":"/a/x.ts"}}]}}"#);
        apply_sub(&mut w, "S", "aid1", None, &[work], &mut Vec::new());
        let s = w.sessions.get("S").unwrap();
        assert_eq!(
            s.subagents[0].model.as_deref(),
            Some("claude-sonnet-4-6"),
            "should pick up the subagent's runtime model"
        );
    }

    /// sdk-cli (non-interactive sessions launched by SDK/eval) are not counted as clocked-in main sessions.
    /// In practice, eval generates many sdk-cli sessions under `/Users/user/.claude`; this prevents the
    /// regression where 4 interactive sessions get inflated to 56 or so.
    #[test]
    fn sdk_cli_sessions_are_not_displayed() {
        let mut w = World::default();
        let entry = e(r#"{"type":"user","entrypoint":"sdk-cli","timestamp":"2026-06-22T03:00:00.000Z","sessionId":"S","cwd":"/Users/user/.claude","message":{"role":"user","content":"review it"}}"#);
        apply_main(&mut w, "S", &[entry], &mut Vec::new());
        let s = w.sessions.get("S").unwrap();
        assert!(!is_displayable(s), "sdk-cli-launched sessions are not counted as present");
    }

    /// Interactive launches (entrypoint=cli) and unknown entrypoint (older versions) are displayed as before.
    #[test]
    fn interactive_and_legacy_sessions_are_displayed() {
        let mut w = World::default();
        let cli = e(r#"{"type":"user","entrypoint":"cli","timestamp":"2026-06-22T03:00:00.000Z","sessionId":"C","cwd":"/proj","message":{"role":"user","content":"do it"}}"#);
        let legacy = e(r#"{"type":"user","timestamp":"2026-06-22T03:00:00.000Z","sessionId":"L","cwd":"/proj","message":{"role":"user","content":"do it"}}"#);
        apply_main(&mut w, "C", &[cli], &mut Vec::new());
        apply_main(&mut w, "L", &[legacy], &mut Vec::new());
        assert!(is_displayable(w.sessions.get("C").unwrap()));
        assert!(is_displayable(w.sessions.get("L").unwrap()));
    }

    /// Once identified as sdk-cli, this is retained even when reading later entries that carry no entrypoint
    /// (so it does not revert to inflation even if the tail read misses the leading entrypoint line).
    #[test]
    fn entrypoint_persists_across_reads() {
        let mut w = World::default();
        let first = e(r#"{"type":"user","entrypoint":"sdk-cli","timestamp":"2026-06-22T03:00:00.000Z","sessionId":"S","message":{"role":"user","content":"x"}}"#);
        apply_main(&mut w, "S", &[first], &mut Vec::new());
        let later = e(r#"{"type":"assistant","timestamp":"2026-06-22T03:00:05.000Z","sessionId":"S","message":{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"Read","input":{"file_path":"/a/b.ts"}}]}}"#);
        apply_main(&mut w, "S", &[later], &mut Vec::new());
        assert!(
            !is_displayable(w.sessions.get("S").unwrap()),
            "once identified as sdk-cli, keep it on subsequent reads"
        );
    }

    /// TodoWrite sets todos, which carry over through a subsequent Edit.
    /// Also, TodoWrite does not change the work kind (keeps the previous Editing).
    #[test]
    fn todowrite_sets_todos_and_keeps_kind() {
        let mut w = World::default();
        let edit = e(r#"{"type":"assistant","timestamp":"2026-06-23T01:00:00.000Z","sessionId":"S","cwd":"/p","message":{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"Edit","input":{"file_path":"/a/x.ts"}}]}}"#);
        apply_main(&mut w, "S", &[edit], &mut Vec::new());
        assert_eq!(w.sessions.get("S").unwrap().current.kind, WorkKind::Editing);

        let todo = e(r#"{"type":"assistant","timestamp":"2026-06-23T01:00:05.000Z","sessionId":"S","message":{"role":"assistant","content":[{"type":"tool_use","id":"t2","name":"TodoWrite","input":{"todos":[{"content":"a","status":"completed","activeForm":"aing"},{"content":"b","status":"in_progress","activeForm":"bing"}]}}]}}"#);
        apply_main(&mut w, "S", &[todo], &mut Vec::new());
        {
            let s = w.sessions.get("S").unwrap();
            assert_eq!(s.current.kind, WorkKind::Editing, "TodoWrite does not change the work kind");
            assert_eq!(s.current.todos.len(), 2);
            assert_eq!(s.current.todos[1].status, "in_progress");
        }

        let next_edit = e(r#"{"type":"assistant","timestamp":"2026-06-23T01:00:10.000Z","sessionId":"S","message":{"role":"assistant","content":[{"type":"tool_use","id":"t3","name":"Edit","input":{"file_path":"/a/y.ts"}}]}}"#);
        apply_main(&mut w, "S", &[next_edit], &mut Vec::new());
        let s = w.sessions.get("S").unwrap();
        assert_eq!(s.current.kind, WorkKind::Editing);
        assert_eq!(s.current.todos.len(), 2, "carry over todos to subsequent tools");
    }

    /// turn_end / a new prompt clears todos.
    #[test]
    fn todos_cleared_on_turn_end_and_prompt() {
        let mut w = World::default();
        let todo = e(r#"{"type":"assistant","timestamp":"2026-06-23T01:00:00.000Z","sessionId":"S","cwd":"/p","message":{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"TodoWrite","input":{"todos":[{"content":"a","status":"pending","activeForm":"aing"}]}}]}}"#);
        let end = e(r#"{"type":"system","subtype":"turn_duration","timestamp":"2026-06-23T01:01:00.000Z","sessionId":"S"}"#);
        apply_main(&mut w, "S", &[todo, end], &mut Vec::new());
        assert!(w.sessions.get("S").unwrap().current.todos.is_empty());

        let todo2 = e(r#"{"type":"assistant","timestamp":"2026-06-23T01:02:00.000Z","sessionId":"S","message":{"role":"assistant","content":[{"type":"tool_use","id":"t2","name":"TodoWrite","input":{"todos":[{"content":"a","status":"pending","activeForm":"aing"}]}}]}}"#);
        let prompt = e(r#"{"type":"user","timestamp":"2026-06-23T01:03:00.000Z","sessionId":"S","message":{"role":"user","content":"next request"}}"#);
        apply_main(&mut w, "S", &[todo2, prompt], &mut Vec::new());
        assert!(w.sessions.get("S").unwrap().current.todos.is_empty());
    }

    /// Becoming inactive (recompute_statuses) clears todos.
    #[test]
    fn todos_cleared_when_not_active() {
        let mut w = World::default();
        let todo = e(r#"{"type":"assistant","timestamp":"2026-06-23T01:00:00.000Z","sessionId":"S","cwd":"/p","message":{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"TodoWrite","input":{"todos":[{"content":"a","status":"pending","activeForm":"aing"}]}}]}}"#);
        apply_main(&mut w, "S", &[todo], &mut Vec::new());
        let now = DateTime::parse_from_rfc3339("2026-06-23T02:00:00.000Z").unwrap().with_timezone(&Utc);
        recompute_statuses(&mut w, now);
        assert!(w.sessions.get("S").unwrap().current.todos.is_empty());
    }

    /// todos carry over in a sub agent too.
    #[test]
    fn sub_agent_todos_persist() {
        let mut w = World::default();
        let todo = e(r#"{"type":"assistant","isSidechain":true,"agentId":"aid1","timestamp":"2026-06-23T01:00:00.000Z","sessionId":"S","message":{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"TodoWrite","input":{"todos":[{"content":"a","status":"in_progress","activeForm":"aing"}]}}]}}"#);
        let read = e(r#"{"type":"assistant","isSidechain":true,"agentId":"aid1","timestamp":"2026-06-23T01:00:05.000Z","sessionId":"S","message":{"role":"assistant","content":[{"type":"tool_use","id":"t2","name":"Read","input":{"file_path":"/a/y.ts"}}]}}"#);
        apply_sub(&mut w, "S", "aid1", None, &[todo, read], &mut Vec::new());
        let s = w.sessions.get("S").unwrap();
        assert_eq!(s.subagents[0].current.kind, WorkKind::Reading);
        assert_eq!(s.subagents[0].current.todos.len(), 1);
    }

    /// From a new session + user prompt + tool_use + tool_result + turn_end,
    /// SessionStart/UserPromptSubmit/PreToolUse/PostToolUse/Stop are reconstructed.
    #[test]
    fn main_reconstructs_lifecycle_events() {
        let mut w = World::default();
        let prompt = e(r#"{"type":"user","timestamp":"2026-06-25T01:00:00.000Z","sessionId":"S","cwd":"/p","message":{"role":"user","content":"do it"}}"#);
        let tool = e(r#"{"type":"assistant","timestamp":"2026-06-25T01:00:01.000Z","sessionId":"S","message":{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"Edit","input":{"file_path":"/a/x.ts"}}]}}"#);
        let result = e(r#"{"type":"user","timestamp":"2026-06-25T01:00:02.000Z","sessionId":"S","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t1","content":"ok"}]}}"#);
        let end = e(r#"{"type":"system","subtype":"turn_duration","timestamp":"2026-06-25T01:00:03.000Z","sessionId":"S"}"#);

        let mut out = Vec::new();
        apply_main(&mut w, "S", &[prompt, tool, result, end], &mut out);

        let kinds: Vec<&str> = out.iter().map(|h| h.event.as_str()).collect();
        assert_eq!(
            kinds,
            vec!["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "Stop"]
        );
        // PreToolUse's tool_name is Edit; PostToolUse inherits the previous tool Edit.
        let pre = out.iter().find(|h| h.event == "PreToolUse").unwrap();
        assert_eq!(pre.tool_name.as_deref(), Some("Edit"));
        let post = out.iter().find(|h| h.event == "PostToolUse").unwrap();
        assert_eq!(post.tool_name.as_deref(), Some("Edit"));
        // All fired from the main session (agent_id=None).
        assert!(out.iter().all(|h| h.agent_id.is_none()));
        assert_eq!(pre.session_id, "S");
    }

    /// PreToolUse/PostToolUse carry the tool_use correlation ID, and PostToolUse also carries is_error.
    #[test]
    fn reconstruct_carries_correlation_and_error() {
        let mut w = World::default();
        let tool = e(r#"{"type":"assistant","timestamp":"2026-06-25T01:00:01.000Z","sessionId":"S","cwd":"/p","message":{"role":"assistant","content":[{"type":"tool_use","id":"tu_1","name":"Bash","input":{"command":"ls"}}]}}"#);
        let result = e(r#"{"type":"user","timestamp":"2026-06-25T01:00:02.000Z","sessionId":"S","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"tu_1","is_error":true,"content":"boom"}]}}"#);
        let mut out = Vec::new();
        apply_main(&mut w, "S", &[tool, result], &mut out);

        let pre = out.iter().find(|h| h.event == "PreToolUse").unwrap();
        let post = out.iter().find(|h| h.event == "PostToolUse").unwrap();
        assert_eq!(pre.correlation_id.as_deref(), Some("tu_1"));
        assert_eq!(post.correlation_id.as_deref(), Some("tu_1"));
        assert_eq!(pre.is_error, None, "Pre does not include is_error");
        assert_eq!(post.is_error, Some(true), "Post includes tool_result.is_error");
    }

    /// On the second read (existing session), SessionStart is not emitted.
    #[test]
    fn session_start_only_once() {
        let mut w = World::default();
        let first = e(r#"{"type":"user","timestamp":"2026-06-25T01:00:00.000Z","sessionId":"S","cwd":"/p","message":{"role":"user","content":"a"}}"#);
        let mut out1 = Vec::new();
        apply_main(&mut w, "S", &[first], &mut out1);
        assert_eq!(out1[0].event, "SessionStart");
        assert_eq!(out1.len(), 2, "two entries: SessionStart + UserPromptSubmit");
        assert_eq!(out1[1].event, "UserPromptSubmit");

        let later = e(r#"{"type":"assistant","timestamp":"2026-06-25T01:00:05.000Z","sessionId":"S","message":{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"Read","input":{"file_path":"/a/y.ts"}}]}}"#);
        let mut out2 = Vec::new();
        apply_main(&mut w, "S", &[later], &mut out2);
        assert!(out2.iter().all(|h| h.event != "SessionStart"), "do not emit SessionStart for an existing session");
    }

    /// For a subagent, tool_use -> PreToolUse, turn_end -> SubagentStop (with agent_id).
    #[test]
    fn sub_reconstructs_lifecycle_with_agent_id() {
        let mut w = World::default();
        let work = e(r#"{"type":"assistant","isSidechain":true,"agentId":"aid1","timestamp":"2026-06-25T01:01:00.000Z","sessionId":"S","message":{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"ls"}}]}}"#);
        let end = e(r#"{"type":"system","subtype":"turn_duration","timestamp":"2026-06-25T01:01:05.000Z","sessionId":"S"}"#);
        let mut out = Vec::new();
        apply_sub(&mut w, "S", "aid1", None, &[work, end], &mut out);
        let kinds: Vec<&str> = out.iter().map(|h| h.event.as_str()).collect();
        assert_eq!(kinds, vec!["PreToolUse", "SubagentStop"]);
        assert!(out.iter().all(|h| h.agent_id.as_deref() == Some("aid1")));
    }

    #[test]
    fn status_thresholds() {
        let now = DateTime::parse_from_rfc3339("2026-06-21T17:00:00.000Z")
            .unwrap()
            .with_timezone(&Utc);
        // 30 seconds ago -> Active
        assert_eq!(
            status_from_last(Some("2026-06-21T16:59:30.000Z"), now),
            SessionStatus::Active
        );
        // 4 minutes ago -> still Active (treats thinking / long-tool gaps as active)
        assert_eq!(
            status_from_last(Some("2026-06-21T16:56:00.000Z"), now),
            SessionStatus::Active
        );
        // 10 minutes ago -> Idle (enough time has passed since work ended)
        assert_eq!(
            status_from_last(Some("2026-06-21T16:50:00.000Z"), now),
            SessionStatus::Idle
        );
        // 1 hour ago -> Ended
        assert_eq!(
            status_from_last(Some("2026-06-21T16:00:00.000Z"), now),
            SessionStatus::Ended
        );
        assert_eq!(status_from_last(None, now), SessionStatus::Ended);
    }
}
