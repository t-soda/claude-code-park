import { create } from "zustand";
import type { AgentDef, CommandDef, SkillDef } from "../bindings";
import { api, type HooksMap } from "../ipc/commands";
import { onConfigChanged } from "../ipc/events";

interface ConfigState {
  agents: AgentDef[];
  hooks: HooksMap;
  skills: SkillDef[];
  commands: CommandDef[];
  loaded: boolean;
  error: string | null;
  /** Loads all config from Rust. */
  loadAll: () => Promise<void>;
  /** Starts subscribing to change events from the CLI side. */
  watch: () => Promise<void>;
  // --- Editing (write to the actual files, then reload on success) ---
  saveAgent: (agent: AgentDef, create: boolean) => Promise<void>;
  deleteAgent: (name: string) => Promise<void>;
  toggleSkill: (name: string, disable: boolean) => Promise<void>;
  saveSkill: (skill: SkillDef, create: boolean) => Promise<void>;
  updateHooks: (hooks: HooksMap) => Promise<void>;
}

/**
 * Editable data for Hooks / Skills / Agents / Commands.
 * Claude Code's actual data is the single source of truth. Edits always reload after writing.
 */
export const useConfigStore = create<ConfigState>((set, get) => ({
  agents: [],
  hooks: {},
  skills: [],
  commands: [],
  loaded: false,
  error: null,

  async loadAll() {
    try {
      const [agents, hooks, skills, commands] = await Promise.all([
        api.listAgents(),
        api.getHooks(),
        api.listSkills(),
        api.listCommands(),
      ]);
      set({ agents, hooks, skills, commands, loaded: true, error: null });
    } catch (e) {
      set({ error: String(e), loaded: true });
    }
  },

  async watch() {
    // Reload when config changes on the CLI side (the GUI <- CLI direction of two-way sync).
    await onConfigChanged(() => get().loadAll());
  },

  // After editing, refetch only the changed resource (don't reload all 4 kinds).
  async saveAgent(agent, create) {
    await api.saveAgent(agent, create);
    set({ agents: await api.listAgents() });
  },
  async deleteAgent(name) {
    await api.deleteAgent(name);
    set({ agents: await api.listAgents() });
  },
  async toggleSkill(name, disable) {
    set({ skills: await api.toggleSkill(name, disable) }); // command returns the updated list
  },
  async saveSkill(skill, create) {
    await api.saveSkill(skill, create);
    set({ skills: await api.listSkills() });
  },
  async updateHooks(hooks) {
    set({ hooks: await api.updateHooks(hooks) }); // command returns the updated hooks
  },
}));
