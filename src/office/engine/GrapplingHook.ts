import { Container, Graphics, Text } from "pixi.js";
import { t as tr } from "../../i18n";
import type { HookFlash } from "../../stores/hookStore";

export interface Pt {
  x: number;
  y: number;
}

/** Outbound flight time of a thrown hook (sec). */
export const FLY = 0.35;
/** Time for a released hook to fly back (sec). */
export const RETURN = 0.3;
/** How long a plain round-trip event keeps the hook latched (sec). */
export const HOLD_ROUND = 0.35;
/** Dwell cap for a pending (PreToolUse) hook before it gives up (sec). */
export const PENDING_TIMEOUT = 10;
export const PENDING_TIMEOUT_FADE = 1;
/** How long a blocked hook stays latched in red (sec). */
export const BLOCKED_TTL = 4;
/** Fade time of a snapped (cancelled) rope (sec). */
export const SNAP_TTL = 0.7;
/** Safety margin past a run's real duration before a latched run self-releases
 * (a paused/scrubbed replay never crosses the resolving event). */
export const RUN_HOLD_SLACK = 5;

const ROPE_COLOR = 0xc084fc;
const SUCCESS_COLOR = 0xffe08a;
const ERROR_COLOR = 0xff5a5a;
const BLOCKED_COLOR = 0xff5a5a;
const TIMEOUT_COLOR = 0xff6b3d;
const SNAP_COLOR = 0xff6b3d;
/** Max characters of a block reason shown beside the socket. */
const REASON_CHARS = 28;

/** Linear interpolation (0->1). */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Height of the throw arc for a given span (px). */
export function arcHeight(a: Pt, b: Pt): number {
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  return Math.min(48, Math.max(14, d * 0.28));
}

/** Position along the parabolic throw at k in [0,1] (peaks mid-flight). */
export function parabolaPoint(a: Pt, b: Pt, k: number, arc: number): Pt {
  return {
    x: lerp(a.x, b.x, k),
    y: lerp(a.y, b.y, k) - arc * Math.sin(Math.PI * k),
  };
}

/** Latch hold for a live reenactment of an already-finished run (sec).
 * Scaled from the real duration but kept snappy. */
export function reenactHold(durationMs: number): number {
  return Math.min(2.5, Math.max(0.6, (durationMs / 1000) * 0.3));
}

export type ThrowState =
  | "flying"
  | "latched"
  | "blocked"
  | "returning"
  | "snapped"
  | "timeout"
  | "done";

/** The timing facts of one throw. All times are seconds on the render clock. */
export interface ThrowTiming {
  startSec: number;
  /** Auto-release time (round trips, reenactments, run safety cap). null = stay latched. */
  holdUntil: number | null;
  /** Release began (success path). */
  resolvedSec: number | null;
  /** Turned red and stays latched (hook blocked its lifecycle). */
  blockedSec: number | null;
  /** Rope cut (user cancelled the hook). */
  snappedSec: number | null;
  /** Pending dwell cap (PreToolUse waiting for its Post). null = no timeout. */
  timeoutAt: number | null;
}

/** When the release animation started (explicit resolve or auto-release). */
export function releaseSec(tm: ThrowTiming): number | null {
  if (tm.resolvedSec != null) return tm.resolvedSec;
  return tm.holdUntil;
}

/** Current state of a throw. Terminal marks (snap/block/resolve) win over the
 * flight/dwell timeline; each fades out on its own TTL. */
export function throwState(tm: ThrowTiming, nowSec: number): ThrowState {
  if (tm.snappedSec != null) {
    return nowSec - tm.snappedSec <= SNAP_TTL ? "snapped" : "done";
  }
  if (tm.blockedSec != null) {
    return nowSec - tm.blockedSec <= BLOCKED_TTL ? "blocked" : "done";
  }
  if (tm.resolvedSec != null) {
    return nowSec - tm.resolvedSec <= RETURN ? "returning" : "done";
  }
  if (nowSec - tm.startSec <= FLY) return "flying";
  if (tm.holdUntil != null && nowSec > tm.holdUntil) {
    return nowSec - tm.holdUntil <= RETURN ? "returning" : "done";
  }
  if (tm.timeoutAt != null && nowSec > tm.timeoutAt) {
    return nowSec - tm.timeoutAt <= PENDING_TIMEOUT_FADE ? "timeout" : "done";
  }
  return "latched";
}

