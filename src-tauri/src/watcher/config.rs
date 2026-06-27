use crate::state::AppState;
use notify_debouncer_full::new_debouncer;
use notify_debouncer_full::notify::{EventKind, RecursiveMode};
use notify_debouncer_full::DebounceEventResult;
use std::collections::{BTreeSet, HashSet};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

/// Event name notifying the frontend that config changed on the CLI side.
pub const EV_CONFIG: &str = "state://config/changed";

/// Merges the two input streams (filesystem events and project-set updates) into one loop.
enum Msg {
    Fs(DebounceEventResult),
    Projects(HashSet<PathBuf>),
}

/// Spawns the config file watcher thread. `proj_rx` delivers the set of active project working
/// dirs whose `.claude` directories should be live-watched (in addition to ~/.claude).
pub fn spawn(app: AppHandle, proj_rx: Receiver<HashSet<PathBuf>>) {
    std::thread::spawn(move || {
        if let Err(e) = run(app, proj_rx) {
            eprintln!("[claude-code-park][config-watcher] exited: {e}");
        }
    });
}

fn run(
    app: AppHandle,
    proj_rx: Receiver<HashSet<PathBuf>>,
) -> Result<(), Box<dyn std::error::Error>> {
    let (home, agents_dir, skills_dir, commands_dir) = {
        let s = app.state::<AppState>();
        (
            s.paths.home.clone(),
            s.paths.agents_dir(),
            s.paths.skills_dir(),
            s.paths.commands_dir(),
        )
    };

    let (tx, rx) = mpsc::channel::<Msg>();

    // Deliver debounced FS events through a closure so they share one loop with project updates.
    let tx_fs = tx.clone();
    let mut debouncer = new_debouncer(Duration::from_millis(200), None, move |res| {
        let _ = tx_fs.send(Msg::Fs(res));
    })?;

    // Watch the home directory non-recursively for settings.json / settings.local.json.
    if home.is_dir() {
        let _ = debouncer.watch(&home, RecursiveMode::NonRecursive);
    }
    for dir in [&agents_dir, &skills_dir, &commands_dir] {
        if dir.is_dir() {
            let _ = debouncer.watch(dir, RecursiveMode::Recursive);
        }
    }

    // Forward project-set updates from the session watcher into the same loop.
    let tx_proj = tx.clone();
    std::thread::spawn(move || {
        for set in proj_rx {
            if tx_proj.send(Msg::Projects(set)).is_err() {
                break;
            }
        }
    });

    // The project <project>/.claude dirs currently watched. Deduped by set membership, so a dir
    // is released once no active session references it anymore (e.g. its session ended).
    let mut watched: HashSet<PathBuf> = HashSet::new();
    eprintln!("[claude-code-park][config-watcher] watching");

    for msg in rx {
        match msg {
            Msg::Projects(set) => {
                let desired: HashSet<PathBuf> = set
                    .iter()
                    .map(|p| p.join(".claude"))
                    .filter(|p| p.is_dir())
                    .collect();
                for old in watched.difference(&desired) {
                    let _ = debouncer.unwatch(old);
                }
                for new in desired.difference(&watched) {
                    if let Err(e) = debouncer.watch(new, RecursiveMode::Recursive) {
                        eprintln!(
                            "[claude-code-park][config-watcher] failed to watch {}: {e}",
                            new.display()
                        );
                    }
                }
                watched = desired;
            }
            Msg::Fs(res) => {
                let Ok(events) = res else { continue };
                let state = app.state::<AppState>();
                let mut kinds = BTreeSet::new();
                // The World's employee list reflects only user-scope agents.
                let mut user_agents_changed = false;
                for ev in events {
                    if !matches!(
                        ev.kind,
                        EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)
                    ) {
                        continue;
                    }
                    for path in &ev.paths {
                        // Ignore echo-back from our own writes.
                        if state.is_self_write(path) {
                            continue;
                        }
                        if path.starts_with(&agents_dir) {
                            user_agents_changed = true;
                        }
                        if let Some(kind) =
                            classify(path, &home, &agents_dir, &skills_dir, &commands_dir, &watched)
                        {
                            kinds.insert(kind);
                        }
                    }
                }
                if kinds.is_empty() {
                    continue;
                }
                // When the user's agents change, also update the World's employee list.
                if user_agents_changed {
                    if let Ok(agents) = crate::config_io::agents::list_agents(&agents_dir) {
                        state.world.lock().unwrap().agents = agents;
                    }
                }
                for kind in kinds {
                    let _ = app.emit(EV_CONFIG, kind);
                }
            }
        }
    }
    Ok(())
}

