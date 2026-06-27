use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use ts_rs::TS;

/// Metrics per aggregation window (today / 7d / 30d).
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct MetricsWindow {
    /// Active seconds (sum of continuous active intervals).
    pub active_seconds: u64,
    /// Active share 0..1 (fraction of the total active seconds across all employees).
    pub share: f64,
    /// Number of invocations (sub agent launch count).
    pub invocations: u32,
    pub tool_calls: u32,
    /// Average tool execution time (milliseconds).
    pub avg_tool_ms: f64,
    /// Failure rate 0..1 (rate of tool_result.is_error).
    pub failure_rate: f64,
    pub tokens_in: u64,
    pub tokens_out: u64,
}

/// Metrics per employee (agent name / "__main__" = the main session).
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct AgentMetrics {
    pub agent_name: String,
    /// "today" | "7d" | "30d" -> MetricsWindow
    pub windows: BTreeMap<String, MetricsWindow>,
}
