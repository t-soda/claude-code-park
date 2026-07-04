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

    /// Whether it is a turn-end marker (system/turn_duration, etc. = transition to waiting for user input).
    pub fn is_turn_end(&self) -> bool {
        self.entry_type.as_deref() == Some("system")
            && matches!(
                self.subtype.as_deref(),
                Some("turn_duration") | Some("stop_hook_summary")
            )
    }
}
