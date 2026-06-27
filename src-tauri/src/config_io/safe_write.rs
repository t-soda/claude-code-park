use crate::error::{AppError, AppResult};
use std::path::{Path, PathBuf};

/// Safely overwrite via backup -> write to a temp file -> atomic rename.
/// On failure, attempts to restore from the backup. Validation (JSON/YAML) is the caller's responsibility.
pub fn safe_write(path: &Path, content: &str, backups_dir: &Path, stamp: i64) -> AppResult<()> {
    // 1. Back up the existing file.
    let backup = if path.exists() {
        Some(make_backup(path, backups_dir, stamp)?)
    } else {
        None
    };

    // 2. Write to a temp file in the same directory (rename is only atomic on the same FS).
    let parent = path
        .parent()
        .ok_or_else(|| AppError::Invalid("no parent directory".into()))?;
    std::fs::create_dir_all(parent)?;
    let tmp = parent.join(format!(
        ".{}.cttmp",
        path.file_name().and_then(|n| n.to_str()).unwrap_or("out")
    ));
    std::fs::write(&tmp, content)?;

    // 3. Atomic replace. On failure, restore from the backup.
    if let Err(e) = std::fs::rename(&tmp, path) {
        let _ = std::fs::remove_file(&tmp);
        if let Some(b) = &backup {
            let _ = std::fs::copy(b, path);
        }
        return Err(e.into());
    }
    Ok(())
}

/// Take a backup before deleting, then delete.
pub fn safe_delete(path: &Path, backups_dir: &Path, stamp: i64) -> AppResult<()> {
    if !path.exists() {
        return Ok(());
    }
    make_backup(path, backups_dir, stamp)?;
    std::fs::remove_file(path)?;
    Ok(())
}

/// Copy path to backups_dir/{filename}.{stamp}.bak and return the backup path.
fn make_backup(path: &Path, backups_dir: &Path, stamp: i64) -> AppResult<PathBuf> {
    std::fs::create_dir_all(backups_dir)?;
    let fname = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("file");
    let dest = backups_dir.join(format!("{fname}.{stamp}.bak"));
    std::fs::copy(path, &dest)?;
    Ok(dest)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_root(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ccpark-test-{tag}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn writes_and_backs_up_existing() {
        let root = tmp_root("write");
        let target = root.join("settings.json");
        let backups = root.join("backups");
        std::fs::write(&target, "OLD").unwrap();

        safe_write(&target, "NEW", &backups, 111).unwrap();
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "NEW");
        // the old content remains in the backup.
        let bak = backups.join("settings.json.111.bak");
        assert_eq!(std::fs::read_to_string(&bak).unwrap(), "OLD");
        // the temp file does not remain.
        assert!(!root.join(".settings.json.cttmp").exists());
    }

    #[test]
    fn creates_new_without_backup() {
        let root = tmp_root("create");
        let target = root.join("new.md");
        let backups = root.join("backups");
        safe_write(&target, "hello", &backups, 222).unwrap();
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "hello");
        // no backup is created when creating a new file.
        assert!(!backups.join("new.md.222.bak").exists());
    }

    #[test]
    fn delete_backs_up() {
        let root = tmp_root("delete");
        let target = root.join("agent.md");
        let backups = root.join("backups");
        std::fs::write(&target, "DEF").unwrap();
        safe_delete(&target, &backups, 333).unwrap();
        assert!(!target.exists());
        assert_eq!(
            std::fs::read_to_string(backups.join("agent.md.333.bak")).unwrap(),
            "DEF"
        );
    }
}
