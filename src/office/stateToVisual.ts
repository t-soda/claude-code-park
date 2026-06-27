import type { WorkKind } from "../bindings";
import { t, type MessageKey } from "../i18n";

export interface Visual {
  /** Bubble / status color */
  color: number;
  /** Label (with emoji; resolved in the current locale). */
  label: string;
}

/** WorkKind -> status color. Labels are resolved dynamically via i18n (activityBubble.*). */
export const STATE_COLORS: Record<WorkKind, number> = {
  Idle: 0x6b7280,
  Thinking: 0xa78bfa,
  Reading: 0x60a5fa,
  Editing: 0x34d399,
  Running: 0xf0883e,
  Searching: 0x22d3ee,
  Reviewing: 0xf472b6,
  Delegating: 0xfacc15,
  WebExploring: 0x38bdf8,
  AwaitingUser: 0xef4444,
};

export function visualFor(kind: WorkKind): Visual {
  const k: WorkKind = kind in STATE_COLORS ? kind : "Idle";
  return { color: STATE_COLORS[k], label: t(`activityBubble.${k}` as MessageKey) };
}
