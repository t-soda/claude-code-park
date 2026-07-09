use crate::jsonl::entry::RawEntry;
use crate::model::activity::WorkKind;
use crate::model::timeline::TimelineEntry;
use crate::pipeline::classify::{classify_tool, skill_name};

/// Converts a sequence of raw JSONL entries into a work-log timeline (pure function).
/// Using the same criteria as session_tracker::classify_entry, produces at most 1 row per entry,
/// and carries over active_skill (set by the Skill tool, cleared on turn boundary / new prompt).
/// If it exceeds limit, keeps only the tail (most recent).
pub fn build_timeline(entries: &[RawEntry], limit: usize) -> Vec<TimelineEntry> {
    let mut out: Vec<TimelineEntry> = Vec::new();
    let mut skill: Option<String> = None;
    for e in entries {
        skill = next_skill(e, skill.take());
        // blocked_hook is checked ahead of row_for: a hook block is never also an
        // activity change (row_for already returns None for all three entry shapes
        // a block can be read from), so this only adds rows, never shadows one.
        // Kept separate from row_for itself because replay::ReplayBuilder shares
        // row_for for its Activity stream and must not see a fabricated WorkKind
        // for these entries.
        let row = blocked_hook(e)
            .map(|(tool, reason)| row_blocked(tool, reason, e))
            .or_else(|| row_for(e));
        if let Some(mut row) = row {
            row.active_skill = skill.clone();
            out.push(row);
        }
    }
    if out.len() > limit {
        out.split_off(out.len() - limit)
    } else {
        out
    }
}

/// One entry -> one row. Rows that do not change state (text responses, tool_result, TodoWrite) are None.
pub(crate) fn row_for(e: &RawEntry) -> Option<TimelineEntry> {
    if e.is_turn_end() {
        return Some(row(WorkKind::Idle, None, None, e));
    }
    if e.is_user_prompt() {
        return Some(row(WorkKind::Thinking, None, None, e));
    }
    if let Some(tb) = e.last_tool_use() {
        let name = tb.name.as_deref().unwrap_or("");
        if name == "TodoWrite" {
            return None;
        }
        let (kind, detail) = classify_tool(name, tb.input.as_ref());
        return Some(row(kind, Some(name.to_string()), detail, e));
    }
    if e.has_thinking() {
        return Some(row(WorkKind::Thinking, None, None, e));
    }
    None
}

/// The (tool, reason) of a hook block carried by this entry, if any. Covers the three
/// sources that carry a block outcome (mirrors session_tracker::reconstruct): a
/// PreToolUse rejection buried in a tool_result, a PostToolUse/Stop hook_blocking_error
/// attachment, and a blocked stop_hook_summary. Only surfaced when the reason text is
/// non-empty — a block with no reason has nothing to show in this log.
fn blocked_hook(e: &RawEntry) -> Option<(Option<String>, String)> {
    // A parallel tool_use batch can carry several tool_results; find_map must keep
    // scanning past one whose block has no reason (e.g. an empty stderr) instead of
    // locking onto the first block-shaped result regardless of whether it has text.
    e.tool_results()
        .filter_map(|tr| tr.pre_hook_block())
        .find_map(|b| b.reason.map(|r| (Some(b.tool), r)))
        .or_else(|| e.hook_blocking().and_then(|b| b.reason.map(|r| (b.tool, r))))
        .or_else(|| {
            e.hook_summary()
                .filter(|s| s.blocked)
                .and_then(|s| s.stop_reason.map(|r| (None, r)))
        })
}

/// Builds a row. `kind` is None only for a blocked-hook row (see `row_blocked`); the
/// frontend renders those specially, keyed off `block_reason` rather than `kind`.
fn entry_row(
    kind: Option<WorkKind>,
    tool_name: Option<String>,
    detail: Option<String>,
    block_reason: Option<String>,
    e: &RawEntry,
) -> TimelineEntry {
    TimelineEntry {
        ts: e.timestamp.clone(),
        kind,
        detail,
        tool_name,
        active_skill: None,
        block_reason,
    }
}

fn row(kind: WorkKind, tool_name: Option<String>, detail: Option<String>, e: &RawEntry) -> TimelineEntry {
    entry_row(Some(kind), tool_name, detail, None, e)
}

