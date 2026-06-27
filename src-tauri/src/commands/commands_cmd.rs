use crate::config_io::commands as cmd_io;
use crate::error::AppResult;
use crate::model::config::CommandDef;
use crate::state::AppState;
use std::path::{Path, PathBuf};
use tauri::State;

/// Returns the commands directory for the given project scope (pure function).
fn commands_dir(home: &Path, project: Option<&str>) -> PathBuf {
    match project {
        Some(p) if !p.is_empty() => PathBuf::from(p).join(".claude").join("commands"),
        _ => home.join("commands"),
    }
}

/// Returns the list of commands (slash commands).
#[tauri::command]
pub fn list_commands(
    state: State<'_, AppState>,
    project: Option<String>,
) -> AppResult<Vec<CommandDef>> {
    cmd_io::list_commands(&commands_dir(&state.paths.home, project.as_deref()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn home() -> PathBuf { PathBuf::from("/home/u/.claude") }

    #[test]
    fn commands_dir_user_scope() {
        assert_eq!(commands_dir(&home(), None), PathBuf::from("/home/u/.claude/commands"));
    }

    #[test]
    fn commands_dir_project_scope() {
        assert_eq!(
            commands_dir(&home(), Some("/work/p")),
            PathBuf::from("/work/p/.claude/commands")
        );
    }
}
