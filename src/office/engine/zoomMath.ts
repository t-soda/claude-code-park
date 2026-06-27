/** Pure zoom/pan math. Pixi-independent, so it's unit-testable. */

/** Compute the new scale from the wheel delta. The exponential formula keeps the perceived speed constant regardless of scale, and clamps to the min/max. */
export function computeZoom(
  oldScale: number,
  deltaY: number,
  sensitivity: number,
  min: number,
  max: number
): number {
  const factor = Math.exp(-deltaY * sensitivity);
  return Math.min(max, Math.max(min, oldScale * factor));
}

/**
 * Adjust the world position (one axis) so the world point under the cursor stays fixed on screen.
 * Derived from the invariant screen(W) = worldPos + W * scale (the stage has scale=1).
 */
export function anchorPan(
  cursor: number,
  worldPosOld: number,
  oldScale: number,
  newScale: number
): number {
  return cursor - (cursor - worldPosOld) * (newScale / oldScale);
}

/** Clamp the pan range by "content length C / view length V / margin M" (pass the scaled length for C). */
export function clampAxis(
  t: number,
  content: number,
  view: number,
  margin: number
): number {
  const lo = Math.min(0, view - content) - margin;
  const hi = Math.max(0, view - content) + margin;
  return Math.min(hi, Math.max(lo, t));
}
