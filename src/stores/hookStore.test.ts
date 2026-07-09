import { describe, it, expect } from "vitest";
import { mergeFlash, pruneEvents, type HookFlash } from "./hookStore";

const flash = (firedAt: number, over: Partial<HookFlash> = {}): HookFlash => ({
  event: "PostToolUse",
  tool: "Edit",
  firedAt,
  correlationId: "tu_1",
  isError: false,
  outcome: null,
  durationMs: null,
  hookCommand: null,
  blockReason: null,
  phase: "fire",
  ...over,
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

describe("mergeFlash", () => {
  const rich = flash(1_000, {
    event: "Stop",
    outcome: "Completed",
    durationMs: 2_868,
  });
  const bare = flash(1_010, { event: "Stop" });

  it("a bare same-event twin does not displace a rich flash", () => {
    // turn_duration and stop_hook_summary reconstruct to the same Stop; the
    // one carrying the execution record must win regardless of arrival order.
    expect(mergeFlash(rich, bare)).toBe(rich);
  });

  it("a rich flash always displaces a bare one", () => {
    expect(mergeFlash(bare, rich)).toBe(rich);
  });

  it("without a previous flash the incoming one wins", () => {
    expect(mergeFlash(undefined, bare)).toBe(bare);
  });

  it("a different event is never swallowed", () => {
    const prompt = flash(1_010, { event: "UserPromptSubmit" });
    expect(mergeFlash(rich, prompt)).toBe(prompt);
  });

  it("a bare twin outside the merge window is a genuine new firing", () => {
    const nextTurn = flash(5_000, { event: "Stop" });
    expect(mergeFlash(rich, nextTurn)).toBe(nextTurn);
  });

  it("a run-start is never swallowed by an earlier rich flash", () => {
    // A rich Stop from turn N followed by turn N+1's run-start marker.
    const runStart = flash(1_200, { event: "Stop", phase: "run-start" });
    expect(mergeFlash(rich, runStart)).toBe(runStart);
  });
});
