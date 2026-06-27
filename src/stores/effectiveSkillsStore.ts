import { create } from "zustand";
import { api } from "../ipc/commands";
import type { SkillDef } from "../bindings";

interface EffectiveSkillsState {
  /** project(cwd) -> all effective skills (scoped, before winner resolution). */
  byProject: Record<string, SkillDef[]>;
  /** Fetches and stores unfetched projects (already-fetched ones aren't refetched). */
  ensure: (projects: string[]) => Promise<void>;
  /** Refetches all known projects (after editing). */
  refresh: () => Promise<void>;
}

export const useEffectiveSkillsStore = create<EffectiveSkillsState>((set, get) => ({
  byProject: {},
  async ensure(projects) {
    const have = get().byProject;
    const missing = projects.filter((p) => !(p in have));
    if (missing.length === 0) return;
    const results = await Promise.all(
      missing.map((p) =>
        api
          .getEffectiveSkills(p)
          .then((s) => [p, s] as const)
          .catch(() => [p, [] as SkillDef[]] as const)
      )
    );
    const next = { ...get().byProject };
    for (const [p, s] of results) next[p] = s;
    set({ byProject: next });
  },
  async refresh() {
    const projects = Object.keys(get().byProject);
    const results = await Promise.all(
      projects.map((p) =>
        api
          .getEffectiveSkills(p)
          .then((s) => [p, s] as const)
          .catch(() => [p, [] as SkillDef[]] as const)
      )
    );
    const next: Record<string, SkillDef[]> = {};
    for (const [p, s] of results) next[p] = s;
    set({ byProject: next });
  },
}));