/** Key that pairs Pre/Post. Prefer the correlation ID; otherwise fall back to agentKey:tool. */
export function pairKey(correlationId: string | null, agentKey: string, tool: string | null): string {
  return correlationId ?? `${agentKey}:${tool ?? ""}`;
}

/** Index of the oldest unresolved throw in a pending queue (-1 if none). */
export function firstUnresolvedIndex(
  throws: readonly { resolvedSec: number | null; blockedSec: number | null; snappedSec: number | null }[]
): number {
  return throws.findIndex(
    (t) => t.resolvedSec == null && t.blockedSec == null && t.snappedSec == null
  );
}

/** Pulsing alpha while latched (0.55-1.0, ~1.2s period). */
export function latchPulse(nowSec: number): number {
  return 0.775 + 0.225 * Math.sin((nowSec * Math.PI * 2) / 1.2);
}

/** Char-boundary-safe excerpt for the reason label. */
export function reasonExcerpt(reason: string, chars = REASON_CHARS): string {
  const flat = reason.replace(/\s+/g, " ").trim();
  const cs = [...flat];
  return cs.length <= chars ? flat : cs.slice(0, chars).join("") + "…";
}

/** Overhead badge text for a firing. Recorded outcomes decorate the plain
 * "🪝 Event Tool" form: blocked ⛔, cancelled ✂️, completed runs show their
 * wall time (language-neutral, so no i18n catalog entry is needed). */
export function badgeLabel(flash: HookFlash): string {
  const mark =
    flash.outcome === "Blocked" ? "⛔" : flash.outcome === "Cancelled" ? "✂️" : "";
  const tool = flash.tool ? ` ${flash.tool}` : "";
  const dur =
    flash.outcome === "Completed" && flash.durationMs != null
      ? ` ✓${(flash.durationMs / 1000).toFixed(1)}s`
      : "";
  return `🪝${mark} ${flash.event}${tool}${dur}`;
}

interface Throw extends ThrowTiming {
  a: Pt;
  b: Pt;
  arc: number;
  isError: boolean | null;
  labelText: string | null;
  labelColor: number;
  label: Text | null;
}

function makeThrow(a: Pt, b: Pt, nowSec: number): Throw {
  return {
    a: { ...a },
    b: { ...b },
    arc: arcHeight(a, b),
    startSec: nowSec,
    holdUntil: null,
    resolvedSec: null,
    blockedSec: null,
    snappedSec: null,
    timeoutAt: null,
    isError: null,
    labelText: null,
    labelColor: TIMEOUT_COLOR,
    label: null,
  };
}

/** Never release/block/snap before the hook visually arrives at the socket. */
function afterArrival(tm: ThrowTiming, nowSec: number): number {
  return Math.max(nowSec, tm.startSec + FLY);
}

function durationLabel(durationMs: number): string {
  return `${(durationMs / 1000).toFixed(1)}s`;
}

/**
 * Grappling hooks thrown from characters onto the lifecycle rail's sockets.
 * A throw flies a parabola, latches onto the socket while its hook is running
 * (or its tool is in flight), then releases, blocks red, or snaps depending on
 * how the recorded execution ended. A single Graphics in scene(world) space.
 */
export class GrapplingHook extends Container {
  private g = new Graphics();
  /** Unkeyed throws: round trips, reenactments, standalone blocks/snaps. */
  private throws: Throw[] = [];
  /** Keyed FIFO queues for Pre/Post pairing. */
  private pending = new Map<string, Throw[]>();
  /** Keyed latches for recorded runs (replay Stop/SubagentStop hooks). */
  private runs = new Map<string, Throw>();

  constructor() {
    super();
    this.addChild(this.g);
  }

