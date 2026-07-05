//! macOS menu-bar (tray) icon that signals "a session is waiting for your reply".
//!
//! The icon is the app's own pixel-art mascot (see `icons/tray/`), bundled as a
//! template image (monochrome + alpha) so it follows the menu bar's light/dark
//! appearance the same way the other system icons do. While at least one
//! session is blocked on an explicit question or plan approval, a background
//! thread cycles through frames of the mascot waving (menu-bar icons cannot
//! play GIFs, so animation = swapping the icon). tray-icon always displays
//! the icon at a fixed 18pt height regardless of the source pixel size, so
//! the bundled 256x256 PNGs just get scaled down.
//!
//! Clicking the icon opens a menu listing those sessions; picking one jumps
//! to its terminal via the same focus_terminal logic the office view's
//! employee click uses.

use crate::commands::terminal_cmd::focus_terminal_core;
use crate::pipeline::session_tracker::AwaitingSession;
use crate::state::AppState;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::image::Image;
use tauri::menu::MenuBuilder;
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager};

/// Tray icon id (used to look the handle up from the animation thread).
const TRAY_ID: &str = "attention";

/// Milliseconds per animation frame.
const TICK_MS: u64 = 140;

/// Menu item id for bringing the main window to the front.
const MENU_OPEN: &str = "open";
/// Menu item id for quitting the app.
const MENU_QUIT: &str = "quit";
/// Prefix for a "jump to this session's terminal" entry; suffixed with the session id.
const MENU_FOCUS_PREFIX: &str = "focus::";

/// Sessions currently shown in the tray menu, keyed by the "focus::{id}" menu
/// item id set on click. Updated whenever the awaiting list changes; also
/// doubles as the animation trigger (non-empty = at least one session is
/// waiting), so there's a single source of truth instead of a separate
/// counter that could drift out of sync with it.
static MENU_SESSIONS: Mutex<Vec<AwaitingSession>> = Mutex::new(Vec::new());

/// Bundled frame atlas: index 0 is the quiet (static) mascot, 1.. are the
/// waving animation, looped in order while a session is waiting.
const FRAME_BYTES: &[&[u8]] = &[
    include_bytes!("../icons/tray/static.png"),
    include_bytes!("../icons/tray/anim-0.png"),
    include_bytes!("../icons/tray/anim-1.png"),
    include_bytes!("../icons/tray/anim-2.png"),
    include_bytes!("../icons/tray/anim-3.png"),
    include_bytes!("../icons/tray/anim-4.png"),
    include_bytes!("../icons/tray/anim-5.png"),
];

/// Builds the tray icon and spawns the animation thread. Called from setup().
pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let frames = Arc::new(load_frames()?);

    let menu = MenuBuilder::new(app)
        .text(MENU_OPEN, "Open Claude Code Park")
        .separator()
        .text(MENU_QUIT, "Quit Claude Code Park")
        .build()?;

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(frames[0].clone())
        .icon_as_template(true)
        .tooltip("Claude Code Park")
        .menu(&menu)
        .on_menu_event(|app, event| handle_menu_event(app, event.id().as_ref()))
        .build(app)?;

    let handle = app.clone();
    std::thread::spawn(move || run_animation(handle, frames));
    Ok(())
}

/// Routes a clicked menu item id to its action.
fn handle_menu_event(app: &AppHandle, id: &str) {
    if id == MENU_OPEN {
        if let Some(win) = app.get_webview_window("main") {
            let _ = win.show();
            let _ = win.unminimize();
            let _ = win.set_focus();
        }
    } else if id == MENU_QUIT {
        app.exit(0);
    } else if let Some(session_id) = id.strip_prefix(MENU_FOCUS_PREFIX) {
        let project = MENU_SESSIONS
            .lock()
            .unwrap()
            .iter()
            .find(|s| s.session_id == session_id)
            .map(|s| s.project.clone());
        let Some(project) = project else { return };
        let sessions_dir = app.state::<AppState>().paths.sessions_dir();
        let session_id = session_id.to_string();
        tauri::async_runtime::spawn(async move {
            if let Err(e) = focus_terminal_core(sessions_dir, session_id, project).await {
                eprintln!("[claude-code-park][tray] focus_terminal failed: {e}");
            }
        });
    }
}

