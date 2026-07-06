use super::activity::WorkKind;
use super::session::SessionStatus;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Summary of a session shown in the replay session browser. Any status (Active/Idle/
/// Ended) may appear: a still-running session can be replayed up to its most recent
/// event, so the user doesn't have to wait for it to end to see what it just did.
/// All times are epoch milliseconds as f64 (i64 would export as bigint via ts-rs,
/// which is awkward for scrubber math on the frontend).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct ReplaySessionMeta {
    pub session_id: String,
    /// Working directory (cwd) of the session.
    pub project: String,
    pub slug: Option<String>,
    pub git_branch: Option<String>,
    /// Excerpt of the first human prompt (used as a title when there is no slug).
    pub first_prompt: Option<String>,
    pub started_at_ms: f64,
    /// Timestamp of the last event seen at list time. For a still-running session
    /// this keeps advancing; opening the replay always re-reads the full file, so it
    /// may show more than this snapshot implied.
    pub ended_at_ms: f64,
    /// The session's status as of list time (Active/Idle/Ended), so the browser can
    /// flag a still-running session instead of implying its history is complete.
    pub status: SessionStatus,
}

/// A sub agent's clock-in/clock-out interval within a replayed session.
/// Times are milliseconds relative to ReplaySessionMeta.started_at_ms.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct ReplaySubagent {
    /// Empty when the spawn could not be linked to a subagent JSONL file
    /// (such runs appear in the log but have no sprite, mirroring live behavior).
    pub agent_id: String,
    pub subagent_type: Option<String>,
    pub description: Option<String>,
    /// The runtime model of the sub agent (assistant entry's message.model).
    pub model: Option<String>,
    pub spawn_ms: f64,
    pub stop_ms: f64,
    /// agent_id of the subagent that spawned this run. None = spawned by the
    /// main session (orchestrator).
    pub parent_agent_id: Option<String>,
    /// Spawn depth from the sidecar meta (1 = spawned by the main session).
    pub spawn_depth: Option<u32>,
}

/// The kind of a single replay event. A tool call intentionally yields two events at
/// the same timestamp: Activity (drives the sprite pose/callout) and PreToolUse
/// (drives the hook flash/beam), mirroring how the live pipeline splits
/// Session.current vs HookEvent.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub enum ReplayEventKind {
    SessionStart,
    UserPrompt,
    Activity,
    PreToolUse,
    PostToolUse,
    TurnEnd,
    SubagentSpawn,
    SubagentStop,
}

/// One event in the replay stream (flat struct with Option payloads, HookEvent style).
/// at_ms is relative to ReplaySessionMeta.started_at_ms.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct ReplayEvent {
    pub at_ms: f64,
    pub kind: ReplayEventKind,
    /// None = the orchestrator (main session); Some = a sub agent.
    pub agent_id: Option<String>,
    /// Activity: the work kind classified from the tool.
    pub work: Option<WorkKind>,
    /// Activity / PreToolUse / PostToolUse: the tool name.
    pub tool_name: Option<String>,
    /// Activity: classify_tool detail. SubagentSpawn: the subagent_type.
    pub detail: Option<String>,
    /// Activity: the skill carried over from the Skill tool.
    pub active_skill: Option<String>,
    /// PreToolUse / PostToolUse pairing id (tool_use.id / tool_result.tool_use_id).
    pub correlation_id: Option<String>,
    /// PostToolUse: tool_result.is_error.
    pub is_error: Option<bool>,
    /// UserPrompt: prompt excerpt. SubagentSpawn: the spawn description.
    pub text: Option<String>,
}

/// Everything the frontend needs to replay one session.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct ReplayData {
    pub meta: ReplaySessionMeta,
    pub subagents: Vec<ReplaySubagent>,
    /// Sorted by at_ms (stable: same-timestamp events keep file order).
    pub events: Vec<ReplayEvent>,
}
