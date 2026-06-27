use crate::error::{AppError, AppResult};
use crate::model::terminal::FocusResult;
use crate::state::AppState;
use crate::terminal::{
    find_host_terminal, parse_ps_rows, parse_session_entry, TerminalKind,
};
use std::process::Command;
use tauri::State;

/// Terminal kind -> app name used for `activate` / `open -a`.
pub fn app_name(kind: &TerminalKind) -> Option<&'static str> {
    match kind {
        TerminalKind::Ghostty => Some("Ghostty"),
        TerminalKind::ITerm2 => Some("iTerm"),
        TerminalKind::VsCode => Some("Visual Studio Code"),
        TerminalKind::TerminalApp => Some("Terminal"),
        TerminalKind::Unknown => None,
    }
}

/// The essential script that just brings the app to the front. If this fails, it's a real failure.
pub fn build_activate_script(app: &str) -> String {
    format!("tell application \"{app}\" to activate")
}

/// Best-effort script that identifies an existing terminal window and brings it to the front.
/// - Terminal.app / iTerm2: strictly selects the window/tab with a matching tty via AppleScript.
/// - VSCode/Ghostty: AXRaises the window whose title contains the needle via System Events.
/// Even if it fails (e.g. no permission), the caller has already done activate, so it's treated as success.
/// Unknown returns an empty string (no window identification).
pub fn build_window_focus_script(kind: &TerminalKind, tty: Option<&str>, title_needle: &str) -> String {
    match kind {
        TerminalKind::TerminalApp => {
            let dev = tty.map(|t| format!("/dev/{t}")).unwrap_or_default();
            format!(
                "tell application \"Terminal\"\n\
                 repeat with w in windows\n\
                 repeat with t in tabs of w\n\
                 if tty of t is \"{dev}\" then\n\
                 set selected tab of w to t\n\
                 set frontmost of w to true\n\
                 set index of w to 1\n\
                 return\n\
                 end if\n\
                 end repeat\n\
                 end repeat\n\
                 end tell"
            )
        }
        TerminalKind::ITerm2 => {
            // iTerm2 has a tty property per session. Selecting the matching session
            // selects its tab/window and brings it to the front.
            let dev = tty.map(|t| format!("/dev/{t}")).unwrap_or_default();
            format!(
                "tell application \"iTerm\"\n\
                 repeat with w in windows\n\
                 repeat with t in tabs of w\n\
                 repeat with s in sessions of t\n\
                 if tty of s is \"{dev}\" then\n\
                 select w\n\
                 select t\n\
                 select s\n\
                 return\n\
                 end if\n\
                 end repeat\n\
                 end repeat\n\
                 end repeat\n\
                 end tell"
            )
        }
        TerminalKind::VsCode | TerminalKind::Ghostty => {
            // Naively strip " from the AppleScript string literal.
            let needle = title_needle.replace('"', "");
            format!(
                "tell application \"System Events\"\n\
                 set procs to (every process whose frontmost is true)\n\
                 repeat with p in procs\n\
                 repeat with w in windows of p\n\
                 if name of w contains \"{needle}\" then\n\
                 perform action \"AXRaise\" of w\n\
                 return\n\
                 end if\n\
                 end repeat\n\
                 end repeat\n\
                 end tell"
            )
        }
        TerminalKind::Unknown => String::new(),
    }
}

/// Extracts the outermost `.app` bundle root from a VSCode host process path.
/// e.g. ".../Visual Studio Code.app/Contents/Frameworks/Code Helper.app/..." -> ".../Visual Studio Code.app".
/// Returns None when the path contains no `.app` segment.
pub fn vscode_bundle_root(comm: &str) -> Option<&str> {
    let idx = comm.find(".app")?;
    Some(&comm[..idx + ".app".len()])
}

/// Candidate paths for the bundled VSCode CLI, given a `.app` bundle root.
/// Stable ships `code`, Insiders ships `code-insiders`; we try stable first.
pub fn vscode_cli_candidates(bundle_root: &str) -> Vec<String> {
    ["code", "code-insiders"]
        .iter()
        .map(|bin| format!("{bundle_root}/Contents/Resources/app/bin/{bin}"))
        .collect()
}

/// Resolves the bundled VSCode CLI binary from the host process path, if it exists on disk.
fn resolve_vscode_cli(host_comm: &str) -> Option<std::path::PathBuf> {
    let root = vscode_bundle_root(host_comm)?;
    vscode_cli_candidates(root)
        .into_iter()
        .map(std::path::PathBuf::from)
        .find(|p| p.exists())
}

