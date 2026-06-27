import type { Graphics } from "pixi.js";
import type { Cell } from "../../stores/characterStore";

export interface PixelColors {
  body: number;
  eye: number;
}

/**
 * Draw a Cell grid into a Graphics.
 * Places the center of the non-empty cells' bounding box at the origin (0,0).
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
  for (let r = minR; r <= maxR; r++) {
    for (let c = minC; c <= maxC; c++) {
      const v = grid[r][c];
      if (v === 0) continue;
      const color = v === 2 ? colors.eye : colors.body;
      g.rect(ox + (c - minC) * px, oy + (r - minR) * px, px, px).fill(color);
    }
  }
}