/// Classifies a changed path into a config kind (None if unrelated). `project_claude_dirs` holds
/// the currently-watched `<project>/.claude` dirs so project-scope changes are classified too.
fn classify(
    path: &Path,
    home: &Path,
    agents_dir: &Path,
    skills_dir: &Path,
    commands_dir: &Path,
    project_claude_dirs: &HashSet<PathBuf>,
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
    // Project scope: a change under one of the watched <project>/.claude dirs.
    for claude in project_claude_dirs {
        if let Ok(rel) = path.strip_prefix(claude) {
            return classify_project_rel(rel);
        }
    }
    None
}

/// Classifies a path relative to a `<project>/.claude` dir. Mirrors the user-scope layout:
/// agents/ skills/ commands/ subtrees, plus settings(.local).json directly inside .claude.
fn classify_project_rel(rel: &Path) -> Option<&'static str> {
    let mut comps = rel.components();
    let first = comps.next().and_then(|c| c.as_os_str().to_str())?;
    match first {
        "agents" => Some("agents"),
        "skills" => Some("skills"),
        "commands" => Some("commands"),
        "settings.json" | "settings.local.json" if comps.next().is_none() => Some("settings"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dirs() -> (PathBuf, PathBuf, PathBuf, PathBuf) {
        let home = PathBuf::from("/home/u/.claude");
        (
            home.clone(),
            home.join("agents"),
            home.join("skills"),
            home.join("commands"),
        )
    }

    #[test]
    fn classifies_user_scope_paths() {
        let (home, a, s, c) = dirs();
        let none = HashSet::new();
        assert_eq!(
            classify(&home.join("settings.json"), &home, &a, &s, &c, &none),
            Some("settings")
        );
        assert_eq!(
            classify(&home.join("settings.local.json"), &home, &a, &s, &c, &none),
            Some("settings")
        );
        assert_eq!(classify(&a.join("foo.md"), &home, &a, &s, &c, &none), Some("agents"));
        assert_eq!(classify(&s.join("x/SKILL.md"), &home, &a, &s, &c, &none), Some("skills"));
        assert_eq!(classify(&home.join("CLAUDE.md"), &home, &a, &s, &c, &none), None);
        // a temp file is ignored.
        assert_eq!(classify(&home.join("settings.json.cttmp"), &home, &a, &s, &c, &none), None);
    }

    #[test]
    fn classifies_project_scope_paths() {
        let (home, a, s, c) = dirs();
        let proj = PathBuf::from("/work/p/.claude");
        let watched: HashSet<PathBuf> = [proj.clone()].into_iter().collect();
        assert_eq!(
            classify(&proj.join("settings.local.json"), &home, &a, &s, &c, &watched),
            Some("settings")
        );
        assert_eq!(
            classify(&proj.join("settings.json"), &home, &a, &s, &c, &watched),
            Some("settings")
        );
        assert_eq!(
            classify(&proj.join("agents/bob.md"), &home, &a, &s, &c, &watched),
            Some("agents")
        );
        assert_eq!(
            classify(&proj.join("commands/run.md"), &home, &a, &s, &c, &watched),
            Some("commands")
        );
        // Other files inside .claude (e.g. CLAUDE.md) are not config kinds we track.
        assert_eq!(classify(&proj.join("CLAUDE.md"), &home, &a, &s, &c, &watched), None);
        // A path under an unwatched project is ignored.
        let other = PathBuf::from("/work/other/.claude/settings.json");
        assert_eq!(classify(&other, &home, &a, &s, &c, &watched), None);
    }
}
