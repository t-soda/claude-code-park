use crate::config_io::{self, settings};
use crate::error::AppResult;
use crate::model::config::{EffectiveHooks, HooksMap};
use crate::state::AppState;
use std::path::{Path, PathBuf};
use tauri::State;

/// Returns the settings.json path for the given project scope (pure function).
fn settings_path(home: &Path, project: Option<&str>) -> PathBuf {
    match project {
        Some(p) if !p.is_empty() => PathBuf::from(p).join(".claude").join("settings.json"),
        _ => home.join("settings.json"),
    }
}

/// Returns the hooks from settings.json (event name -> HookEntry list).
/// When project is specified, reads <project>/.claude/settings.json.
#[tauri::command]
pub fn get_hooks(state: State<'_, AppState>, project: Option<String>) -> AppResult<HooksMap> {
    settings::read_hooks(&settings_path(&state.paths.home, project.as_deref()))
}

/// Replaces the entire hooks section (other keys are preserved).
#[tauri::command]
pub fn update_hooks(
    state: State<'_, AppState>,
    project: Option<String>,
    hooks: HooksMap,
) -> AppResult<HooksMap> {
    let path = settings_path(&state.paths.home, project.as_deref());
    state.mark_written(&path);
    settings::write_hooks(&path, &hooks, &state.paths.backups_dir(), config_io::stamp())?;
    settings::read_hooks(&path)
}

/// Returns the hooks actually in effect for a given project (cwd), merged across user+project+local+plugin.
/// If project is an empty string, returns only user + user-scope plugin hooks.
#[tauri::command]
pub fn get_effective_hooks(
    state: State<'_, AppState>,
    project: String,
) -> AppResult<EffectiveHooks> {
    let dir = std::path::PathBuf::from(&project);
    let project_dir = if project.is_empty() { None } else { Some(dir.as_path()) };
    let plugins_dir = state.paths.home.join("plugins");
    settings::read_effective_hooks(&state.paths.settings(), project_dir, &plugins_dir)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn home() -> std::path::PathBuf { PathBuf::from("/home/u/.claude") }

    #[test]
    fn settings_path_user_scope() {
        assert_eq!(settings_path(&home(), None), PathBuf::from("/home/u/.claude/settings.json"));
    }

    #[test]
    fn settings_path_project_scope() {
        assert_eq!(
            settings_path(&home(), Some("/work/p")),
            PathBuf::from("/work/p/.claude/settings.json")
        );
    }
}
