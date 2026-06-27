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
    /// Work kind.
    pub kind: WorkKind,
    /// File being edited, command description, etc.
    pub detail: Option<String>,
    /// Most recent tool_use name (Read/Edit/Bash...). None means thinking / a turn boundary.
    pub tool_name: Option<String>,
    /// The skill name that was active at that point.
    pub active_skill: Option<String>,
}
