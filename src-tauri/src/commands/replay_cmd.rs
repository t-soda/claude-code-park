use crate::error::{AppError, AppResult};
use crate::jsonl::entry::RawEntry;
use crate::jsonl::{for_each_entry, TailReader};
use crate::model::replay::{ReplayData, ReplaySessionMeta};
use crate::model::session::SessionStatus;
use crate::pipeline::replay::{assemble, epoch_ms, excerpt, is_markup_prompt, ReplayBuilder, EXCERPT_CHARS};
use crate::pipeline::session_tracker::status_from_last;
use crate::pipeline::{route_path, Target};
use crate::state::AppState;
use chrono::{DateTime, Utc};
use std::path::Path;
use tauri::State;

/// Byte budget scanned per file for session meta (cwd/slug/entrypoint/first prompt
/// all appear within the first few lines; a resumed session can start with many
/// meta-less summary lines, so this is a byte budget rather than a line count).
const HEAD_BYTES: u64 = 256 * 1024;
/// Tail window read per file to find the last event timestamp.
const TAIL_BYTES: u64 = 64 * 1024;
/// Fallback tail window when TAIL_BYTES lands entirely inside one oversized last
/// line (a huge final tool_result). Bounded on purpose: an uncapped read would pull
/// a whole multi-hundred-MB transcript into memory during listing. A session whose
/// last line exceeds even this is dropped from the list rather than paid for.
const TAIL_FALLBACK_BYTES: u64 = 8 * 1024 * 1024;
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
            let head = read_head(&path, HEAD_BYTES);
            // If the tail window lands entirely inside one oversized last line (a huge
            // final tool_result), the capped read yields nothing; retry with a larger
            // but still bounded window rather than dropping the session.
            let last_ts = last_timestamp(&path, TAIL_BYTES)
                .or_else(|| last_timestamp(&path, TAIL_FALLBACK_BYTES));
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
            let Some(Target::Sub { parent_id, agent_id }) = route_path(&projects_dir, &sub_path) else {
                continue;
            };
            // The glob pattern embeds session_id verbatim; route_path's own parse of the
            // path is the source of truth for which session a match actually belongs to.
            if parent_id != session_id {
                continue;
            }
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

/// Parses complete lines from the start of a JSONL file up to `byte_budget` and stops
/// there, so listing never streams a whole multi-hundred-MB transcript. A byte budget
/// (rather than a line count) matters for resumed sessions, which can start with many
/// meta-less summary lines before the first entry carrying entrypoint/cwd.
fn read_head(path: &Path, byte_budget: u64) -> Vec<RawEntry> {
    use std::io::BufRead;
    let mut head = Vec::new();
    let Ok(file) = std::fs::File::open(path) else {
        return head;
    };
    let mut reader = std::io::BufReader::new(file);
    let mut raw = Vec::new();
    let mut consumed = 0u64;
    loop {
        raw.clear();
        let n = match reader.read_until(b'\n', &mut raw) {
            Ok(0) | Err(_) => break,
            Ok(n) => n,
        };
        if let Some(e) = crate::jsonl::parse::parse_line(&String::from_utf8_lossy(&raw)) {
            head.push(e);
        }
        consumed += n as u64;
        if consumed >= byte_budget {
            break;
        }
    }
    head
}

/// Finds the last event timestamp within `cap` bytes read from the file's tail.
fn last_timestamp(path: &Path, cap: u64) -> Option<String> {
    TailReader::new()
        .read_tail(path, cap)
        .iter()
        .rev()
        .find_map(|e| e.timestamp.clone())
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
            .map(|s| excerpt(s, EXCERPT_CHARS)),
        started_at_ms,
        ended_at_ms,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;
    use std::io::Write;

    fn e(json: &str) -> RawEntry {
        serde_json::from_str(json).expect("fixture should parse")
    }

    /// `now` far enough after the last event that status_from_last says Ended.
    fn long_after() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 6, 26, 0, 0, 0).unwrap()
    }

    fn tmp_jsonl(label: &str, content: &str) -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!(
            "claude_code_park_replay_cmd_test_{}_{}.jsonl",
            label,
            std::process::id()
        ));
        let mut f = std::fs::File::create(&path).unwrap();
        f.write_all(content.as_bytes()).unwrap();
        path
    }

    /// When the tail window (TAIL_BYTES cap) lands entirely inside one oversized last
    /// line, the capped read finds no timestamp; the larger — but still bounded —
    /// fallback window must find it without reading the whole file.
    #[test]
    fn last_timestamp_falls_back_when_tail_window_misses() {
        let huge_result = format!(
            r#"{{"type":"user","timestamp":"2026-06-25T02:00:00.000Z","message":{{"role":"user","content":[{{"type":"tool_result","tool_use_id":"c1","content":"{}"}}]}}}}"#,
            "x".repeat(200_000)
        );
        let path = tmp_jsonl("hugeline", &format!("{huge_result}\n"));

        let small_cap = last_timestamp(&path, 1024);
        assert_eq!(small_cap, None, "a small cap should miss inside the huge line");

        let fallback = last_timestamp(&path, TAIL_FALLBACK_BYTES);
        assert_eq!(fallback.as_deref(), Some("2026-06-25T02:00:00.000Z"));

        let _ = std::fs::remove_file(&path);
    }

    /// read_head must scan past many meta-less lines (a resumed session's summaries)
    /// within its byte budget rather than stopping at a fixed line count.
    #[test]
    fn read_head_scans_past_many_summary_lines_within_budget() {
        let summary = r#"{"type":"summary","summary":"earlier work"}"#;
        let mut content = String::new();
        for _ in 0..80 {
            content.push_str(summary);
            content.push('\n');
        }
        content.push_str(r#"{"type":"user","timestamp":"2026-06-25T01:00:00.000Z","entrypoint":"cli","message":{"role":"user","content":"go"}}"#);
        content.push('\n');
        let path = tmp_jsonl("manysummaries", &content);

        let head = read_head(&path, HEAD_BYTES);
        assert!(
            head.iter().any(|e| e.timestamp.is_some()),
            "expected the timestamped entry beyond line 80 to be scanned"
        );

        let _ = std::fs::remove_file(&path);
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
