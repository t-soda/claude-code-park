use super::plugins::{effective_plugins_for, read_installed_plugins};
use super::safe_write::safe_write;
use crate::error::AppResult;
use crate::model::config::{EffectiveHooks, HookEntry, HooksMap, ScopedHook};
use serde_json::{Map, Value};
use std::collections::BTreeMap;
use std::path::Path;

/// Read the hooks section from settings.json.
/// Lenient toward unknown/missing data (empty Map if absent).
pub fn read_hooks(settings_path: &Path) -> AppResult<HooksMap> {
    let mut map: HooksMap = BTreeMap::new();
    if !settings_path.is_file() {
        return Ok(map);
    }
    let text = std::fs::read_to_string(settings_path)?;
    let root: Value = serde_json::from_str(&text)?;
    let Some(hooks) = root.get("hooks").and_then(|h| h.as_object()) else {
        return Ok(map);
    };
    for (event, arr) in hooks {
        // Each event holds an array of HookEntry. Parse leniently per element so that one
        // broken/unknown element does not discard the whole event (also picks up hooks
        // without a command, such as the agent type).
        let Some(items) = arr.as_array() else { continue };
        let mut entries = Vec::with_capacity(items.len());
        for item in items {
            match serde_json::from_value::<HookEntry>(item.clone()) {
                Ok(entry) => entries.push(entry),
                Err(e) => eprintln!(
                    "[claude-code-park][hooks] skipping broken hook entry for {event}: {e}"
                ),
            }
        }
        if !entries.is_empty() {
            map.insert(event.clone(), entries);
        }
    }
    Ok(map)
}

/// Read a single settings file with a scope tag and flatten it into event -> ScopedHook[].
/// Attach the plugin name when it comes from a plugin. Unreadable/corrupt files yield empty (never panics).
fn read_scoped(path: &Path, scope: &str, plugin: Option<&str>) -> EffectiveHooks {
    let mut out: EffectiveHooks = BTreeMap::new();
    let raw = match read_hooks(path) {
        Ok(raw) => raw,
        Err(e) => {
            eprintln!(
                "[claude-code-park][hooks] skipping load of {} ({}): {e}",
                path.display(),
                scope
            );
            return out;
        }
    };
    for (event, entries) in raw {
        let v = out.entry(event).or_default();
        for entry in entries {
            for action in entry.hooks {
                v.push(ScopedHook {
                    scope: scope.to_string(),
                    matcher: entry.matcher.clone(),
                    command: action.display_command(),
                    plugin: plugin.map(|s| s.to_string()),
                });
            }
        }
    }
    out
}

/// Return scope-tagged effective hooks, concatenated in this order: user(settings.json) +
/// project(<dir>/.claude/settings.json) + local(.local.json) + plugin(<install>/hooks/hooks.json).
/// Read everything leniently so it does not break in distributed environments.
pub fn read_effective_hooks(
    user_settings: &Path,
    project_dir: Option<&Path>,
    plugins_dir: &Path,
) -> AppResult<EffectiveHooks> {
    let mut merged: EffectiveHooks = read_scoped(user_settings, "user", None);
    if let Some(dir) = project_dir {
        for (file, scope) in [("settings.json", "project"), ("settings.local.json", "local")] {
            let p = dir.join(".claude").join(file);
            for (event, mut hooks) in read_scoped(&p, scope, None) {
                merged.entry(event).or_default().append(&mut hooks);
            }
        }
    }
    // plugin scope (read-only). user always, project only when projectPath matches.
    let plugins = effective_plugins_for(&read_installed_plugins(plugins_dir), project_dir);
    for plugin in plugins {
        let p = plugin.install_path.join("hooks").join("hooks.json");
        for (event, mut hooks) in read_scoped(&p, "plugin", Some(&plugin.name)) {
            merged.entry(event).or_default().append(&mut hooks);
        }
    }
    Ok(merged)
}

