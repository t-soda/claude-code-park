import { create } from "zustand";
import type { AgentDef, Session } from "../bindings";
import { api } from "../ipc/commands";
import { onSessionsUpdated } from "../ipc/events";

interface WorldState {
  sessions: Session[];
  agents: AgentDef[];
  loaded: boolean;
  /** On startup, fetch the initial state from Rust and start subscribing to diff events. */
  start: () => Promise<void>;
}

/**
 * Rendering source for the overhead office view. Listens to state://sessions/updated emitted by
 * the Rust watcher and replaces sessions (Rust is the single source of truth).
 */
export const useWorldStore = create<WorldState>((set) => ({
  sessions: [],
  agents: [],
  loaded: false,
  async start() {
    // Subscribe first, then fetch the initial state (to avoid missing updates).
    await onSessionsUpdated((sessions) => set({ sessions }));
    const initial = await api.getInitialState();
    set({
      sessions: initial.sessions,
      agents: initial.agents,
      loaded: true,
    });
  },
}));
