use serde::Deserialize;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

/// A single installed plugin (one entry in installed_plugins.json).
#[derive(Debug, Clone, PartialEq)]
pub struct InstalledPlugin {
    pub name: String,
    pub marketplace: String,
    pub scope: String,
    pub install_path: PathBuf,
    pub project_path: Option<PathBuf>,
}

/// A single install entry in installed_plugins.json (only the fields we need).
#[derive(Deserialize)]
struct RawEntry {
    scope: String,
    #[serde(rename = "installPath")]
    install_path: String,
    #[serde(rename = "projectPath")]
    project_path: Option<String>,
}

/// The whole installed_plugins.json (only the plugins map is used).
#[derive(Deserialize)]
struct RawFile {
    #[serde(default)]
    plugins: BTreeMap<String, Vec<RawEntry>>,
}

/// Split "<name>@<marketplace>" (empty string when the marketplace is missing).
fn split_key(key: &str) -> (String, String) {
    match key.split_once('@') {
        Some((n, m)) => (n.to_string(), m.to_string()),
        None => (key.to_string(), String::new()),
    }
}

/// Read ~/.claude/plugins/installed_plugins.json and return each install flattened.
/// Missing files or parse failures yield an empty Vec (never panics).
pub fn read_installed_plugins(plugins_dir: &Path) -> Vec<InstalledPlugin> {
    let path = plugins_dir.join("installed_plugins.json");
    let Ok(text) = std::fs::read_to_string(&path) else {
        return Vec::new();
    };
    let Ok(file) = serde_json::from_str::<RawFile>(&text) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for (key, entries) in file.plugins {
        let (name, marketplace) = split_key(&key);
        for e in entries {
            out.push(InstalledPlugin {
                name: name.clone(),
                marketplace: marketplace.clone(),
                scope: e.scope,
                install_path: PathBuf::from(e.install_path),
                project_path: e.project_path.map(PathBuf::from),
            });
        }
    }
    out
}

/// Return only the plugins that are actually effective for the given project (pure function).
/// user is always effective, project only when project_path matches, any other scope is excluded.
pub fn effective_plugins_for(
    plugins: &[InstalledPlugin],
    project: Option<&Path>,
) -> Vec<InstalledPlugin> {
    plugins
        .iter()
        .filter(|p| match p.scope.as_str() {
            "user" => true,
            "project" => p.project_path.as_deref() == project,
            _ => false,
        })
        .cloned()
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(dir: &Path, body: &str) {
        std::fs::create_dir_all(dir).unwrap();
        std::fs::write(dir.join("installed_plugins.json"), body).unwrap();
    }

    #[test]
    fn reads_and_splits_name_marketplace() {
        let dir = std::env::temp_dir().join("ct-plugins-read");
        let _ = std::fs::remove_dir_all(&dir);
        write(
            &dir,
            r#"{"version":2,"plugins":{
              "superpowers@claude-plugins-official":[{"scope":"user","installPath":"/p/sp","version":"6"}],
              "sec@claude-plugins-official":[{"scope":"project","projectPath":"/work/a","installPath":"/p/sec","version":"2"}]
            }}"#,
        );
        let mut got = read_installed_plugins(&dir);
        got.sort_by(|a, b| a.name.cmp(&b.name));
        assert_eq!(got.len(), 2);
        assert_eq!(got[1].name, "superpowers");
        assert_eq!(got[1].marketplace, "claude-plugins-official");
        assert_eq!(got[1].scope, "user");
        assert_eq!(got[1].install_path, PathBuf::from("/p/sp"));
        assert_eq!(got[1].project_path, None);
        assert_eq!(got[0].name, "sec");
        assert_eq!(got[0].project_path, Some(PathBuf::from("/work/a")));
    }

    #[test]
    fn missing_or_broken_returns_empty() {
        let dir = std::env::temp_dir().join("ct-plugins-missing");
        let _ = std::fs::remove_dir_all(&dir);
        // the file itself does not exist
        assert!(read_installed_plugins(&dir).is_empty());
        // broken JSON
        write(&dir, "{ not json");
        assert!(read_installed_plugins(&dir).is_empty());
    }

    #[test]
    fn effective_filters_by_scope_and_project() {
        let user = InstalledPlugin {
            name: "u".into(), marketplace: "m".into(), scope: "user".into(),
            install_path: PathBuf::from("/p/u"), project_path: None,
        };
        let proj_a = InstalledPlugin {
            name: "a".into(), marketplace: "m".into(), scope: "project".into(),
            install_path: PathBuf::from("/p/a"), project_path: Some(PathBuf::from("/work/a")),
        };
        let proj_b = InstalledPlugin {
            name: "b".into(), marketplace: "m".into(), scope: "project".into(),
            install_path: PathBuf::from("/p/b"), project_path: Some(PathBuf::from("/work/b")),
        };
        let all = vec![user.clone(), proj_a.clone(), proj_b.clone()];

        // project = /work/a -> only user and proj_a
        let eff = effective_plugins_for(&all, Some(Path::new("/work/a")));
        assert_eq!(eff, vec![user.clone(), proj_a.clone()]);

        // project = None -> only user
        let eff_none = effective_plugins_for(&all, None);
        assert_eq!(eff_none, vec![user.clone()]);
    }
}
