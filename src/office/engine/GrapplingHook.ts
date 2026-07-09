import { Container, Graphics, Text } from "pixi.js";
import { t as tr } from "../../i18n";
import type { HookFlash } from "../../stores/hookStore";

export interface Pt {
  x: number;
  y: number;
}

/** Live anchor: the current world position of a rope end, or null when the
 * target is gone (the throw then keeps its last known position). Anchors are
 * re-read every frame so ropes follow moving characters and a rail that
 * re-centers when the room resizes. */
export type Anchor = () => Pt | null;

/** Outbound flight time of a thrown hook (sec). */
export const FLY = 0.35;
/** Time to reel a released hook back in (sec). */
export const REEL = 0.4;
/** How long a plain round-trip event keeps the hook latched (sec). */
export const HOLD_ROUND = 0.35;
/** Dwell cap for a pending (PreToolUse) hook before it reels back in (sec). */
export const PENDING_TIMEOUT = 10;
/** How long the "no response" label lingers at the socket after the reel-in (sec). */
export const TIMEOUT_LABEL_TTL = 1.2;
/** How long a blocked hook stays latched in red (sec). */
export const BLOCKED_TTL = 4;
/** Fade time of a snapped (cancelled) rope (sec). */
export const SNAP_TTL = 0.7;
/** Seconds for a taut rope to pull straight after latching/blocking. */
export const TAUT_RAMP = 0.5;
/** Safety margin past a run's real duration before a latched run self-releases
 * (a paused/scrubbed replay never crosses the resolving event). */
export const RUN_HOLD_SLACK = 5;

const ROPE_COLOR = 0xc084fc;
const SUCCESS_COLOR = 0xffe08a;
const ERROR_COLOR = 0xff5a5a;
const BLOCKED_COLOR = 0xff5a5a;
/** Neutral reel-in (timeout): deliberately not an error color. */
const NEUTRAL_COLOR = 0x9aa4b2;
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

/** How taut the rope is (0 slack -> 1 straight) since it started pulling. */
export function tautness(tautSince: number | null, nowSec: number): number {
  if (tautSince == null) return 0;
  return Math.min(1, Math.max(0, (nowSec - tautSince) / TAUT_RAMP));
}

export type ThrowState =
  | "flying"
  | "latched"
  | "blocked"
  | "reeling"
  | "snapped"
  | "done";

/** Why a hook is being reeled back in (drives the reel color). */
export type ReelCause = "resolved" | "auto" | "timeout";

/** The timing facts of one throw. All times are seconds on the render clock. */
export interface ThrowTiming {
  startSec: number;
  /** Auto-reel time (round trips, reenactments, run safety cap). null = stay latched. */
  holdUntil: number | null;
  /** Reel-in began (explicit resolution). */
  resolvedSec: number | null;
  /** Turned red and stays latched (hook blocked its lifecycle). */
  blockedSec: number | null;
  /** Rope cut (user cancelled the hook). */
  snappedSec: number | null;
  /** Pending dwell cap (PreToolUse waiting for its Post). null = no timeout. */
  timeoutAt: number | null;
}

/** When the reel-in started, and why. null while still latched/flying. */
export function reelStart(tm: ThrowTiming, nowSec: number): { at: number; cause: ReelCause } | null {
  if (tm.resolvedSec != null) return { at: tm.resolvedSec, cause: "resolved" };
  if (tm.holdUntil != null && nowSec > tm.holdUntil) return { at: tm.holdUntil, cause: "auto" };
  if (tm.timeoutAt != null && nowSec > tm.timeoutAt) return { at: tm.timeoutAt, cause: "timeout" };
  return null;
}

/** Current state of a throw. Terminal marks (snap/block) win over the
 * flight/dwell timeline; each fades out on its own TTL. */
