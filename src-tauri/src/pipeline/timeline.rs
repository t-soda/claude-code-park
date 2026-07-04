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
        if let Some(mut row) = row_for(e) {
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

fn row(kind: WorkKind, tool_name: Option<String>, detail: Option<String>, e: &RawEntry) -> TimelineEntry {
    TimelineEntry {
        ts: e.timestamp.clone(),
        kind,
        detail,
        tool_name,
        active_skill: None,
    }
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
        assert_eq!(rows[0].kind, WorkKind::Reading);
        assert_eq!(rows[0].tool_name.as_deref(), Some("Read"));
        assert_eq!(rows[0].detail.as_deref(), Some("Button.tsx"));
        assert_eq!(rows[1].kind, WorkKind::Editing);
        assert_eq!(rows[1].tool_name.as_deref(), Some("Edit"));
    }

    /// turn_end -> Idle, user prompt -> Thinking, thinking -> Thinking (tool_name is None).
    #[test]
    fn builds_narrative_rows() {
        let prompt = e(r#"{"type":"user","timestamp":"2026-06-25T01:00:00.000Z","message":{"role":"user","content":"do it"}}"#);
        let end = e(r#"{"type":"system","subtype":"turn_duration","timestamp":"2026-06-25T01:01:00.000Z"}"#);
        let rows = build_timeline(&[prompt, end], 200);
        assert_eq!(rows[0].kind, WorkKind::Thinking);
        assert_eq!(rows[0].tool_name, None);
        assert_eq!(rows[1].kind, WorkKind::Idle);
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
