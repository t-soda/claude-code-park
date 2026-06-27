import { describe, it, expect } from "vitest";
import {
  lerp,
  roundTripHead,
  ROUND_TTL,
  pendingPhase,
  pendingHead,
  pendingColor,
  pairKey,
  firstUnresolvedIndex,
  PENDING_OUT,
  PENDING_RETURN,
  PENDING_TIMEOUT,
  PENDING_TIMEOUT_FADE,
} from "./HookBeam";

describe("lerp", () => {
  it("both ends and the midpoint", () => {
    expect(lerp(0, 10, 0)).toBe(0);
    expect(lerp(0, 10, 1)).toBe(10);
    expect(lerp(0, 10, 0.5)).toBe(5);
  });
});

describe("roundTripHead", () => {
  const a = { x: 0, y: 0 };
  const b = { x: 100, y: 0 };
  it("first half advances a->b", () => {
    expect(roundTripHead(a, b, 0)).toEqual({ x: 0, y: 0 });
    expect(roundTripHead(a, b, 0.25)).toEqual({ x: 100, y: 0 }); // reaches b at the end of the first half
  });
  it("second half returns b->a", () => {
    expect(roundTripHead(a, b, 0.5)).toEqual({ x: 100, y: 0 });
    expect(roundTripHead(a, b, 1)).toEqual({ x: 0, y: 0 }); // returns to a at the end
  });
});

// Confirm that ROUND_TTL is exported
describe("ROUND_TTL", () => {
  it("positive number", () => {
    expect(typeof ROUND_TTL).toBe("number");
    expect(ROUND_TTL).toBeGreaterThan(0);
  });
});

describe("pendingPhase", () => {
  it("unresolved: outbound → dwell → timeout → done", () => {
    const bm = { startSec: 100, resolvedSec: null };
    expect(pendingPhase(bm, 100.1)).toBe("outbound");
    expect(pendingPhase(bm, 100 + PENDING_OUT + 0.01)).toBe("dwell");
    expect(pendingPhase(bm, 100 + PENDING_TIMEOUT + 0.5)).toBe("timeout");
    expect(pendingPhase(bm, 100 + PENDING_TIMEOUT + PENDING_TIMEOUT_FADE + 0.1)).toBe("done");
  });
  it("resolved: returning → done", () => {
    const bm = { startSec: 100, resolvedSec: 105 };
    expect(pendingPhase(bm, 105.2)).toBe("returning");
    expect(pendingPhase(bm, 105 + PENDING_RETURN + 0.1)).toBe("done");
  });
});

describe("pendingHead", () => {
  const a = { x: 0, y: 0 };
  const b = { x: 100, y: 0 };
  it("outbound goes a->b, reaching b at the end", () => {
    expect(pendingHead(a, b, { startSec: 0, resolvedSec: null }, PENDING_OUT)).toEqual({ x: 100, y: 0 });
  });
  it("dwell stays at b", () => {
    expect(pendingHead(a, b, { startSec: 0, resolvedSec: null }, 5)).toEqual({ x: 100, y: 0 });
  });
  it("returning goes b->a", () => {
    expect(pendingHead(a, b, { startSec: 0, resolvedSec: 5 }, 5 + PENDING_RETURN)).toEqual({ x: 0, y: 0 });
  });
});

describe("pendingColor", () => {
  it("success returning=purple / failure=red / timeout=red-orange / dwell=purple", () => {
    expect(pendingColor("returning", false)).toBe(0xc084fc);
    expect(pendingColor("returning", true)).toBe(0xff5a5a);
    expect(pendingColor("timeout", null)).toBe(0xff6b3d);
    expect(pendingColor("dwell", null)).toBe(0xc084fc);
  });
});

describe("pairKey", () => {
  it("prefers correlationId, falls back to agentKey:tool", () => {
    expect(pairKey("tu_1", "aid", "Bash")).toBe("tu_1");
    expect(pairKey(null, "aid", "Bash")).toBe("aid:Bash");
    expect(pairKey(null, "aid", null)).toBe("aid:");
  });
});

describe("firstUnresolvedIndex", () => {
  it("returns the oldest unresolved index (-1 if none)", () => {
    expect(firstUnresolvedIndex([{ resolvedSec: 1 }, { resolvedSec: null }, { resolvedSec: null }])).toBe(1);
    expect(firstUnresolvedIndex([{ resolvedSec: 1 }])).toBe(-1);
  });
});
