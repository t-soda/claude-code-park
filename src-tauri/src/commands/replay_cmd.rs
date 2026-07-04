use crate::error::{AppError, AppResult};
use crate::jsonl::entry::RawEntry;
use crate::jsonl::{for_each_entry, TailReader};
use crate::model::replay::{ReplayData, ReplaySessionMeta};
use crate::model::session::SessionStatus;
use crate::pipeline::replay::{assemble, epoch_ms, is_markup_prompt, ReplayBuilder};
use crate::pipeline::session_tracker::status_from_last;
use crate::pipeline::{route_path, Target};
use crate::state::AppState;
use chrono::{DateTime, Utc};
use std::path::Path;
use tauri::State;

/// How many head lines are scanned per file for session meta (cwd/slug/entrypoint/
/// first prompt all appear within the first few lines).
const HEAD_LINES: usize = 50;
/// Tail window read per file to find the last event timestamp.
const TAIL_BYTES: u64 = 64 * 1024;
/// Only sessions modified within this window are listed (bounds the scan cost;
/// same policy as the metrics scan).
const MAX_AGE_SECS: u64 = 31 * 24 * 3600;
/// Upper bound on the number of sessions returned (newest first).
const MAX_SESSIONS: usize = 200;

/// Lists past (Ended) sessions available for replay, newest first.
/// Never reads whole files: only a bounded head scan plus a bounded tail read per file.
#[tauri::command]
pub async fn list_replay_sessions(state: State<'_, AppState>) -> AppResult<Vec<ReplaySessionMeta>> {
    let projects_dir = state.paths.projects_dir();
    tauri::async_runtime::spawn_blocking(move || {
        let now = Utc::now();
        let now_sys = std::time::SystemTime::now();
        let mut out: Vec<ReplaySessionMeta> = Vec::new();
        let pattern = format!("{}/*/*.jsonl", projects_dir.display());
        for path in glob::glob(&pattern).into_iter().flatten().flatten() {
            let Some(Target::Main { session_id }) = route_path(&projects_dir, &path) else {
                continue;
            };
            let recent = std::fs::metadata(&path)
                .and_then(|m| m.modified())
                .ok()
                .and_then(|mt| now_sys.duration_since(mt).ok())
                .map(|age| age.as_secs() <= MAX_AGE_SECS)
                .unwrap_or(false);
            if !recent {
                continue;
            }
            let head = read_head(&path, HEAD_LINES);
            let last_ts = TailReader::new()
                .read_tail(&path, TAIL_BYTES)
                .iter()
                .rev()
                .find_map(|e| e.timestamp.clone());
            if let Some(meta) = meta_from_scan(&session_id, &head, last_ts.as_deref(), now) {
                out.push(meta);
            }
        }
        out.sort_by(|a, b| b.ended_at_ms.total_cmp(&a.ended_at_ms));
        out.truncate(MAX_SESSIONS);
        Ok(out)
    })
    .await
    .map_err(|e| AppError::Other(format!("replay list task failed: {e}")))?
}

/// Reads one past session (main + subagent JSONL files) in full and returns the
/// replay event stream. Fully on-demand, nothing kept in memory afterwards.
#[tauri::command]
pub async fn get_replay_data(state: State<'_, AppState>, session_id: String) -> AppResult<ReplayData> {
    let projects_dir = state.paths.projects_dir();
    tauri::async_runtime::spawn_blocking(move || {
        let path = super::session_cmd::resolve_path(&projects_dir, &session_id, None)
            .ok_or_else(|| AppError::Other("session JSONL not found".into()))?;

        let mut main = ReplayBuilder::new_main();
        for_each_entry(&path, |e| main.push(e));

        let mut subs: Vec<(String, crate::pipeline::replay::BuiltFile)> = Vec::new();
        let sub_pattern = format!(
            "{}/*/{}/subagents/agent-*.jsonl",
            projects_dir.display(),
            session_id
        );
        for sub_path in glob::glob(&sub_pattern).into_iter().flatten().flatten() {
            let Some(Target::Sub { agent_id, .. }) = route_path(&projects_dir, &sub_path) else {
                continue;
            };
            let mut builder = ReplayBuilder::new_sub(&agent_id);
            for_each_entry(&sub_path, |e| builder.push(e));
            subs.push((agent_id, builder.finish()));
        }

        assemble(&session_id, main.finish(), subs)
            .ok_or_else(|| AppError::Other("session JSONL has no timestamped entries".into()))
    })
    .await
    .map_err(|e| AppError::Other(format!("replay data task failed: {e}")))?
}

/// Parses the first `limit` lines of a JSONL file and stops reading there,
/// so listing never streams a whole multi-hundred-MB transcript.
fn read_head(path: &Path, limit: usize) -> Vec<RawEntry> {
    use std::io::BufRead;
    let mut head = Vec::new();
    let Ok(file) = std::fs::File::open(path) else {
        return head;
    };
    let mut reader = std::io::BufReader::new(file);
    let mut raw = Vec::new();
    for _ in 0..limit {
        raw.clear();
        match reader.read_until(b'\n', &mut raw) {
            Ok(0) | Err(_) => break,
            Ok(_) => {}
        }
        if let Some(e) = crate::jsonl::parse::parse_line(&String::from_utf8_lossy(&raw)) {
            head.push(e);
        }
    }
    head
}

