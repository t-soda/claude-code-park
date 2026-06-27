use super::frontmatter as fm;
use crate::error::AppResult;
use crate::model::config::CommandDef;
use std::path::Path;

/// Read ~/.claude/commands/*.md and return the list of commands.
pub fn list_commands(commands_dir: &Path) -> AppResult<Vec<CommandDef>> {
    let mut out = Vec::new();
    if !commands_dir.is_dir() {
        return Ok(out);
    }
    for entry in std::fs::read_dir(commands_dir)? {
        let path = entry?.path();
        if path.extension().and_then(|e| e.to_str()) != Some("md") {
            continue;
        }
        if let Some(c) = read_command(&path) {
            out.push(c);
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

fn read_command(path: &Path) -> Option<CommandDef> {
    let content = std::fs::read_to_string(path).ok()?;
    let (fmval, body) = fm::parse(&content);
    let v = fmval.unwrap_or(serde_yaml::Value::Null);
    let stem = path.file_stem()?.to_str()?.to_string();
    Some(CommandDef {
        name: stem,
        description: fm::get_str(&v, "description").unwrap_or_default(),
        allowed_tools: fm::get_tools(&v, "allowed-tools"),
        body,
        file_path: path.display().to_string(),
    })
}
