pub mod classify;
pub mod replay;
pub mod session_tracker;
pub mod timeline;

use std::path::Path;

/// The result of determining which session/subagent a changed JSONL path belongs to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Target {
    /// projects/{proj}/{sid}.jsonl
    Main { session_id: String },
    /// projects/{proj}/{sid}/subagents/agent-{aid}.jsonl
    Sub { parent_id: String, agent_id: String },
}

/// Routes a JSONL path to a Target. None if it is not an expected path under projects.
pub fn route_path(projects_dir: &Path, path: &Path) -> Option<Target> {
    if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
        return None;
    }
    let stem = path.file_stem()?.to_str()?;
    let parent = path.parent()?;
    let parent_name = parent.file_name().and_then(|n| n.to_str());

    if parent_name == Some("subagents") {
        // {proj}/{sid}/subagents/agent-{aid}.jsonl
        let sid_dir = parent.parent()?;
        let parent_id = sid_dir.file_name()?.to_str()?.to_string();
        let agent_id = stem.strip_prefix("agent-").unwrap_or(stem).to_string();
        return Some(Target::Sub {
            parent_id,
            agent_id,
        });
    }

    // The main session is projects/{proj}/{sid}.jsonl (the grandparent is projects_dir).
    if parent.parent() == Some(projects_dir) {
        return Some(Target::Main {
            session_id: stem.to_string(),
        });
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn routes_main_and_sub_paths() {
        let projects = PathBuf::from("/home/u/.claude/projects");

        let main = projects.join("-home-u-proj").join("SID.jsonl");
        assert_eq!(
            route_path(&projects, &main),
            Some(Target::Main {
                session_id: "SID".into()
            })
        );

        let sub = projects
            .join("-home-u-proj")
            .join("SID")
            .join("subagents")
            .join("agent-AID.jsonl");
        assert_eq!(
            route_path(&projects, &sub),
            Some(Target::Sub {
                parent_id: "SID".into(),
                agent_id: "AID".into()
            })
        );

        // Unexpected paths return None.
        let other = projects.join("foo").join("bar").join("baz.jsonl");
        assert_eq!(route_path(&projects, &other), None);
        let nonjsonl = projects.join("-home-u-proj").join("SID.txt");
        assert_eq!(route_path(&projects, &nonjsonl), None);
    }
}
