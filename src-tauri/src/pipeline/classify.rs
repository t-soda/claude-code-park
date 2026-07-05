use crate::model::activity::{TodoItem, WorkKind};
use serde_json::Value;

/// Determines the work kind and display detail from a tool_use's name and input.
/// This is the core of expressing "what is happening now" in the overview office.
pub fn classify_tool(name: &str, input: Option<&Value>) -> (WorkKind, Option<String>) {
    let detail = extract_detail(name, input);
    let kind = match name {
        "Read" | "NotebookRead" => WorkKind::Reading,
        "Edit" | "Write" | "MultiEdit" | "NotebookEdit" => WorkKind::Editing,
        "Bash" | "BashOutput" | "KillBash" => {
            // Test/build runs are also counted as Running (the label is distinguished via detail).
            WorkKind::Running
        }
        "Grep" | "Glob" | "LS" => WorkKind::Searching,
        "Agent" | "Task" => WorkKind::Delegating,
        "WebSearch" | "WebFetch" => WorkKind::WebExploring,
        "AskUserQuestion" | "ExitPlanMode" => WorkKind::AwaitingUser,
        "TodoWrite" => WorkKind::Thinking,
        "Skill" => WorkKind::Thinking,
        other if other.starts_with("mcp__") && other.to_lowercase().contains("review") => {
            WorkKind::Reviewing
        }
        other if other.starts_with("mcp__") => WorkKind::Running,
        _ => WorkKind::Running,
    };
    (kind, detail)
}

/// Extracts a short detail for the speech-bubble display from a tool_use's input.
fn extract_detail(name: &str, input: Option<&Value>) -> Option<String> {
    let input = input?;
    let pick = |key: &str| input.get(key).and_then(|v| v.as_str()).map(str::to_string);

    match name {
        "Read" | "Edit" | "Write" | "MultiEdit" | "NotebookRead" | "NotebookEdit" => {
            pick("file_path").map(|p| basename(&p).to_string())
        }
        "Bash" | "BashOutput" => pick("description").or_else(|| pick("command").map(|c| truncate(&c, 48))),
        "Grep" => pick("pattern").map(|p| truncate(&p, 40)),
        "Glob" => pick("pattern"),
        "Agent" | "Task" => {
            let st = pick("subagent_type");
            let d = pick("description");
            match (st, d) {
                (Some(s), Some(d)) => Some(format!("{s}: {}", truncate(&d, 40))),
                (Some(s), None) => Some(s),
                (None, d) => d.map(|d| truncate(&d, 48)),
            }
        }
        "WebSearch" => pick("query").map(|q| truncate(&q, 40)),
        "WebFetch" => pick("url").map(|u| truncate(&u, 48)),
        "Skill" => skill_name(Some(input)),
        _ => None,
    }
}

/// Basename of a `/`-or-`\`-separated path, skipping empty segments (so a
/// trailing separator doesn't yield an empty result). Shared by tool-input
/// detail extraction, the tray menu's session labels, and terminal-focus
/// window matching.
pub fn basename(path: &str) -> &str {
    path.rsplit(['/', '\\']).find(|s| !s.is_empty()).unwrap_or(path)
}

/// Extracts the display skill name from a Skill tool's input.
/// For the `"plugin:name"` form, drops the plugin namespace (the part before the first `:`).
pub fn skill_name(input: Option<&Value>) -> Option<String> {
    let raw = input?.get("skill")?.as_str()?;
    let name = raw.split_once(':').map(|(_, rest)| rest).unwrap_or(raw);
    Some(name.to_string())
}

/// Extracts the TodoItem array from a TodoWrite input.
/// Empty if `input.todos` is not an array. Tolerant of missing fields per element (defaults to empty string).
pub fn parse_todos(input: Option<&Value>) -> Vec<TodoItem> {
    let Some(arr) = input.and_then(|v| v.get("todos")).and_then(|v| v.as_array()) else {
        return Vec::new();
    };
    arr.iter()
        .map(|t| {
            let s = |k: &str| t.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();
            TodoItem {
                content: s("content"),
                status: s("status"),
                active_form: s("activeForm"),
            }
        })
        .collect()
}

fn truncate(s: &str, max: usize) -> String {
    let s = s.trim();
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let cut: String = s.chars().take(max).collect();
        format!("{cut}…")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::activity::WorkKind;
    use serde_json::json;

    #[test]
    fn basename_skips_trailing_separator() {
        assert_eq!(basename("/a/b/c.ts"), "c.ts");
        assert_eq!(basename("/a/b/my-project/"), "my-project");
        assert_eq!(basename("just-a-name"), "just-a-name");
    }

    #[test]
    fn skill_strips_plugin_namespace() {
        let input = json!({ "skill": "superpowers:brainstorming" });
        let (kind, detail) = classify_tool("Skill", Some(&input));
        assert_eq!(kind, WorkKind::Thinking);
        assert_eq!(detail.as_deref(), Some("brainstorming"));
    }

    #[test]
    fn skill_without_namespace_kept_as_is() {
        let input = json!({ "skill": "deep-research" });
        assert_eq!(skill_name(Some(&input)).as_deref(), Some("deep-research"));
    }

    #[test]
    fn skill_missing_field_is_none() {
        let input = json!({ "args": "x" });
        let (kind, detail) = classify_tool("Skill", Some(&input));
        assert_eq!(kind, WorkKind::Thinking);
        assert_eq!(detail, None);
        assert_eq!(skill_name(None), None);
    }

    #[test]
    fn parse_todos_extracts_items() {
        let input = json!({
            "todos": [
                { "content": "generate types", "status": "completed", "activeForm": "generating types" },
                { "content": "add tests", "status": "in_progress", "activeForm": "adding tests" }
            ]
        });
        let todos = parse_todos(Some(&input));
        assert_eq!(todos.len(), 2);
        assert_eq!(todos[0].status, "completed");
        assert_eq!(todos[1].active_form, "adding tests");
        assert_eq!(todos[1].content, "add tests");
    }

    #[test]
    fn parse_todos_missing_or_nonarray_is_empty() {
        assert!(parse_todos(None).is_empty());
        assert!(parse_todos(Some(&json!({ "todos": "x" }))).is_empty());
        assert!(parse_todos(Some(&json!({ "other": 1 }))).is_empty());
    }

    #[test]
    fn parse_todos_tolerates_missing_fields() {
        let input = json!({ "todos": [ { "content": "do it" } ] });
        let todos = parse_todos(Some(&input));
        assert_eq!(todos.len(), 1);
        assert_eq!(todos[0].content, "do it");
        assert_eq!(todos[0].status, "");
        assert_eq!(todos[0].active_form, "");
    }
}