export function throwState(tm: ThrowTiming, nowSec: number): ThrowState {
  if (tm.snappedSec != null) {
    return nowSec - tm.snappedSec <= SNAP_TTL ? "snapped" : "done";
  }
  if (tm.blockedSec != null) {
    return nowSec - tm.blockedSec <= BLOCKED_TTL ? "blocked" : "done";
  }
  const reel = reelStart(tm, nowSec);
  if (reel) {
    const ttl = reel.cause === "timeout" ? REEL + TIMEOUT_LABEL_TTL : REEL;
    return nowSec - reel.at <= ttl ? "reeling" : "done";
  }
  if (nowSec - tm.startSec <= FLY) return "flying";
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
  /** Rope origin: the rail socket the hook launched from. */
  from: Pt;
  /** Rope target: the character the hook grips. */
  to: Pt;
  fromAnchor: Anchor;
  toAnchor: Anchor;
  arc: number;
  /** When the rope started pulling straight (run latches, blocks). null = stays slack. */
  tautSince: number | null;
  isError: boolean | null;
  labelText: string | null;
  labelColor: number;
  label: Text | null;
}

function resolveAnchor(anchor: Anchor): Pt {
  return anchor() ?? { x: 0, y: 0 };
}

function makeThrow(from: Anchor, to: Anchor, nowSec: number): Throw {
  const a = resolveAnchor(from);
  const b = resolveAnchor(to);
  return {
    from: a,
    to: b,
    fromAnchor: from,
    toAnchor: to,
    arc: arcHeight(a, b),
    startSec: nowSec,
    holdUntil: null,
    resolvedSec: null,
    blockedSec: null,
    snappedSec: null,
    timeoutAt: null,
    tautSince: null,
    isError: null,
    labelText: null,
    labelColor: NEUTRAL_COLOR,
    label: null,
  };
}

/** Never release/block/snap before the hook visually reaches the character. */
function afterArrival(tm: ThrowTiming, nowSec: number): number {
  return Math.max(nowSec, tm.startSec + FLY);
}

function durationLabel(durationMs: number): string {
  return `${(durationMs / 1000).toFixed(1)}s`;
}

