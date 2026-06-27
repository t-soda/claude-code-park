/** Dimensions of the menu icon to the right of the sign (px, scene-local). */
export const ICON = { size: 28, gap: 10 } as const;

export interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Decide whether canvas-relative coordinates (cx,cy) are inside the icon rectangle. */
export function hitIcon(cx: number, cy: number, r: Rect): boolean {
  return cx >= r.minX && cx <= r.maxX && cy >= r.minY && cy <= r.maxY;
}

/**
 * Compute the positions of the two icons (terminal / menu) placed to the right of the sign.
 * signRightX = the sign's right-edge X (the sign is center-anchored, so x + width/2).
 * y = the icons' top-edge Y. Terminal is inner (toward the sign), menu is outer.
 */
export function signIconLayout(
  signRightX: number,
  y: number
): { terminal: { x: number; y: number }; menu: { x: number; y: number } } {
  const tx = signRightX + ICON.gap;
  return {
    terminal: { x: tx, y },
    menu: { x: tx + ICON.size + ICON.gap, y },
  };
}