fn row_blocked(tool_name: Option<String>, reason: String, e: &RawEntry) -> TimelineEntry {
    entry_row(None, tool_name, None, Some(reason), e)
}

/// Same logic as next_active_skill (symmetric with session_tracker).
pub(crate) fn next_skill(e: &RawEntry, prev: Option<String>) -> Option<String> {
    if e.is_turn_end() || e.is_user_prompt() {
        return None;
    }
    if let Some(tb) = e.last_tool_use() {
        if tb.name.as_deref() == Some("Skill") {
            return skill_name(tb.input.as_ref());
        }
    }
    prev
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::jsonl::entry::RawEntry;
    use crate::model::activity::WorkKind;

    fn e(json: &str) -> RawEntry {
        serde_json::from_str(json).expect("fixture should parse")
    }

    /// A Read -> Edit tool sequence is laid out chronologically with kind and tool_name.
    #[test]
    fn builds_rows_for_tools() {
        let read = e(r#"{"type":"assistant","timestamp":"2026-06-25T01:00:00.000Z","message":{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"Read","input":{"file_path":"/a/Button.tsx"}}]}}"#);
        let edit = e(r#"{"type":"assistant","timestamp":"2026-06-25T01:00:05.000Z","message":{"role":"assistant","content":[{"type":"tool_use","id":"t2","name":"Edit","input":{"file_path":"/a/handler.ts"}}]}}"#);
        let rows = build_timeline(&[read, edit], 200);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].kind, Some(WorkKind::Reading));
        assert_eq!(rows[0].tool_name.as_deref(), Some("Read"));
        assert_eq!(rows[0].detail.as_deref(), Some("Button.tsx"));
        assert_eq!(rows[1].kind, Some(WorkKind::Editing));
        assert_eq!(rows[1].tool_name.as_deref(), Some("Edit"));
    }

    /// turn_end -> Idle, user prompt -> Thinking, thinking -> Thinking (tool_name is None).
    #[test]
    fn builds_narrative_rows() {
        let prompt = e(r#"{"type":"user","timestamp":"2026-06-25T01:00:00.000Z","message":{"role":"user","content":"do it"}}"#);
        let end = e(r#"{"type":"system","subtype":"turn_duration","timestamp":"2026-06-25T01:01:00.000Z"}"#);
        let rows = build_timeline(&[prompt, end], 200);
        assert_eq!(rows[0].kind, Some(WorkKind::Thinking));
        assert_eq!(rows[0].tool_name, None);
        assert_eq!(rows[1].kind, Some(WorkKind::Idle));
    }

    /// The Skill tool sets active_skill, which carries over to subsequent rows.
    #[test]
    fn carries_active_skill() {
        let skill = e(r#"{"type":"assistant","timestamp":"2026-06-25T01:00:00.000Z","message":{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"Skill","input":{"skill":"superpowers:brainstorming"}}]}}"#);
        let edit = e(r#"{"type":"assistant","timestamp":"2026-06-25T01:00:05.000Z","message":{"role":"assistant","content":[{"type":"tool_use","id":"t2","name":"Edit","input":{"file_path":"/a/x.ts"}}]}}"#);
        let rows = build_timeline(&[skill, edit], 200);
        assert_eq!(rows.last().unwrap().active_skill.as_deref(), Some("brainstorming"));
    }

    /// TodoWrite is bookkeeping, so it creates no row (same treatment as not changing the kind).
    #[test]
    fn skips_todowrite() {
        let todo = e(r#"{"type":"assistant","timestamp":"2026-06-25T01:00:00.000Z","message":{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"TodoWrite","input":{"todos":[]}}]}}"#);
        assert!(build_timeline(&[todo], 200).is_empty());
    }

    /// A PreToolUse hook rejection (parsed out of the tool_result's error text) becomes
    /// a row carrying the blocked tool and the stderr reason, not a normal tool row.
    #[test]
    fn pre_hook_block_becomes_a_row() {
        let entry = e(
            r#"{"type":"user","timestamp":"2026-07-08T10:29:02.706Z","message":{"role":"user","content":[{"type":"tool_result","content":"PreToolUse:Read hook error: [echo blocked >&2; exit 2]: blocked\n","is_error":true,"tool_use_id":"toolu_01"}]}}"#,
        );
        let rows = build_timeline(&[entry], 200);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].kind, None, "kind is not fabricated for a blocked row");
        assert_eq!(rows[0].tool_name.as_deref(), Some("Read"));
        assert_eq!(rows[0].block_reason.as_deref(), Some("blocked"));
    }

    /// A parallel tool_use batch can carry several tool_results in one entry. If the
    /// first PreToolUse-shaped block has no reason (empty stderr) but a later one in
    /// the same entry does, the row must still surface the one with a reason instead
    /// of locking onto the first block-shaped result and yielding nothing.
    #[test]
    fn pre_hook_block_skips_a_reasonless_block_to_find_a_later_one_with_a_reason() {
        let entry = e(
            r#"{"type":"user","timestamp":"2026-07-08T10:29:02.706Z","message":{"role":"user","content":[{"type":"tool_result","content":"PreToolUse:Read hook error: []: ","is_error":true,"tool_use_id":"toolu_01"},{"type":"tool_result","content":"PreToolUse:Bash hook error: [guard.sh]: not allowed","is_error":true,"tool_use_id":"toolu_02"}]}}"#,
        );
        let rows = build_timeline(&[entry], 200);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].tool_name.as_deref(), Some("Bash"));
        assert_eq!(rows[0].block_reason.as_deref(), Some("not allowed"));
    }

    /// A PostToolUse hook_blocking_error attachment becomes a row with the matcher's
    /// tool and the blocking hook's stderr.
    #[test]
    fn hook_blocking_error_becomes_a_row() {
        let entry = e(
            r#"{"type":"attachment","attachment":{"type":"hook_blocking_error","hookName":"PostToolUse:Bash","toolUseID":"toolu_02","hookEvent":"PostToolUse","blockingError":{"blockingError":"[lint.sh]: style violation","command":"lint.sh"}},"timestamp":"2026-07-08T10:34:11.086Z"}"#,
        );
        let rows = build_timeline(&[entry], 200);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].tool_name.as_deref(), Some("Bash"));
        assert_eq!(rows[0].block_reason.as_deref(), Some("[lint.sh]: style violation"));
    }

    /// A blocked stop_hook_summary becomes a row carrying the stopReason, with no
    /// specific tool (the Stop lifecycle isn't tied to one).
    #[test]
    fn blocked_stop_summary_becomes_a_row() {
        let entry = e(
            r#"{"type":"system","subtype":"stop_hook_summary","hookInfos":[{"command":"./gate.sh","durationMs":900}],"hookErrors":[],"preventedContinuation":true,"stopReason":"keep going","timestamp":"2026-07-04T14:31:24.506Z"}"#,
        );
        let rows = build_timeline(&[entry], 200);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].tool_name, None);
        assert_eq!(rows[0].block_reason.as_deref(), Some("keep going"));
    }

    /// A hook block with no reason text (empty stopReason) yields no row at all —
    /// there is nothing for this log to show.
    #[test]
    fn blocked_with_no_reason_yields_no_row() {
        let entry = e(
            r#"{"type":"system","subtype":"stop_hook_summary","hookInfos":[{"command":"./gate.sh","durationMs":900}],"hookErrors":[],"preventedContinuation":true,"stopReason":"","timestamp":"2026-07-04T14:31:24.506Z"}"#,
        );
        assert!(build_timeline(&[entry], 200).is_empty());
    }

    /// If it exceeds limit, keep only the tail (most recent).
    #[test]
    fn truncates_to_limit() {
        let rows_in: Vec<RawEntry> = (0..10)
            .map(|i| e(&format!(r#"{{"type":"assistant","timestamp":"2026-06-25T01:00:0{i}.000Z","message":{{"role":"assistant","content":[{{"type":"tool_use","id":"t","name":"Read","input":{{"file_path":"/a/f{i}.ts"}}}}]}}}}"#)))
            .collect();
        let rows = build_timeline(&rows_in, 3);
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0].detail.as_deref(), Some("f7.ts"));
        assert_eq!(rows[2].detail.as_deref(), Some("f9.ts"));
    }
}
