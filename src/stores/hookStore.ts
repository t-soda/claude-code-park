import { create } from "zustand";
import type { HookEvent } from "../bindings";
import { onLifecycleFired } from "../ipc/events";

/** A fire flash shown above a character for a limited time. */
export type HookFlash = {
  event: string;
  tool: string | null;
  firedAt: number; // milliseconds from Date.now()
  /** tool_use correlation ID for Pre/Post pairing. */
  correlationId: string | null;
  /** Whether PostToolUse failed (success false / failure true / not applicable null). */
  isError: boolean | null;
};

/** Returns a new Record with flashes past their TTL removed (pure function). */
export function pruneEvents(
  flashes: Record<string, HookFlash>,
  now: number,
  ttlMs: number
): Record<string, HookFlash> {
  const out: Record<string, HookFlash> = {};
  for (const [key, f] of Object.entries(flashes)) {
    if (now - f.firedAt <= ttlMs) out[key] = f;
  }
  return out;
}

/** How long to keep a badge. Slightly long to account for watcher->IPC latency. */
const FLASH_TTL_MS = 3_000;

type HookState = {
  flashes: Record<string, HookFlash>;
  start(): Promise<void>;
};

let started = false;

export const useHookStore = create<HookState>((set, get) => ({
  flashes: {},
  async start() {
    if (started) return;
    started = true;
    await onLifecycleFired((e: HookEvent) => {
      const key = e.agent_id ?? e.session_id;
      const now = Date.now();
      const next = pruneEvents(get().flashes, now, FLASH_TTL_MS);
      next[key] = {
        event: e.event,
        tool: e.tool_name,
        firedAt: now,
        correlationId: e.correlation_id,
        isError: e.is_error,
      };
      set({ flashes: next });
    });
  },
}));
