import { Container, Graphics } from "pixi.js";

export interface Pt {
  x: number;
  y: number;
}

/**
 * One caller -> callee delegation drawn as an arc. Coordinates are in scene/world space.
 * "in"/"out" are hover emphases relative to the hovered agent: "in" = it is being
 * called (caller -> hovered), "out" = it is calling (hovered -> callee).
 */
export interface ArcLink {
  from: Pt;
  to: Pt;
  emphasis: "normal" | "in" | "out" | "dim";
}

/** Number of segments used to flatten one arc into a polyline. */
const SEGMENTS = 24;
/** How far the control point bulges from the chord midpoint, relative to the chord length. */
const BULGE = 0.22;
/** Light-pulse travel speed along the arc (full arc lengths per second). */
const FLOW_SPEED = 0.45;
/** Spacing between light pulses (fraction of the arc, 0-1). */
const FLOW_SPACING = 0.33;
/** Length of one light pulse in scene px (fixed, independent of the arc's length). */
const PULSE_PX = 6;

/** Neon beam: saturated halos under a pale core, additive-blended. Blue when not
 *  hovering; on hover, incoming turns magenta and outgoing turns green. Warm
 *  yellows are avoided: additive blending washes them out on the pale floor tiles. */
export const ARC_COLOR = 0x38bdf8;
const BEAM_COLORS: Record<ArcLink["emphasis"], { halo: number; core: number }> = {
  normal: { halo: ARC_COLOR, core: 0x9fdcff },
  dim: { halo: ARC_COLOR, core: 0x9fdcff },
  in: { halo: 0xf043b4, core: 0xffb3e2 },
  out: { halo: 0x10c860, core: 0x86f5b5 },
};
const PULSE_COLOR = 0xffffff;
/** Core line width (px). The pulse is drawn at the same width by design. */
const CORE_W = 2;
/** Hovered relation: only slightly wider/brighter than normal — a nudge, not a spotlight. */
const HIGHLIGHT_W = 2.5;

/**
 * Control point of the arc: the chord midpoint pushed along the chord normal,
 * always toward screen-up so arcs bow above the characters' heads.
 */
export function arcControl(a: Pt, b: Pt, bulge = BULGE): Pt {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return { x: a.x, y: a.y };
  // Normal of the chord; flip it when it points down (+y) so the bow is upward.
  let nx = dy / len;
  let ny = -dx / len;
  if (ny > 0) {
    nx = -nx;
    ny = -ny;
  }
  return { x: (a.x + b.x) / 2 + nx * len * bulge, y: (a.y + b.y) / 2 + ny * len * bulge };
}

/** Point on the quadratic bezier a-(c)-b at t in [0,1]. */
export function quadPoint(a: Pt, c: Pt, b: Pt, t: number): Pt {
  const u = 1 - t;
  return {
    x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
    y: u * u * a.y + 2 * u * t * c.y + t * t * b.y,
  };
}

/** Approximate length of the bezier a-(c)-b (polyline over SEGMENTS pieces). */
export function arcLength(a: Pt, c: Pt, b: Pt): number {
  let len = 0;
  let prev = a;
  for (let i = 1; i <= SEGMENTS; i++) {
    const p = quadPoint(a, c, b, i / SEGMENTS);
    len += Math.hypot(p.x - prev.x, p.y - prev.y);
    prev = p;
  }
  return len;
}

/**
 * End fraction of a pulse starting at `phase`, so the pulse spans a fixed pixel
 * length regardless of how long the arc is. Clamped to the arc's end.
 */
export function pulseEnd(phase: number, arcLen: number, pulsePx = PULSE_PX): number {
  if (arcLen <= 0) return phase;
  return Math.min(1, phase + pulsePx / arcLen);
}

/**
 * Positions (0-1 along the arc) of the light pulses at a given time. The pulses
 * run from 0 (caller) toward 1 (callee), which is what conveys the call direction.
 */
export function flowPhases(nowSec: number, spacing = FLOW_SPACING, speed = FLOW_SPEED): number[] {
  const base = ((nowSec * speed) % spacing + spacing) % spacing;
  const out: number[] = [];
  for (let p = base; p < 1; p += spacing) out.push(p);
  return out;
}

/**
 * Arcs between a caller (orchestrator or subagent) and the subagents it spawned.
 * A single Graphics redrawn every frame in scene/world space (same pattern as GrapplingHook).
 */
export class DelegationArcs extends Container {
  private g = new Graphics();

  constructor() {
    super();
    // Additive blending makes the stacked halos glow like neon over the dark floor.
    this.g.blendMode = "add";
    this.addChild(this.g);
  }

  /** Stroke the exact bezier span t0-t1 (sampled fine enough for short pulses). */
  private strokeSpan(
    a: Pt,
    c: Pt,
    b: Pt,
    t0: number,
    t1: number,
    width: number,
    color: number,
    alpha: number
  ) {
    if (t1 <= t0) return;
    const steps = Math.max(2, Math.ceil((t1 - t0) * SEGMENTS) + 1);
    const p0 = quadPoint(a, c, b, t0);
    this.g.moveTo(p0.x, p0.y);
    for (let i = 1; i <= steps; i++) {
      const p = quadPoint(a, c, b, t0 + ((t1 - t0) * i) / steps);
      this.g.lineTo(p.x, p.y);
    }
    this.g.stroke({ width, color, alpha });
  }

  /** Per frame: redraw all beams and their light pulses. */
  update(links: ArcLink[], nowSec: number) {
    this.g.clear();
    for (const l of links) {
      const c = arcControl(l.from, l.to);
      const len = arcLength(l.from, c, l.to);
      const hovered = l.emphasis === "in" || l.emphasis === "out";
      const coreW = hovered ? HIGHLIGHT_W : CORE_W;
      const alpha = l.emphasis === "dim" ? 0.15 : hovered ? 0.65 : 0.5;
      const { halo, core } = BEAM_COLORS[l.emphasis];
      // Neon: two saturated halos widening under a pale core.
      this.strokeSpan(l.from, c, l.to, 0, 1, coreW * 7, halo, alpha * 0.08);
      this.strokeSpan(l.from, c, l.to, 0, 1, coreW * 3, halo, alpha * 0.25);
      this.strokeSpan(l.from, c, l.to, 0, 1, coreW, core, alpha);
      // Fixed-length light pulses caller -> callee, at the same width as the core.
      // Dimmed beams stay static so the emphasized relation is the one whose
      // direction pops.
      if (l.emphasis !== "dim") {
        for (const ph of flowPhases(nowSec)) {
          this.strokeSpan(l.from, c, l.to, ph, pulseEnd(ph, len), coreW, PULSE_COLOR, alpha);
        }
      }
    }
  }
}
