use crate::error::AppResult;
use crate::model::InitialState;
use crate::state::AppState;
use tauri::State;

/// Called by the frontend at startup. Returns a snapshot of the current world (sessions and employees).
/// Empty in Phase 0. From Phase 1 onward it holds the results of scanning projects and loading agents.
#[tauri::command]
pub fn get_initial_state(state: State<'_, AppState>) -> AppResult<InitialState> {
    let world = state.world.lock().unwrap();
    Ok(InitialState {
        sessions: world.sessions.values().cloned().collect(),
        agents: world.agents.clone(),
    })
}
