import { describe, it, expect } from "vitest";
import {
  arcHeight,
  badgeLabel,
  BLOCKED_TTL,
  firstUnresolvedIndex,
  FLY,
  lerp,
  pairKey,
  parabolaPoint,
  PENDING_TIMEOUT,
  PENDING_TIMEOUT_FADE,
  reasonExcerpt,
  reenactHold,
  releaseSec,
  RETURN,
  SNAP_TTL,
  throwState,
  type ThrowTiming,
} from "./GrapplingHook";
import type { HookFlash } from "../../stores/hookStore";

/** A bare timing with every terminal mark unset. */
function tm(over: Partial<ThrowTiming> = {}): ThrowTiming {
  return {
    startSec: 100,
    holdUntil: null,
    resolvedSec: null,
    blockedSec: null,
    snappedSec: null,
    timeoutAt: null,
    ...over,
  };
}

describe("lerp", () => {
  it("both ends and the midpoint", () => {
    expect(lerp(0, 10, 0)).toBe(0);
    expect(lerp(0, 10, 1)).toBe(10);
    expect(lerp(0, 10, 0.5)).toBe(5);
  });
});

describe("parabolaPoint", () => {
  const a = { x: 0, y: 0 };
  const b = { x: 100, y: 0 };
  it("starts at a, ends at b, peaks by the arc mid-flight", () => {
    expect(parabolaPoint(a, b, 0, 30)).toEqual({ x: 0, y: 0 });
    expect(parabolaPoint(a, b, 1, 30).x).toBe(100);
    expect(parabolaPoint(a, b, 1, 30).y).toBeCloseTo(0);
    expect(parabolaPoint(a, b, 0.5, 30)).toEqual({ x: 50, y: -30 });
  });
});

describe("arcHeight", () => {
  it("scales with distance, clamped to sane bounds", () => {
    expect(arcHeight({ x: 0, y: 0 }, { x: 10, y: 0 })).toBe(14); // floor
    expect(arcHeight({ x: 0, y: 0 }, { x: 100, y: 0 })).toBeCloseTo(28);
    expect(arcHeight({ x: 0, y: 0 }, { x: 1000, y: 0 })).toBe(48); // ceiling
  });
});

describe("reenactHold", () => {
  it("scales with the real duration, clamped to stay snappy", () => {
    expect(reenactHold(100)).toBe(0.6); // floor
    expect(reenactHold(2900)).toBeCloseTo(0.87);
    expect(reenactHold(60_000)).toBe(2.5); // ceiling
  });
});

describe("throwState", () => {
  it("plain pending: flying → latched → timeout → done", () => {
    const t = tm({ timeoutAt: 100 + PENDING_TIMEOUT });
    expect(throwState(t, 100.1)).toBe("flying");
    expect(throwState(t, 100 + FLY + 0.01)).toBe("latched");
    expect(throwState(t, 100 + PENDING_TIMEOUT + 0.5)).toBe("timeout");
    expect(throwState(t, 100 + PENDING_TIMEOUT + PENDING_TIMEOUT_FADE + 0.1)).toBe("done");
  });

  it("resolved: returning → done", () => {
    const t = tm({ resolvedSec: 105 });
    expect(throwState(t, 105.1)).toBe("returning");
    expect(throwState(t, 105 + RETURN + 0.1)).toBe("done");
  });

  it("auto-release via holdUntil: latched → returning → done", () => {
    const t = tm({ holdUntil: 101 });
    expect(throwState(t, 100.9)).toBe("latched");
    expect(throwState(t, 101.1)).toBe("returning");
    expect(throwState(t, 101 + RETURN + 0.1)).toBe("done");
  });

  it("blocked stays red for BLOCKED_TTL then fades", () => {
    const t = tm({ blockedSec: 102, timeoutAt: 100 + PENDING_TIMEOUT });
    expect(throwState(t, 103)).toBe("blocked");
    expect(throwState(t, 102 + BLOCKED_TTL - 0.1)).toBe("blocked");
    expect(throwState(t, 102 + BLOCKED_TTL + 0.1)).toBe("done");
  });

  it("snapped wins over everything and fades on its own TTL", () => {
    const t = tm({ snappedSec: 103, blockedSec: 102, resolvedSec: 104 });
    expect(throwState(t, 103.1)).toBe("snapped");
    expect(throwState(t, 103 + SNAP_TTL + 0.1)).toBe("done");
  });

  it("a block outlives a pending timeout that would have fired later", () => {
    const t = tm({ blockedSec: 100 + PENDING_TIMEOUT - 1, timeoutAt: 100 + PENDING_TIMEOUT });
    expect(throwState(t, 100 + PENDING_TIMEOUT + 1)).toBe("blocked");
  });
});

describe("releaseSec", () => {
  it("prefers the explicit resolve over the auto-release", () => {
    expect(releaseSec(tm({ resolvedSec: 105, holdUntil: 110 }))).toBe(105);
    expect(releaseSec(tm({ holdUntil: 110 }))).toBe(110);
    expect(releaseSec(tm())).toBeNull();
  });
});

describe("pairKey", () => {
  it("prefers the correlation ID, falls back to agentKey:tool", () => {
    expect(pairKey("tu_1", "A", "Bash")).toBe("tu_1");
    expect(pairKey(null, "A", "Bash")).toBe("A:Bash");
    expect(pairKey(null, "A", null)).toBe("A:");
  });
});

describe("firstUnresolvedIndex", () => {
  it("skips resolved, blocked, and snapped throws", () => {
    const q = [
      { resolvedSec: 1, blockedSec: null, snappedSec: null },
      { resolvedSec: null, blockedSec: 2, snappedSec: null },
      { resolvedSec: null, blockedSec: null, snappedSec: 3 },
      { resolvedSec: null, blockedSec: null, snappedSec: null },
    ];
    expect(firstUnresolvedIndex(q)).toBe(3);
    expect(firstUnresolvedIndex(q.slice(0, 3))).toBe(-1);
    expect(firstUnresolvedIndex([])).toBe(-1);
  });
});

describe("reasonExcerpt", () => {
  it("flattens whitespace and cuts long reasons on char boundaries", () => {
    expect(reasonExcerpt("tests are\n failing")).toBe("tests are failing");
    const long = "あ".repeat(40);
    expect(reasonExcerpt(long)).toBe("あ".repeat(28) + "…");
  });
});

describe("badgeLabel", () => {
  const base: HookFlash = {
    event: "Stop",
    tool: null,
    firedAt: 0,
    correlationId: null,
    isError: null,
    outcome: null,
    durationMs: null,
    hookCommand: null,
    blockReason: null,
    phase: "fire",
  };
  it("plain firing keeps the original form", () => {
    expect(badgeLabel(base)).toBe("🪝 Stop");
    expect(badgeLabel({ ...base, event: "PreToolUse", tool: "Bash" })).toBe("🪝 PreToolUse Bash");
  });
  it("recorded outcomes decorate the badge", () => {
    expect(badgeLabel({ ...base, outcome: "Completed", durationMs: 2868 })).toBe("🪝 Stop ✓2.9s");
    expect(badgeLabel({ ...base, event: "PreToolUse", tool: "Read", outcome: "Blocked" })).toBe(
      "🪝⛔ PreToolUse Read"
    );
    expect(badgeLabel({ ...base, outcome: "Cancelled" })).toBe("🪝✂️ Stop");
  });
});