/// Replace only the hooks section of settings.json (all other keys are fully preserved).
/// Read the whole existing file as a Value, replace only "hooks", and write it back.
pub fn write_hooks(
    settings_path: &Path,
    hooks: &HooksMap,
    backups_dir: &Path,
    stamp: i64,
) -> AppResult<()> {
    // Read the existing settings.json (empty object if absent).
    let mut root: Value = if settings_path.is_file() {
        let text = std::fs::read_to_string(settings_path)?;
        serde_json::from_str(&text)?
    } else {
        Value::Object(Map::new())
    };
    let obj = root
        .as_object_mut()
        .ok_or_else(|| crate::error::AppError::Invalid("settings.json is not an object".into()))?;

    if hooks.is_empty() {
        obj.remove("hooks");
    } else {
        // BTreeMap<String, Vec<HookEntry>> -> JSON. Empty matchers are dropped via skip_serializing.
        obj.insert("hooks".into(), serde_json::to_value(hooks)?);
    }

    let pretty = serde_json::to_string_pretty(&root)?;
    safe_write(settings_path, &pretty, backups_dir, stamp)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn write_hooks_preserves_other_keys() {
        let dir = std::env::temp_dir().join("ccpark-test-settings");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("settings.json");
        let backups = dir.join("backups");
        // existing settings including permissions / env.
        std::fs::write(
            &path,
            r#"{"model":"opus","permissions":{"allow":["Bash"]},"env":{"X":"1"}}"#,
        )
        .unwrap();

        let mut hooks: HooksMap = BTreeMap::new();
        hooks.insert(
            "Stop".into(),
            vec![HookEntry {
                matcher: None,
                hooks: vec![crate::model::config::HookAction {
                    action_type: "command".into(),
                    command: Some("echo done".into()),
                    extra: serde_json::Map::new(),
                }],
            }],
        );
        write_hooks(&path, &hooks, &backups, 1).unwrap();

        let v: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        // existing keys are fully preserved.
        assert_eq!(v["model"], "opus");
        assert_eq!(v["permissions"]["allow"][0], "Bash");
        assert_eq!(v["env"]["X"], "1");
        // hooks are written.
        assert_eq!(v["hooks"]["Stop"][0]["hooks"][0]["command"], "echo done");
    }

    /// Even when an agent-type hook without a command is mixed in, a command-type hook in the
    /// same event is not dropped along with it (lenient per-element parsing). Agent-type hooks
    /// are shown with a pseudo label.
    #[test]
    fn agent_type_hook_does_not_drop_sibling_command_hook() {
        let dir = std::env::temp_dir().join("ccpark-test-agenthook");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("settings.json");
        std::fs::write(
            &path,
            r#"{"hooks":{"PreToolUse":[
                {"matcher":"Bash","hooks":[{"type":"command","command":"bash gate.sh"}]},
                {"matcher":"Bash","hooks":[{"type":"agent","if":"Bash(git commit*)","statusMessage":"inspecting","prompt":"long prompt"}]}
            ]}}"#,
        )
        .unwrap();

        let map = read_hooks(&path).unwrap();
        let pre = map.get("PreToolUse").expect("PreToolUse is present");
        assert_eq!(pre.len(), 2, "picks up both command-type and agent-type");
        assert_eq!(pre[0].hooks[0].command.as_deref(), Some("bash gate.sh"));
        assert_eq!(pre[1].hooks[0].action_type, "agent");
        assert_eq!(pre[1].hooks[0].command, None, "agent type has no command");
        // the display label is composed from type + statusMessage.
        assert_eq!(pre[1].hooks[0].display_command(), "[agent] inspecting");

        // effective hooks (user scope) also yield 2 entries.
        let eff = read_effective_hooks(&path, None, &dir.join("no-plugins")).unwrap();
        assert_eq!(eff.get("PreToolUse").unwrap().len(), 2);

        // writing back preserves the agent type's accompanying fields (does not drop them).
        write_hooks(&path, &map, &dir.join("backups"), 1).unwrap();
        let v: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        let agent = &v["hooks"]["PreToolUse"][1]["hooks"][0];
        assert_eq!(agent["type"], "agent");
        assert_eq!(agent["if"], "Bash(git commit*)");
        assert_eq!(agent["prompt"], "long prompt");
        assert!(agent.get("command").is_none(), "not a command type, so no command key is emitted");
    }

    #[test]
    fn effective_hooks_merges_scopes_in_order() {
        let dir = std::env::temp_dir().join("ccpark-test-effective");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join(".claude")).unwrap();

        let user = dir.join("user-settings.json");
        std::fs::write(
            &user,
            r#"{"hooks":{"PreToolUse":[{"matcher":"Edit","hooks":[{"type":"command","command":"u-cmd"}]}]}}"#,
        )
        .unwrap();
        std::fs::write(
            dir.join(".claude").join("settings.json"),
            r#"{"hooks":{"PreToolUse":[{"hooks":[{"type":"command","command":"p-cmd"}]}]}}"#,
        )
        .unwrap();
        std::fs::write(
            dir.join(".claude").join("settings.local.json"),
            r#"{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"l-cmd"}]}]}}"#,
        )
        .unwrap();

        let eff = read_effective_hooks(&user, Some(dir.as_path()), &dir.join("no-plugins")).unwrap();
        let pre = eff.get("PreToolUse").unwrap();
        assert_eq!(pre.len(), 2);
        assert_eq!(pre[0].scope, "user");
        assert_eq!(pre[0].matcher.as_deref(), Some("Edit"));
        assert_eq!(pre[0].command, "u-cmd");
        assert_eq!(pre[1].scope, "project");
        assert_eq!(pre[1].command, "p-cmd");
        assert_eq!(eff.get("Stop").unwrap()[0].scope, "local");
    }

    #[test]
    fn effective_hooks_tolerates_missing_and_broken_project() {
        let dir = std::env::temp_dir().join("ccpark-test-effective-broken");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join(".claude")).unwrap();
        let user = dir.join("user-settings.json");
        std::fs::write(&user, r#"{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"u"}]}]}}"#).unwrap();
        // the project settings.json is broken JSON.
        std::fs::write(dir.join(".claude").join("settings.json"), "{ not json").unwrap();

        let eff = read_effective_hooks(&user, Some(dir.as_path()), &dir.join("no-plugins")).unwrap();
        // the user entries remain and the broken project is ignored.
        assert_eq!(eff.get("Stop").unwrap().len(), 1);
        assert_eq!(eff.get("Stop").unwrap()[0].scope, "user");
    }

    #[test]
    fn effective_hooks_appends_plugin_scope() {
        let dir = std::env::temp_dir().join("ct-effective-plugin");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join(".claude")).unwrap();

        // one entry in user settings
        let user = dir.join("user-settings.json");
        std::fs::write(
            &user,
            r#"{"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"u"}]}]}}"#,
        )
        .unwrap();

        // hooks/hooks.json in the plugin install dir
        let plug_install = dir.join("plug-sp");
        std::fs::create_dir_all(plug_install.join("hooks")).unwrap();
        std::fs::write(
            plug_install.join("hooks").join("hooks.json"),
            r#"{"hooks":{"SessionStart":[{"matcher":"startup","hooks":[{"type":"command","command":"p-cmd"}]}]}}"#,
        )
        .unwrap();

        // installed_plugins.json in plugins_dir (user scope)
        let plugins_dir = dir.join("plugins");
        std::fs::create_dir_all(&plugins_dir).unwrap();
        std::fs::write(
            plugins_dir.join("installed_plugins.json"),
            format!(
                r#"{{"version":2,"plugins":{{"superpowers@official":[{{"scope":"user","installPath":"{}","version":"1"}}]}}}}"#,
                plug_install.display()
            ),
        )
        .unwrap();

        let eff = read_effective_hooks(&user, Some(dir.as_path()), &plugins_dir).unwrap();
        let ss = eff.get("SessionStart").unwrap();
        // user entries + plugin entries (plugin comes last)
        assert_eq!(ss.len(), 2);
        assert_eq!(ss[0].scope, "user");
        assert_eq!(ss[1].scope, "plugin");
        assert_eq!(ss[1].plugin.as_deref(), Some("superpowers"));
        assert_eq!(ss[1].matcher.as_deref(), Some("startup"));
        assert_eq!(ss[1].command, "p-cmd");
    }

    #[test]
    fn effective_hooks_excludes_unmatched_project_plugin() {
        let dir = std::env::temp_dir().join("ct-effective-plugin-proj");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join(".claude")).unwrap();
        let user = dir.join("user-settings.json");
        std::fs::write(&user, r#"{"hooks":{}}"#).unwrap();

        let plug_install = dir.join("plug-x");
        std::fs::create_dir_all(plug_install.join("hooks")).unwrap();
        std::fs::write(
            plug_install.join("hooks").join("hooks.json"),
            r#"{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"x"}]}]}}"#,
        )
        .unwrap();

        let plugins_dir = dir.join("plugins");
        std::fs::create_dir_all(&plugins_dir).unwrap();
        // project scope, but projectPath does not match the current dir
        std::fs::write(
            plugins_dir.join("installed_plugins.json"),
            format!(
                r#"{{"version":2,"plugins":{{"x@m":[{{"scope":"project","projectPath":"/other","installPath":"{}","version":"1"}}]}}}}"#,
                plug_install.display()
            ),
        )
        .unwrap();

        let eff = read_effective_hooks(&user, Some(dir.as_path()), &plugins_dir).unwrap();
        // projectPath does not match, so no plugin hooks appear
        assert!(eff.get("Stop").is_none());
    }

    /// Round-trip a copy of a real settings.json and verify the set of top-level keys is unchanged.
    /// Point CT_SETTINGS_FILE at a real file and run `cargo test -- --ignored real_settings`.
    #[test]
    #[ignore]
    fn real_settings_roundtrip_preserves_keys() {
        let Ok(src) = std::env::var("CT_SETTINGS_FILE") else {
            eprintln!("CT_SETTINGS_FILE not set, skipping");
            return;
        };
        let dir = std::env::temp_dir().join("ccpark-test-realsettings");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let copy = dir.join("settings.json");
        std::fs::copy(&src, &copy).unwrap();

        let before: Value = serde_json::from_str(&std::fs::read_to_string(&copy).unwrap()).unwrap();
        let before_keys: std::collections::BTreeSet<_> =
            before.as_object().unwrap().keys().cloned().collect();

        // write the read hooks straight back (a no-change round-trip).
        let hooks = read_hooks(&copy).unwrap();
        write_hooks(&copy, &hooks, &dir.join("backups"), 1).unwrap();

        let after: Value = serde_json::from_str(&std::fs::read_to_string(&copy).unwrap()).unwrap();
        let after_keys: std::collections::BTreeSet<_> =
            after.as_object().unwrap().keys().cloned().collect();

        eprintln!("top-level keys: {:?}", after_keys);
        assert_eq!(before_keys, after_keys, "top-level keys were not preserved");
        // also individually confirm that important keys like permissions / env remain.
        for k in ["permissions", "env", "model"] {
            assert_eq!(before.get(k), after.get(k), "key {k} changed");
        }
    }
}
