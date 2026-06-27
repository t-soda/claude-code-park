import { Container, Graphics, Text } from "pixi.js";
import { t as tr } from "../../i18n";

/** Total lifetime of one round-trip beam (sec). First half = outbound / second half = return. */
export const ROUND_TTL = 0.9;

export interface Pt {
  x: number;
  y: number;
}

interface Beam {
  a: Pt; // character position (start and end point)
  b: Pt; // gear slot position (turnaround)
  startSec: number;
}

/** Linear interpolation (0->1). */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Head position of a round-trip beam.
 * - p 0->0.25: a->b (outbound)
 * - p 0.25->0.5: dwell at b
 * - p 0.5->1: b->a (return)
 */
export function roundTripHead(a: Pt, b: Pt, p: number): Pt {
  if (p <= 0.25) {
    const k = p * 4; // normalize 0->0.25 to 0->1 (outbound)
    return { x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k) };
  }
  if (p <= 0.5) {
    return { x: b.x, y: b.y }; // dwell
  }
  const k = (p - 0.5) * 2; // normalize 0.5->1 to 0->1 (return)
  return { x: lerp(b.x, a.x, k), y: lerp(b.y, a.y, k) };
}

/** Per-phase durations for a pending beam (sec). PENDING_TIMEOUT is the adjustable dwell cap. */
export const PENDING_OUT = 0.25;
export const PENDING_RETURN = 0.5;
export const PENDING_TIMEOUT = 10;
export const PENDING_TIMEOUT_FADE = 1;

export type PendingPhase = "outbound" | "dwell" | "returning" | "timeout" | "done";

interface PendingTiming {
  startSec: number;
  resolvedSec: number | null;
}

/** Current phase of a pending beam. If resolved, return; otherwise determined by elapsed time. */
export function pendingPhase(bm: PendingTiming, nowSec: number): PendingPhase {
  if (bm.resolvedSec != null) {
    return nowSec - bm.resolvedSec <= PENDING_RETURN ? "returning" : "done";
  }
  const elapsed = nowSec - bm.startSec;
  if (elapsed <= PENDING_OUT) return "outbound";
  if (elapsed <= PENDING_TIMEOUT) return "dwell";
  if (elapsed <= PENDING_TIMEOUT + PENDING_TIMEOUT_FADE) return "timeout";
  return "done";
}

/** Head position of a pending beam. outbound=a->b / dwell·timeout=dwell at b / returning=b->a. */
export function pendingHead(a: Pt, b: Pt, bm: PendingTiming, nowSec: number): Pt {
  const phase = pendingPhase(bm, nowSec);
  if (phase === "outbound") {
    const k = Math.min(1, (nowSec - bm.startSec) / PENDING_OUT);
    return { x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k) };
  }
  if (phase === "returning") {
    const k = Math.min(1, (nowSec - (bm.resolvedSec as number)) / PENDING_RETURN);
    return { x: lerp(b.x, a.x, k), y: lerp(b.y, a.y, k) };
  }
  return { x: b.x, y: b.y };
}

/** Color by phase and outcome. Success/waiting = purple, failure = red, timeout = red-orange. */
export function pendingColor(phase: PendingPhase, isError: boolean | null): number {
  if (phase === "timeout") return 0xff6b3d;
  if (phase === "returning" && isError) return 0xff5a5a;
  return 0xc084fc;
}

/** Pulsing alpha during dwell (0.4-1.0, ~1.2s period). */
export function dwellPulse(nowSec: number): number {
  return 0.7 + 0.3 * Math.sin((nowSec * Math.PI * 2) / 1.2);
}

/** Key that pairs Pre/Post. Prefer the correlation ID; otherwise fall back to agentKey:tool. */
export function pairKey(correlationId: string | null, agentKey: string, tool: string | null): string {
  return correlationId ?? `${agentKey}:${tool ?? ""}`;
}

/** Index of the oldest unresolved beam in the queue (-1 if none). */
export function firstUnresolvedIndex(beams: readonly { resolvedSec: number | null }[]): number {
  return beams.findIndex((b) => b.resolvedSec == null);
}

interface PendingBeam {
  a: Pt;
  b: Pt;
  startSec: number;
  resolvedSec: number | null;
  isError: boolean | null;
  label: Text | null;
}

/**
 * Round-trip beams character -> gear slot -> character. A single Graphics placed in scene(world) space.
 */
