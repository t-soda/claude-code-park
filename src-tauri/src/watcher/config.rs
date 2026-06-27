use crate::state::AppState;
use notify_debouncer_full::new_debouncer;
use notify_debouncer_full::notify::{EventKind, RecursiveMode};
use std::path::Path;
use std::sync::mpsc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

/// Event name notifying the frontend that config changed on the CLI side.
pub const EV_CONFIG: &str = "state://config/changed";

/// Spawns the config file watcher thread.
pub fn spawn(app: AppHandle) {
    std::thread::spawn(move || {
        if let Err(e) = run(app) {
            eprintln!("[claude-code-park][config-watcher] exited: {e}");
        }
    });
}

fn run(app: AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let (home, agents_dir, skills_dir, commands_dir) = {
        let s = app.state::<AppState>();
        (
            s.paths.home.clone(),
            s.paths.agents_dir(),
            s.paths.skills_dir(),
            s.paths.commands_dir(),
        )
    };

    let (tx, rx) = mpsc::channel();
    let mut debouncer = new_debouncer(Duration::from_millis(200), None, tx)?;

    // Watch the home directory non-recursively for settings.json / settings.local.json.
    if home.is_dir() {
        let _ = debouncer.watch(&home, RecursiveMode::NonRecursive);
    }
    for dir in [&agents_dir, &skills_dir, &commands_dir] {
        if dir.is_dir() {
            let _ = debouncer.watch(dir, RecursiveMode::Recursive);
        }
    }
    eprintln!("[claude-code-park][config-watcher] watching");

    for res in rx {
        let Ok(events) = res else { continue };
        let state = app.state::<AppState>();
        let mut kinds = std::collections::BTreeSet::new();
        for ev in events {
            if !matches!(ev.kind, EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_))
            {
                continue;
            }
            for path in &ev.paths {
                // Ignore echo-back from our own writes.
                if state.is_self_write(path) {
                    continue;
                }
                if let Some(kind) =
                    classify(path, &home, &agents_dir, &skills_dir, &commands_dir)
                {
                    kinds.insert(kind);
                }
            }
        }
        if kinds.is_empty() {
            continue;
        }
        // When agents change, also update the World's employee list.
        if kinds.contains("agents") {
            if let Ok(agents) = crate::config_io::agents::list_agents(&agents_dir) {
                state.world.lock().unwrap().agents = agents;
            }
        }
        for kind in kinds {
            let _ = app.emit(EV_CONFIG, kind);
        }
    }
    Ok(())
}

/// Classifies a changed path into a config kind (None if unrelated).
fn classify(
    path: &Path,
    home: &Path,
    agents_dir: &Path,
    skills_dir: &Path,
    commands_dir: &Path,
) -> Option<&'static str> {
    // Ignore temporary files.
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
    if name.ends_with(".cttmp") {
        return None;
    }
    if path.starts_with(agents_dir) {
        return Some("agents");
    }
    if path.starts_with(skills_dir) {
        return Some("skills");
    }
    if path.starts_with(commands_dir) {
        return Some("commands");
    }
    // settings files directly under home.
    if path.parent() == Some(home)
        && (name == "settings.json" || name == "settings.local.json")
    {
        return Some("settings");
    }
    None
}
