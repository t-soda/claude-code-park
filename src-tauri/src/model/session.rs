use super::activity::ActivityState;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub enum SessionStatus {
    Active,
    Idle,
    Ended,
}

impl Default for SessionStatus {
    fn default() -> Self {
        SessionStatus::Idle
    }
}

/// The main Claude Code session.
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct Session {
    pub session_id: String,
    /// Working directory (cwd). Taken from the JSONL cwd field.
    pub project: String,
    pub git_branch: Option<String>,
    pub slug: Option<String>,
    pub status: SessionStatus,
    pub started_at: Option<String>,
    pub last_event_at: Option<String>,
    pub current: ActivityState,
    /// Whether this is a main session not tied to an agent definition. Always true (a main session is never tied to an agent definition).
    pub is_main: bool,
    /// Sub agents launched from this session.
    pub subagents: Vec<SubAgentRun>,
    /// Launch path (JSONL entrypoint). "sdk-cli" is an eval/programmatic launch, so it is
    /// used to decide exclusion from the count of clocked-in main sessions. Not sent to the frontend (backend-internal only).
    #[serde(skip)]
    #[ts(skip)]
    pub entrypoint: Option<String>,
}

/// The activity of a sub agent called from the main session (= an employee who clocked in).
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct SubAgentRun {
    /// The id from subagents/agent-{id}.jsonl.
    pub agent_id: String,
    /// The Agent tool_use's input.subagent_type (matched against AgentDef.name).
    pub subagent_type: Option<String>,
    /// The Agent tool_use's input.description.
    pub description: Option<String>,
    /// The runtime model this sub agent actually ran on (the assistant entry's
    /// message.model). The pixel art is chosen from this, not the static model in the definition file.
    pub model: Option<String>,
    pub started_at: Option<String>,
    pub status: SessionStatus,
    pub current: ActivityState,
}
