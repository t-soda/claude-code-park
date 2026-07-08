use serde::Deserialize;

/// A single (raw) line of the session JSONL. Unknown fields are ignored and missing fields are tolerated
/// (because the shape can change across Claude Code versions).
#[derive(Debug, Clone, Deserialize)]
pub struct RawEntry {
    #[serde(rename = "type")]
    pub entry_type: Option<String>,
    pub timestamp: Option<String>,
    pub cwd: Option<String>,
    #[serde(rename = "gitBranch")]
    pub git_branch: Option<String>,
    pub slug: Option<String>,
    /// The session's launch path ("cli" = interactive launch, "sdk-cli" = SDK/eval launch).
    /// Used to exclude non-interactive sdk-cli sessions from the count of clocked-in main sessions.
    pub entrypoint: Option<String>,
    /// The subtype of a system entry (turn_duration, etc.).
    pub subtype: Option<String>,
    /// Top-level content of non-message entries. queue-operation entries carry the
    /// task-notification text (background agent stopped) here. Kept raw so a future
    /// CLI writing a non-string shape degrades to "no notification" instead of
    /// failing the whole line's parse (which would also drop its timestamp/meta).
    pub content: Option<serde_json::Value>,
    pub message: Option<RawMessage>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RawMessage {
    /// content is a string or an array. Only treated as blocks when it is an array.
    pub content: Option<ContentField>,
    pub usage: Option<RawUsage>,
    /// The model ID the assistant entry actually used ("claude-sonnet-4-6", etc.).
    pub model: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum ContentField {
    /// A catch-all to absorb string content (user prompts, etc.) without dropping it.
    Text(String),
    Blocks(Vec<ContentBlock>),
}

#[derive(Debug, Clone, Deserialize)]
pub struct ContentBlock {
    #[serde(rename = "type")]
    pub block_type: Option<String>,
    // text
    pub text: Option<String>,
    // tool_use
    pub name: Option<String>,
    pub input: Option<serde_json::Value>,
    /// The id of the tool_use block (for Pre/Post pairing).
    pub id: Option<String>,
    // tool_result
    pub is_error: Option<bool>,
    /// The id of the tool_use that the tool_result refers to (for Pre/Post pairing).
    pub tool_use_id: Option<String>,
    /// tool_result content: a string or an array of blocks. Kept raw because only
    /// the leading text is ever inspected (async-launch ack detection).
    pub content: Option<serde_json::Value>,
}

impl ContentBlock {
    /// The leading text of a tool_result's content (string content, or the first
    /// text block for array content). None when there is no text.
    pub fn result_text(&self) -> Option<&str> {
        match self.content.as_ref()? {
            serde_json::Value::String(s) => Some(s.as_str()),
            serde_json::Value::Array(blocks) => blocks.iter().find_map(|b| {
                (b.get("type")?.as_str()? == "text")
                    .then(|| b.get("text")?.as_str())
                    .flatten()
            }),
            _ => None,
        }
    }
}

/// A background agent's stop notification, parsed out of a queue-operation entry.
/// Fires each time the agent stops (it may be resumed and notify again later).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TaskNotification {
    /// The agent id (task-id) that stopped.
    pub task_id: String,
    /// The Agent tool_use id that spawned it.
    pub tool_use_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RawUsage {
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
}

impl RawEntry {
    /// Returns the blocks of the content array (empty for string content or when missing).
    pub fn blocks(&self) -> &[ContentBlock] {
        match self.message.as_ref().and_then(|m| m.content.as_ref()) {
            Some(ContentField::Blocks(b)) => b,
            _ => &[],
        }
    }

    /// Returns the last tool_use block (since one assistant response may have several).
    pub fn last_tool_use(&self) -> Option<&ContentBlock> {
        self.blocks()
            .iter()
            .filter(|b| b.block_type.as_deref() == Some("tool_use"))
            .last()
    }

    /// The list of tool_result blocks (used to compute the failure rate).
    pub fn tool_results(&self) -> impl Iterator<Item = &ContentBlock> {
        self.blocks()
            .iter()
            .filter(|b| b.block_type.as_deref() == Some("tool_result"))
    }

    /// The runtime model ID this entry used (the assistant entry's message.model).
    pub fn model(&self) -> Option<&str> {
        self.message.as_ref().and_then(|m| m.model.as_deref())
    }

    /// Whether it contains an extended-thinking (thinking) block.
    pub fn has_thinking(&self) -> bool {
        self.blocks()
            .iter()
            .any(|b| b.block_type.as_deref() == Some("thinking"))
    }

    /// Whether it is a prompt from a human (a user entry that is not a tool_result).
    /// = the signal for the agent to start this turn's work. Used to treat the wait from
    /// receipt until the first assistant entry appears as "working".
    pub fn is_user_prompt(&self) -> bool {
        self.entry_type.as_deref() == Some("user")
            && !self
                .blocks()
                .iter()
                .any(|b| b.block_type.as_deref() == Some("tool_result"))
    }

    /// The human prompt text: the string content, or the first text block for array
    /// content. None for non-prompt entries (tool_results, assistant entries, ...).
    pub fn user_prompt_text(&self) -> Option<&str> {
        if !self.is_user_prompt() {
            return None;
        }
        match self.message.as_ref()?.content.as_ref()? {
            ContentField::Text(s) => Some(s),
            ContentField::Blocks(blocks) => blocks
                .iter()
                .find(|b| b.block_type.as_deref() == Some("text"))
                .and_then(|b| b.text.as_deref()),
        }
    }

    /// Parses a background agent's stop notification. Only queue-operation entries
    /// carry it in top-level content (the duplicate attachment entry nests it under
    /// attachment.prompt and is deliberately not parsed, to process each stop once).
    pub fn task_notification(&self) -> Option<TaskNotification> {
        if self.entry_type.as_deref() != Some("queue-operation") {
            return None;
        }
        let content = self.content.as_ref()?.as_str()?;
        if !content.contains("<task-notification>") {
            return None;
        }
        Some(TaskNotification {
            task_id: tag_text(content, "task-id")?.to_string(),
            tool_use_id: tag_text(content, "tool-use-id").map(str::to_string),
        })
    }

    /// Whether it is a turn-end marker (system/turn_duration, etc. = transition to waiting for user input).
    pub fn is_turn_end(&self) -> bool {
        self.entry_type.as_deref() == Some("system")
            && matches!(
                self.subtype.as_deref(),
                Some("turn_duration") | Some("stop_hook_summary")
            )
    }
}

/// The text between <tag> and </tag> (first occurrence).
fn tag_text<'a>(s: &'a str, tag: &str) -> Option<&'a str> {
    let open = format!("<{tag}>");
    let start = s.find(&open)? + open.len();
    let end = s[start..].find(&format!("</{tag}>"))? + start;
    Some(s[start..end].trim())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn e(json: &str) -> RawEntry {
        serde_json::from_str(json).expect("fixture should parse")
    }

