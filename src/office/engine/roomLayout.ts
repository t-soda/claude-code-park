import type { Cell } from "./iso";
import type { Orientation } from "./assetManifest";

/**
 * Top-down iso "room" layout calculation (pure, Pixi-independent).
 * 1 session = 1 room. Working employees form "islands of two facing each other"; idle ones wander the waiting area.
 * The Orchestrator is placed in isolation at top center with a gap. Multiple rooms are arranged onto a meta-grid by planTown.
 *
 * Seat fill order (as specified):
 *   index 0 → island 0's left seat (down-right), 1 → island 0's right seat (up-left, facing),
 *   2 → island 1's left seat, 3 → island 1's right seat … islands stack along rows, wrapping to the next island column at ISLANDS_PER_COL.
 */

/** Cell margin reserved for the room's interior walls (all four sides). */
export const ROOM_PAD = 1;
/** Number of rows of gap between the Orchestrator and the islands (sense of isolation). */
export const ORCHESTRATOR_GAP = 2;
/** Gap between islands (along rows). Island row pitch = 1 + this. */
export const ISLAND_ROW_GAP = 1;
/** Gap between island columns (along columns). Island column pitch = 2 + this. */
export const ISLAND_COL_GAP = 1;
/** Number of islands stacked in one island column (wraps to the next column beyond this). */
export const ISLANDS_PER_COL = 3;
/** Number of rooms placed per row of the meta-grid. */
export const ROOMS_PER_ROW = 3;
/** Number of cells of gap between rooms. */
export const ROOM_GAP = 3;

/** Waiting area (the rectangular range idle characters wander, in local cells). */
export interface WaitRect {
  col0: number;
  col1: number;
  row0: number;
  row1: number;
}

/** A single desk seat (cell and facing). */
export interface DeskSlot {
  cell: Cell;
  facing: Orientation;
}

/** Free cells where decor can be placed (classified by placement rule). */
export interface FreeCells {
  /** Along the back walls (inside the two back edges). */
  wall: Cell[];
  /** Room corners (corners along the walls). */
  corner: Cell[];
  /** All other floor. */
  floor: Cell[];
}

/** One room's interior layout (all in room-local cell coordinates). */
export interface RoomPlan {
  cols: number;
  rows: number;
  orchestrator: Cell;
  orchestratorFacing: Orientation;
  /** Working employee key → fixed seat (cell + facing). */
  desks: Map<string, DeskSlot>;
  waiting: WaitRect;
  free: FreeCells;
}

const key = (c: number, r: number) => `${c},${r}`;

/**
 * @param workingKeys Keys of working (fixed-seat) employees. Expected to be passed in a stable order.
 * @param idleCount Number of idle employees (no seat; they wander).
 */
export function planRoom(workingKeys: string[], idleCount: number): RoomPlan {
  const nIslands = Math.ceil(workingKeys.length / 2);
  const colGroups = Math.max(1, Math.ceil(nIslands / ISLANDS_PER_COL));
  const colPitch = 2 + ISLAND_COL_GAP;
  const rowPitch = 1 + ISLAND_ROW_GAP;

  const interiorCols = Math.max(3, colGroups * colPitch - ISLAND_COL_GAP);
  const islandsTallest = Math.min(Math.max(nIslands, 0), ISLANDS_PER_COL);
  const islandsSpan = islandsTallest > 0 ? islandsTallest * rowPitch - ISLAND_ROW_GAP : 0;
  const waitingRows = Math.max(1, Math.ceil(idleCount / 3));

  // Interior rows (0-based): Orchestrator(0) → gap → islands → gap → waiting.
  const islandRow0 = 1 + ORCHESTRATOR_GAP;
  const islandsBottom = islandRow0 + islandsSpan;
  const waitRow0 = islandsBottom + 1;
  const interiorRows = waitRow0 + waitingRows;

  const cols = interiorCols + 2 * ROOM_PAD;
  const rows = interiorRows + 2 * ROOM_PAD;

  const orchestrator: Cell = {
    col: ROOM_PAD + Math.floor(interiorCols / 2),
    row: ROOM_PAD,
  };

  const occupied = new Set<string>([key(orchestrator.col, orchestrator.row)]);

  const desks = new Map<string, DeskSlot>();
  workingKeys.forEach((k, i) => {
    const island = Math.floor(i / 2);
    const seat = i % 2; // 0=left seat (down-right) / 1=right seat (up-left)
    const colGroup = Math.floor(island / ISLANDS_PER_COL);
    const rowIdx = island % ISLANDS_PER_COL;
    const colI = colGroup * colPitch + seat;
    const rowI = islandRow0 + rowIdx * rowPitch;
    const cell: Cell = { col: ROOM_PAD + colI, row: ROOM_PAD + rowI };
    desks.set(k, { cell, facing: seat === 0 ? "frontRight" : "backLeft" });
    occupied.add(key(cell.col, cell.row));
  });

  const waiting: WaitRect = {
    col0: ROOM_PAD,
    col1: ROOM_PAD + interiorCols - 1,
    row0: ROOM_PAD + waitRow0,
    row1: ROOM_PAD + waitRow0 + waitingRows - 1,
  };

  // Classify free cells by placement rule (excluding occupied and waiting areas).
  const free: FreeCells = { wall: [], corner: [], floor: [] };
  for (let ri = 0; ri < interiorRows; ri++) {
    for (let ci = 0; ci < interiorCols; ci++) {
      const col = ROOM_PAD + ci;
      const row = ROOM_PAD + ri;
      if (occupied.has(key(col, row))) continue;
      const inWaiting =
        col >= waiting.col0 && col <= waiting.col1 && row >= waiting.row0 && row <= waiting.row1;
      if (inWaiting) continue;
      const onBackEdge = ri === 0 || ci === 0;
      if (ri === 0 && ci === 0) free.corner.push({ col, row });
      else if (onBackEdge) free.wall.push({ col, row });
      else free.floor.push({ col, row });
    }
  }

  return { cols, rows, orchestrator, orchestratorFacing: "frontRight", desks, waiting, free };
}

/** One room placed on the meta-grid (with its absolute cell offset). */
export interface PlacedRoom {
  sessionId: string;
  col0: number;
  row0: number;
  plan: RoomPlan;
}

/**
 * Arrange the rooms onto the meta-grid (ROOMS_PER_ROW columns) with wrapping, assigning absolute cell offsets.
 * Pack by actual width within a row; advance rows by that row's maximum height.
 */
export function planTown(
  rooms: Array<{ sessionId: string; plan: RoomPlan }>
): PlacedRoom[] {
  const placed: PlacedRoom[] = [];
  let curCol0 = 0;
  let curRow0 = 0;
  let rowMaxRows = 0;
  let countInRow = 0;

  for (const room of rooms) {
    if (countInRow === ROOMS_PER_ROW) {
      curRow0 += rowMaxRows + ROOM_GAP;
      curCol0 = 0;
      rowMaxRows = 0;
      countInRow = 0;
    }
    placed.push({ sessionId: room.sessionId, col0: curCol0, row0: curRow0, plan: room.plan });
    curCol0 += room.plan.cols + ROOM_GAP;
    rowMaxRows = Math.max(rowMaxRows, room.plan.rows);
    countInRow += 1;
  }
  return placed;
}

/** Signature of the room composition (so the floor/furniture is rebuilt only when desk arrangement or room count changes). */
export function townSignature(placed: PlacedRoom[]): string {
  return placed
    .map(
      (p) =>
        `${p.sessionId}@${p.col0},${p.row0}:${p.plan.cols}x${p.plan.rows}#${p.plan.desks.size}`
    )
    .join("|");
}
