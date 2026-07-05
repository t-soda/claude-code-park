use crate::tray;
use tauri::AppHandle;

/// Shows or hides the menu-bar attention icon (the Settings display toggle).
/// The awaiting-sessions tracking keeps running regardless of visibility, so
/// re-enabling immediately reflects whatever the current state is. Returns
/// an error (surfaced to the frontend's `.catch`) if the icon itself
/// couldn't be created, rather than silently leaving the checkbox out of
/// sync with reality.
#[tauri::command]
pub async fn set_tray_enabled(app: AppHandle, enabled: bool) -> Result<(), String> {
    tray::set_enabled(&app, enabled).await
}
