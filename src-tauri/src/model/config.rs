use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use ts_rs::TS;

/// A single hook action. For `type=command`, `command` holds the shell command.
/// Some types (e.g. `type=agent`) have no command, so `command` is optional.
/// Incidental fields other than `command`/`type` (e.g. an agent type's `prompt`/`if`/`model`/
/// `statusMessage`/`timeout`) are preserved in `extra` and restored verbatim when written back
/// (so new kinds of hook types are not dropped).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct HookAction {
    #[serde(rename = "type")]
    pub action_type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(flatten)]
    #[ts(skip)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

impl HookAction {
    /// Display string for the command. Uses `command` if present; otherwise
    /// builds a pseudo-label from the type and supplementary info (statusMessage / start of prompt).
    pub fn display_command(&self) -> String {
        if let Some(c) = &self.command {
            return c.clone();
        }
        let hint = self
            .extra
            .get("statusMessage")
            .or_else(|| self.extra.get("prompt"))
            .and_then(|v| v.as_str());
        match hint {
            Some(h) => {
                let line = h.lines().next().unwrap_or(h);
                let trimmed: String = line.chars().take(80).collect();
                if trimmed.chars().count() < line.chars().count() {
                    format!("[{}] {trimmed}…", self.action_type)
                } else {
                    format!("[{}] {trimmed}", self.action_type)
                }
            }
            None => format!("[{}]", self.action_type),
        }
    }
}

/// The hooks tied to a single matcher.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct HookEntry {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub matcher: Option<String>,
    pub hooks: Vec<HookAction>,
}

/// Event name (e.g. PreToolUse) -> HookEntry list.
pub type HooksMap = BTreeMap<String, Vec<HookEntry>>;

/// A single effective hook (flattened with a scope tag). Corresponds to one device.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct ScopedHook {
    /// Origin. "user" | "project" | "local" | "plugin".
    pub scope: String,
    pub matcher: Option<String>,
    pub command: String,
    /// The plugin name when the origin is plugin (e.g. "superpowers"). None for other scopes.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub plugin: Option<String>,
}

/// Event name -> effective hooks (concatenated in user -> project -> local order).
pub type EffectiveHooks = BTreeMap<String, Vec<ScopedHook>>;

/// The origin of a skill. "user" | "project" | "plugin".
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
#[serde(tag = "kind", content = "plugin", rename_all = "lowercase")]
pub enum SkillSource {
    /// User-defined under ~/.claude/skills (editable).
    User,
    /// Project-defined under <project>/.claude/skills (editable).
    Project,
    /// Originates from a plugin (read-only).
    Plugin(String),
}

impl Default for SkillSource {
    fn default() -> Self {
        SkillSource::User
    }
}

/// Skill definition (~/.claude/skills/{name}/SKILL.md).
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct SkillDef {
    pub name: String,
    pub description: String,
    pub disable_model_invocation: bool,
    pub argument_hint: Option<String>,
    pub allowed_tools: Vec<String>,
    /// Whether it has become SKILL.md.disabled.
    pub disabled: bool,
    pub body: String,
    /// Path to the skill directory.
    pub dir: String,
    pub source: SkillSource,
}

/// Command definition (~/.claude/commands/{name}.md).
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct CommandDef {
    pub name: String,
    pub description: String,
    pub allowed_tools: Vec<String>,
    pub body: String,
    pub file_path: String,
}
