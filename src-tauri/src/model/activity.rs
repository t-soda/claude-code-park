use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// A single TodoWrite item. The smallest unit of a plan Claude makes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct TodoItem {
    /// Completed-form description (content).
    pub content: String,
    /// "pending" | "in_progress" | "completed"
    pub status: String,
    /// Progressive-form description (activeForm).
    pub active_form: String,
}

/// The kind of "what is being done right now" for an employee (or the main session).
/// Determined from the tool_use name via classify::work_kind.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub enum WorkKind {
    Idle,
    Thinking,
    Reading,
    Editing,
    Running,
    Searching,
    Reviewing,
    Delegating,
    WebExploring,
    AwaitingUser,
}

impl Default for WorkKind {
    fn default() -> Self {
        WorkKind::Idle
    }
}

/// The current work state.
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct ActivityState {
    pub kind: WorkKind,
    /// Most recent tool_use name (Read/Edit/Bash...).
    pub tool_name: Option<String>,
    /// Detail for the speech-bubble display, e.g. the file being edited or the start of a command.
    pub detail: Option<String>,
    /// Time this state was entered (ISO8601).
    pub since: Option<String>,
    /// Name of the currently active skill (display name with the plugin namespace stripped).
    /// Set by the Skill tool; updated/cleared on turn end, a new prompt, or a different skill.
    pub active_skill: Option<String>,
    /// The current TODO list. Set by TodoWrite, retained across subsequent tools, and
    /// cleared on turn end, a new prompt, or going inactive (same lifecycle as active_skill).
    pub todos: Vec<TodoItem>,
}
