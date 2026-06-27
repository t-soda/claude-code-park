import type { ScopedHook } from "../bindings";
import type { EffectiveHooks } from "../ipc/commands";

/** Hook firing timings (fixed order for learning). This is the slot ordering itself. */
export const LIFECYCLE_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PermissionRequest",
  "PostToolUse",
  "Notification",
  "PreCompact",
  "Stop",
  "SubagentStop",
] as const;

/** Display unit for one slot (one timing). hooks may be an empty array. */
export interface SlotGroup {
  event: string;
  index: number;
  hooks: ScopedHook[];
}

/** Event name -> slot index (-1 if unknown). */
export function eventToSlotIndex(event: string): number {
  return (LIFECYCLE_EVENTS as readonly string[]).indexOf(event);
}

/**
 * Whether the matcher (regex) matches toolName.
 * - An empty matcher matches everything.
 * - A null toolName (non-tool event = Stop, etc.) returns true regardless of matcher.
 * - An invalid regex returns false.
 */
export function matchesTool(matcher: string | null, toolName: string | null): boolean {
  if (!matcher) return true;
  if (toolName == null) return true;
  try {
    return new RegExp(matcher).test(toolName);
  } catch {
    return false;
  }
}

/** Aligns effective hooks into 9 slots (always includes empty timings = a teaching reference). */
export function groupBySlot(effective: EffectiveHooks): SlotGroup[] {
  return LIFECYCLE_EVENTS.map((event, index) => ({
    event,
    index,
    hooks: effective[event] ?? [],
  }));
}

/** Returns only the slot's registered hooks that match the fired tool. */
export function matchingHooks(group: SlotGroup, toolName: string | null): ScopedHook[] {
  return group.hooks.filter((h) => matchesTool(h.matcher, toolName));
}