/**
 * Grappling hooks launched from the lifecycle rail's sockets onto characters:
 * the registered hook is the thrower, and the agent is what it catches. A
 * throw flies a parabola, grips the character while something is genuinely
 * happening — slack rope while the tool merely runs, pulled taut while a hook
 * holds the agent — then reels back in, blocks red, or snaps depending on how
 * the recorded execution ended. A single Graphics in scene(world) space.
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

  /** Throw, grip briefly, reel back in. For firings with no completion record. */
  throwRelease(from: Anchor, to: Anchor, nowSec: number) {
    const t = makeThrow(from, to, nowSec);
    t.holdUntil = nowSec + FLY + HOLD_ROUND;
    this.throws.push(t);
  }

  /** Reenact an already-finished run: grip taut scaled to the real duration,
   * with a duration label. Live mode only learns of a Stop-hook run when it
   * completes. */
  throwReenact(from: Anchor, to: Anchor, nowSec: number, durationMs: number, isError: boolean | null) {
    const t = makeThrow(from, to, nowSec);
    t.holdUntil = nowSec + FLY + reenactHold(durationMs);
    t.tautSince = nowSec + FLY;
    t.isError = isError;
    if (durationMs > 0) {
      t.labelText = durationLabel(durationMs);
      t.labelColor = ROPE_COLOR;
    }
    this.throws.push(t);
  }

  /** Throw and grip red on arrival (a recorded block with no live throw to mark). */
  throwBlocked(from: Anchor, to: Anchor, nowSec: number, reason: string | null) {
    const t = makeThrow(from, to, nowSec);
    t.blockedSec = nowSec + FLY;
    t.tautSince = nowSec + FLY;
    this.setBlockLabel(t, reason);
    this.throws.push(t);
  }

  /** Throw and snap the rope on arrival (a cancelled hook with no live latch). */
  throwSnap(from: Anchor, to: Anchor, nowSec: number) {
    const t = makeThrow(from, to, nowSec);
    t.snappedSec = nowSec + FLY + 0.15;
    this.throws.push(t);
  }

  /** Register one pending throw (PreToolUse): the hook grips the character
   * with a slack rope while the tool runs. The same key is pushed onto a FIFO
   * queue; a pending hook waits up to PENDING_TIMEOUT seconds for its Post. */
  startPending(key: string, from: Anchor, to: Anchor, nowSec: number) {
    const t = makeThrow(from, to, nowSec);
    t.timeoutAt = nowSec + PENDING_TIMEOUT;
    const q = this.pending.get(key);
    if (q) q.push(t);
    else this.pending.set(key, [t]);
  }

  /** Reel in the matching pending throw (PostToolUse). Returns true if found. */
  resolvePending(key: string, isError: boolean | null, nowSec: number): boolean {
    const t = this.firstUnresolved(key);
    if (!t) return false;
    t.resolvedSec = afterArrival(t, nowSec);
    t.isError = isError;
    return true;
  }

  /** Pull the matching pending throw taut and red (the hook holds the agent). */
  blockPending(key: string, reason: string | null, nowSec: number): boolean {
    const t = this.firstUnresolved(key);
    if (!t) return false;
    t.blockedSec = afterArrival(t, nowSec);
    t.tautSince = t.blockedSec;
    t.timeoutAt = null;
    this.setBlockLabel(t, reason);
    return true;
  }

  /** Grip a recorded run (replay HookRunStart): the rope pulls taut — the agent
   * is genuinely waiting on this hook. durationMs caps the latch so a paused or
   * scrubbed replay that never crosses the resolving event still lets go. */
  latchRun(key: string, from: Anchor, to: Anchor, nowSec: number, durationMs: number | null) {
    const t = makeThrow(from, to, nowSec);
    t.tautSince = nowSec + FLY;
    if (durationMs != null) {
      t.holdUntil = nowSec + FLY + durationMs / 1000 + RUN_HOLD_SLACK;
      t.labelText = durationLabel(durationMs);
      t.labelColor = ROPE_COLOR;
    }
    const prev = this.runs.get(key);
    if (prev) this.disposeLabel(prev);
    this.runs.set(key, t);
  }

  /** Reel in the latched run. Returns true if one was latched. */
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
    t.tautSince = t.tautSince ?? t.blockedSec;
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
      t.label.position.set(t.from.x, t.from.y - 12);
      return;
    }
    const label = new Text({ text, style: { fontSize: 10, fill: color } });
    label.anchor.set(0.5, 1);
    label.position.set(t.from.x, t.from.y - 12);
    this.addChild(label);
    t.label = label;
  }

  private disposeLabel(t: Throw) {
    if (!t.label) return;
    this.removeChild(t.label);
    t.label.destroy();
    t.label = null;
  }

  /** Per frame: track anchors, draw all live throws, drop the finished ones. */
  update(nowSec: number) {
    this.g.clear();
    const draw = (t: Throw): boolean => {
      const state = throwState(t, nowSec);
      if (state === "done") {
        this.disposeLabel(t);
        return false;
      }
      // Follow moving ends: characters walk, and the rail re-centers when the
      // room resizes. A vanished anchor keeps the last known point.
      const f = t.fromAnchor();
      if (f) t.from = f;
      const g = t.toAnchor();
      if (g) t.to = g;
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
        const head = parabolaPoint(t.from, t.to, k, t.arc);
        // Rope trailing the hook: sags behind the flight and ripples a little.
        const slack = t.arc * 0.5 * (1 - k) + Math.sin(nowSec * 9) * 2 * (1 - k);
        this.drawRope(t.from, head, slack, ROPE_COLOR, 0.6, nowSec);
        this.drawHookHead(head.x, head.y, ROPE_COLOR, 1);
        break;
      }
      case "latched": {
        const pulse = latchPulse(nowSec);
        const taut = tautness(t.tautSince, nowSec);
        const slack = t.arc * 0.4 * (1 - taut);
        const color = ROPE_COLOR;
        this.drawRope(t.from, t.to, slack, color, (0.4 + 0.35 * taut) * pulse, nowSec);
        if (taut > 0.6) this.drawTransmission(t.from, t.to, nowSec, color);
        this.drawHookHead(t.to.x, t.to.y, color, 1);
        this.g.circle(t.to.x, t.to.y, 6 + pulse * 3).fill({ color, alpha: 0.15 * pulse });
        if (t.labelText) this.ensureLabel(t, t.labelText, t.labelColor);
        break;
      }
      case "blocked": {
        const age = nowSec - (t.blockedSec as number);
        const fade = Math.min(1, (BLOCKED_TTL - age) / 0.6);
        const taut = tautness(t.tautSince, nowSec);
        this.drawRope(t.from, t.to, t.arc * 0.4 * (1 - taut), BLOCKED_COLOR, 0.7 * fade, nowSec);
        this.drawHookHead(t.to.x, t.to.y, BLOCKED_COLOR, fade);
        this.drawBlockCross(t.from.x, t.from.y - 6, fade);
        if (t.labelText) this.ensureLabel(t, t.labelText, t.labelColor);
        break;
      }
      case "reeling": {
        const reel = reelStart(t, nowSec) as { at: number; cause: ReelCause };
        const k = Math.min(1, (nowSec - reel.at) / REEL);
        // Reel like a fishing rod: the hook is wound back in along a rope that
        // shortens toward the socket, accelerating as it goes.
        const wound = k * k;
        const head = { x: lerp(t.to.x, t.from.x, wound), y: lerp(t.to.y, t.from.y, wound) };
        const color =
          reel.cause === "timeout"
            ? NEUTRAL_COLOR
            : t.isError
              ? ERROR_COLOR
              : SUCCESS_COLOR;
        const fade = 1 - wound * 0.5;
        this.drawRope(t.from, head, t.arc * 0.25 * (1 - wound), color, 0.5 * fade, nowSec);
        this.drawHookHead(head.x, head.y, color, fade);
        if (reel.cause === "timeout") {
          const labelFade = Math.min(1, (REEL + TIMEOUT_LABEL_TTL - (nowSec - reel.at)) / 0.5);
          this.ensureLabel(t, tr("hookBeam.noResponse"), NEUTRAL_COLOR);
          if (t.label) t.label.alpha = labelFade;
        } else {
          this.disposeLabel(t);
        }
        break;
      }
      case "snapped": {
        const age = nowSec - (t.snappedSec as number);
        const fade = 1 - age / SNAP_TTL;
        const drop = age * 26;
        // Two dangling stubs: one hanging off the socket, one falling with the hook.
        const midF = { x: lerp(t.from.x, t.to.x, 0.3), y: lerp(t.from.y, t.to.y, 0.3) + 8 + drop * 0.4 };
        this.g
          .moveTo(t.from.x, t.from.y)
          .quadraticCurveTo(t.from.x, t.from.y + 12, midF.x, midF.y)
          .stroke({ width: 2, color: SNAP_COLOR, alpha: 0.5 * fade });
        this.g
          .moveTo(t.to.x, t.to.y + drop)
          .lineTo(lerp(t.to.x, t.from.x, 0.18), t.to.y + 10 + drop)
          .stroke({ width: 2, color: SNAP_COLOR, alpha: 0.5 * fade });
        this.drawHookHead(t.to.x, t.to.y + drop, SNAP_COLOR, fade);
        break;
      }
      case "done":
        break;
    }
  }

  /** Rope between two points as a chain of segments hanging under gravity:
   * per-vertex sag follows a parabolic profile plus a soft traveling wave, so
   * the line reads as rope rather than a beam. sag 0 = pulled straight. */
  private drawRope(a: Pt, head: Pt, sag: number, color: number, alpha: number, nowSec: number) {
    const steps = 14;
    this.g.moveTo(a.x, a.y);
    for (let i = 1; i <= steps; i++) {
      const k = i / steps;
      const droop = Math.sin(Math.PI * k) * sag;
      const wave = Math.sin(k * Math.PI * 3 + nowSec * 2.4) * sag * 0.12;
      this.g.lineTo(lerp(a.x, head.x, k), lerp(a.y, head.y, k) + droop + wave);
    }
    this.g.stroke({ width: 2, color, alpha });
  }

  /** Pulses traveling down a taut rope (socket -> character): the hook is
   * actively holding the agent and "something is coming through the line". */
  private drawTransmission(a: Pt, b: Pt, nowSec: number, color: number) {
    for (let i = 0; i < 2; i++) {
      const k = ((nowSec * 0.8 + i * 0.5) % 1 + 1) % 1;
      this.g
        .circle(lerp(a.x, b.x, k), lerp(a.y, b.y, k), 2.4)
        .fill({ color, alpha: 0.9 * Math.sin(Math.PI * k) });
    }
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