/// Builds the browser row from the bounded head/tail scan (pure; unit-tested).
/// Returns None for sessions that must not be listed: sdk-cli launches, sessions
/// without a parsable start timestamp, and sessions that are not Ended yet
/// (live sessions stay exclusively in the office view).
fn meta_from_scan(
    session_id: &str,
    head: &[RawEntry],
    last_ts: Option<&str>,
    now: DateTime<Utc>,
) -> Option<ReplaySessionMeta> {
    let entrypoint = head.iter().find_map(|e| e.entrypoint.as_deref());
    if entrypoint == Some("sdk-cli") {
        return None;
    }
    if status_from_last(last_ts, now) != SessionStatus::Ended || last_ts.is_none() {
        return None;
    }
    let started_at_ms = head
        .iter()
        .find_map(|e| e.timestamp.as_deref())
        .and_then(epoch_ms)?;
    let ended_at_ms = last_ts.and_then(epoch_ms)?;
    Some(ReplaySessionMeta {
        session_id: session_id.to_string(),
        project: head
            .iter()
            .find_map(|e| e.cwd.clone())
            .unwrap_or_default(),
        slug: head.iter().find_map(|e| e.slug.clone()),
        git_branch: head.iter().find_map(|e| e.git_branch.clone()),
        // Prefer a human-looking prompt over slash-command/harness markup for the title.
        first_prompt: head
            .iter()
            .filter_map(|e| e.user_prompt_text())
            .find(|s| !is_markup_prompt(s))
            .or_else(|| head.iter().find_map(|e| e.user_prompt_text()))
            .map(|s| s.chars().take(200).collect()),
        started_at_ms,
        ended_at_ms,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn e(json: &str) -> RawEntry {
        serde_json::from_str(json).expect("fixture should parse")
    }

    /// `now` far enough after the last event that status_from_last says Ended.
    fn long_after() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 6, 26, 0, 0, 0).unwrap()
    }

    #[test]
    fn builds_meta_for_ended_session() {
        let head = vec![
            e(r#"{"type":"user","timestamp":"2026-06-25T01:00:00.000Z","cwd":"/home/u/proj","gitBranch":"main","slug":"fix-bug","entrypoint":"cli","message":{"role":"user","content":"fix the bug"}}"#),
        ];
        let meta = meta_from_scan("SID", &head, Some("2026-06-25T02:00:00.000Z"), long_after())
            .expect("listed");
        assert_eq!(meta.session_id, "SID");
        assert_eq!(meta.project, "/home/u/proj");
        assert_eq!(meta.slug.as_deref(), Some("fix-bug"));
        assert_eq!(meta.first_prompt.as_deref(), Some("fix the bug"));
        assert!(meta.ended_at_ms > meta.started_at_ms);
    }

    /// sdk-cli sessions (SDK/eval launches) are not listed.
    #[test]
    fn excludes_sdk_cli() {
        let head = vec![
            e(r#"{"type":"user","timestamp":"2026-06-25T01:00:00.000Z","entrypoint":"sdk-cli","message":{"role":"user","content":"x"}}"#),
        ];
        assert!(meta_from_scan("SID", &head, Some("2026-06-25T02:00:00.000Z"), long_after()).is_none());
    }

    /// Sessions still Active/Idle are not listed (they belong to the office view).
    #[test]
    fn excludes_non_ended() {
        let head = vec![
            e(r#"{"type":"user","timestamp":"2026-06-25T01:00:00.000Z","message":{"role":"user","content":"x"}}"#),
        ];
        let now = Utc.with_ymd_and_hms(2026, 6, 25, 1, 5, 0).unwrap();
        assert!(meta_from_scan("SID", &head, Some("2026-06-25T01:00:00.000Z"), now).is_none());
    }

    /// Slash-command/caveat markup is skipped for the title when a human prompt follows.
    #[test]
    fn prefers_human_prompt_over_markup() {
        let head = vec![
            e(r#"{"type":"user","timestamp":"2026-06-25T01:00:00.000Z","message":{"role":"user","content":"<local-command-caveat>Caveat: ...</local-command-caveat>"}}"#),
            e(r#"{"type":"user","timestamp":"2026-06-25T01:00:01.000Z","message":{"role":"user","content":"fix the login bug"}}"#),
        ];
        let meta = meta_from_scan("SID", &head, Some("2026-06-25T02:00:00.000Z"), long_after())
            .expect("listed");
        assert_eq!(meta.first_prompt.as_deref(), Some("fix the login bug"));
    }

    /// All-markup sessions still get a title (fallback to the first prompt).
    #[test]
    fn falls_back_to_markup_when_nothing_else() {
        let head = vec![
            e(r#"{"type":"user","timestamp":"2026-06-25T01:00:00.000Z","message":{"role":"user","content":"<command-message>review</command-message>"}}"#),
        ];
        let meta = meta_from_scan("SID", &head, Some("2026-06-25T02:00:00.000Z"), long_after())
            .expect("listed");
        assert_eq!(meta.first_prompt.as_deref(), Some("<command-message>review</command-message>"));
    }

    /// No parsable start timestamp -> not listed.
    #[test]
    fn excludes_missing_start() {
        let head = vec![e(r#"{"type":"user","message":{"role":"user","content":"x"}}"#)];
        assert!(meta_from_scan("SID", &head, Some("2026-06-25T02:00:00.000Z"), long_after()).is_none());
    }
}