/// Whether window identification can be considered "reliable" (= whether window_focused can be true).
/// Terminal.app / iTerm2 are reliable because they can strictly select a window by matching tty.
/// VSCode/Ghostty rely on best-effort title matching, so even on success they aren't treated as reliable.
pub fn focus_is_reliable(kind: &TerminalKind, tty: Option<&str>) -> bool {
    matches!(kind, TerminalKind::TerminalApp | TerminalKind::ITerm2) && tty.is_some()
}

/// Brings the session's host terminal to the front.
/// 1. session_id -> running claude PID (resolved by matching sessionId in `~/.claude/sessions/<pid>.json`).
/// 2. Get all processes via ps and walk ppid to determine the host terminal.
/// 3. Get claude's controlling tty (for identifying the Terminal.app window).
/// 4. Bring it to the front: VSCode uses the bundled `code` CLI to focus the exact window by
///    workspace folder; other terminals use osascript (activate + best-effort window focus).
#[tauri::command]
pub async fn focus_terminal(
    state: State<'_, AppState>,
    session_id: String,
    project: String,
) -> AppResult<FocusResult> {
    let sessions_dir = state.paths.sessions_dir();
    tauri::async_runtime::spawn_blocking(move || {
        // 1. session_id -> running claude PID, via the session file Claude Code writes.
        let claude_pid = resolve_claude_pid(&sessions_dir, &session_id).ok_or_else(|| {
            AppError::Other("no running claude process found (the session may have ended)".into())
        })?;

        // 2. Get all processes via ps and determine the host terminal.
        let ps_out = run_capture("ps", &["-axo", "pid=,ppid=,comm="])?;
        let rows = parse_ps_rows(&ps_out);
        let host = find_host_terminal(claude_pid, &rows)
            .ok_or_else(|| AppError::Other("could not identify the host terminal".into()))?;

        // 3. claude's controlling tty (e.g. "ttys003"). Continue even on failure (not needed except for Terminal).
        let tty_out = run_capture("ps", &["-o", "tty=", "-p", &claude_pid.to_string()]).ok();
        let tty = tty_out
            .as_deref()
            .map(str::trim)
            .filter(|t| !t.is_empty() && *t != "??");

        let app = app_name(&host.kind)
            .ok_or_else(|| AppError::Other("unsupported terminal".into()))?;

        // VSCode: focus the exact window via the bundled `code` CLI (`code -r <folder>`).
        // VSCode keeps one window per workspace folder, so opening the folder focuses that
        // window precisely. Unlike the AppleScript path this needs no Accessibility/Automation
        // permission and never picks the wrong window by fuzzy title match. On failure (CLI not
        // found, non-zero exit) we fall through to the legacy activate + AppleScript path.
        if host.kind == TerminalKind::VsCode {
            let host_comm = rows.iter().find(|r| r.pid == host.pid).map(|r| r.comm.as_str());
            if let Some(code_bin) = host_comm.and_then(resolve_vscode_cli) {
                let st = Command::new(&code_bin).arg("-r").arg(&project).status();
                if matches!(st, Ok(s) if s.success()) {
                    return Ok(FocusResult {
                        app: app.to_string(),
                        window_focused: true,
                    });
                }
                eprintln!("focus_terminal: code CLI focus failed, falling back to AppleScript");
            }
        }

        // 1. activate (required). Failure is a real failure -> Err (the frontend shows a toast).
        let act = Command::new("osascript")
            .arg("-e")
            .arg(build_activate_script(app))
            .status();
        if !matches!(act, Ok(s) if s.success()) {
            eprintln!("focus_terminal: failed to activate app={app}");
            return Err(AppError::Other(format!("could not bring {app} to the front")));
        }

        // 2. Window identification (best-effort). Ignore failures like missing permission (activate done = success).
        let needle = project.rsplit('/').find(|s| !s.is_empty()).unwrap_or(&project);
        let focus_script = build_window_focus_script(&host.kind, tty, needle);
        let window_focused = if focus_script.is_empty() {
            false
        } else {
            // Window identification is best-effort. Failure (e.g. no Automation permission) is expected, so
            // swallow osascript's stderr (e.g. -1743) to avoid polluting the console.
            let st = Command::new("osascript")
                .arg("-e")
                .arg(&focus_script)
                .stderr(std::process::Stdio::null())
                .status();
            matches!(st, Ok(s) if s.success()) && focus_is_reliable(&host.kind, tty)
        };

        Ok(FocusResult {
            app: app.to_string(),
            window_focused,
        })
    })
    .await
    .map_err(|e| AppError::Other(format!("terminal focus task failed: {e}")))?
}

