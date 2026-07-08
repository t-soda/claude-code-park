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
    // stop_hook_summary fields (system entry written when Stop/SubagentStop hooks
    // finish; the timestamp minus the longest durationMs is the hooks' start time).
    #[serde(rename = "hookInfos")]
    pub hook_infos: Option<Vec<RawHookInfo>>,
    /// Per-hook error payloads. Shape varies across versions; only emptiness is inspected.
    #[serde(rename = "hookErrors")]
    pub hook_errors: Option<Vec<serde_json::Value>>,
    /// Whether a Stop hook blocked the stop (exit 2), forcing the turn to continue.
    #[serde(rename = "preventedContinuation")]
    pub prevented_continuation: Option<bool>,
    /// The blocking hook's reason shown to the model (empty when not blocked).
    #[serde(rename = "stopReason")]
    pub stop_reason: Option<String>,
    /// Which lifecycle the summary is for. Absent today (implying Stop/SubagentStop);
    /// the binary already reads summaries labeled "PreToolUse", so tolerate them.
    #[serde(rename = "hookLabel")]
    pub hook_label: Option<String>,
    /// Attachment payload (type "attachment" entries): hook_blocking_error /
    /// hook_cancelled carry real hook execution outcomes.
    pub attachment: Option<RawAttachment>,
}

/// One executed hook command inside a stop_hook_summary.
#[derive(Debug, Clone, Deserialize)]
pub struct RawHookInfo {
    pub command: Option<String>,
    #[serde(rename = "durationMs")]
    pub duration_ms: Option<f64>,
}

/// The attachment payload of an attachment entry. Only hook-related types are
/// modeled; other attachment types simply leave these fields None.
#[derive(Debug, Clone, Deserialize)]
pub struct RawAttachment {
    #[serde(rename = "type")]
    pub attachment_type: Option<String>,
    /// Lifecycle event name ("Stop", "PostToolUse", ...).
    #[serde(rename = "hookEvent")]
    pub hook_event: Option<String>,
    /// Event plus matcher ("PostToolUse:Bash") for hook_blocking_error.
    #[serde(rename = "hookName")]
    pub hook_name: Option<String>,
    /// hook_cancelled: the cancelled hook's command and how long it had run.
    pub command: Option<String>,
    #[serde(rename = "durationMs")]
    pub duration_ms: Option<f64>,
    /// The tool_use the hook was attached to (Pre/Post pairing).
    #[serde(rename = "toolUseID")]
    pub tool_use_id: Option<String>,
    /// hook_blocking_error: the blocking hook's command and message.
    #[serde(rename = "blockingError")]
    pub blocking_error: Option<RawBlockingError>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RawBlockingError {
    #[serde(rename = "blockingError")]
    pub blocking_error: Option<String>,
    pub command: Option<String>,
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

/// A PreToolUse hook block parsed from a tool_result's error text. The tool was
/// never executed; the hook rejected it (exit 2).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreHookBlock {
    /// The tool the hook rejected ("Read", "Bash", ...).
    pub tool: String,
    /// The blocking hook's command.
    pub command: Option<String>,
    /// The hook's stderr shown to the model.
    pub reason: Option<String>,
}

impl ContentBlock {
    /// Parses a PreToolUse hook rejection out of an erroring tool_result. The CLI
    /// writes "PreToolUse:<Tool> hook error: [<command>]: <stderr>" as the result
    /// content when a PreToolUse hook exits 2 (verified against Claude Code 2.1.204).
    pub fn pre_hook_block(&self) -> Option<PreHookBlock> {
        if self.is_error != Some(true) {
            return None;
        }
        let text = self.result_text()?;
        let rest = text.strip_prefix("PreToolUse:")?;
        let (tool, rest) = rest.split_once(" hook error: ")?;
        if tool.is_empty() || tool.contains(char::is_whitespace) {
            return None;
        }
        // "[<command>]: <stderr>" — both halves optional-ish; degrade to None fields.
        let (command, reason) = match rest.strip_prefix('[').and_then(|r| r.split_once("]: ")) {
            Some((cmd, msg)) => (Some(cmd.to_string()), Some(msg.trim().to_string())),
            None => (None, Some(rest.trim().to_string())),
        };
        Some(PreHookBlock {
            tool: tool.to_string(),
            command,
            reason: reason.filter(|r| !r.is_empty()),
        })
    }

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
            && (self.subtype.as_deref() == Some("turn_duration")
                || (self.subtype.as_deref() == Some("stop_hook_summary")
                    && self.is_stop_labeled()))
    }

