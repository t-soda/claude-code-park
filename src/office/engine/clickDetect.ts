/** If the pointerdown→up movement is below this many px, it's a click (more than that is a pan drag). */
export const CLICK_THRESHOLD = 5;

/** Whether the movement (dx,dy) from down counts as a click. */
export function isClick(dx: number, dy: number, threshold: number = CLICK_THRESHOLD): boolean {
  return Math.hypot(dx, dy) < threshold;
}
