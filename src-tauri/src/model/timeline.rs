use crate::model::activity::WorkKind;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// One line of the work log reconstructed from the session JSONL.
/// A line where `tool_name` is Some is a "tool execution log" (the frontend shows the
/// tool-name tag only when lifecycleView is ON).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct TimelineEntry {
    /// Time of occurrence (ISO8601).
    pub ts: Option<String>,
    /// Work kind. None only for a hook-block row (see `block_reason`) — mirrors
    /// ReplayEvent's kind/work split rather than reusing a WorkKind variant as a
    /// meaningless placeholder for a row that isn't an activity change.
    pub kind: Option<WorkKind>,
    /// File being edited, command description, etc.
    pub detail: Option<String>,
    /// Most recent tool_use name (Read/Edit/Bash...). None means thinking / a turn boundary.
    pub tool_name: Option<String>,
    /// The skill name that was active at that point.
    pub active_skill: Option<String>,
    /// Set only for a row synthesized from a hook block (PreToolUse rejection,
    /// PostToolUse/Stop hook_blocking_error, or a blocked stop_hook_summary).
    /// Rows with no reason text are not emitted, so this is never Some("").
    pub block_reason: Option<String>,
}
