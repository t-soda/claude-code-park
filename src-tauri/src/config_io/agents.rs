use super::frontmatter as fm;
use super::plugins::{effective_plugins_for, read_installed_plugins};
use super::safe_write::{safe_delete, safe_write};
use crate::error::{AppError, AppResult};
use crate::model::agent::{AgentDef, AgentSource};
use std::path::Path;

/// Validate an agent name (lowercase letters, digits, and hyphens only, since it is also used as a filename).
pub fn validate_name(name: &str) -> AppResult<()> {
    if name.is_empty()
        || !name
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    {
        return Err(AppError::Invalid(
            "employee name may only contain lowercase letters, digits, and hyphens".into(),
        ));
    }
    Ok(())
}

/// Save an agent (hire = create new / edit existing). Returns the saved AgentDef.
pub fn save_agent(
    agents_dir: &Path,
    backups_dir: &Path,
    agent: &AgentDef,
    create: bool,
    stamp: i64,
) -> AppResult<AgentDef> {
    validate_name(&agent.name)?;
    let path = agents_dir.join(format!("{}.md", agent.name));
    if create && path.exists() {
        return Err(AppError::Invalid(format!(
            "employee '{}' already exists",
            agent.name
        )));
    }
    let md = build_agent_md(agent);
    safe_write(&path, &md, backups_dir, stamp)?;
    read_agent(&path, AgentSource::User).ok_or_else(|| AppError::Other("failed to read back after saving".into()))
}

/// Fire an agent (delete its definition file, with a backup).
pub fn delete_agent(
    agents_dir: &Path,
    backups_dir: &Path,
    name: &str,
    stamp: i64,
) -> AppResult<()> {
    validate_name(name)?;
    let path = agents_dir.join(format!("{}.md", name));
    safe_delete(&path, backups_dir, stamp)
}

/// AgentDef -> Markdown (frontmatter + body).
fn build_agent_md(a: &AgentDef) -> String {
    let mut s = String::from("---\n");
    s.push_str(&format!("name: {}\n", a.name));
    s.push_str(&format!("description: {}\n", fm::yaml_quote(&a.description)));
    if !a.tools.is_empty() {
        s.push_str(&format!("tools: {}\n", a.tools.join(", ")));
    }
    if let Some(m) = a.model.as_deref().filter(|m| !m.is_empty()) {
        s.push_str(&format!("model: {m}\n"));
    }
    if let Some(c) = a.color.as_deref().filter(|c| !c.is_empty()) {
        s.push_str(&format!("color: {c}\n"));
    }
    s.push_str("---\n\n");
    s.push_str(a.body.trim_end());
    s.push('\n');
    s
}

