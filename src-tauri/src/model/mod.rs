pub mod activity;
pub mod agent;
pub mod config;
pub mod metrics;
pub mod session;
pub mod terminal;
pub mod timeline;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// The initial state handed to the frontend in bulk at startup.
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct InitialState {
    pub sessions: Vec<session::Session>,
    pub agents: Vec<agent::AgentDef>,
}
