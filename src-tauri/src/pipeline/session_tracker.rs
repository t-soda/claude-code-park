use super::classify::{classify_tool, skill_name};
use crate::jsonl::entry::RawEntry;
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
        // Agent tool_use -> record the sub agent clocking in (main session only).
        if let Some(tb) = e.last_tool_use() {
            let name = tb.name.as_deref().unwrap_or("");
            if name == "Agent" || name == "Task" {
                register_subagent(session, tb, e.timestamp.as_deref());
            }
        }
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

    // Find an existing run: match by agent_id -> else the latest run with no agent_id assigned -> else create new.
    let idx = find_or_create_run(session, agent_id);

    for e in entries {
        if let Some(ts) = e.timestamp.clone() {
            session.subagents[idx].started_at.get_or_insert(ts.clone());
            session.last_event_at = Some(ts);
        }
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
    session.subagents[idx].status = SessionStatus::Active;
    true
}

/// The lifecycle event reconstructed from a single entry.
/// For PostToolUse, the caller passes the most recent tool name as `post_tool`
/// (handled the same for main/sub). If is_sub=true, turn_end becomes SubagentStop.
fn reconstruct(
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

fn register_subagent(session: &mut Session, tb: &crate::jsonl::entry::ContentBlock, ts: Option<&str>) {
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
    session.subagents.push(SubAgentRun {
        agent_id: String::new(),
        subagent_type,
        description,
        model: None,
        started_at: ts.map(str::to_string),
        status: SessionStatus::Active,
        current: ActivityState::default(),
    });
}

fn find_or_create_run(session: &mut Session, agent_id: &str) -> usize {
    if let Some(i) = session
        .subagents
        .iter()
        .position(|r| r.agent_id == agent_id)
    {
        return i;
    }
    // Link to an unassigned run registered earlier by the parent's Agent tool_use.
    if let Some(i) = session
        .subagents
        .iter()
        .rposition(|r| r.agent_id.is_empty())
    {
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
    let age = now.signed_duration_since(dt.with_timezone(&Utc)).num_seconds();
    if age <= ACTIVE_SECS {
        SessionStatus::Active
    } else if age <= IDLE_SECS {
        SessionStatus::Idle
    } else {
        SessionStatus::Ended
    }
}

/// Recomputes the status of all sessions/subagents in the World relative to the current time.
/// Once no longer Active, resets the work kind to Idle (💤 waiting) (prevents the last tool from lingering).
pub fn recompute_statuses(world: &mut World, now: DateTime<Utc>) {
    for s in world.sessions.values_mut() {
        s.status = status_from_last(s.last_event_at.as_deref(), now);
        if s.status != SessionStatus::Active {
            mark_idle(&mut s.current);
        }
        for r in &mut s.subagents {
            // Subagents use their own current.since as an approximation of the last event time.
            let last = r.current.since.as_deref().or(r.started_at.as_deref());
            r.status = status_from_last(last, now);
            if r.status != SessionStatus::Active {
                mark_idle(&mut r.current);
            }
        }
    }
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
        apply_sub(&mut w, "S", "aid1", &[sub_work], &mut Vec::new());

        let s = w.sessions.get("S").unwrap();
        assert_eq!(s.subagents.len(), 1, "attaches to the unassigned run, so it does not increase");
        assert_eq!(s.subagents[0].agent_id, "aid1");
        assert_eq!(s.subagents[0].current.kind, WorkKind::Running);
        assert_eq!(s.subagents[0].current.detail.as_deref(), Some("run tests"));
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
        apply_sub(&mut w, "S", "aid1", &[skill, read], &mut Vec::new());
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
        apply_sub(&mut w, "S", "aid1", &[work], &mut Vec::new());
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
        apply_sub(&mut w, "S", "aid1", &[todo, read], &mut Vec::new());
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
        apply_sub(&mut w, "S", "aid1", &[work, end], &mut out);
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