    /// A queue-operation entry carrying a task-notification yields the stopped
    /// agent's task-id and the spawning tool_use id.
    #[test]
    fn parses_task_notification() {
        let entry = e(
            r#"{"type":"queue-operation","operation":"enqueue","timestamp":"2026-07-05T11:51:26.492Z","sessionId":"S","content":"<task-notification>\n<task-id>a784c3</task-id>\n<tool-use-id>toolu_01</tool-use-id>\n<status>completed</status>\n</task-notification>"}"#,
        );
        let n = entry.task_notification().expect("should parse");
        assert_eq!(n.task_id, "a784c3");
        assert_eq!(n.tool_use_id.as_deref(), Some("toolu_01"));
    }

    /// Other entry shapes yield no notification: a queue-operation without the
    /// marker, and a user entry whose message merely mentions it.
    #[test]
    fn ignores_non_notification_entries() {
        let plain = e(
            r#"{"type":"queue-operation","operation":"enqueue","timestamp":"2026-07-05T11:51:26.492Z","sessionId":"S","content":"remember to run tests"}"#,
        );
        assert_eq!(plain.task_notification(), None);
        let user = e(
            r#"{"type":"user","timestamp":"2026-07-05T11:51:26.492Z","sessionId":"S","message":{"role":"user","content":"<task-notification>fake</task-notification>"}}"#,
        );
        assert_eq!(user.task_notification(), None);
    }

    /// A non-string top-level content (should a future CLI write one) must not
    /// fail the line's parse — the entry still yields its timestamp and simply
    /// carries no notification.
    #[test]
    fn non_string_content_degrades_to_no_notification() {
        let entry = e(
            r#"{"type":"queue-operation","operation":"enqueue","timestamp":"2026-07-05T11:51:26.492Z","sessionId":"S","content":{"kind":"structured","text":"<task-notification>x</task-notification>"}}"#,
        );
        assert_eq!(entry.task_notification(), None);
        assert_eq!(entry.timestamp.as_deref(), Some("2026-07-05T11:51:26.492Z"));
    }

    /// result_text reads string content directly and digs the first text block
    /// out of array content.
    #[test]
    fn result_text_handles_both_content_shapes() {
        let s = e(
            r#"{"type":"user","timestamp":"2026-07-05T11:00:00.000Z","sessionId":"S","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t1","content":"plain"}]}}"#,
        );
        assert_eq!(s.tool_results().next().unwrap().result_text(), Some("plain"));
        let arr = e(
            r#"{"type":"user","timestamp":"2026-07-05T11:00:00.000Z","sessionId":"S","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t1","content":[{"type":"text","text":"Async agent launched successfully."}]}]}}"#,
        );
        assert_eq!(
            arr.tool_results().next().unwrap().result_text(),
            Some("Async agent launched successfully.")
        );
    }

    /// Content shapes with no leading text yield None: an array without text
    /// blocks, and a numeric content.
    #[test]
    fn result_text_none_without_text() {
        let no_text = e(
            r#"{"type":"user","timestamp":"2026-07-05T11:00:00.000Z","sessionId":"S","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t1","content":[{"type":"image","source":{}}]}]}}"#,
        );
        assert_eq!(no_text.tool_results().next().unwrap().result_text(), None);
        let numeric = e(
            r#"{"type":"user","timestamp":"2026-07-05T11:00:00.000Z","sessionId":"S","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t1","content":42}]}}"#,
        );
        assert_eq!(numeric.tool_results().next().unwrap().result_text(), None);
    }
}
