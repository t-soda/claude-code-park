mod commands;
mod config_io;
mod error;
pub mod hook_events;
mod jsonl;
mod metrics;
mod model;
mod paths;
mod pipeline;
mod state;
mod terminal;
mod watcher;

use paths::ClaudePaths;
use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let claude_paths = ClaudePaths::discover().unwrap_or_else(|e| {
        // Still start up even in environments without ~/.claude (shows an empty state).
        eprintln!("[claude-code-park] {e}; assuming ~/.claude and continuing");
        ClaudePaths {
            home: dirs::home_dir().unwrap_or_default().join(".claude"),
        }
    });

    tauri::Builder::default()
        .manage(AppState::new(claude_paths))
        .setup(|app| {
            use tauri::Manager;
            // At startup, load employees (agent definitions) into the World.
            {
                let state = app.state::<AppState>();
                if let Ok(agents) = config_io::agents::list_agents(&state.paths.agents_dir()) {
                    state.world.lock().unwrap().agents = agents;
                }
            }
            // Spawn the session watcher thread (tails JSONL under projects).
            watcher::spawn(app.handle().clone());
            // Config file watcher (CLI -> GUI sync).
            watcher::config::spawn(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::world_cmd::get_initial_state,
            commands::agents_cmd::list_agents,
            commands::agents_cmd::get_effective_agents,
            commands::agents_cmd::save_agent,
            commands::agents_cmd::delete_agent,
            commands::hooks_cmd::get_hooks,
            commands::hooks_cmd::update_hooks,
            commands::hooks_cmd::get_effective_hooks,
            commands::skills_cmd::list_skills,
            commands::skills_cmd::get_effective_skills,
            commands::skills_cmd::toggle_skill,
            commands::skills_cmd::save_skill,
            commands::commands_cmd::list_commands,
            commands::metrics_cmd::get_metrics,
            commands::session_cmd::get_session_timeline,
            commands::terminal_cmd::focus_terminal
        ])
        .run(tauri::generate_context!())
        .expect("failed to launch Claude Code Park");
}
