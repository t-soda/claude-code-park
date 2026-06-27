import { describe, it, expect } from "vitest";
import { makeWander, stepWander, type WanderState, type CellRect } from "./Wanderer";

/** Deterministic rng that returns array values in order (repeats the last once exhausted). */
function seqRng(values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

const RECT: CellRect = { col0: 0, col1: 10, row0: 0, row1: 6 };

describe("makeWander", () => {
  it("places the cell within the range and starts un-paused", () => {
    const s = makeWander(RECT, () => 0.5);
    expect(s.col).toBe(5);
    expect(s.row).toBe(3);
    expect(s.tcol).toBe(5);
    expect(s.trow).toBe(3);
    expect(s.pauseUntil).toBe(0);
  });
});

describe("stepWander", () => {
  it("never leaves the range over many steps", () => {
    const rng = seqRng([0.9, 0.1, 0.8, 0.2, 0.5, 0.0, 1.0]);
    let s = makeWander(RECT, rng);
    for (let i = 0; i < 50; i++) {
      s = stepWander(s, RECT, i * 0.1, 0.1, rng);
      expect(s.col).toBeGreaterThanOrEqual(RECT.col0);
      expect(s.col).toBeLessThanOrEqual(RECT.col1);
      expect(s.row).toBeGreaterThanOrEqual(RECT.row0);
      expect(s.row).toBeLessThanOrEqual(RECT.row1);
    }
  });

  it("faces by world-x direction (x ∝ col - row) while travelling", () => {
    // Target in the col direction (down-right = world x increasing) → facing 1
    const right: WanderState = { col: 5, row: 3, tcol: 9, trow: 3, pauseUntil: 0, facing: -1, back: false };
    expect(stepWander(right, RECT, 0, 0.1, () => 0.5).facing).toBe(1);
    // Target in the row direction (down-left = world x decreasing) → facing -1
    const left: WanderState = { col: 5, row: 3, tcol: 5, trow: 6, pauseUntil: 0, facing: 1, back: false };
    expect(stepWander(left, RECT, 0, 0.1, () => 0.5).facing).toBe(-1);
  });

  it("flags back when heading away (world y ∝ col + row decreasing)", () => {
    // Target with col+row decreasing (up-left = world y decreasing = away) → back true
    const away: WanderState = { col: 5, row: 3, tcol: 2, trow: 0, pauseUntil: 0, facing: 1, back: false };
    expect(stepWander(away, RECT, 0, 0.1, () => 0.5).back).toBe(true);
    // Target with col+row increasing (down-right = world y increasing = toward) → back false
    const toward: WanderState = { col: 5, row: 3, tcol: 9, trow: 6, pauseUntil: 0, facing: 1, back: true };
    expect(stepWander(toward, RECT, 0, 0.1, () => 0.5).back).toBe(false);
  });

  it("pauses after arriving, then stays put until the pause ends", () => {
    const arrived: WanderState = { col: 5, row: 3, tcol: 5, trow: 3, pauseUntil: 0, facing: 1, back: false };
    const after = stepWander(arrived, RECT, 0, 0.1, () => 0.5);
    expect(after.pauseUntil).toBeGreaterThan(0);
    const held = stepWander(after, RECT, after.pauseUntil - 0.01, 0.1, () => 0.5);
    expect(held.col).toBe(after.col);
    expect(held.row).toBe(after.row);
  });

  it("collapses to the corner when the range is degenerate", () => {
    const s: WanderState = { col: 5, row: 5, tcol: 5, trow: 5, pauseUntil: 0, facing: 1, back: false };
    const degenerate: CellRect = { col0: 2, col1: 2, row0: 3, row1: 3 };
    const out = stepWander(s, degenerate, 0, 0.1, () => 0.5);
    expect(out.col).toBe(2);
    expect(out.row).toBe(3);
  });
});
