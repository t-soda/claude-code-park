use super::entry::RawEntry;

/// Parses a single JSONL line into a RawEntry. Returns None for blank lines or parse failures (broken lines are skipped).
pub fn parse_line(line: &str) -> Option<RawEntry> {
    let line = line.trim();
    if line.is_empty() {
        return None;
    }
    serde_json::from_str::<RawEntry>(line).ok()
}
