import { create } from "zustand";
import type { AgentDef, CommandDef, SkillDef } from "../bindings";
import { api, type HooksMap } from "../ipc/commands";

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
  saveAgent: (project: string, agent: AgentDef, create: boolean) => Promise<void>;
  deleteAgent: (project: string, name: string) => Promise<void>;
  toggleSkill: (project: string, name: string, disable: boolean) => Promise<void>;
  saveSkill: (project: string, skill: SkillDef, create: boolean) => Promise<void>;
  updateHooks: (project: string, hooks: HooksMap) => Promise<void>;
}

/** In-flight fetches (collapse duplicate calls per project). */
const inFlight = new Map<string, Promise<void>>();

export const useScopedConfigStore = create<ScopedConfigState>((set, get) => {
  const patch = (project: string, p: Partial<ScopedConfigSlice>) => {
    const cur = get().byProject[project] ?? EMPTY;
    set({ byProject: { ...get().byProject, [project]: { ...cur, ...p } } });
  };
  return {
    byProject: {},
    ensure(project) {
      if (get().byProject[project]?.loaded) return Promise.resolve();
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
