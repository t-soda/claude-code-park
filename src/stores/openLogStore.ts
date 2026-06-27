import { create } from "zustand";
import type { TimelineEntry } from "../bindings";
import { api } from "../ipc/commands";

/** Log fetch target for the clicked character. agentId=null is the Orchestrator (main session). */
export type LogTarget = { sessionId: string; agentId: string | null; title: string };
/** A point in canvas-relative CSS px. */
export type Anchor = { x: number; y: number };

/** Screen-edge margin (px). */
const EDGE = 8;
/** Minimum space above the character (px) needed to open upward. Below this, open downward. */
const MIN_ABOVE = 160;
/** Upper bound on dialog height (as a fraction of the screen height). */
const MAX_HEIGHT_RATIO = 0.7;

/** Open upward (top-right) if there's enough space above the character. */
function opensAbove(anchor: Anchor): boolean {
  return anchor.y - EDGE >= MIN_ABOVE;
}

/**
 * Maximum dialog height (px). Fits within the space in the open direction, capped at a fraction of the screen height.
 * Used to constrain the height so the character-side corner always lands at the character's position, even for tall logs.
 * Applied to the CSS max-height before measuring the actual size.
 */
export function dialogMaxHeight(anchor: Anchor, viewport: { w: number; h: number }): number {
  const space = opensAbove(anchor) ? anchor.y - EDGE : viewport.h - anchor.y - EDGE;
  return Math.min(Math.round(viewport.h * MAX_HEIGHT_RATIO), space);
}

/**
 * Pure function computing the dialog placement (left/top) and the attach point for the connector line.
 * Opens at the character's top-right (when there's space above), with the character at the dialog's bottom-left corner.
 * If space above is tight, opens bottom-right, with the character at the top-left corner. In either case the line
 * connects to that corner = the character's position when opened. size.h is expected to be the actual size already constrained by dialogMaxHeight.
 */
export function dialogPlacement(
  anchor: Anchor,
  viewport: { w: number; h: number },
  size: { w: number; h: number }
): { left: number; top: number; attach: Anchor } {
  const left = clamp(anchor.x, EDGE, Math.max(EDGE, viewport.w - size.w - EDGE));
  // Opening up: align the bottom edge to the character y (top = y - h). Opening down: align the top edge to the character y.
  const top = opensAbove(anchor) ? anchor.y - size.h : anchor.y;
  const attach = { x: left, y: anchor.y }; // Character-side corner (bottom-left or top-left) = character position
  return { left, top, attach };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Whether the row comes from a tool execution (has tool_name). Used to decide whether to hide the tool-name tag when lifecycleView is OFF. */
export function isToolRow(entry: TimelineEntry): boolean {
  return entry.tool_name != null;
}

interface OpenLogState {
  target: LogTarget | null;
  anchor: Anchor | null;
  /** Line attach point computed after the dialog's actual size is determined (null until then). */
  dialogAnchor: Anchor | null;
  timeline: TimelineEntry[] | null; // null = loading
  loading: boolean;
  error: string | null;
  open: (target: LogTarget, anchor: Anchor) => void;
  close: () => void;
  setDialogAnchor: (p: Anchor) => void;
}

export const useOpenLogStore = create<OpenLogState>((set, get) => ({
  target: null,
  anchor: null,
  dialogAnchor: null,
  timeline: null,
  loading: false,
  error: null,
  open(target, anchor) {
    set({ target, anchor, dialogAnchor: null, timeline: null, loading: true, error: null });
    api
      .getSessionTimeline(target.sessionId, target.agentId)
      .then((timeline) => {
        // Discard if the target switched to another character while fetching (last open wins).
        if (get().target?.sessionId !== target.sessionId || get().target?.agentId !== target.agentId) return;
        set({ timeline, loading: false });
      })
      .catch((e) => {
        if (get().target?.sessionId !== target.sessionId || get().target?.agentId !== target.agentId) return;
        set({ error: String(e), loading: false, timeline: [] });
      });
  },
  close() {
    set({ target: null, anchor: null, dialogAnchor: null, timeline: null, loading: false, error: null });
  },
  setDialogAnchor(p) {
    set({ dialogAnchor: p });
  },
}));
