use crate::error::{AppError, AppResult};
use std::path::PathBuf;

/// Helper that resolves the main paths under ~/.claude.
pub struct ClaudePaths {
    pub home: PathBuf,
}

impl ClaudePaths {
    pub fn discover() -> AppResult<Self> {
        let home = dirs::home_dir()
            .map(|h| h.join(".claude"))
            .ok_or(AppError::ClaudeHomeNotFound)?;
        if !home.is_dir() {
            return Err(AppError::ClaudeHomeNotFound);
        }
        Ok(Self { home })
    }

    pub fn settings(&self) -> PathBuf {
        self.home.join("settings.json")
    }
    pub fn agents_dir(&self) -> PathBuf {
        self.home.join("agents")
    }
    pub fn skills_dir(&self) -> PathBuf {
        self.home.join("skills")
    }
    pub fn commands_dir(&self) -> PathBuf {
        self.home.join("commands")
    }
    pub fn projects_dir(&self) -> PathBuf {
        self.home.join("projects")
    }
    /// The directory where Claude Code writes a `<pid>.json` (pid, sessionId, etc.) for each running session.
    pub fn sessions_dir(&self) -> PathBuf {
        self.home.join("sessions")
    }
    pub fn backups_dir(&self) -> PathBuf {
        self.home.join("backups").join("claude-code-park")
    }
}
