use crate::config_io::{self, skills};
use crate::error::AppResult;
use crate::model::config::SkillDef;
use crate::state::AppState;
use std::path::{Path, PathBuf};
use tauri::State;

/// Returns the skills directory for the given project scope (pure function).
fn skills_dir(home: &Path, project: Option<&str>) -> PathBuf {
    match project {
        Some(p) if !p.is_empty() => PathBuf::from(p).join(".claude").join("skills"),
        _ => home.join("skills"),
    }
}

/// Returns the list of skills.
#[tauri::command]
pub fn list_skills(state: State<'_, AppState>, project: Option<String>) -> AppResult<Vec<SkillDef>> {
    skills::list_skills(&skills_dir(&state.paths.home, project.as_deref()))
}

/// Returns all skills visible in a given project (cwd) across user + project + plugin.
/// Plugin names are already namespaced as `<plugin>:<skill>`. Winner resolution is done on the frontend.
#[tauri::command]
pub fn get_effective_skills(
    state: State<'_, AppState>,
    project: String,
) -> AppResult<Vec<SkillDef>> {
    let dir = PathBuf::from(&project);
    let project_dir = if project.is_empty() { None } else { Some(dir.as_path()) };
    let user_dir = state.paths.home.join("skills");
    let plugins_dir = state.paths.home.join("plugins");
    Ok(skills::read_effective_skills(&user_dir, project_dir, &plugins_dir))
}

/// Toggles a skill enabled/disabled (renames SKILL.md <-> .disabled).
#[tauri::command]
pub fn toggle_skill(
    state: State<'_, AppState>,
    project: Option<String>,
    name: String,
    disable: bool,
) -> AppResult<Vec<SkillDef>> {
    let dir = skills_dir(&state.paths.home, project.as_deref());
    let sd = dir.join(&name);
    state.mark_written(&sd.join("SKILL.md"));
    state.mark_written(&sd.join("SKILL.md.disabled"));
    skills::toggle_skill(&dir, &name, disable)?;
    skills::list_skills(&dir)
}

/// Saves a skill (create / edit).
#[tauri::command]
pub fn save_skill(
    state: State<'_, AppState>,
    project: Option<String>,
    skill: SkillDef,
    create: bool,
) -> AppResult<SkillDef> {
    let dir = skills_dir(&state.paths.home, project.as_deref());
    let sd = dir.join(&skill.name);
    state.mark_written(&sd.join("SKILL.md"));
    state.mark_written(&sd.join("SKILL.md.disabled"));
    skills::save_skill(
        &dir,
        &state.paths.backups_dir(),
        &skill,
        create,
        config_io::stamp(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn home() -> PathBuf {
        PathBuf::from("/home/u/.claude")
    }

    #[test]
    fn skills_dir_user_scope() {
        assert_eq!(skills_dir(&home(), None), PathBuf::from("/home/u/.claude/skills"));
    }

    #[test]
    fn skills_dir_project_scope() {
        assert_eq!(
            skills_dir(&home(), Some("/work/p")),
            PathBuf::from("/work/p/.claude/skills")
        );
    }
}
