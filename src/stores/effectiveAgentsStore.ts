import { create } from "zustand";
import { api } from "../ipc/commands";
import type { AgentDef } from "../bindings";

interface EffectiveAgentsState {
  /** project(cwd) -> all effective agents (scoped, before winner resolution). */
  byProject: Record<string, AgentDef[]>;
  /** Fetches and stores unfetched projects (already-fetched ones aren't refetched). */
  ensure: (projects: string[]) => Promise<void>;
  /** Refetches all known projects (after editing). */
  refresh: () => Promise<void>;
}

export const useEffectiveAgentsStore = create<EffectiveAgentsState>((set, get) => ({
  byProject: {},
  async ensure(projects) {
    const have = get().byProject;
    const missing = projects.filter((p) => !(p in have));
    if (missing.length === 0) return;
    const results = await Promise.all(
      missing.map((p) =>
        api
          .getEffectiveAgents(p)
          .then((a) => [p, a] as const)
          .catch(() => [p, [] as AgentDef[]] as const)
      )
    );
    const next = { ...get().byProject };
    for (const [p, a] of results) next[p] = a;
    set({ byProject: next });
  },
  async refresh() {
    const projects = Object.keys(get().byProject);
    const results = await Promise.all(
      projects.map((p) =>
        api
          .getEffectiveAgents(p)
          .then((a) => [p, a] as const)
          .catch(() => [p, [] as AgentDef[]] as const)
      )
    );
    const next: Record<string, AgentDef[]> = {};
    for (const [p, a] of results) next[p] = a;
    set({ byProject: next });
  },
}));
