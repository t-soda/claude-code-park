use serde::Deserialize;
use std::path::Path;

/// Sidecar metadata Claude Code writes next to each subagent transcript
/// (subagents/agent-{id}.meta.json). All fields are optional so older files
/// without the sidecar (or with a different shape) degrade gracefully.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubAgentMeta {
    /// The Agent tool_use's input.subagent_type ("general-purpose", ...).
    pub agent_type: Option<String>,
    pub description: Option<String>,
    /// The id of the Agent tool_use block (in the caller's transcript) that
    /// spawned this agent. Links a transcript to its exact spawn call.
    pub tool_use_id: Option<String>,
    /// 1 = spawned by the main session, 2+ = spawned by another subagent.
    pub spawn_depth: Option<u32>,
}

/// Reads the sidecar meta for a subagent transcript path
/// (.../agent-{id}.jsonl -> .../agent-{id}.meta.json).
/// None when the sidecar is missing or unparseable.
pub fn read_sidecar_meta(jsonl_path: &Path) -> Option<SubAgentMeta> {
    let stem = jsonl_path.file_stem()?.to_str()?;
    let meta_path = jsonl_path.with_file_name(format!("{stem}.meta.json"));
    let raw = std::fs::read_to_string(meta_path).ok()?;
    serde_json::from_str(&raw).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_sidecar_next_to_transcript() {
        let dir = std::env::temp_dir().join(format!("ccp-meta-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let jsonl = dir.join("agent-abc123.jsonl");
        std::fs::write(
            dir.join("agent-abc123.meta.json"),
            r#"{"agentType":"Explore","description":"scan","toolUseId":"toolu_1","spawnDepth":2}"#,
        )
        .unwrap();

        let meta = read_sidecar_meta(&jsonl).expect("sidecar should parse");
        assert_eq!(meta.agent_type.as_deref(), Some("Explore"));
        assert_eq!(meta.description.as_deref(), Some("scan"));
        assert_eq!(meta.tool_use_id.as_deref(), Some("toolu_1"));
        assert_eq!(meta.spawn_depth, Some(2));

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn missing_or_broken_sidecar_is_none() {
        let dir = std::env::temp_dir().join(format!("ccp-meta-test2-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        assert!(read_sidecar_meta(&dir.join("agent-none.jsonl")).is_none());
        std::fs::write(dir.join("agent-bad.meta.json"), "not json").unwrap();
        assert!(read_sidecar_meta(&dir.join("agent-bad.jsonl")).is_none());
        std::fs::remove_dir_all(&dir).ok();
    }
}
