import { invoke } from "@tauri-apps/api/core";
import type {
  AgentDef,
  AgentMetrics,
  CommandDef,
  FocusResult,
  HookEntry,
  InitialState,
  ReplayData,
  ReplaySessionMeta,
  ScopedHook,
  SkillDef,
  TimelineEntry,
} from "../bindings";

/** hooks from settings.json (event name -> HookEntry list). Corresponds to HooksMap on the Rust side. */
export type HooksMap = Record<string, HookEntry[]>;

/** event name -> effective hooks (with scope). Corresponds to EffectiveHooks on the Rust side. */
export type EffectiveHooks = Record<string, ScopedHook[]>;

/**
 * Typed wrappers around Rust's #[tauri::command] functions.
 * Add an entry here whenever a new command is introduced (the single call site for the frontend).
 */
export const api = {
  getInitialState(): Promise<InitialState> {
    return invoke<InitialState>("get_initial_state");
  },
  listAgents(project?: string): Promise<AgentDef[]> {
    return invoke<AgentDef[]>("list_agents", { project });
  },
  getHooks(project?: string): Promise<HooksMap> {
    return invoke<HooksMap>("get_hooks", { project });
  },
  getEffectiveHooks(project: string): Promise<EffectiveHooks> {
    return invoke<EffectiveHooks>("get_effective_hooks", { project });
  },
  getEffectiveAgents(project: string): Promise<AgentDef[]> {
    return invoke<AgentDef[]>("get_effective_agents", { project });
  },
  listSkills(project?: string): Promise<SkillDef[]> {
    return invoke<SkillDef[]>("list_skills", { project });
  },
  getEffectiveSkills(project: string): Promise<SkillDef[]> {
    return invoke<SkillDef[]>("get_effective_skills", { project });
  },
  listCommands(project?: string): Promise<CommandDef[]> {
    return invoke<CommandDef[]>("list_commands", { project });
  },
  // --- Editing operations (Phase 4) ---
  updateHooks(hooks: HooksMap, project?: string): Promise<HooksMap> {
    return invoke<HooksMap>("update_hooks", { hooks, project });
  },
  saveAgent(agent: AgentDef, create: boolean, project?: string): Promise<AgentDef> {
    return invoke<AgentDef>("save_agent", { agent, create, project });
  },
  deleteAgent(name: string, project?: string): Promise<void> {
    return invoke<void>("delete_agent", { name, project });
  },
  toggleSkill(name: string, disable: boolean, project?: string): Promise<SkillDef[]> {
    return invoke<SkillDef[]>("toggle_skill", { name, disable, project });
  },
  saveSkill(skill: SkillDef, create: boolean, project?: string): Promise<SkillDef> {
    return invoke<SkillDef>("save_skill", { skill, create, project });
  },
  getMetrics(project?: string): Promise<AgentMetrics[]> {
    return invoke<AgentMetrics[]>("get_metrics", { project });
  },
  getSessionTimeline(sessionId: string, agentId: string | null): Promise<TimelineEntry[]> {
    return invoke<TimelineEntry[]>("get_session_timeline", { sessionId, agentId });
  },
  listReplaySessions(): Promise<ReplaySessionMeta[]> {
    return invoke<ReplaySessionMeta[]>("list_replay_sessions");
  },
  getReplayData(sessionId: string): Promise<ReplayData> {
    return invoke<ReplayData>("get_replay_data", { sessionId });
  },
  focusTerminal(sessionId: string, project: string): Promise<FocusResult> {
    return invoke<FocusResult>("focus_terminal", { sessionId, project });
  },
};
