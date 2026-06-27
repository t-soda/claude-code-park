use serde_yaml::Value;

/// Split a Markdown file into YAML frontmatter and body.
/// If there is no frontmatter, returns (None, full text).
pub fn parse(content: &str) -> (Option<Value>, String) {
    let norm = content.replace("\r\n", "\n");
    if !norm.starts_with("---") {
        return (None, content.to_string());
    }
    let after = &norm[3..];
    // Find the closing marker "\n---".
    let Some(close_nl) = after.find("\n---") else {
        return (None, content.to_string());
    };
    let yaml_str = &after[..close_nl];
    // Skip to the end of the closing-marker line (the next newline).
    let close_start = close_nl + 1; // position of '-'
    let line_end = after[close_start..]
        .find('\n')
        .map(|i| close_start + i + 1)
        .unwrap_or(after.len());
    let body = after[line_end..].trim_start_matches('\n').to_string();
    let val = serde_yaml::from_str::<Value>(yaml_str).ok().flatten();
    (val, body)
}

trait FlattenNull {
    fn flatten(self) -> Option<Value>;
}
impl FlattenNull for Option<Value> {
    fn flatten(self) -> Option<Value> {
        match self {
            Some(Value::Null) => None,
            other => other,
        }
    }
}

/// Extract a string field from the frontmatter.
pub fn get_str(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(|x| x.as_str()).map(str::to_string)
}

/// Extract a boolean field from the frontmatter (defaults to false).
pub fn get_bool(v: &Value, key: &str) -> bool {
    v.get(key).and_then(|x| x.as_bool()).unwrap_or(false)
}

/// Normalize tools / allowed-tools into a Vec<String>.
/// Accepts either a string (comma/whitespace-separated) or a sequence.
pub fn get_tools(v: &Value, key: &str) -> Vec<String> {
    match v.get(key) {
        Some(Value::String(s)) => split_tools(s),
        Some(Value::Sequence(seq)) => seq
            .iter()
            .filter_map(|x| x.as_str().map(str::to_string))
            .collect(),
        _ => Vec::new(),
    }
}

/// Produce a double-quoted string that is safe as a frontmatter value (newlines become spaces).
pub fn yaml_quote(s: &str) -> String {
    let escaped = s
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', " ")
        .replace('\r', "");
    format!("\"{escaped}\"")
}

/// "Bash(git:*), Read(*.md)" / "Glob Grep Read" → ["Bash(git:*)", "Read(*.md)", ...]
pub fn split_tools(s: &str) -> Vec<String> {
    s.split([',', ' ', '\t', '\n'])
        .map(str::trim)
        .filter(|t| !t.is_empty())
        .map(str::to_string)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_frontmatter_and_body() {
        let md = "---\nname: ship\ndescription: \"ship it\"\nallowed-tools: Bash(git:*) Read(*.md)\n---\n\n# Body\nThis is the body.\n";
        let (fm, body) = parse(md);
        let fm = fm.expect("frontmatter present");
        assert_eq!(get_str(&fm, "name").as_deref(), Some("ship"));
        assert_eq!(get_str(&fm, "description").as_deref(), Some("ship it"));
        assert_eq!(get_tools(&fm, "allowed-tools"), vec!["Bash(git:*)", "Read(*.md)"]);
        assert!(body.starts_with("# Body"));
    }

    #[test]
    fn no_frontmatter() {
        let (fm, body) = parse("# just markdown\n");
        assert!(fm.is_none());
        assert_eq!(body, "# just markdown\n");
    }

    #[test]
    fn tools_as_sequence() {
        let md = "---\ntools:\n  - Read\n  - Edit\n---\nbody\n";
        let (fm, _) = parse(md);
        assert_eq!(get_tools(&fm.unwrap(), "tools"), vec!["Read", "Edit"]);
    }
}