  /** Throw, latch briefly, release. For firings with no completion record. */
  throwRelease(a: Pt, b: Pt, nowSec: number) {
    const t = makeThrow(a, b, nowSec);
    t.holdUntil = nowSec + FLY + HOLD_ROUND;
    this.throws.push(t);
  }

  /** Reenact an already-finished run: latch scaled to the real duration, with a
   * duration label. Live mode only learns of a Stop-hook run when it completes. */
  throwReenact(a: Pt, b: Pt, nowSec: number, durationMs: number, isError: boolean | null) {
    const t = makeThrow(a, b, nowSec);
    t.holdUntil = nowSec + FLY + reenactHold(durationMs);
    t.isError = isError;
    if (durationMs > 0) {
      t.labelText = durationLabel(durationMs);
      t.labelColor = ROPE_COLOR;
    }
    this.throws.push(t);
  }

  /** Throw and latch red on arrival (a recorded block with no live throw to mark). */
  throwBlocked(a: Pt, b: Pt, nowSec: number, reason: string | null) {
    const t = makeThrow(a, b, nowSec);
    t.blockedSec = nowSec + FLY;
    this.setBlockLabel(t, reason);
    this.throws.push(t);
  }

  /** Throw and snap the rope on arrival (a cancelled hook with no live latch). */
  throwSnap(a: Pt, b: Pt, nowSec: number) {
    const t = makeThrow(a, b, nowSec);
    t.snappedSec = nowSec + FLY + 0.15;
    this.throws.push(t);
  }

  /** Register one pending throw (PreToolUse). The same key is pushed onto a FIFO
   * queue. a (character position) is frozen at throw time; a pending hook may
   * dwell up to PENDING_TIMEOUT seconds. */
  startPending(key: string, a: Pt, b: Pt, nowSec: number) {
    const t = makeThrow(a, b, nowSec);
    t.timeoutAt = nowSec + PENDING_TIMEOUT;
    const q = this.pending.get(key);
    if (q) q.push(t);
    else this.pending.set(key, [t]);
  }

  /** Release the matching pending throw (PostToolUse). Returns true if found. */
  resolvePending(key: string, isError: boolean | null, nowSec: number): boolean {
    const t = this.firstUnresolved(key);
    if (!t) return false;
    t.resolvedSec = afterArrival(t, nowSec);
    t.isError = isError;
    return true;
  }

  /** Turn the matching pending throw into a red latched block. Returns true if found. */
  blockPending(key: string, reason: string | null, nowSec: number): boolean {
    const t = this.firstUnresolved(key);
    if (!t) return false;
    t.blockedSec = afterArrival(t, nowSec);
    t.timeoutAt = null;
    this.setBlockLabel(t, reason);
    return true;
  }

  /** Latch a recorded run (replay HookRunStart). durationMs caps the latch so a
   * paused or scrubbed replay that never crosses the resolving event still lets go. */
  latchRun(key: string, a: Pt, b: Pt, nowSec: number, durationMs: number | null) {
    const t = makeThrow(a, b, nowSec);
    if (durationMs != null) {
      t.holdUntil = nowSec + FLY + durationMs / 1000 + RUN_HOLD_SLACK;
      t.labelText = durationLabel(durationMs);
      t.labelColor = ROPE_COLOR;
    }
    const prev = this.runs.get(key);
    if (prev) this.disposeLabel(prev);
    this.runs.set(key, t);
  }

  /** Release the latched run. Returns true if one was latched. */
  resolveRun(key: string, isError: boolean | null, nowSec: number): boolean {
    const t = this.runs.get(key);
    if (!t || t.resolvedSec != null || t.blockedSec != null || t.snappedSec != null) return false;
    t.resolvedSec = afterArrival(t, nowSec);
    t.isError = isError;
    return true;
  }

  /** Turn the latched run into a red block. Returns true if one was latched. */
  blockRun(key: string, reason: string | null, nowSec: number): boolean {
    const t = this.runs.get(key);
    if (!t || t.blockedSec != null || t.snappedSec != null) return false;
    t.resolvedSec = null;
    t.holdUntil = null;
    t.blockedSec = afterArrival(t, nowSec);
    this.setBlockLabel(t, reason);
    return true;
  }

