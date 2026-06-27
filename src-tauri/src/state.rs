use crate::model::agent::AgentDef;
use crate::model::session::Session;
use crate::paths::ClaudePaths;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Grace period for ignoring the echo-back the watcher picks up right after our own write.
const ECHO_SUPPRESS: Duration = Duration::from_millis(1500);

/// The app's source of truth. The frontend receives a projection of this via listen.
#[derive(Default)]
pub struct World {
    /// session_id -> main session
    pub sessions: HashMap<String, Session>,
    /// Hired employees (agent definitions)
    pub agents: Vec<AgentDef>,
}

/// Shared state managed by tauri.
pub struct AppState {
    pub world: Mutex<World>,
    pub paths: ClaudePaths,
    /// Paths the GUI itself wrote (for suppressing the watcher's echo-back).
    recently_written: Mutex<HashMap<PathBuf, Instant>>,
}

impl AppState {
    pub fn new(paths: ClaudePaths) -> Self {
        Self {
            world: Mutex::new(World::default()),
            paths,
            recently_written: Mutex::new(HashMap::new()),
        }
    }

    /// Records a path just before writing.
    pub fn mark_written(&self, path: &Path) {
        self.recently_written
            .lock()
            .unwrap()
            .insert(path.to_path_buf(), Instant::now());
    }

    /// Whether a path was recently written by us (true if within the grace period). Used by the watcher for ignore decisions.
    pub fn is_self_write(&self, path: &Path) -> bool {
        let mut map = self.recently_written.lock().unwrap();
        // Sweep out expired entries.
        map.retain(|_, t| t.elapsed() < ECHO_SUPPRESS);
        map.contains_key(path)
    }
}