/// Runs a command and returns stdout as a string. The caller decides on the exit code.
fn run_capture(cmd: &str, args: &[&str]) -> AppResult<String> {
    let out = Command::new(cmd)
        .args(args)
        .output()
        .map_err(|e| AppError::Other(format!("failed to run {cmd}: {e}")))?;
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// Scans `~/.claude/sessions/*.json` and returns the claude PID of the file with a matching sessionId.
/// Since Claude Code writes one per running session, session_id -> PID can be resolved without a hook.
fn resolve_claude_pid(sessions_dir: &std::path::Path, session_id: &str) -> Option<u32> {
    let pattern = format!("{}/*.json", sessions_dir.display());
    for path in glob::glob(&pattern).into_iter().flatten().flatten() {
        let Ok(content) = std::fs::read_to_string(&path) else { continue };
        let Some((pid, sid)) = parse_session_entry(&content) else { continue };
        if sid == session_id {
            return Some(pid);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_name_maps_kinds() {
        assert_eq!(app_name(&TerminalKind::Ghostty), Some("Ghostty"));
        assert_eq!(app_name(&TerminalKind::ITerm2), Some("iTerm"));
        assert_eq!(app_name(&TerminalKind::VsCode), Some("Visual Studio Code"));
        assert_eq!(app_name(&TerminalKind::TerminalApp), Some("Terminal"));
        assert_eq!(app_name(&TerminalKind::Unknown), None);
    }

    #[test]
    fn activate_script_targets_app() {
        let s = build_activate_script("Ghostty");
        assert_eq!(s, "tell application \"Ghostty\" to activate");
    }

    #[test]
    fn terminal_focus_script_matches_by_tty() {
        let s = build_window_focus_script(&TerminalKind::TerminalApp, Some("ttys003"), "my-project");
        assert!(s.contains("tell application \"Terminal\""));
        assert!(s.contains("/dev/ttys003"));
    }

    #[test]
    fn iterm2_focus_script_matches_session_by_tty() {
        let s = build_window_focus_script(&TerminalKind::ITerm2, Some("ttys003"), "my-project");
        assert!(s.contains("tell application \"iTerm\""));
        assert!(s.contains("sessions of t"));
        assert!(s.contains("/dev/ttys003"));
    }

    #[test]
    fn vscode_focus_script_matches_by_title_needle() {
        let s = build_window_focus_script(&TerminalKind::VsCode, None, "my-project");
        assert!(s.contains("System Events"));
        assert!(s.contains("AXRaise"));
        assert!(s.contains("my-project"));
    }

    #[test]
    fn ghostty_focus_script_uses_system_events() {
        let s = build_window_focus_script(&TerminalKind::Ghostty, None, "my-project");
        assert!(s.contains("System Events"));
        assert!(s.contains("AXRaise"));
    }

    #[test]
    fn unknown_focus_script_is_empty() {
        assert!(build_window_focus_script(&TerminalKind::Unknown, None, "x").is_empty());
    }

    #[test]
    fn vscode_bundle_root_extracts_first_app_bundle() {
        // The VSCode host process is often a nested helper; we want the outermost .app bundle.
        let comm = "/Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper.app/Contents/MacOS/Code Helper";
        assert_eq!(
            vscode_bundle_root(comm),
            Some("/Applications/Visual Studio Code.app")
        );
        // The main Electron process path also resolves to the same bundle.
        assert_eq!(
            vscode_bundle_root("/Applications/Visual Studio Code.app/Contents/MacOS/Electron"),
            Some("/Applications/Visual Studio Code.app")
        );
    }

    #[test]
    fn vscode_bundle_root_none_for_non_app_path() {
        assert_eq!(vscode_bundle_root("/bin/zsh"), None);
    }

    #[test]
    fn vscode_cli_candidates_builds_bin_paths() {
        let cands = vscode_cli_candidates("/Applications/Visual Studio Code.app");
        // Stable ships `code`; Insiders ships `code-insiders`. Try both, stable first.
        assert_eq!(
            cands,
            vec![
                "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code".to_string(),
                "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code-insiders"
                    .to_string(),
            ]
        );
    }

    #[test]
    fn focus_reliable_only_for_terminal_app_with_tty() {
        assert!(focus_is_reliable(&TerminalKind::TerminalApp, Some("ttys003")));
        assert!(focus_is_reliable(&TerminalKind::ITerm2, Some("ttys003")));
        assert!(!focus_is_reliable(&TerminalKind::ITerm2, None));
        assert!(!focus_is_reliable(&TerminalKind::TerminalApp, None));
        assert!(!focus_is_reliable(&TerminalKind::Ghostty, Some("ttys003")));
        assert!(!focus_is_reliable(&TerminalKind::VsCode, Some("ttys003")));
    }
}