export class HookBeam extends Container {
  private g = new Graphics();
  private beams: Beam[] = [];
  private pending = new Map<string, PendingBeam[]>();

  constructor() {
    super();
    this.addChild(this.g);
  }

  /** Fire one round-trip beam (coordinates are in scene/world space). */
  roundTrip(charPos: Pt, socketPos: Pt, nowSec: number) {
    this.beams.push({ a: { ...charPos }, b: { ...socketPos }, startSec: nowSec });
  }

  /**
   * Register one pending beam (PreToolUse). The same key is pushed onto a FIFO queue.
   * a (character position) is frozen at Pre time, like roundTrip. A pending beam may dwell up to
   * PENDING_TIMEOUT seconds, so if the character moves during that time the return heads to the
   * position at registration time (an intentional simplification; if following is needed, update it each frame like b).
   */
  startPending(key: string, charPos: Pt, socketPos: Pt, nowSec: number) {
    const beam: PendingBeam = {
      a: { ...charPos },
      b: { ...socketPos },
      startSec: nowSec,
      resolvedSec: null,
      isError: null,
      label: null,
    };
    const q = this.pending.get(key);
    if (q) q.push(beam);
    else this.pending.set(key, [beam]);
  }

  /** Complete (return) the matching pending beam (PostToolUse). Returns true if found. */
  resolvePending(key: string, isError: boolean | null, nowSec: number): boolean {
    const q = this.pending.get(key);
    if (!q) return false;
    const i = firstUnresolvedIndex(q);
    if (i < 0) return false;
    q[i].resolvedSec = nowSec;
    q[i].isError = isError;
    return true;
  }

  /** Show a "no response" label beside the gear on timeout (created only once). */
  private ensureLabel(bm: PendingBeam) {
    if (bm.label) return;
    const t = new Text({ text: tr("hookBeam.noResponse"), style: { fontSize: 10, fill: 0xff6b3d } });
    t.anchor.set(0.5, 1);
    t.position.set(bm.b.x, bm.b.y - 8);
    this.addChild(t);
    bm.label = t;
  }

  private disposeLabel(bm: PendingBeam) {
    if (!bm.label) return;
    this.removeChild(bm.label);
    bm.label.destroy();
    bm.label = null;
  }

  /** Per frame: draw in-progress beams and remove expired ones. */
  update(nowSec: number) {
    this.g.clear();
    this.beams = this.beams.filter((bm) => nowSec - bm.startSec <= ROUND_TTL);
    for (const bm of this.beams) {
      const p = Math.min(1, (nowSec - bm.startSec) / ROUND_TTL);
      const head = roundTripHead(bm.a, bm.b, p);
      const goingOut = p <= 0.5; // during outbound + dwell, the character side is the tail
      // A faint line: outbound connects character->head, return connects gear->head.
      const tail = goingOut ? bm.a : bm.b;
      const fade = p <= 0.5 ? 1 : 1 - (p - 0.5) * 2;
      this.g
        .moveTo(tail.x, tail.y)
        .lineTo(head.x, head.y)
        .stroke({ width: 2, color: 0xc084fc, alpha: 0.55 * fade });
      this.g.circle(head.x, head.y, 4).fill({ color: 0xffe08a, alpha: 0.95 * fade });
    }
    // Pending beams (iterate over a snapshot and remove the done ones).
    for (const [key, q] of [...this.pending]) {
      for (const bm of q) {
        const phase = pendingPhase(bm, nowSec);
        if (phase === "done") {
          this.disposeLabel(bm);
          continue;
        }
        const head = pendingHead(bm.a, bm.b, bm, nowSec);
        const tail = phase === "returning" ? bm.b : bm.a;
        const color = pendingColor(phase, bm.isError);
        const pulse = phase === "dwell" ? dwellPulse(nowSec) : 1;
        this.g
          .moveTo(tail.x, tail.y)
          .lineTo(head.x, head.y)
          .stroke({ width: 2, color, alpha: 0.55 * pulse });
        const dotR = phase === "dwell" ? 3 + 2 * pulse : 4;
        this.g.circle(head.x, head.y, dotR).fill({ color, alpha: 0.95 });
        if (phase === "timeout") this.ensureLabel(bm);
        else this.disposeLabel(bm);
      }
      const alive = q.filter((bm) => pendingPhase(bm, nowSec) !== "done");
      if (alive.length) this.pending.set(key, alive);
      else this.pending.delete(key);
    }
  }
}
