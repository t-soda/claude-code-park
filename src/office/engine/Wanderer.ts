/**
 * Wandering for idle characters (2D over iso cell space). Pixi-independent.
 * Drifts around a rectangular cell range inside a room. col/row may be fractional (interpolated for smooth motion).
 */

/** Wander range (absolute cells, both ends inclusive). */
export interface CellRect {
  col0: number;
  col1: number;
  row0: number;
  row1: number;
}

/** Wander state (cell coordinates). */
export interface WanderState {
  col: number;
  row: number;
  tcol: number;
  trow: number;
  pauseUntil: number;
  facing: 1 | -1;
  /** Whether heading away (toward the top of the screen). If true, draw the back view. */
  back: boolean;
}

/** Wander speed (cells/sec). */
const WANDER_SPEED = 1.6;
/** Lower bound and span of the pause duration (sec) after reaching the target. */
const PAUSE_MIN = 0.4;
const PAUSE_SPAN = 1.4;

function randIn(a: number, b: number, rng: () => number): number {
  return a + (b - a) * rng();
}

/** Travel direction in world x (in iso, x ∝ col-row). Used for left/right flipping. */
function facingOf(dcol: number, drow: number): 1 | -1 {
  return dcol - drow >= 0 ? 1 : -1;
}

/** Travel direction in world y (in iso, y ∝ col+row). Back view when heading away (up). */
function backOf(dcol: number, drow: number): boolean {
  return dcol + drow < 0;
}

/** Create a random initial state within the range. */
export function makeWander(rect: CellRect, rng: () => number): WanderState {
  const col = randIn(rect.col0, rect.col1, rng);
  const row = randIn(rect.row0, rect.row1, rng);
  return { col, row, tcol: col, trow: row, pauseUntil: 0, facing: 1, back: false };
}

/**
 * Pure function that advances the wander by one frame.
 * - While paused (t < pauseUntil), hold position.
 * - Move toward the target cell at constant speed; on arrival, pause and pick the next target within the range.
 * - If degenerate (the range is a point), stick to the corner.
 */
export function stepWander(
  s: WanderState,
  rect: CellRect,
  t: number,
  dt: number,
  rng: () => number
): WanderState {
  if (rect.col1 <= rect.col0 && rect.row1 <= rect.row0) {
    return { ...s, col: rect.col0, row: rect.row0, tcol: rect.col0, trow: rect.row0 };
  }
  if (t < s.pauseUntil) return s;

  const dcol = s.tcol - s.col;
  const drow = s.trow - s.row;
  const dist = Math.hypot(dcol, drow);
  const step = WANDER_SPEED * dt;

  if (dist <= step || dist === 0) {
    const tcol = randIn(rect.col0, rect.col1, rng);
    const trow = randIn(rect.row0, rect.row1, rng);
    const pauseUntil = t + PAUSE_MIN + rng() * PAUSE_SPAN;
    return {
      col: s.tcol,
      row: s.trow,
      tcol,
      trow,
      pauseUntil,
      facing: facingOf(tcol - s.tcol, trow - s.trow),
      back: backOf(tcol - s.tcol, trow - s.trow),
    };
  }

  return {
    col: s.col + (dcol / dist) * step,
    row: s.row + (drow / dist) * step,
    tcol: s.tcol,
    trow: s.trow,
    pauseUntil: s.pauseUntil,
    facing: facingOf(dcol, drow),
    back: backOf(dcol, drow),
  };
}
