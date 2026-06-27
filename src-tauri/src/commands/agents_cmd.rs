use crate::config_io::{self, agents};
use crate::error::AppResult;
use crate::model::agent::AgentDef;
use crate::state::AppState;
use std::path::{Path, PathBuf};
use tauri::State;

/// Returns the agents directory for the given project scope (pure function).
fn agents_dir(home: &Path, project: Option<&str>) -> PathBuf {
    match project {
        Some(p) if !p.is_empty() => PathBuf::from(p).join(".claude").join("agents"),
        _ => home.join("agents"),
    }
}

/// Returns the list of employees (agent definitions).
#[tauri::command]
pub fn list_agents(state: State<'_, AppState>, project: Option<String>) -> AppResult<Vec<AgentDef>> {
    agents::list_agents(&agents_dir(&state.paths.home, project.as_deref()))
}

/// Returns all agents visible in a given project (cwd) across user + project + plugin.
/// Plugin names are already namespaced as `<plugin>:<agent>`. Winner resolution is done on the frontend.
#[tauri::command]
pub fn get_effective_agents(
    state: State<'_, AppState>,
    project: String,
) -> AppResult<Vec<AgentDef>> {
    let dir = PathBuf::from(&project);
    let project_dir = if project.is_empty() { None } else { Some(dir.as_path()) };
    let user_dir = state.paths.home.join("agents");
    let plugins_dir = state.paths.home.join("plugins");
    Ok(agents::read_effective_agents(&user_dir, project_dir, &plugins_dir))
}

/// Saves an employee (hire = create / edit existing). Returns the saved AgentDef.
#[tauri::command]
pub fn save_agent(
    state: State<'_, AppState>,
    project: Option<String>,
    agent: AgentDef,
    create: bool,
) -> AppResult<AgentDef> {
    let dir = agents_dir(&state.paths.home, project.as_deref());
    let path = dir.join(format!("{}.md", agent.name));
    state.mark_written(&path);
    let saved = agents::save_agent(
        &dir,
        &state.paths.backups_dir(),
        &agent,
        create,
        config_io::stamp(),
    )?;
    // The global world's main-session-to-employee mapping uses user definitions only. Don't update it for project scope.
    if project.as_deref().map(|p| p.is_empty()).unwrap_or(true) {
        refresh_world_agents(&state);
    }
    Ok(saved)
}

/// Fires an employee (deletes the definition).
#[tauri::command]
pub fn delete_agent(
    state: State<'_, AppState>,
    project: Option<String>,
    name: String,
) -> AppResult<()> {
    let dir = agents_dir(&state.paths.home, project.as_deref());
    state.mark_written(&dir.join(format!("{name}.md")));
    agents::delete_agent(
        &dir,
        &state.paths.backups_dir(),
        &name,
        config_io::stamp(),
    )?;
    if project.as_deref().map(|p| p.is_empty()).unwrap_or(true) {
        refresh_world_agents(&state);
    }
    Ok(())
}

/// Reloads the World's employee list (refreshes the main-session-to-employee mapping).
fn refresh_world_agents(state: &AppState) {
    if let Ok(agents) = agents::list_agents(&state.paths.agents_dir()) {
        state.world.lock().unwrap().agents = agents;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn home() -> PathBuf { PathBuf::from("/home/u/.claude") }

    #[test]
    fn agents_dir_user_scope() {
        assert_eq!(agents_dir(&home(), None), PathBuf::from("/home/u/.claude/agents"));
    }

    #[test]
    fn agents_dir_project_scope() {
        assert_eq!(
            agents_dir(&home(), Some("/work/p")),
            PathBuf::from("/work/p/.claude/agents")
        );
    }
}
