import { create } from "zustand";
import type { AgentMetrics } from "../bindings";
import { api } from "../ipc/commands";

export interface ScopedMetricsSlice {
  metrics: AgentMetrics[];
  loading: boolean;
  loaded: boolean;
  error: string | null;
}

const EMPTY: ScopedMetricsSlice = { metrics: [], loading: false, loaded: false, error: null };

interface ScopedMetricsState {
  byProject: Record<string, ScopedMetricsSlice>;
  load: (project: string) => Promise<void>;
  ensureLoaded: (project: string) => Promise<void>;
}

/** In-flight fetches (collapse duplicate calls per project). */
const inFlight = new Map<string, Promise<void>>();

export const useScopedMetricsStore = create<ScopedMetricsState>((set, get) => {
  const patch = (project: string, p: Partial<ScopedMetricsSlice>) => {
    const cur = get().byProject[project] ?? EMPTY;
    set({ byProject: { ...get().byProject, [project]: { ...cur, ...p } } });
  };
  return {
    byProject: {},
    load(project) {
      const running = inFlight.get(project);
      if (running) return running;
      patch(project, { loading: true, error: null });
      const p = (async () => {
        try {
          patch(project, { metrics: await api.getMetrics(project), loading: false, loaded: true });
        } catch (e) {
          patch(project, { loading: false, error: String(e) });
        } finally {
          inFlight.delete(project);
        }
      })();
      inFlight.set(project, p);
      return p;
    },
    ensureLoaded(project) {
      if (get().byProject[project]?.loaded) return Promise.resolve();
      return get().load(project);
    },
  };
});
