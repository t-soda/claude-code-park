import { create } from "zustand";
import type { HookEvent, HookOutcome } from "../bindings";
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
  /** How the recorded hook execution ended (null for reconstructed firings). */
  outcome: HookOutcome | null;
  /** Wall time of the recorded hook run (ms). */
  durationMs: number | null;
  /** The hook command behind the record. */
  hookCommand: string | null;
  /** Why the hook blocked. */
  blockReason: string | null;
  /** "run-start" marks the replay-synthesized start of a recorded hook run
   * (the hook latches here and releases on the matching outcome flash). */
  phase: "fire" | "run-start";
};

/** HookFlash from a live pipeline event. */
export function flashFrom(e: HookEvent, firedAt: number): HookFlash {
  return {
    event: e.event,
    tool: e.tool_name,
    firedAt,
    correlationId: e.correlation_id,
    isError: e.is_error,
    outcome: e.outcome,
    durationMs: e.duration_ms,
    hookCommand: e.hook_command,
    blockReason: e.block_reason,
    phase: "fire",
  };
}

/** How close a bare duplicate must be to a rich flash to be swallowed (ms). */
const MERGE_WINDOW_MS = 1_500;

/**
 * Keeps a rich flash (recorded execution) over a bare same-event duplicate.
 * A turn boundary writes turn_duration and stop_hook_summary at the same
 * instant, both reconstructing to Stop; whichever order they arrive, the one
 * carrying the execution record must win the per-actor slot.
 */
export function mergeFlash(prev: HookFlash | undefined, next: HookFlash): HookFlash {
  if (
    prev &&
    prev.event === next.event &&
    prev.outcome !== null &&
    next.outcome === null &&
    next.phase === "fire" &&
    next.firedAt - prev.firedAt <= MERGE_WINDOW_MS
  ) {
    return prev;
  }
  return next;
}

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
      next[key] = mergeFlash(next[key], flashFrom(e, now));
      set({ flashes: next });
    });
  },
}));
