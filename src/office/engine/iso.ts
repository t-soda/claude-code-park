/**
 * The heart of the isometric (45-degree top-down) coordinate system.
 * Single-handedly handles the conversion between cell coordinates (col, row) ⇄ world coordinates (x, y) and depth.
 * The camera is fixed (no rotation), so this is the sole projection definition.
 */

/** Width of a single diamond tile (world px). */
export const TILE_W = 128;
/** Height of a single diamond tile (world px). 2:1 ratio. */
export const TILE_H = 64;

export interface Cell {
  col: number;
  row: number;
}

export interface Point {
  x: number;
  y: number;
}

/**
 * World coordinates of a cell center (the diamond's center).
 * A typical iso layout: increasing col extends down-right, increasing row extends down-left.
 */
export function cellToWorld(col: number, row: number): Point {
  return {
    x: (col - row) * (TILE_W / 2),
    y: (col + row) * (TILE_H / 2),
  };
}

/** World coordinates → cell coordinates (fractional). For reverse lookups such as click detection. */
export function worldToCell(x: number, y: number): Cell {
  const a = x / (TILE_W / 2);
  const b = y / (TILE_H / 2);
  return { col: (a + b) / 2, row: (b - a) / 2 };
}

/**
 * Depth (larger toward the front). Used as the base for zIndex.
 * Larger screen y = closer to the front, so in practice you can use world y directly as zIndex.
 */
export function depth(col: number, row: number): number {
  return col + row;
}

/** Vertices of the diamond tile (offsets relative to the cell center). Used for floor drawing. */
export function diamondPoints(): number[] {
  const hw = TILE_W / 2;
  const hh = TILE_H / 2;
  // top → right → bottom → left
  return [0, -hh, hw, 0, 0, hh, -hw, 0];
}
