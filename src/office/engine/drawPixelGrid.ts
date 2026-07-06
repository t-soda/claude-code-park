import type { Graphics } from "pixi.js";
import type { Cell } from "../../stores/characterStore";

export interface PixelColors {
  body: number;
  eye: number;
}

/** Lighten (amount > 0) or darken (amount < 0) a 0xRRGGBB color, amount in [-1, 1]. */
function shade(hex: number, amount: number): number {
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  const adjust = (c: number) =>
    amount >= 0 ? Math.round(c + (255 - c) * amount) : Math.round(c * (1 + amount));
  return (adjust(r) << 16) | (adjust(g) << 8) | adjust(b);
}

function isEmptyAt(grid: Cell[][], r: number, c: number): boolean {
  if (r < 0 || r >= grid.length) return true;
  if (c < 0 || c >= grid[r].length) return true;
  return grid[r][c] === 0;
}

interface Corner {
  r: number;
  c: number;
}

/**
 * Traces the boundary of the occupied-cell mask (grid[r][c] !== 0) into one or more closed
 * polygon loops, in grid-corner coordinates. Handles multiple disconnected regions; each loop
 * is a simple cycle of corner points walking the mask's edge graph (each boundary edge has
 * exactly two endpoints shared with its neighbors, so loops are found by following unvisited
 * edges until returning to the start).
 */
function traceContours(grid: Cell[][]): Corner[][] {
  const adj = new Map<string, string[]>();
  const key = (r: number, c: number) => `${r},${c}`;
  const addEdge = (p1: [number, number], p2: [number, number]) => {
    const k1 = key(p1[0], p1[1]);
    const k2 = key(p2[0], p2[1]);
    if (!adj.has(k1)) adj.set(k1, []);
    if (!adj.has(k2)) adj.set(k2, []);
    adj.get(k1)!.push(k2);
    adj.get(k2)!.push(k1);
  };
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      if (isEmptyAt(grid, r, c)) continue;
      if (isEmptyAt(grid, r - 1, c)) addEdge([r, c], [r, c + 1]);
      if (isEmptyAt(grid, r + 1, c)) addEdge([r + 1, c], [r + 1, c + 1]);
      if (isEmptyAt(grid, r, c - 1)) addEdge([r, c], [r + 1, c]);
      if (isEmptyAt(grid, r, c + 1)) addEdge([r, c + 1], [r + 1, c + 1]);
    }
  }
  const edgeKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const visited = new Set<string>();
  const loops: Corner[][] = [];
  for (const [startKey, neighbors0] of adj) {
    for (const nb0 of neighbors0) {
      const ek0 = edgeKey(startKey, nb0);
      if (visited.has(ek0)) continue;
      visited.add(ek0);
      const pts = [startKey, nb0];
      let prevKey = startKey;
      let curKey = nb0;
      while (curKey !== startKey) {
        const neighbors = adj.get(curKey) ?? [];
        let nextKey: string | null = null;
        for (const cand of neighbors) {
          if (cand === prevKey) continue;
          if (visited.has(edgeKey(curKey, cand))) continue;
          nextKey = cand;
          break;
        }
        if (nextKey === null) {
          for (const cand of neighbors) {
            if (!visited.has(edgeKey(curKey, cand))) {
              nextKey = cand;
              break;
            }
          }
        }
        if (nextKey === null) break;
        visited.add(edgeKey(curKey, nextKey));
        pts.push(nextKey);
        prevKey = curKey;
        curKey = nextKey;
      }
      pts.pop();
      loops.push(
        pts.map((k) => {
          const [rr, cc] = k.split(",").map(Number);
          return { r: rr, c: cc };
        })
      );
    }
  }
  return loops;
}

/** Collapses a traced loop down to just its turning points (drops the redundant points along straight runs). */
function simplifyLoop(points: Corner[]): Corner[] {
  const n = points.length;
  if (n < 3) return points;
  const out: Corner[] = [];
  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n];
    const curr = points[i];
    const next = points[(i + 1) % n];
    const dx1 = curr.c - prev.c;
    const dy1 = curr.r - prev.r;
    const dx2 = next.c - curr.c;
    const dy2 = next.r - curr.r;
    if (dx1 !== dx2 || dy1 !== dy2) out.push(curr);
  }
  return out.length >= 3 ? out : points;
}

