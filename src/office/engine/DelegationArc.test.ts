import { describe, expect, it } from "vitest";
import { arcControl, arcLength, flowPhases, pulseEnd, quadPoint } from "./DelegationArc";

describe("arcControl", () => {
  it("bows the arc upward (screen -y) regardless of chord direction", () => {
    const a = { x: 0, y: 0 };
    const b = { x: 100, y: 0 };
    expect(arcControl(a, b).y).toBeLessThan(0);
    expect(arcControl(b, a).y).toBeLessThan(0);
  });

  it("keeps the control point on the chord's perpendicular bisector", () => {
    const a = { x: 0, y: 0 };
    const b = { x: 100, y: 40 };
    const c = arcControl(a, b);
    const da = Math.hypot(c.x - a.x, c.y - a.y);
    const db = Math.hypot(c.x - b.x, c.y - b.y);
    expect(da).toBeCloseTo(db, 6);
  });

  it("degenerates to the point itself for a zero-length chord", () => {
    const p = { x: 5, y: 7 };
    expect(arcControl(p, { x: 5, y: 7 })).toEqual(p);
  });
});

describe("quadPoint", () => {
  it("hits both endpoints at t=0 and t=1", () => {
    const a = { x: 0, y: 0 };
    const b = { x: 10, y: 20 };
    const c = { x: 5, y: -30 };
    expect(quadPoint(a, c, b, 0)).toEqual(a);
    expect(quadPoint(a, c, b, 1)).toEqual(b);
  });

  it("pulls the midpoint toward the control point", () => {
    const a = { x: 0, y: 0 };
    const b = { x: 10, y: 0 };
    const c = { x: 5, y: -30 };
    const m = quadPoint(a, c, b, 0.5);
    expect(m.x).toBeCloseTo(5);
    expect(m.y).toBeLessThan(0);
  });
});

describe("arcLength", () => {
  it("matches the chord for a degenerate (straight) control point", () => {
    const a = { x: 0, y: 0 };
    const b = { x: 100, y: 0 };
    expect(arcLength(a, { x: 50, y: 0 }, b)).toBeCloseTo(100, 6);
  });

  it("is zero for a zero-length chord", () => {
    const p = { x: 3, y: 4 };
    expect(arcLength(p, p, p)).toBeCloseTo(0, 10);
  });
});

describe("pulseEnd", () => {
  it("spans a fixed pixel length as a fraction of the arc", () => {
    expect(pulseEnd(0.5, 100, 6)).toBeCloseTo(0.56, 6);
    expect(pulseEnd(0.5, 300, 6)).toBeCloseTo(0.52, 6);
  });

  it("clamps to the end of the arc", () => {
    expect(pulseEnd(0.99, 100, 6)).toBe(1);
  });

  it("degenerates to the phase itself on a zero-length arc", () => {
    expect(pulseEnd(0.4, 0, 6)).toBe(0.4);
  });
});

describe("flowPhases", () => {
  it("keeps every phase in [0,1) at the requested spacing", () => {
    const phases = flowPhases(12.34, 0.25, 0.45);
    expect(phases.length).toBe(4);
    for (const p of phases) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThan(1);
    }
    for (let i = 1; i < phases.length; i++) {
      expect(phases[i] - phases[i - 1]).toBeCloseTo(0.25, 6);
    }
  });

  it("advances toward the callee as time passes", () => {
    const before = flowPhases(1.0, 0.25, 0.1)[0];
    const after = flowPhases(1.5, 0.25, 0.1)[0];
    expect(after).toBeGreaterThan(before);
  });
});
