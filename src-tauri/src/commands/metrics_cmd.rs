use crate::error::{AppError, AppResult};
use crate::metrics;
use crate::model::metrics::AgentMetrics;
use crate::state::AppState;
use chrono::Utc;
use tauri::State;

/// Aggregates and returns metrics per employee (__main__ plus each subagent_type).
///
/// Aggregation scans every JSONL under projects_dir and parses every line, so it can take
/// hundreds of ms to several seconds. As a sync command, Tauri would run it on the main thread,
/// freezing the UI since the WebView can't repaint meanwhile. So this is an async command, and the
/// heavy aggregation is offloaded to a worker thread via spawn_blocking.
#[tauri::command]
pub async fn get_metrics(
    state: State<'_, AppState>,
    project: Option<String>,
) -> AppResult<Vec<AgentMetrics>> {
    // Hold the lock only to clone, then release it immediately; don't hold it across an await.
    let agents = state.world.lock().unwrap().agents.clone();
    let projects_dir = state.paths.projects_dir();
    tauri::async_runtime::spawn_blocking(move || {
        metrics::compute_all(&projects_dir, &agents, Utc::now(), project.as_deref())
    })
    .await
    .map_err(|e| AppError::Other(format!("metrics aggregation task failed: {e}")))
}
