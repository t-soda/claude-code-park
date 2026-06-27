import { create } from "zustand";
import { api, type EffectiveHooks } from "../ipc/commands";

/** Returns the deduplicated non-empty project(cwd) values from a set of sessions (pure function). */
export function uniqueProjects(sessions: { project: string }[]): string[] {
  const set = new Set<string>();
  for (const s of sessions) if (s.project) set.add(s.project);
  return [...set];
}

interface EffectiveHooksState {
  /** project(cwd) -> effective hooks. */
  byProject: Record<string, EffectiveHooks>;
  /** Fetches and stores unfetched projects (already-fetched ones aren't refetched). */
  ensure: (projects: string[]) => Promise<void>;
  /** Refetches all known projects (on config change). */
  refresh: () => Promise<void>;
}

export const useEffectiveHooksStore = create<EffectiveHooksState>((set, get) => ({
  byProject: {},
  async ensure(projects) {
    const have = get().byProject;
    const missing = projects.filter((p) => !(p in have));
    if (missing.length === 0) return;
    const results = await Promise.all(
      missing.map((p) =>
        api
          .getEffectiveHooks(p)
          .then((eff) => [p, eff] as const)
          .catch(() => [p, {} as EffectiveHooks] as const)
      )
    );
    const next = { ...get().byProject };
    for (const [p, eff] of results) next[p] = eff;
    set({ byProject: next });
  },
  async refresh() {
    const projects = Object.keys(get().byProject);
    const results = await Promise.all(
      projects.map((p) =>
        api
          .getEffectiveHooks(p)
          .then((eff) => [p, eff] as const)
          .catch(() => [p, {} as EffectiveHooks] as const)
      )
    );
    const next: Record<string, EffectiveHooks> = {};
    for (const [p, eff] of results) next[p] = eff;
    set({ byProject: next });
  },
}));
