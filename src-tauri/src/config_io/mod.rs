pub mod agents;
pub mod commands;
pub mod frontmatter;
pub mod plugins;
pub mod safe_write;
pub mod settings;
pub mod skills;

/// Monotonically increasing stamp used in backup filenames (epoch milliseconds).
pub fn stamp() -> i64 {
    chrono::Utc::now().timestamp_millis()
}
