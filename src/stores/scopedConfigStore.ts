import { create } from "zustand";
import type { AgentDef, CommandDef, SkillDef } from "../bindings";
import { api, type HooksMap } from "../ipc/commands";
import { onConfigChanged } from "../ipc/events";

export interface ScopedConfigSlice {
  agents: AgentDef[];
  hooks: HooksMap;
  skills: SkillDef[];
  commands: CommandDef[];
  loaded: boolean;
  error: string | null;
}

const EMPTY: ScopedConfigSlice = {
  agents: [],
  hooks: {},
  skills: [],
  commands: [],
  loaded: false,
  error: null,
};

interface ScopedConfigState {
  byProject: Record<string, ScopedConfigSlice>;
  ensure: (project: string) => Promise<void>;
  /** Force-refetches a project's config, bypassing the loaded cache (e.g. when a panel reopens). */
  reload: (project: string) => Promise<void>;
  /** Subscribes once to CLI-side config changes and refetches all loaded projects. */
  watch: () => Promise<void>;
  saveAgent: (project: string, agent: AgentDef, create: boolean) => Promise<void>;
  deleteAgent: (project: string, name: string) => Promise<void>;
  toggleSkill: (project: string, name: string, disable: boolean) => Promise<void>;
  saveSkill: (project: string, skill: SkillDef, create: boolean) => Promise<void>;
  updateHooks: (project: string, hooks: HooksMap) => Promise<void>;
}

/** In-flight fetches (collapse duplicate calls per project). */
const inFlight = new Map<string, Promise<void>>();

/** Guard so the config-change subscription is registered only once. */
let watching = false;

export const useScopedConfigStore = create<ScopedConfigState>((set, get) => {
  const patch = (project: string, p: Partial<ScopedConfigSlice>) => {
    const cur = get().byProject[project] ?? EMPTY;
    set({ byProject: { ...get().byProject, [project]: { ...cur, ...p } } });
  };
  const fetchInto = (project: string): Promise<void> => {
    const running = inFlight.get(project);
    if (running) return running;
    const p = (async () => {
      try {
        const [agents, hooks, skills, commands] = await Promise.all([
          api.listAgents(project),
          api.getHooks(project),
          api.listSkills(project),
          api.listCommands(project),
        ]);
        patch(project, { agents, hooks, skills, commands, loaded: true, error: null });
      } catch (e) {
        patch(project, { loaded: true, error: String(e) });
      } finally {
        inFlight.delete(project);
      }
    })();
    inFlight.set(project, p);
    return p;
  };
  return {
    byProject: {},
    ensure(project) {
      if (get().byProject[project]?.loaded) return Promise.resolve();
      return fetchInto(project);
    },
    reload(project) {
      return fetchInto(project);
    },
    async watch() {
      if (watching) return;
      watching = true;
      // Refetch every project we've already loaded when the CLI side changes config.
      await onConfigChanged(() => {
        for (const project of Object.keys(get().byProject)) void fetchInto(project);
      });
    },
    async saveAgent(project, agent, create) {
      await api.saveAgent(agent, create, project);
      patch(project, { agents: await api.listAgents(project) });
    },
    async deleteAgent(project, name) {
      await api.deleteAgent(name, project);
      patch(project, { agents: await api.listAgents(project) });
    },
    async toggleSkill(project, name, disable) {
      patch(project, { skills: await api.toggleSkill(name, disable, project) });
    },
    async saveSkill(project, skill, create) {
      await api.saveSkill(skill, create, project);
      patch(project, { skills: await api.listSkills(project) });
    },
    async updateHooks(project, hooks) {
      patch(project, { hooks: await api.updateHooks(hooks, project) });
    },
  };
});
