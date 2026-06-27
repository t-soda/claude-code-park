export interface CalloutBox {
  anchorX: number;
  anchorY: number;
  w: number;
  h: number;
}

export interface CalloutPlaced {
  x: number;
  y: number;
  tethered: boolean;
}

export interface LayoutOpts {
  /** Minimum gap between rectangles (px). */
  gap?: number;
  /** Maximum displacement from the ideal position (px). Won't move farther than this. */
  maxShift?: number;
  /** Draw a leader line once displaced beyond this distance (px). */
  tetherThreshold?: number;
  /** Number of separation iterations. */
  iterations?: number;
}

const clamp = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, v));

/**
 * Start each callout from its ideal position (directly above the anchor) and push overlaps apart iteratively.
 * Any whose resolved position is displaced from the ideal beyond the threshold gets tethered=true (a leader-line target).
 * Assumes on the order of a dozen-odd shown at once (O(n²) × iterations is enough).
 */
export function layoutCallouts(
  boxes: CalloutBox[],
  opts: LayoutOpts = {}
): CalloutPlaced[] {
  const gap = opts.gap ?? 6;
  const maxShift = opts.maxShift ?? 80;
  const tether = opts.tetherThreshold ?? 14;
  const iterations = opts.iterations ?? 12;

  const ideal = boxes.map((b) => ({ x: b.anchorX, y: b.anchorY - b.h / 2 }));
  const pos = ideal.map((p) => ({ x: p.x, y: p.y }));

  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        const dx = pos[j].x - pos[i].x;
        const dy = pos[j].y - pos[i].y;
        const ox = (a.w + b.w) / 2 + gap - Math.abs(dx); // overlap in the x direction
        const oy = (a.h + b.h) / 2 + gap - Math.abs(dy); // overlap in the y direction
        if (ox > 0 && oy > 0) {
          // Separate along the axis with the smaller overlap (prefer vertical; vertical when equal).
          if (oy <= ox) {
            const shift = oy / 2;
            const dir = dy >= 0 ? 1 : -1;
            pos[i].y -= dir * shift;
            pos[j].y += dir * shift;
          } else {
            const shift = ox / 2;
            const dir = dx >= 0 ? 1 : -1;
            pos[i].x -= dir * shift;
            pos[j].x += dir * shift;
          }
        }
      }
    }
  }

  return pos.map((p, i) => {
    const x = clamp(p.x, ideal[i].x - maxShift, ideal[i].x + maxShift);
    const y = clamp(p.y, ideal[i].y - maxShift, ideal[i].y + maxShift);
    const tethered = Math.hypot(x - ideal[i].x, y - ideal[i].y) > tether;
    return { x, y, tethered };
  });
}

/**
 * Hysteresis decision for showing the leader line. Separate ON/OFF thresholds (a dead-band)
 * prevent the tail ⇄ leader line from toggling every frame and flickering when the
 * displacement hovers around the threshold. Assumes `onAt > offAt`.
 * @param current whether the leader line is currently shown (the tail is hidden)
 * @param displacement distance the shown callout is displaced from its ideal position (px)
 */
export function nextTethered(
  current: boolean,
  displacement: number,
  onAt: number,
  offAt: number
): boolean {
  return current ? displacement > offAt : displacement > onAt;
}