    /// Whether a stop_hook_summary is about the stop lifecycle. hookLabel is absent
    /// today; the CLI binary already reads summaries labeled "PreToolUse", so a
    /// labeled summary for another lifecycle must not read as a turn end.
    fn is_stop_labeled(&self) -> bool {
        matches!(
            self.hook_label.as_deref(),
            None | Some("Stop") | Some("SubagentStop")
        )
    }

    /// A completed Stop/SubagentStop hook run (from a stop_hook_summary entry).
    /// The timestamp is the completion time; timestamp - duration_ms is the start.
    pub fn hook_summary(&self) -> Option<HookSummary> {
        if self.entry_type.as_deref() != Some("system")
            || self.subtype.as_deref() != Some("stop_hook_summary")
            || !self.is_stop_labeled()
        {
            return None;
        }
        let infos = self.hook_infos.as_deref().unwrap_or(&[]);
        Some(HookSummary {
            // Hooks for one event run in parallel: the longest is the wall time.
            duration_ms: infos
                .iter()
                .filter_map(|i| i.duration_ms)
                .fold(0.0, f64::max),
            commands: infos.iter().filter_map(|i| i.command.clone()).collect(),
            had_errors: self.hook_errors.as_ref().is_some_and(|e| !e.is_empty()),
            blocked: self.prevented_continuation == Some(true),
            stop_reason: self
                .stop_reason
                .clone()
                .filter(|r| !r.trim().is_empty()),
        })
    }

    /// A PostToolUse (etc.) hook that blocked with exit 2 (hook_blocking_error attachment).
    pub fn hook_blocking(&self) -> Option<HookBlocking> {
        let a = self.attachment_of("hook_blocking_error")?;
        Some(HookBlocking {
            event: a.hook_event.clone()?,
            // hookName is "<event>:<matcher>"; the matcher names the tool.
            tool: a
                .hook_name
                .as_deref()
                .and_then(|n| n.split_once(':'))
                .map(|(_, t)| t.to_string())
                .filter(|t| !t.is_empty()),
            tool_use_id: a.tool_use_id.clone(),
            command: a
                .blocking_error
                .as_ref()
                .and_then(|b| b.command.clone()),
            reason: a
                .blocking_error
                .as_ref()
                .and_then(|b| b.blocking_error.clone())
                .map(|r| r.trim().to_string())
                .filter(|r| !r.is_empty()),
        })
    }

    /// A hook run the user interrupted mid-flight (hook_cancelled attachment).
    pub fn hook_cancelled(&self) -> Option<HookCancelled> {
        let a = self.attachment_of("hook_cancelled")?;
        Some(HookCancelled {
            event: a.hook_event.clone()?,
            command: a.command.clone(),
            duration_ms: a.duration_ms,
        })
    }

    fn attachment_of(&self, attachment_type: &str) -> Option<&RawAttachment> {
        if self.entry_type.as_deref() != Some("attachment") {
            return None;
        }
        self.attachment
            .as_ref()
            .filter(|a| a.attachment_type.as_deref() == Some(attachment_type))
    }
}

/// A completed Stop/SubagentStop hook run, summarized from a stop_hook_summary entry.
#[derive(Debug, Clone, PartialEq)]
pub struct HookSummary {
    /// Wall time of the run (hooks run in parallel; the longest one's durationMs).
    pub duration_ms: f64,
    /// The executed hook commands.
    pub commands: Vec<String>,
    pub had_errors: bool,
    /// Whether a hook blocked the stop (preventedContinuation).
    pub blocked: bool,
    /// The blocking hook's reason (None when not blocked or empty).
    pub stop_reason: Option<String>,
}

/// A hook that blocked its lifecycle with exit 2 (hook_blocking_error attachment).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HookBlocking {
    /// Lifecycle event name ("PostToolUse", ...).
    pub event: String,
    /// The tool named by hookName's matcher half ("Bash" in "PostToolUse:Bash").
    pub tool: Option<String>,
    /// The tool_use the hook was attached to (Pre/Post pairing).
    pub tool_use_id: Option<String>,
    pub command: Option<String>,
    pub reason: Option<String>,
}