/// Reports the sessions currently blocked on an explicit question or plan
/// approval. Rebuilds the tray menu and tooltip (and restarts/stops the
/// animation) only when the list actually changed.
pub fn update_awaiting(app: &AppHandle, entries: Vec<AwaitingSession>) {
    {
        let mut current = MENU_SESSIONS.lock().unwrap();
        if *current == entries {
            return;
        }
        *current = entries.clone();
    }

    let app2 = app.clone();
    let _ = app.run_on_main_thread(move || {
        let Some(tray) = app2.tray_by_id(TRAY_ID) else { return };

        let tip = if entries.is_empty() {
            "Claude Code Park".to_string()
        } else {
            format!(
                "Claude Code Park — {} waiting for your reply",
                entries.len()
            )
        };
        let _ = tray.set_tooltip(Some(tip));

        let mut builder = MenuBuilder::new(&app2);
        for entry in &entries {
            builder = builder.text(format!("{MENU_FOCUS_PREFIX}{}", entry.session_id), &entry.label);
        }
        if !entries.is_empty() {
            builder = builder.separator();
        }
        builder = builder
            .text(MENU_OPEN, "Open Claude Code Park")
            .separator()
            .text(MENU_QUIT, "Quit Claude Code Park");
        if let Ok(menu) = builder.build() {
            let _ = tray.set_menu(Some(menu));
        }
    });
}

/// Animation loop. Sleeps most of the time; while sessions are waiting it
/// advances one frame per tick, and when the last one clears it restores the
/// static icon once. Icon swaps are marshalled to the main thread because
/// NSStatusItem must only be touched there.
fn run_animation(app: AppHandle, frames: Arc<Vec<Image<'static>>>) {
    let anim_frames = frames.len() - 1; // frame 0 is the static mascot
    let mut phase = 0usize;
    let mut animating = false;
    loop {
        std::thread::sleep(Duration::from_millis(TICK_MS));
        let waiting = !MENU_SESSIONS.lock().unwrap().is_empty();
        if !waiting && !animating {
            continue;
        }
        let idx = if waiting {
            animating = true;
            phase = (phase + 1) % anim_frames;
            1 + phase
        } else {
            animating = false;
            0
        };
        let app2 = app.clone();
        let frame = frames[idx].clone();
        let _ = app.run_on_main_thread(move || {
            if let Some(tray) = app2.tray_by_id(TRAY_ID) {
                let _ = tray.set_icon(Some(frame));
            }
        });
    }
}

/// Decodes the bundled PNG frame atlas once at startup. A decode failure
/// (e.g. a corrupted bundled asset) is surfaced as a normal startup error
/// through the caller's `?` rather than panicking — a bad tray icon shouldn't
/// take the whole app down.
///
/// Each returned `Image` borrows a `'static` buffer (intentionally leaked
/// once here, since the app keeps every frame for its entire lifetime), so
/// swapping the tray icon every animation tick clones a lightweight
/// `Cow::Borrowed` pointer instead of deep-copying a ~256KB RGBA buffer.
fn load_frames() -> tauri::Result<Vec<Image<'static>>> {
    FRAME_BYTES
        .iter()
        .map(|bytes| {
            let decoded = Image::from_bytes(bytes)?;
            let (width, height) = (decoded.width(), decoded.height());
            let rgba: &'static [u8] = Box::leak(decoded.rgba().to_vec().into_boxed_slice());
            Ok(Image::new(rgba, width, height))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_bundled_frames_decode_and_are_non_empty() {
        let frames = load_frames().expect("bundled PNGs must decode in tests");
        assert_eq!(frames.len(), FRAME_BYTES.len());
        for f in &frames {
            assert!(f.width() > 0 && f.height() > 0);
            assert!(f.rgba().iter().any(|&b| b != 0), "frame must not be blank");
        }
    }

    #[test]
    fn animated_frames_differ_from_static() {
        let frames = load_frames().expect("bundled PNGs must decode in tests");
        assert_ne!(
            frames[0].rgba(),
            frames[1].rgba(),
            "waving pose must differ from the resting static frame"
        );
    }
}
