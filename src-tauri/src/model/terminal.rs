use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// The result of bringing a terminal to the front. On failure the command returns Err,
/// so this type is only created on success.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct FocusResult {
    /// Name of the app brought to the front ("Ghostty" / "Visual Studio Code" / "Terminal"). Always valid since it is only returned on success.
    pub app: String,
    /// Whether focus reached the specific window (false means it stopped at bringing the app to the front).
    pub window_focused: bool,
}