/// A hook run cancelled by a user interrupt (hook_cancelled attachment).
#[derive(Debug, Clone, PartialEq)]
pub struct HookCancelled {
    /// Lifecycle event name ("Stop", ...).
    pub event: String,
    pub command: Option<String>,
    /// How long the hook had been running when cancelled.
    pub duration_ms: Option<f64>,
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

    /// A stop_hook_summary yields the run's wall time (longest parallel hook),
    /// the commands, and no block for a plain completion. Fixture mirrors a real
    /// Claude Code 2.1.204 entry.
    #[test]
    fn parses_stop_hook_summary() {
        let entry = e(
            r#"{"type":"system","subtype":"stop_hook_summary","hookCount":2,"hookInfos":[{"command":"afplay /System/Library/Sounds/Funk.aiff","durationMs":2868},{"command":"echo done","durationMs":12}],"hookErrors":[],"hookAdditionalContext":[],"preventedContinuation":false,"stopReason":"","hasOutput":false,"timestamp":"2026-07-04T14:31:24.506Z","sessionId":"S"}"#,
        );
        let s = entry.hook_summary().expect("should parse");
        assert_eq!(s.duration_ms, 2868.0, "wall time is the longest hook");
        assert_eq!(s.commands.len(), 2);
        assert!(!s.had_errors);
        assert!(!s.blocked);
        assert_eq!(s.stop_reason, None, "empty stopReason reads as no reason");
        assert!(entry.is_turn_end(), "an unlabeled summary is still a turn end");
    }

    /// preventedContinuation + stopReason mark the run blocked, and hookErrors
    /// flip had_errors.
    #[test]
    fn stop_hook_summary_blocked_and_errors() {
        let entry = e(
            r#"{"type":"system","subtype":"stop_hook_summary","hookCount":1,"hookInfos":[{"command":"./check.sh","durationMs":410}],"hookErrors":["exit 2"],"preventedContinuation":true,"stopReason":"tests are failing","timestamp":"2026-07-04T14:31:24.506Z","sessionId":"S"}"#,
        );
        let s = entry.hook_summary().expect("should parse");
        assert!(s.blocked);
        assert!(s.had_errors);
        assert_eq!(s.stop_reason.as_deref(), Some("tests are failing"));
    }

    /// A summary labeled for another lifecycle (the CLI binary already reads
    /// hookLabel:"PreToolUse") is neither a turn end nor a stop summary; labels
    /// naming the stop lifecycles keep working.
    #[test]
    fn labeled_summary_is_not_a_turn_end() {
        let pre = e(
            r#"{"type":"system","subtype":"stop_hook_summary","hookLabel":"PreToolUse","hookInfos":[{"command":"x","durationMs":5}],"timestamp":"2026-07-04T14:31:24.506Z","sessionId":"S"}"#,
        );
        assert!(!pre.is_turn_end());
        assert!(pre.hook_summary().is_none());
        let stop = e(
            r#"{"type":"system","subtype":"stop_hook_summary","hookLabel":"Stop","hookInfos":[{"command":"x","durationMs":5}],"timestamp":"2026-07-04T14:31:24.506Z","sessionId":"S"}"#,
        );
        assert!(stop.is_turn_end());
        assert!(stop.hook_summary().is_some());
    }

    /// A hook_blocking_error attachment yields the event, the tool from the
    /// hookName matcher, the pairing id, and the command + reason. Fixture
    /// mirrors a real 2.1.204 entry.
    #[test]
    fn parses_hook_blocking_error_attachment() {
        let entry = e(
            r#"{"type":"attachment","attachment":{"type":"hook_blocking_error","hookName":"PostToolUse:Bash","toolUseID":"toolu_018N","hookEvent":"PostToolUse","blockingError":{"blockingError":"[echo complaint >&2; exit 2]: complaint\n","command":"echo complaint >&2; exit 2"}},"timestamp":"2026-07-08T10:34:11.086Z","sessionId":"S"}"#,
        );
        let b = entry.hook_blocking().expect("should parse");
        assert_eq!(b.event, "PostToolUse");
        assert_eq!(b.tool.as_deref(), Some("Bash"));
        assert_eq!(b.tool_use_id.as_deref(), Some("toolu_018N"));
        assert_eq!(b.command.as_deref(), Some("echo complaint >&2; exit 2"));
        assert_eq!(b.reason.as_deref(), Some("[echo complaint >&2; exit 2]: complaint"));
        assert!(entry.hook_cancelled().is_none());
    }

