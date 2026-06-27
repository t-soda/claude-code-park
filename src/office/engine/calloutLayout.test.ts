import { describe, it, expect } from "vitest";
import { layoutCallouts, nextTethered } from "./calloutLayout";

describe("layoutCallouts", () => {
  it("leaves non-overlapping callouts at their ideal spot, untethered", () => {
    const boxes = [
      { anchorX: 0, anchorY: 0, w: 40, h: 20 },
      { anchorX: 200, anchorY: 0, w: 40, h: 20 },
    ];
    const r = layoutCallouts(boxes);
    expect(r[0].x).toBeCloseTo(0);
    expect(r[0].y).toBeCloseTo(-10); // anchorY - h/2
    expect(r[0].tethered).toBe(false);
    expect(r[1].tethered).toBe(false);
  });

  it("separates two callouts sharing an anchor so they no longer overlap", () => {
    const boxes = [
      { anchorX: 0, anchorY: 0, w: 40, h: 20 },
      { anchorX: 0, anchorY: 0, w: 40, h: 20 },
    ];
    const r = layoutCallouts(boxes, { gap: 6 });
    const dy = Math.abs(r[0].y - r[1].y);
    const dx = Math.abs(r[0].x - r[1].x);
    // Non-overlapping if separated by at least (h+gap) or (w+gap) on either axis.
    expect(dy >= 26 - 0.001 || dx >= 46 - 0.001).toBe(true);
  });

  it("clamps shift to maxShift and marks tethered when displaced beyond threshold", () => {
    const boxes = [
      { anchorX: 0, anchorY: 0, w: 40, h: 40 },
      { anchorX: 0, anchorY: 0, w: 40, h: 40 },
    ];
    const r = layoutCallouts(boxes, { gap: 6, maxShift: 10, tetherThreshold: 5 });
    for (const p of r) {
      // Displacement from the ideal center (0, -20) is clamped within maxShift.
      expect(Math.abs(p.x - 0)).toBeLessThanOrEqual(10 + 0.001);
      expect(Math.abs(p.y - -20)).toBeLessThanOrEqual(10 + 0.001);
      expect(p.tethered).toBe(true);
    }
  });
});

describe("nextTethered (hysteresis)", () => {
  const ON = 18;
  const OFF = 10;

  it("turns ON only when displacement exceeds the higher threshold", () => {
    expect(nextTethered(false, 17, ON, OFF)).toBe(false);
    expect(nextTethered(false, 19, ON, OFF)).toBe(true);
  });

  it("stays ON within the dead-band (between OFF and ON)", () => {
    // Once ON, stay ON down to the OFF threshold even if it drops below the ON threshold (anti-flicker).
    expect(nextTethered(true, 12, ON, OFF)).toBe(true);
  });

  it("turns OFF only when displacement drops below the lower threshold", () => {
    expect(nextTethered(true, 11, ON, OFF)).toBe(true);
    expect(nextTethered(true, 9, ON, OFF)).toBe(false);
  });

  it("does not toggle for a value oscillating inside the dead-band", () => {
    // Oscillating within the dead-band (10–18) doesn't change the state.
    let s = true;
    for (const d of [11, 15, 12, 17, 13]) s = nextTethered(s, d, ON, OFF);
    expect(s).toBe(true);
    s = false;
    for (const d of [11, 15, 12, 17, 13]) s = nextTethered(s, d, ON, OFF);
    expect(s).toBe(false);
  });
});
