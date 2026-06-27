import { create } from "zustand";
import type { AgentMetrics } from "../bindings";
import { api } from "../ipc/commands";

interface MetricsState {
  metrics: AgentMetrics[];
  loading: boolean;
  /** Whether a fetch has ever succeeded. Used for skeleton detection and cache reuse. */
  loaded: boolean;
  error: string | null;
  /** Forced fetch (for the refresh button). Concurrent calls while fetching collapse into one. */
  load: () => Promise<void>;
  /** Fetch only when not yet loaded (for a tab's first mount; reopening shows immediately). */
  ensureLoaded: () => Promise<void>;
}

/** In-flight fetch (for collapsing duplicate calls). */
let inFlight: Promise<void> | null = null;

/** Per-employee aggregates such as utilization and call counts. Fetched from Rust on demand. */
export const useMetricsStore = create<MetricsState>((set, get) => ({
  metrics: [],
  loading: false,
  loaded: false,
  error: null,
  load() {
    // Concurrent calls while fetching collapse into the same Promise.
    // Keep the existing metrics during a refetch so nothing goes blank or freezes.
    if (inFlight) return inFlight;
    set({ loading: true, error: null });
    inFlight = (async () => {
      try {
        set({ metrics: await api.getMetrics(), loading: false, loaded: true });
      } catch (e) {
        set({ error: String(e), loading: false });
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  },
  ensureLoaded() {
    // Don't refetch if already loaded (makes reopening instant = no full scan every time).
    if (get().loaded) return Promise.resolve();
    if (inFlight) return inFlight;
    return get().load();
  },
}));
