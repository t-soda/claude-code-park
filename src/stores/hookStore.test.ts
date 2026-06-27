import { describe, it, expect } from "vitest";
import { pruneEvents, type HookFlash } from "./hookStore";

const flash = (firedAt: number): HookFlash => ({
  event: "PostToolUse",
  tool: "Edit",
  firedAt,
  correlationId: "tu_1",
  isError: false,
});

describe("pruneEvents", () => {
  it("keeps fresh flashes within TTL", () => {
    const now = 10_000;
    const out = pruneEvents({ a: flash(9_000) }, now, 2_000);
    expect(out.a).toBeDefined();
  });

  it("drops flashes older than TTL", () => {
    const now = 10_000;
    const out = pruneEvents({ a: flash(7_000) }, now, 2_000);
    expect(out.a).toBeUndefined();
  });

  it("returns the same content when nothing expires", () => {
    const now = 1_000;
    const input = { a: flash(900), b: flash(950) };
    const out = pruneEvents(input, now, 2_000);
    expect(Object.keys(out).sort()).toEqual(["a", "b"]);
  });
});