  /** Snap the latched run's rope (user cancelled). Returns true if one was latched. */
  snapRun(key: string, nowSec: number): boolean {
    const t = this.runs.get(key);
    if (!t || t.blockedSec != null || t.snappedSec != null) return false;
    t.resolvedSec = null;
    t.holdUntil = null;
    t.snappedSec = afterArrival(t, nowSec);
    this.disposeLabel(t);
    t.labelText = null;
    return true;
  }

  private firstUnresolved(key: string): Throw | null {
    const q = this.pending.get(key);
    if (!q) return null;
    const i = firstUnresolvedIndex(q);
    return i < 0 ? null : q[i];
  }

  private setBlockLabel(t: Throw, reason: string | null) {
    this.disposeLabel(t);
    t.labelText = reason ? reasonExcerpt(reason) : tr("hookBeam.blocked");
    t.labelColor = BLOCKED_COLOR;
  }

  private ensureLabel(t: Throw, text: string, color: number) {
    if (t.label) {
      if (t.label.text !== text) t.label.text = text;
      return;
    }
    const label = new Text({ text, style: { fontSize: 10, fill: color } });
    label.anchor.set(0.5, 1);
    label.position.set(t.b.x, t.b.y - 10);
    this.addChild(label);
    t.label = label;
  }

  private disposeLabel(t: Throw) {
    if (!t.label) return;
    this.removeChild(t.label);
    t.label.destroy();
    t.label = null;
  }

  /** Per frame: draw all live throws and drop the finished ones. */
  update(nowSec: number) {
    this.g.clear();
    const draw = (t: Throw): boolean => {
      const state = throwState(t, nowSec);
      if (state === "done") {
        this.disposeLabel(t);
        return false;
      }
      this.drawThrow(t, state, nowSec);
      return true;
    };
    this.throws = this.throws.filter(draw);
    for (const [key, q] of [...this.pending]) {
      const alive = q.filter(draw);
      if (alive.length) this.pending.set(key, alive);
      else this.pending.delete(key);
    }
    for (const [key, t] of [...this.runs]) {
      if (!draw(t)) this.runs.delete(key);
    }
  }