/** Outline stroke thickness as a fraction of one cell. */
const OUTLINE_FRAC = 0.22;
/** Body shade spread from top (light) to bottom (dark) of the silhouette, top..bottom. */
const BODY_SHADE_RANGE: [number, number] = [0.16, -0.16];
/** 2x2 ordered-dither (Bayer) matrix used to add a faint grain on top of the body gradient. */
const BAYER2 = [
  [0, 2],
  [3, 1],
];
/** Dither jitter amplitude layered on top of the gradient (kept subtle so it reads as grain, not banding). */
const DITHER_AMOUNT = 0.01;

/** Maps a cell's Bayer level to a jitter in [-amount, amount]. */
function bayerJitter(r: number, c: number, amount: number): number {
  const level = (BAYER2[r % 2][c % 2] + 0.5) / 4; // 0.125, 0.375, 0.625, 0.875
  return (level - 0.5) * 2 * amount;
}

/**
 * Draw a Cell grid into a Graphics.
 * Places the center of the non-empty cells' bounding box at the origin (0,0).
 *
 * Beyond a flat per-cell fill, this adds a couple of classic pixel-art touches computed
 * purely from the two template colors (no extra editor state): a top-light/bottom-dark
 * vertical shade on the body with a faint dither grain on top, and a single darkened
 * outline stroked once around the traced silhouette (rather than per-cell edge strokes),
 * so the line reads as one continuous, evenly-thick contour instead of a patchwork of
 * per-cell strips that can be uneven at staircase-shaped steps.
 */
export function drawPixelGrid(
  g: Graphics,
  grid: Cell[][],
  colors: PixelColors,
  px: number
): void {
  g.clear();
  let minR = Infinity;
  let minC = Infinity;
  let maxR = -Infinity;
  let maxC = -Infinity;
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      if (grid[r][c] === 0) continue;
      if (r < minR) minR = r;
      if (r > maxR) maxR = r;
      if (c < minC) minC = c;
      if (c > maxC) maxC = c;
    }
  }
  if (maxR < 0) return; // all cells empty

  const w = (maxC - minC + 1) * px;
  const h = (maxR - minR + 1) * px;
  const ox = -w / 2;
  const oy = -h / 2;
  const rowSpan = maxR - minR;

  for (let r = minR; r <= maxR; r++) {
    for (let c = minC; c <= maxC; c++) {
      const v = grid[r][c];
      if (v === 0) continue;
      const x = ox + (c - minC) * px;
      const y = oy + (r - minR) * px;
      // Same gradient+dither treatment for eye and body cells (using each's own template color),
      // so a redraw where the eye color is set equal to the body color (facing away) blends in
      // seamlessly instead of leaving a flat-shaded "ghost" silhouette of the eye.
      const preShade = v === 2 ? colors.eye : colors.body;
      const t = rowSpan > 0 ? (r - minR) / rowSpan : 0;
      const gradientAmount = BODY_SHADE_RANGE[0] + t * (BODY_SHADE_RANGE[1] - BODY_SHADE_RANGE[0]);
      const base = shade(preShade, gradientAmount + bayerJitter(r, c, DITHER_AMOUNT));
      g.rect(x, y, px, px).fill(base);
    }
  }

  // Outline: trace the whole silhouette (all non-empty cells, body and eye alike) into one
  // or more closed loops and stroke each once, so the line has one even thickness all the way
  // around instead of being built from separately-drawn per-cell edge strips.
  const outlineColor = shade(colors.body, -0.5);
  const strokeWidth = Math.max(1, px * OUTLINE_FRAC) * 1.6;
  const loops = traceContours(grid).map(simplifyLoop).filter((loop) => loop.length >= 3);
  for (const loop of loops) {
    g.moveTo(ox + (loop[0].c - minC) * px, oy + (loop[0].r - minR) * px);
    for (let i = 1; i < loop.length; i++) {
      g.lineTo(ox + (loop[i].c - minC) * px, oy + (loop[i].r - minR) * px);
    }
    g.closePath();
  }
  if (loops.length > 0) {
    g.stroke({ width: strokeWidth, color: outlineColor, join: "round" });
  }
}