    /// A hook_cancelled attachment yields the event, command, and elapsed time.
    /// Fixture mirrors a real 2.1.201 entry.
    #[test]
    fn parses_hook_cancelled_attachment() {
        let entry = e(
            r#"{"type":"attachment","attachment":{"type":"hook_cancelled","hookName":"Stop","toolUseID":"d10a","hookEvent":"Stop","command":"afplay /System/Library/Sounds/Funk.aiff","durationMs":2179,"timedOut":false,"timeoutMs":600000},"timestamp":"2026-07-04T21:06:14.258Z","sessionId":"S"}"#,
        );
        let c = entry.hook_cancelled().expect("should parse");
        assert_eq!(c.event, "Stop");
        assert_eq!(c.command.as_deref(), Some("afplay /System/Library/Sounds/Funk.aiff"));
        assert_eq!(c.duration_ms, Some(2179.0));
        assert!(entry.hook_blocking().is_none());
    }

    /// Non-hook attachments (task_reminder etc.) yield neither record.
    #[test]
    fn other_attachments_yield_no_hook_records() {
        let entry = e(
            r#"{"type":"attachment","attachment":{"type":"task_reminder"},"timestamp":"2026-07-04T21:06:14.258Z","sessionId":"S"}"#,
        );
        assert!(entry.hook_blocking().is_none());
        assert!(entry.hook_cancelled().is_none());
    }

    /// A PreToolUse hook rejection written into a tool_result parses into the
    /// tool, the blocking command, and the stderr reason. Fixture mirrors a real
    /// 2.1.204 entry.
    #[test]
    fn parses_pre_hook_block_from_tool_result() {
        let entry = e(
            r#"{"type":"user","timestamp":"2026-07-08T10:29:02.706Z","sessionId":"S","message":{"role":"user","content":[{"type":"tool_result","content":"PreToolUse:Read hook error: [echo blocked >&2; exit 2]: blocked\n","is_error":true,"tool_use_id":"toolu_01Am"}]}}"#,
        );
        let b = entry
            .tool_results()
            .next()
            .unwrap()
            .pre_hook_block()
            .expect("should parse");
        assert_eq!(b.tool, "Read");
        assert_eq!(b.command.as_deref(), Some("echo blocked >&2; exit 2"));
        assert_eq!(b.reason.as_deref(), Some("blocked"));
    }

    /// Ordinary tool failures — even ones mentioning PreToolUse mid-text — and
    /// successful results are not misread as hook blocks.
    #[test]
    fn pre_hook_block_ignores_ordinary_results() {
        let plain_err = e(
            r#"{"type":"user","timestamp":"2026-07-08T10:29:02.706Z","sessionId":"S","message":{"role":"user","content":[{"type":"tool_result","content":"command not found","is_error":true,"tool_use_id":"t1"}]}}"#,
        );
        assert!(plain_err.tool_results().next().unwrap().pre_hook_block().is_none());
        let not_error = e(
            r#"{"type":"user","timestamp":"2026-07-08T10:29:02.706Z","sessionId":"S","message":{"role":"user","content":[{"type":"tool_result","content":"PreToolUse:Read hook error: [x]: y","is_error":false,"tool_use_id":"t1"}]}}"#,
        );
        assert!(not_error.tool_results().next().unwrap().pre_hook_block().is_none());
        let mid_text = e(
            r#"{"type":"user","timestamp":"2026-07-08T10:29:02.706Z","sessionId":"S","message":{"role":"user","content":[{"type":"tool_result","content":"the PreToolUse: hook error: docs say [a]: b","is_error":true,"tool_use_id":"t1"}]}}"#,
        );
        assert!(mid_text.tool_results().next().unwrap().pre_hook_block().is_none());
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
