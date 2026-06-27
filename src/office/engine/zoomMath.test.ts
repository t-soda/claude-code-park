import { describe, it, expect } from "vitest";
import { computeZoom, anchorPan, clampAxis } from "./zoomMath";

const MIN = 0.4;
const MAX = 3.0;
const SENS = 0.0015;

describe("computeZoom", () => {
  it("zooms in when deltaY is negative (scroll up / pinch out)", () => {
    expect(computeZoom(1, -100, SENS, MIN, MAX)).toBeGreaterThan(1);
  });
  it("zooms out when deltaY is positive", () => {
    expect(computeZoom(1, 100, SENS, MIN, MAX)).toBeLessThan(1);
  });
  it("returns the same scale when deltaY is zero", () => {
    expect(computeZoom(1.5, 0, SENS, MIN, MAX)).toBeCloseTo(1.5);
  });
  it("clamps to the maximum", () => {
    expect(computeZoom(2.9, -100000, SENS, MIN, MAX)).toBe(MAX);
  });
  it("clamps to the minimum", () => {
    expect(computeZoom(0.5, 100000, SENS, MIN, MAX)).toBe(MIN);
  });
});

describe("anchorPan", () => {
  it("keeps the world point under the cursor fixed on screen", () => {
    // screen(W) = worldPos + W * scale  (the stage has scale=1)
    const cursor = 300;
    const worldPosOld = 50;
    const oldScale = 1;
    const newScale = 2;
    // The world point under the cursor
    const W = (cursor - worldPosOld) / oldScale;
    const worldPosNew = anchorPan(cursor, worldPosOld, oldScale, newScale);
    // The same world point's new screen coordinate matches cursor
    expect(worldPosNew + W * newScale).toBeCloseTo(cursor);
  });
  it("does not move the world position when scale is unchanged", () => {
    expect(anchorPan(300, 50, 1.5, 1.5)).toBeCloseTo(50);
  });
});

describe("clampAxis", () => {
  it("allows free pan within margin when content fits the view", () => {
    // content < view: lo=-160, hi=760. t=0 is within range, so it's returned as is.
    expect(clampAxis(0, 200, 800, 160)).toBe(0);
  });
  it("clamps beyond the high bound", () => {
    expect(clampAxis(10000, 200, 800, 160)).toBe(Math.max(0, 800 - 200) + 160);
  });
  it("clamps beyond the low bound", () => {
    expect(clampAxis(-10000, 2000, 800, 160)).toBe(Math.min(0, 800 - 2000) - 160);
  });
});
