pub mod utilization;

use crate::model::agent::AgentDef;
use crate::model::metrics::{AgentMetrics, MetricsWindow};
use crate::pipeline::{route_path, Target};
use chrono::{DateTime, Utc};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use utilization::{active_seconds, windows};

/// Virtual employee key representing the main Claude Code session.
pub const MAIN_KEY: &str = "__main__";

/// Raw aggregation data extracted from a single entry.
struct EntryStat {
    ts: DateTime<Utc>,
    tool_calls: u32,
    failures: u32,
    tokens_in: u64,
    tokens_out: u64,
    /// The subagent_types of sub agents launched by this entry.
    agent_calls: Vec<String>,
    /// The entry's cwd (used for the project directory filter).
    cwd: Option<String>,
}

/// Accumulator for one window and one employee.
#[derive(Default)]
struct Acc {
    ts: Vec<DateTime<Utc>>,
    tool_calls: u32,
    failures: u32,
    tokens_in: u64,
    tokens_out: u64,
    invocations: u32,
}

impl Acc {
    fn finalize(mut self) -> MetricsWindow {
        self.ts.sort();
        let active = active_seconds(&self.ts);
        let failure_rate = if self.tool_calls > 0 {
            self.failures as f64 / self.tool_calls as f64
        } else {
            0.0
        };
        // Average tool run time is approximated as active seconds / tool count (per-tool measurements are not in the JSONL).
        let avg_tool_ms = if self.tool_calls > 0 {
            active as f64 * 1000.0 / self.tool_calls as f64
        } else {
            0.0
        };
        MetricsWindow {
            active_seconds: active,
            // share requires the cross-window total, so assign_shares writes it later in compute_all.
            share: 0.0,
            invocations: self.invocations,
            tool_calls: self.tool_calls,
            avg_tool_ms,
            failure_rate,
            tokens_in: self.tokens_in,
            tokens_out: self.tokens_out,
        }
    }
}

/// Returns the project directory name (encoded cwd) directly under projects_dir.
/// None if it is not under projects_dir.
pub fn project_dir_name(projects_dir: &Path, path: &Path) -> Option<String> {
    let rel = path.strip_prefix(projects_dir).ok()?;
    let first = rel.components().next()?;
    Some(first.as_os_str().to_str()?.to_string())
}

/// Scans under projects and aggregates metrics per employee (__main__ plus each subagent_type).
pub fn compute_all(
    projects_dir: &Path,
    agents: &[AgentDef],
    now: DateTime<Utc>,
    project: Option<&str>,
) -> Vec<AgentMetrics> {
    let wins = windows(now);
    let oldest = wins.iter().map(|w| w.start).min().unwrap_or(now);

    // 1. Collect files updated within 30d and parse them.
    let mut parsed: BTreeMap<PathBuf, Vec<EntryStat>> = BTreeMap::new();
    let pattern = format!("{}/**/*.jsonl", projects_dir.display());
    let now_sys = std::time::SystemTime::now();
    for path in glob::glob(&pattern).into_iter().flatten().flatten() {
        let recent = std::fs::metadata(&path)
            .and_then(|m| m.modified())
            .ok()
            .and_then(|mt| now_sys.duration_since(mt).ok())
            .map(|age| age.as_secs() <= 31 * 24 * 3600)
            .unwrap_or(false);
        if recent {
            parsed.insert(path.clone(), parse_file(&path));
        }
    }

    // When project is specified: keep only files under the project directory with that cwd.
    if let Some(target_cwd) = project.filter(|p| !p.is_empty()) {
        // Derive {dir name -> cwd} from the main files.
        let mut dir_cwd: BTreeMap<String, String> = BTreeMap::new();
        for (path, stats) in &parsed {
            if let Some(dir) = project_dir_name(projects_dir, path) {
                if let Some(cwd) = stats.iter().find_map(|s| s.cwd.clone()) {
                    dir_cwd.entry(dir).or_insert(cwd);
                }
            }
        }
        parsed.retain(|path, _| {
            project_dir_name(projects_dir, path)
                .and_then(|d| dir_cwd.get(&d).cloned())
                .map(|cwd| cwd == target_cwd)
                .unwrap_or(false)
        });
    }

    // 2. Build sub agent file -> subagent_type links per parent session.
    let link = build_links(projects_dir, &parsed);

    // 3. Aggregate. agg[agent][window_key]
    let mut agg: BTreeMap<String, BTreeMap<String, Acc>> = BTreeMap::new();
    let ensure = |agg: &mut BTreeMap<String, BTreeMap<String, Acc>>, key: &str| {
        agg.entry(key.to_string()).or_insert_with(|| {
            wins.iter().map(|w| (w.key.to_string(), Acc::default())).collect()
        });
    };
    // Always emit defined employees and __main__ even with 0.
    ensure(&mut agg, MAIN_KEY);
    for a in agents {
        ensure(&mut agg, &a.name);
    }

    for (path, stats) in &parsed {
        let target = route_path(projects_dir, path);
        let bucket = match &target {
            Some(Target::Main { .. }) | None => MAIN_KEY.to_string(),
            Some(Target::Sub { .. }) => link
                .get(path)
                .cloned()
                .unwrap_or_else(|| "general-purpose".to_string()),
        };
        ensure(&mut agg, &bucket);

        for st in stats {
            if st.ts < oldest {
                continue;
            }
            for w in &wins {
                if st.ts < w.start {
                    continue;
                }
                let acc = agg.get_mut(&bucket).unwrap().get_mut(w.key).unwrap();
                acc.ts.push(st.ts);
                acc.tool_calls += st.tool_calls;
                acc.failures += st.failures;
                acc.tokens_in += st.tokens_in;
                acc.tokens_out += st.tokens_out;
            }
            // Count invocations against the called subagent_type.
            for call_type in &st.agent_calls {
                ensure(&mut agg, call_type);
                for w in &wins {
                    if st.ts < w.start {
                        continue;
                    }
                    agg.get_mut(call_type)
                        .unwrap()
                        .get_mut(w.key)
                        .unwrap()
                        .invocations += 1;
                }
            }
        }
    }

    // 4. finalize (fixes active_seconds, etc. share is computed later).
    let mut result: Vec<AgentMetrics> = agg
        .into_iter()
        .map(|(agent_name, wmap)| AgentMetrics {
            agent_name,
            windows: wmap.into_iter().map(|(k, acc)| (k, acc.finalize())).collect(),
        })
        .collect();

    // 5. Per window, compute share using the sum of all employees' active seconds as the denominator.
    let win_keys: Vec<&str> = wins.iter().map(|w| w.key).collect();
    assign_shares(&mut result, &win_keys);
    result
}

