use crate::jsonl::TailReader;
use crate::model::session::Session;
use crate::pipeline::{route_path, session_tracker, Target};
use crate::state::AppState;
use chrono::Utc;
use notify_debouncer_full::new_debouncer;
use notify_debouncer_full::notify::{EventKind, RecursiveMode};
use std::path::Path;
use std::sync::mpsc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

/// At startup, restore state by reading only sessions newer than this many seconds
/// (older Ended sessions are not parsed; they are positioned at the tail so only later appends are picked up).
const RESTORE_WINDOW_SECS: u64 = 6 * 3600;

/// Event name for the session-update event sent to the frontend.
pub const EV_SESSIONS: &str = "state://sessions/updated";

/// Event name for the lifecycle-fired event sent to the frontend (for the round-trip beam).
pub const EV_LIFECYCLE: &str = "state://lifecycle/fired";

/// Spawns the watcher thread. Called from setup().
pub fn spawn(app: AppHandle) {
    std::thread::spawn(move || {
        if let Err(e) = run(app) {
            eprintln!("[claude-code-park][watcher] watch loop ended: {e}");
        }
    });
}

fn run(app: AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let projects_dir = app.state::<AppState>().paths.projects_dir();
    let mut tail = TailReader::new();

    initial_scan(&app, &projects_dir, &mut tail);
    emit_sessions(&app);

    if !projects_dir.is_dir() {
        eprintln!(
            "[claude-code-park][watcher] projects directory not found: {}",
            projects_dir.display()
        );
        return Ok(());
    }

    let (tx, rx) = mpsc::channel();
    let mut debouncer = new_debouncer(Duration::from_millis(150), None, tx)?;
    debouncer.watch(&projects_dir, RecursiveMode::Recursive)?;
    eprintln!(
        "[claude-code-park][watcher] watching: {}",
        projects_dir.display()
    );

    loop {
        match rx.recv_timeout(Duration::from_secs(5)) {
            Ok(Ok(events)) => {
                let mut changed = false;
                for ev in events {
                    if !matches!(ev.kind, EventKind::Create(_) | EventKind::Modify(_)) {
                        continue;
                    }
                    for path in &ev.paths {
                        if process_path(&app, &projects_dir, &mut tail, path) {
                            changed = true;
                        }
                    }
                }
                if changed {
                    emit_sessions(&app);
                }
            }
            Ok(Err(errs)) => eprintln!("[claude-code-park][watcher] error: {errs:?}"),
            Err(mpsc::RecvTimeoutError::Timeout) => {
                // Even with no events, recompute status to reflect idle/ended transitions.
                emit_sessions(&app);
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
    Ok(())
}

/// Startup scan. Walks the jsonl files under projects and restores state for recent ones.
fn initial_scan(app: &AppHandle, projects_dir: &Path, tail: &mut TailReader) {
    let pattern = format!("{}/**/*.jsonl", projects_dir.display());
    let now = std::time::SystemTime::now();
    let mut restored = 0usize;
    for entry in glob::glob(&pattern).into_iter().flatten().flatten() {
        let recent = std::fs::metadata(&entry)
            .and_then(|m| m.modified())
            .ok()
            .and_then(|mt| now.duration_since(mt).ok())
            .map(|age| age.as_secs() <= RESTORE_WINDOW_SECS)
            .unwrap_or(false);

        if recent {
            if process_path(app, projects_dir, tail, &entry) {
                restored += 1;
            }
        } else {
            // Do not read the contents; position at the tail for append detection.
            tail.mark_read_to_end(&entry);
        }
    }
    eprintln!("[claude-code-park][watcher] startup scan complete: restored {restored} sessions");
}

/// Processes one path and updates the World. Returns true if anything changed.
fn process_path(
    app: &AppHandle,
    projects_dir: &Path,
    tail: &mut TailReader,
    path: &Path,
) -> bool {
    let Some(target) = route_path(projects_dir, path) else {
        return false;
    };
    let entries = tail.read_new(path);
    if entries.is_empty() {
        return false;
    }
    let mut events: Vec<crate::hook_events::HookEvent> = Vec::new();
    let changed = {
        let state = app.state::<AppState>();
        let mut world = state.world.lock().unwrap();
        match &target {
            Target::Main { session_id } => {
                let c = session_tracker::apply_main(&mut world, session_id, &entries, &mut events);
                if let Some(s) = world.sessions.get(session_id) {
                    if session_tracker::is_displayable(s) {
                        log_activity(session_id, s);
                    }
                }
                c
            }
            Target::Sub {
                parent_id,
                agent_id,
            } => session_tracker::apply_sub(&mut world, parent_id, agent_id, &entries, &mut events),
        }
    };
    for ev in events {
        let _ = app.emit(EV_LIFECYCLE, ev);
    }
    changed
}

/// Logs the current work state for verification (a Phase 1 checkpoint).
fn log_activity(session_id: &str, s: &Session) {
    let a = &s.current;
    eprintln!(
        "[claude-code-park] session {}: {:?} {}",
        &session_id[..session_id.len().min(8)],
        a.kind,
        a.detail.as_deref().unwrap_or("")
    );
}

/// Recomputes status for the World's sessions, then snapshots and emits them to the frontend.
fn emit_sessions(app: &AppHandle) {
    let state = app.state::<AppState>();
    let sessions = {
        let mut world = state.world.lock().unwrap();
        session_tracker::recompute_statuses(&mut world, Utc::now());
        // sdk-cli (non-interactive sessions launched by SDK/eval) are not counted as clocked-in main sessions.
        let mut v: Vec<Session> = world
            .sessions
            .values()
            .filter(|s| session_tracker::is_displayable(s))
            .cloned()
            .collect();
        // Fix the order with a stable key. Sorting by last_event_at makes buildings jump
        // left and right on every event, so key by start time (ascending) -> session_id.
        // This keeps existing buildings still, with new sessions simply added on the right.
        v.sort_by(|a, b| {
            a.started_at
                .cmp(&b.started_at)
                .then_with(|| a.session_id.cmp(&b.session_id))
        });
        v
    };
    let _ = app.emit(EV_SESSIONS, sessions);
}
