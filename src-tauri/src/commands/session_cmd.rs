use crate::error::{AppError, AppResult};
use crate::jsonl::TailReader;
use crate::model::timeline::TimelineEntry;
use crate::pipeline::timeline::build_timeline;
use crate::pipeline::{route_path, Target};
use crate::state::AppState;
use std::path::PathBuf;
use tauri::State;

/// Reads the clicked character's session JSONL once and returns a timeline of the work log.
/// Fully on-demand, not kept in memory. Limited to the most recent 200 entries (to stay lightweight).
/// If agent_id is Some, reads the sub agent (employee) JSONL; if None, the main session (Orchestrator).
#[tauri::command]
pub async fn get_session_timeline(
    state: State<'_, AppState>,
    session_id: String,
    agent_id: Option<String>,
) -> AppResult<Vec<TimelineEntry>> {
    const LIMIT: usize = 200;
    // Far more JSONL than LIMIT rows ever need, and keeps a click on a huge session cheap.
    const READ_BYTES: u64 = 2 * 1024 * 1024;
    let projects_dir = state.paths.projects_dir();
    tauri::async_runtime::spawn_blocking(move || {
        let path = resolve_path(&projects_dir, &session_id, agent_id.as_deref())
            .ok_or_else(|| AppError::Other("session JSONL not found".into()))?;
        let mut tail = TailReader::new();
        // A fresh TailReader starts at offset 0; read_tail returns the newest complete
        // lines only, without the head-meta salvage (a stale first line is not a row).
        let entries = tail.read_tail(&path, READ_BYTES);
        Ok(build_timeline(&entries, LIMIT))
    })
    .await
    .map_err(|e| AppError::Other(format!("timeline fetch task failed: {e}")))?
}

/// Resolves the actual JSONL path from session_id (+ agent_id) via glob.
/// Validates it against the expected path (Main / Sub) with route_path before returning.
pub(crate) fn resolve_path(projects_dir: &std::path::Path, session_id: &str, agent_id: Option<&str>) -> Option<PathBuf> {
    let pattern = match agent_id {
        Some(aid) => format!(
            "{}/*/{}/subagents/agent-{}.jsonl",
            projects_dir.display(),
            session_id,
            aid
        ),
        None => format!("{}/*/{}.jsonl", projects_dir.display(), session_id),
    };
    for path in glob::glob(&pattern).into_iter().flatten().flatten() {
        match (agent_id, route_path(projects_dir, &path)) {
            (None, Some(Target::Main { .. })) => return Some(path),
            (Some(_), Some(Target::Sub { .. })) => return Some(path),
            _ => continue,
        }
    }
    None
}
