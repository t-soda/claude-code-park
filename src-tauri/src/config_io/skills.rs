use super::frontmatter as fm;
use super::plugins::{effective_plugins_for, read_installed_plugins};
use super::safe_write::safe_write;
use crate::error::{AppError, AppResult};
use crate::model::config::{SkillDef, SkillSource};
use std::path::Path;

/// Toggle a skill enabled/disabled by renaming SKILL.md <-> SKILL.md.disabled (content unchanged).
pub fn toggle_skill(skills_dir: &Path, name: &str, disable: bool) -> AppResult<()> {
    let dir = skills_dir.join(name);
    let active = dir.join("SKILL.md");
    let disabled = dir.join("SKILL.md.disabled");
    if disable {
        if active.is_file() {
            std::fs::rename(&active, &disabled)?;
        }
    } else if disabled.is_file() {
        std::fs::rename(&disabled, &active)?;
    }
    Ok(())
}

/// Save a skill (create new / edit). Writes to SKILL.md(.disabled) depending on the disabled state.
pub fn save_skill(
    skills_dir: &Path,
    backups_dir: &Path,
    skill: &SkillDef,
    create: bool,
    stamp: i64,
) -> AppResult<SkillDef> {
    super::agents::validate_name(&skill.name)?;
    let dir = skills_dir.join(&skill.name);
    let active = dir.join("SKILL.md");
    let disabled = dir.join("SKILL.md.disabled");
    if create && (active.exists() || disabled.exists()) {
        return Err(AppError::Invalid(format!(
            "Skill '{}' already exists",
            skill.name
        )));
    }
    std::fs::create_dir_all(&dir)?;
    let path = if skill.disabled { disabled } else { active };
    let md = build_skill_md(skill);
    safe_write(&path, &md, backups_dir, stamp)?;
    read_skill(&dir, &path, skill.disabled, SkillSource::User)
        .ok_or_else(|| AppError::Other("failed to read back after saving".into()))
}

fn build_skill_md(s: &SkillDef) -> String {
    let mut out = String::from("---\n");
    out.push_str(&format!("name: {}\n", s.name));
    out.push_str(&format!("description: {}\n", fm::yaml_quote(&s.description)));
    if s.disable_model_invocation {
        out.push_str("disable-model-invocation: true\n");
    }
    if let Some(h) = s.argument_hint.as_deref().filter(|h| !h.is_empty()) {
        out.push_str(&format!("argument-hint: {}\n", fm::yaml_quote(h)));
    }
    if !s.allowed_tools.is_empty() {
        out.push_str(&format!("allowed-tools: {}\n", s.allowed_tools.join(" ")));
    }
    out.push_str("---\n\n");
    out.push_str(s.body.trim_end());
    out.push('\n');
    out
}

