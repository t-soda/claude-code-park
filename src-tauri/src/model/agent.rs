use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
#[serde(tag = "kind", content = "plugin", rename_all = "lowercase")]
pub enum AgentSource {
    /// User-defined under ~/.claude/agents (editable).
    User,
    /// Project-defined under <project>/.claude/agents (editable).
    Project,
    /// Originates from a plugin (read-only).
    Plugin(String),
}

impl Default for AgentSource {
    fn default() -> Self {
        AgentSource::User
    }
}

/// An "employee" = the role definition of a sub agent (~/.claude/agents/{name}.md).
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct AgentDef {
    /// File name & frontmatter.name (primary key).
    pub name: String,
    pub description: String,
    /// The frontmatter `tools` (comma-separated string) split into a list.
    pub tools: Vec<String>,
    pub model: Option<String>,
    pub color: Option<String>,
    /// The body following the frontmatter (the role-definition prompt).
    pub body: String,
    pub file_path: String,
    pub source: AgentSource,
}