/// Read ~/.claude/agents/*.md and return the list of agents.
pub fn list_agents(agents_dir: &Path) -> AppResult<Vec<AgentDef>> {
    let mut out = Vec::new();
    if !agents_dir.is_dir() {
        return Ok(out);
    }
    for entry in std::fs::read_dir(agents_dir)? {
        let path = entry?.path();
        if path.extension().and_then(|e| e.to_str()) != Some("md") {
            continue;
        }
        if let Some(a) = read_agent(&path, AgentSource::User) {
            out.push(a);
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

/// Read all *.md under a single directory with the given source (missing/corrupt files are swallowed).
fn list_dir_agents(dir: &Path, source: AgentSource) -> Vec<AgentDef> {
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(dir) else {
        return out;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("md") {
            continue;
        }
        if let Some(a) = read_agent(&path, source.clone()) {
            out.push(a);
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

/// Return every entry, scope-tagged, from user(~/.claude/agents) + project(<dir>/.claude/agents)
/// + plugin(<install>/agents). Plugin names are namespaced as `<plugin>:<agent>`.
/// Winner selection and deduplication are the frontend's responsibility. Read leniently so it
/// does not break in distributed environments.
pub fn read_effective_agents(
    user_dir: &Path,
    project_dir: Option<&Path>,
    plugins_dir: &Path,
) -> Vec<AgentDef> {
    let mut out = list_dir_agents(user_dir, AgentSource::User);
    if let Some(dir) = project_dir {
        out.extend(list_dir_agents(
            &dir.join(".claude").join("agents"),
            AgentSource::Project,
        ));
    }
    for plugin in effective_plugins_for(&read_installed_plugins(plugins_dir), project_dir) {
        let adir = plugin.install_path.join("agents");
        for mut a in list_dir_agents(&adir, AgentSource::Plugin(plugin.name.clone())) {
            a.name = format!("{}:{}", plugin.name, a.name);
            out.push(a);
        }
    }
    out
}

/// Convert a single file into an AgentDef (with the given source).
pub fn read_agent(path: &Path, source: AgentSource) -> Option<AgentDef> {
    let content = std::fs::read_to_string(path).ok()?;
    let (fmval, body) = fm::parse(&content);
    let v = fmval.unwrap_or(serde_yaml::Value::Null);
    let stem = path.file_stem()?.to_str()?.to_string();
    let name = fm::get_str(&v, "name").unwrap_or(stem);
    Some(AgentDef {
        description: fm::get_str(&v, "description").unwrap_or_default(),
        tools: fm::get_tools(&v, "tools"),
        model: fm::get_str(&v, "model"),
        color: fm::get_str(&v, "color"),
        body,
        file_path: path.display().to_string(),
        source,
        name,
    })
}

#[cfg(test)]
mod effective_tests {
    use super::*;
    use crate::model::agent::AgentSource;
    use std::path::PathBuf;

    fn write_agent(dir: &PathBuf, name: &str) {
        std::fs::create_dir_all(dir).unwrap();
        std::fs::write(
            dir.join(format!("{name}.md")),
            format!("---\nname: {name}\ndescription: d-{name}\n---\nbody\n"),
        )
        .unwrap();
    }

    #[test]
    fn tags_sources_and_namespaces_plugin() {
        let base = std::env::temp_dir().join("ct-eff-agents");
        let _ = std::fs::remove_dir_all(&base);
        let user_dir = base.join("user-agents");
        write_agent(&user_dir, "alpha");
        let project = base.join("proj");
        write_agent(&project.join(".claude").join("agents"), "beta");

        // agents/review.md in the plugin install dir
        let plug_install = base.join("plug-sp");
        write_agent(&plug_install.join("agents"), "review");
        let plugins_dir = base.join("plugins");
        std::fs::create_dir_all(&plugins_dir).unwrap();
        std::fs::write(
            plugins_dir.join("installed_plugins.json"),
            format!(
                r#"{{"version":2,"plugins":{{"superpowers@official":[{{"scope":"user","installPath":"{}","version":"1"}}]}}}}"#,
                plug_install.display()
            ),
        )
        .unwrap();

        let got = read_effective_agents(&user_dir, Some(project.as_path()), &plugins_dir);
        let find = |n: &str| got.iter().find(|a| a.name == n).cloned();

        let a = find("alpha").expect("user agent");
        assert_eq!(a.source, AgentSource::User);
        let b = find("beta").expect("project agent");
        assert_eq!(b.source, AgentSource::Project);
        // plugin agent is namespaced
        let p = find("superpowers:review").expect("namespaced plugin agent");
        assert_eq!(p.source, AgentSource::Plugin("superpowers".into()));
    }

    #[test]
    fn excludes_unmatched_project_plugin() {
        let base = std::env::temp_dir().join("ct-eff-agents-proj");
        let _ = std::fs::remove_dir_all(&base);
        let user_dir = base.join("user-agents");
        std::fs::create_dir_all(&user_dir).unwrap();
        let project = base.join("proj");
        std::fs::create_dir_all(&project).unwrap();

        let plug_install = base.join("plug-x");
        write_agent(&plug_install.join("agents"), "xagent");
        let plugins_dir = base.join("plugins");
        std::fs::create_dir_all(&plugins_dir).unwrap();
        // project scope, but projectPath does not match the current project
        std::fs::write(
            plugins_dir.join("installed_plugins.json"),
            format!(
                r#"{{"version":2,"plugins":{{"x@m":[{{"scope":"project","projectPath":"/other","installPath":"{}","version":"1"}}]}}}}"#,
                plug_install.display()
            ),
        )
        .unwrap();

        let got = read_effective_agents(&user_dir, Some(project.as_path()), &plugins_dir);
        assert!(got.iter().all(|a| a.name != "x:xagent"));
    }
}