/// Read ~/.claude/skills/{name}/SKILL.md(.disabled) and return the list of skills.
pub fn list_skills(skills_dir: &Path) -> AppResult<Vec<SkillDef>> {
    let mut out = Vec::new();
    if !skills_dir.is_dir() {
        return Ok(out);
    }
    for entry in std::fs::read_dir(skills_dir)? {
        let dir = entry?.path();
        if !dir.is_dir() {
            continue;
        }
        let active = dir.join("SKILL.md");
        let disabled = dir.join("SKILL.md.disabled");
        let (path, is_disabled) = if active.is_file() {
            (active, false)
        } else if disabled.is_file() {
            (disabled, true)
        } else {
            continue;
        };
        if let Some(s) = read_skill(&dir, &path, is_disabled, SkillSource::User) {
            out.push(s);
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

/// Read each <name>/SKILL.md(.disabled) under a single skills directory with the given source.
/// Missing/corrupt files are swallowed (never panics).
fn list_dir_skills(skills_dir: &Path, source: SkillSource) -> Vec<SkillDef> {
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(skills_dir) else {
        return out;
    };
    for entry in entries.flatten() {
        let dir = entry.path();
        if !dir.is_dir() {
            continue;
        }
        let active = dir.join("SKILL.md");
        let disabled = dir.join("SKILL.md.disabled");
        let (path, is_disabled) = if active.is_file() {
            (active, false)
        } else if disabled.is_file() {
            (disabled, true)
        } else {
            continue;
        };
        if let Some(s) = read_skill(&dir, &path, is_disabled, source.clone()) {
            out.push(s);
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

/// Return every entry, scope-tagged, from user(~/.claude/skills) + project(<dir>/.claude/skills)
/// + plugin(<install>/skills). Plugin names are namespaced as `<plugin>:<skill>`.
/// Winner selection and deduplication are the frontend's responsibility. Read leniently so it
/// does not break in distributed environments.
pub fn read_effective_skills(
    user_dir: &Path,
    project_dir: Option<&Path>,
    plugins_dir: &Path,
) -> Vec<SkillDef> {
    let mut out = list_dir_skills(user_dir, SkillSource::User);
    if let Some(dir) = project_dir {
        out.extend(list_dir_skills(
            &dir.join(".claude").join("skills"),
            SkillSource::Project,
        ));
    }
    for plugin in effective_plugins_for(&read_installed_plugins(plugins_dir), project_dir) {
        let sdir = plugin.install_path.join("skills");
        for mut s in list_dir_skills(&sdir, SkillSource::Plugin(plugin.name.clone())) {
            s.name = format!("{}:{}", plugin.name, s.name);
            out.push(s);
        }
    }
    out
}

fn read_skill(dir: &Path, path: &Path, disabled: bool, source: SkillSource) -> Option<SkillDef> {
    let content = std::fs::read_to_string(path).ok()?;
    let (fmval, body) = fm::parse(&content);
    let v = fmval.unwrap_or(serde_yaml::Value::Null);
    let dir_name = dir.file_name()?.to_str()?.to_string();
    Some(SkillDef {
        name: fm::get_str(&v, "name").unwrap_or(dir_name),
        description: fm::get_str(&v, "description").unwrap_or_default(),
        disable_model_invocation: fm::get_bool(&v, "disable-model-invocation"),
        argument_hint: fm::get_str(&v, "argument-hint"),
        allowed_tools: fm::get_tools(&v, "allowed-tools"),
        disabled,
        body,
        dir: dir.display().to_string(),
        source,
    })
}

#[cfg(test)]
mod effective_tests {
    use super::*;
    use std::path::PathBuf;

    fn write_skill(skills_dir: &PathBuf, name: &str) {
        let dir = skills_dir.join(name);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("SKILL.md"),
            format!("---\nname: {name}\ndescription: d-{name}\n---\nbody\n"),
        )
        .unwrap();
    }

    #[test]
    fn tags_sources_and_namespaces_plugin() {
        let base = std::env::temp_dir().join("ct-eff-skills");
        let _ = std::fs::remove_dir_all(&base);
        let user_dir = base.join("user-skills");
        write_skill(&user_dir, "alpha");
        let project = base.join("proj");
        write_skill(&project.join(".claude").join("skills"), "beta");

        let plug_install = base.join("plug-sp");
        write_skill(&plug_install.join("skills"), "review");
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

        let got = read_effective_skills(&user_dir, Some(project.as_path()), &plugins_dir);
        let find = |n: &str| got.iter().find(|s| s.name == n).cloned();

        assert_eq!(find("alpha").unwrap().source, SkillSource::User);
        assert_eq!(find("beta").unwrap().source, SkillSource::Project);
        let p = find("superpowers:review").expect("namespaced plugin skill");
        assert_eq!(p.source, SkillSource::Plugin("superpowers".into()));
    }

    #[test]
    fn excludes_unmatched_project_plugin() {
        let base = std::env::temp_dir().join("ct-eff-skills-proj");
        let _ = std::fs::remove_dir_all(&base);
        let user_dir = base.join("user-skills");
        std::fs::create_dir_all(&user_dir).unwrap();
        let project = base.join("proj");
        std::fs::create_dir_all(&project).unwrap();

        let plug_install = base.join("plug-x");
        write_skill(&plug_install.join("skills"), "xskill");
        let plugins_dir = base.join("plugins");
        std::fs::create_dir_all(&plugins_dir).unwrap();
        std::fs::write(
            plugins_dir.join("installed_plugins.json"),
            format!(
                r#"{{"version":2,"plugins":{{"x@m":[{{"scope":"project","projectPath":"/other","installPath":"{}","version":"1"}}]}}}}"#,
                plug_install.display()
            ),
        )
        .unwrap();

        let got = read_effective_skills(&user_dir, Some(project.as_path()), &plugins_dir);
        assert!(got.iter().all(|s| s.name != "x:xskill"));
    }
}