  private drawThrow(t: Throw, state: ThrowState, nowSec: number) {
    switch (state) {
      case "flying": {
        const k = Math.min(1, (nowSec - t.startSec) / FLY);
        this.drawFlightRope(t, k);
        const head = parabolaPoint(t.a, t.b, k, t.arc);
        this.drawHookHead(head.x, head.y, ROPE_COLOR, 1);
        break;
      }
      case "latched": {
        const pulse = latchPulse(nowSec);
        this.drawSlackRope(t, nowSec, ROPE_COLOR, 0.55 * pulse);
        this.drawHookHead(t.b.x, t.b.y, ROPE_COLOR, 1);
        this.g.circle(t.b.x, t.b.y, 7 + pulse * 3).fill({ color: ROPE_COLOR, alpha: 0.18 * pulse });
        if (t.labelText) this.ensureLabel(t, t.labelText, t.labelColor);
        break;
      }
      case "blocked": {
        const age = nowSec - (t.blockedSec as number);
        const fade = Math.min(1, (BLOCKED_TTL - age) / 0.6);
        this.drawSlackRope(t, nowSec, BLOCKED_COLOR, 0.7 * fade);
        this.drawHookHead(t.b.x, t.b.y, BLOCKED_COLOR, fade);
        this.drawBlockCross(t.b.x, t.b.y - 10, fade);
        if (t.labelText) this.ensureLabel(t, t.labelText, t.labelColor);
        break;
      }
      case "timeout": {
        const fade = 1 - (nowSec - (t.timeoutAt as number)) / PENDING_TIMEOUT_FADE;
        this.drawSlackRope(t, nowSec, TIMEOUT_COLOR, 0.4 * fade);
        this.drawHookHead(t.b.x, t.b.y, TIMEOUT_COLOR, fade);
        this.ensureLabel(t, tr("hookBeam.noResponse"), TIMEOUT_COLOR);
        break;
      }
      case "returning": {
        this.disposeLabel(t);
        const rel = releaseSec(t) as number;
        const k = Math.min(1, (nowSec - rel) / RETURN);
        const fade = 1 - k;
        const color = t.isError ? ERROR_COLOR : SUCCESS_COLOR;
        const head = { x: lerp(t.b.x, t.a.x, k), y: lerp(t.b.y, t.a.y, k) };
        this.g
          .moveTo(t.b.x, t.b.y)
          .lineTo(head.x, head.y)
          .stroke({ width: 2, color, alpha: 0.5 * fade });
        this.drawHookHead(head.x, head.y, color, fade);
        break;
      }
      case "snapped": {
        const age = nowSec - (t.snappedSec as number);
        const fade = 1 - age / SNAP_TTL;
        const drop = age * 26;
        // Two dangling stubs: one hanging off the thrower, one falling from the socket.
        const midA = { x: lerp(t.a.x, t.b.x, 0.3), y: lerp(t.a.y, t.b.y, 0.3) + 8 + drop * 0.4 };
        this.g
          .moveTo(t.a.x, t.a.y)
          .quadraticCurveTo(t.a.x, t.a.y + 12, midA.x, midA.y)
          .stroke({ width: 2, color: SNAP_COLOR, alpha: 0.5 * fade });
        this.g
          .moveTo(t.b.x, t.b.y + drop)
          .lineTo(lerp(t.b.x, t.a.x, 0.18), t.b.y + 10 + drop)
          .stroke({ width: 2, color: SNAP_COLOR, alpha: 0.5 * fade });
        this.drawHookHead(t.b.x, t.b.y + drop, SNAP_COLOR, fade);
        break;
      }
      case "done":
        break;
    }
  }

  /** Rope laid along the flight parabola from the thrower to the current head. */
  private drawFlightRope(t: Throw, k: number) {
    const steps = 12;
    this.g.moveTo(t.a.x, t.a.y);
    for (let i = 1; i <= steps; i++) {
      const p = parabolaPoint(t.a, t.b, (k * i) / steps, t.arc);
      this.g.lineTo(p.x, p.y);
    }
    this.g.stroke({ width: 2, color: ROPE_COLOR, alpha: 0.6 });
  }

  /** Slack rope hanging between the thrower and the latched hook, gently swaying. */
  private drawSlackRope(t: Throw, nowSec: number, color: number, alpha: number) {
    const midX = (t.a.x + t.b.x) / 2 + Math.sin(nowSec * 2.2) * 2;
    const midY = (t.a.y + t.b.y) / 2 + t.arc * 0.35 + Math.sin(nowSec * 1.7) * 1.5;
    this.g
      .moveTo(t.a.x, t.a.y)
      .quadraticCurveTo(midX, midY, t.b.x, t.b.y)
      .stroke({ width: 2, color, alpha });
  }

  /** A tiny grappling hook: rope eye + J-shaped fluke hanging below the head. */
  private drawHookHead(x: number, y: number, color: number, alpha: number) {
    this.g.circle(x, y - 2, 1.6).fill({ color, alpha });
    this.g
      .moveTo(x, y - 2)
      .lineTo(x, y + 2)
      .stroke({ width: 2, color, alpha });
    this.g
      .arc(x, y + 3, 3.4, -Math.PI * 0.15, Math.PI * 0.85)
      .stroke({ width: 2, color, alpha });
  }

  /** Small red cross above a blocked socket. */
  private drawBlockCross(x: number, y: number, alpha: number) {
    const r = 3;
    this.g
      .moveTo(x - r, y - r)
      .lineTo(x + r, y + r)
      .moveTo(x + r, y - r)
      .lineTo(x - r, y + r)
      .stroke({ width: 2, color: BLOCKED_COLOR, alpha });
  }
}