/// For each window, writes share using the sum of all employees' active_seconds as the denominator.
/// When the total is 0, all employees get share=0.0 (avoids division by zero).
fn assign_shares(metrics: &mut [AgentMetrics], win_keys: &[&str]) {
    for &key in win_keys {
        let total: u64 = metrics
            .iter()
            .filter_map(|m| m.windows.get(key))
            .map(|w| w.active_seconds)
            .sum();
        for m in metrics.iter_mut() {
            if let Some(w) = m.windows.get_mut(key) {
                w.share = if total > 0 {
                    w.active_seconds as f64 / total as f64
                } else {
                    0.0
                };
            }
        }
    }
}

/// Converts an entire file into a sequence of EntryStat.
/// Streams line by line so a multi-hundred-MB session JSONL is never held in memory whole.
fn parse_file(path: &Path) -> Vec<EntryStat> {
    let mut out = Vec::new();
    crate::jsonl::for_each_entry(path, |e| {
        let Some(ts) = e
            .timestamp
            .as_deref()
            .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        else {
            return;
        };
        let ts = ts.with_timezone(&Utc);
        let mut tool_calls = 0u32;
        let mut agent_calls = Vec::new();
        for b in e.blocks() {
            if b.block_type.as_deref() == Some("tool_use") {
                tool_calls += 1;
                if let Some(name) = b.name.as_deref() {
                    if name == "Agent" || name == "Task" {
                        let st = b
                            .input
                            .as_ref()
                            .and_then(|v| v.get("subagent_type"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("general-purpose")
                            .to_string();
                        agent_calls.push(st);
                    }
                }
            }
        }
        let failures = e.tool_results().filter(|b| b.is_error == Some(true)).count() as u32;
        let (tokens_in, tokens_out) = e
            .message
            .as_ref()
            .and_then(|m| m.usage.as_ref())
            .map(|u| (u.input_tokens.unwrap_or(0), u.output_tokens.unwrap_or(0)))
            .unwrap_or((0, 0));
        out.push(EntryStat {
            ts,
            tool_calls,
            failures,
            tokens_in,
            tokens_out,
            agent_calls,
            cwd: e.cwd.clone(),
        });
    });
    out
}

/// Builds sub agent file -> subagent_type links.
/// Matches the parent session's Agent calls (in time order) against sub files (in start-time order).
fn build_links(
    projects_dir: &Path,
    parsed: &BTreeMap<PathBuf, Vec<EntryStat>>,
) -> BTreeMap<PathBuf, String> {
    // parent sid -> list of Agent calls (ts, type)
    let mut calls_by_parent: BTreeMap<String, Vec<(DateTime<Utc>, String)>> = BTreeMap::new();
    // parent sid -> list of sub files (first_ts, path)
    let mut subs_by_parent: BTreeMap<String, Vec<(DateTime<Utc>, PathBuf)>> = BTreeMap::new();

    for (path, stats) in parsed {
        match route_path(projects_dir, path) {
            Some(Target::Main { session_id }) => {
                let entry = calls_by_parent.entry(session_id).or_default();
                for st in stats {
                    for t in &st.agent_calls {
                        entry.push((st.ts, t.clone()));
                    }
                }
            }
            Some(Target::Sub { parent_id, .. }) => {
                if let Some(first) = stats.iter().map(|s| s.ts).min() {
                    subs_by_parent
                        .entry(parent_id)
                        .or_default()
                        .push((first, path.clone()));
                }
            }
            None => {}
        }
    }

    let mut link = BTreeMap::new();
    for (sid, mut subs) in subs_by_parent {
        subs.sort_by_key(|(ts, _)| *ts);
        let mut calls = calls_by_parent.remove(&sid).unwrap_or_default();
        calls.sort_by_key(|(ts, _)| *ts);
        for (i, (_, path)) in subs.into_iter().enumerate() {
            if let Some((_, ty)) = calls.get(i) {
                link.insert(path, ty.clone());
            }
        }
    }
    link
}

#[cfg(test)]
mod project_filter_tests {
    use super::*;
    use std::path::PathBuf;

    fn projects() -> PathBuf {
        PathBuf::from("/home/u/.claude/projects")
    }

    #[test]
    fn dir_name_for_main_file() {
        let p = projects().join("-work-proj").join("SID.jsonl");
        assert_eq!(project_dir_name(&projects(), &p), Some("-work-proj".to_string()));
    }

    #[test]
    fn dir_name_for_subagent_file() {
        let p = projects()
            .join("-work-proj")
            .join("SID")
            .join("subagents")
            .join("agent-A.jsonl");
        assert_eq!(project_dir_name(&projects(), &p), Some("-work-proj".to_string()));
    }

    #[test]
    fn dir_name_outside_projects_is_none() {
        let p = PathBuf::from("/tmp/x.jsonl");
        assert_eq!(project_dir_name(&projects(), &p), None);
    }
}

#[cfg(test)]
mod compute_all_filter_tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    /// Creates a unique directory for tests under temp_dir.
    fn make_projects_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir()
            .join(format!("claude_code_park_metrics_test_{}_{}", label, std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// A minimal valid JSONL line (assistant + tool_use).
    /// Distinguishes projects by the cwd field. Since it is treated as a recent file,
    /// the timestamp need not be close to "now" -- glob's recent check is based on the
    /// file mtime, so newly created files are automatically treated as recent.
    fn make_line(ts: &str, session_id: &str, cwd: &str) -> String {
        format!(
            r#"{{"type":"assistant","timestamp":"{ts}","sessionId":"{session_id}","cwd":"{cwd}","message":{{"role":"assistant","content":[{{"type":"tool_use","id":"t1","name":"Read","input":{{"file_path":"/x"}}}}]}}}}"#,
            ts = ts,
            session_id = session_id,
            cwd = cwd,
        )
    }

    /// Encoded directory name (per Claude Code convention, replaces "/" in cwd with "-").
    fn encode_dir(cwd: &str) -> String {
        cwd.replace('/', "-")
    }

    /// Verifies that compute_all's project filter narrows files by cwd match.
    #[test]
    fn compute_all_filters_by_cwd() {
        let projects_dir = make_projects_dir("filter_by_cwd");

        let cwd_a = "/work/project-alpha";
        let cwd_b = "/work/project-beta";
        let sid_a = "SIDA";
        let sid_b = "SIDB";

        // project A: <projects_dir>/<encoded_cwd_a>/<sid_a>.jsonl
        let dir_a = projects_dir.join(encode_dir(cwd_a));
        fs::create_dir_all(&dir_a).unwrap();
        let now_ts = "2026-06-25T10:00:00.000Z";
        let lines_a = [
            make_line(now_ts, sid_a, cwd_a),
            make_line("2026-06-25T10:00:05.000Z", sid_a, cwd_a),
        ]
        .join("\n");
        fs::write(dir_a.join(format!("{}.jsonl", sid_a)), &lines_a).unwrap();

        // project B: <projects_dir>/<encoded_cwd_b>/<sid_b>.jsonl
        let dir_b = projects_dir.join(encode_dir(cwd_b));
        fs::create_dir_all(&dir_b).unwrap();
        let lines_b = [
            make_line(now_ts, sid_b, cwd_b),
            make_line("2026-06-25T10:00:05.000Z", sid_b, cwd_b),
        ]
        .join("\n");
        fs::write(dir_b.join(format!("{}.jsonl", sid_b)), &lines_b).unwrap();

        let now = Utc::now();

        // With cwd_a specified: __main__'s tool_calls cover only A's 2 entries.
        let metrics_a = compute_all(&projects_dir, &[], now, Some(cwd_a));
        let main_a = metrics_a.iter().find(|m| m.agent_name == MAIN_KEY).unwrap();
        let total_a: u32 = main_a.windows.values().map(|w| w.tool_calls).max().unwrap_or(0);
        assert_eq!(total_a, 2, "with project A filter, only A's 2 tool_calls should be counted");

        // With cwd_b specified: __main__'s tool_calls cover only B's 2 entries.
        let metrics_b = compute_all(&projects_dir, &[], now, Some(cwd_b));
        let main_b = metrics_b.iter().find(|m| m.agent_name == MAIN_KEY).unwrap();
        let total_b: u32 = main_b.windows.values().map(|w| w.tool_calls).max().unwrap_or(0);
        assert_eq!(total_b, 2, "with project B filter, only B's 2 tool_calls should be counted");

        // No filter: the 4 entries from both projects are combined.
        let metrics_all = compute_all(&projects_dir, &[], now, None);
        let main_all = metrics_all.iter().find(|m| m.agent_name == MAIN_KEY).unwrap();
        let total_all: u32 = main_all.windows.values().map(|w| w.tool_calls).max().unwrap_or(0);
        assert_eq!(total_all, 4, "with no filter, A + B's 4 tool_calls should be counted");
    }
}

#[cfg(test)]
mod share_tests {
    use super::*;
    use crate::model::metrics::{AgentMetrics, MetricsWindow};
    use std::collections::BTreeMap;

    /// Creates an AgentMetrics with a single "today" window where only active_seconds is set.
    fn agent(name: &str, active: u64) -> AgentMetrics {
        let mut windows = BTreeMap::new();
        windows.insert(
            "today".to_string(),
            MetricsWindow { active_seconds: active, ..Default::default() },
        );
        AgentMetrics { agent_name: name.to_string(), windows }
    }

    #[test]
    fn shares_sum_to_one_across_agents() {
        let mut m = vec![agent("a", 30), agent("b", 10)];
        assign_shares(&mut m, &["today"]);
        let sa = m[0].windows["today"].share;
        let sb = m[1].windows["today"].share;
        assert!((sa - 0.75).abs() < 1e-9, "a share = {sa}");
        assert!((sb - 0.25).abs() < 1e-9, "b share = {sb}");
        assert!((sa + sb - 1.0).abs() < 1e-9, "the sum is 1.0");
    }

    #[test]
    fn single_agent_gets_full_share() {
        let mut m = vec![agent("solo", 42)];
        assign_shares(&mut m, &["today"]);
        assert!((m[0].windows["today"].share - 1.0).abs() < 1e-9);
    }

    #[test]
    fn zero_total_yields_zero_share_without_panic() {
        let mut m = vec![agent("a", 0), agent("b", 0)];
        assign_shares(&mut m, &["today"]);
        assert_eq!(m[0].windows["today"].share, 0.0);
        assert_eq!(m[1].windows["today"].share, 0.0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Verifies that metrics aggregation runs without breaking on a real projects directory and produces sensible values.
    /// `CT_PROJECTS_DIR=~/.claude/projects cargo test -- --ignored real_metrics --nocapture`
    #[test]
    #[ignore]
    fn real_metrics_smoke() {
        let Ok(dir) = std::env::var("CT_PROJECTS_DIR") else {
            eprintln!("CT_PROJECTS_DIR not set, skipping");
            return;
        };
        let now = Utc::now();
        let metrics = compute_all(Path::new(&dir), &[], now, None);
        assert!(!metrics.is_empty(), "metrics are empty");
        eprintln!("== aggregated employees: {} ==", metrics.len());
        for m in metrics.iter().take(8) {
            if let Some(w) = m.windows.get("30d") {
                eprintln!(
                    "{:<24} 30d: active {}s share {:.0}% calls {} tools {} failure {:.0}%",
                    m.agent_name,
                    w.active_seconds,
                    w.share * 100.0,
                    w.invocations,
                    w.tool_calls,
                    w.failure_rate * 100.0
                );
            }
        }
        // __main__ exists and tool_calls is >= 0.
        let main = metrics.iter().find(|m| m.agent_name == MAIN_KEY).unwrap();
        assert!(main.windows.contains_key("today"));
    }
}
