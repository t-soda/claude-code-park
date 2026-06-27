import { describe, it, expect } from "vitest";
import type { ScopedHook } from "../bindings";
import {
  LIFECYCLE_EVENTS,
  eventToSlotIndex,
  matchesTool,
  groupBySlot,
  matchingHooks,
} from "./hookLifecycle";

const sh = (over: Partial<ScopedHook> = {}): ScopedHook => ({
  scope: "user",
  matcher: null,
  command: "echo",
  ...over,
});

describe("LIFECYCLE_EVENTS", () => {
  it("has 9 kinds in firing order", () => {
    expect(LIFECYCLE_EVENTS).toHaveLength(9);
    expect(LIFECYCLE_EVENTS[0]).toBe("SessionStart");
    expect(LIFECYCLE_EVENTS[2]).toBe("PreToolUse");
    expect(LIFECYCLE_EVENTS[8]).toBe("SubagentStop");
  });
});

describe("eventToSlotIndex", () => {
  it("known events return their index, unknown returns -1", () => {
    expect(eventToSlotIndex("PreToolUse")).toBe(2);
    expect(eventToSlotIndex("Nope")).toBe(-1);
  });
});

describe("matchesTool", () => {
  it("an empty matcher is always true", () => {
    expect(matchesTool(null, "Edit")).toBe(true);
  });
  it("toolName null (non-tool event) is true", () => {
    expect(matchesTool("Edit", null)).toBe(true);
  });
  it("matches the tool name with a regex", () => {
    expect(matchesTool("Edit|Write", "Write")).toBe(true);
    expect(matchesTool("Edit|Write", "Bash")).toBe(false);
  });
  it("an invalid regex is false", () => {
    expect(matchesTool("(", "Bash")).toBe(false);
  });
});

describe("groupBySlot", () => {
  it("always returns 9 slots in firing order, including empty ones", () => {
    const groups = groupBySlot({ PreToolUse: [sh({ command: "p" })] });
    expect(groups).toHaveLength(9);
    expect(groups[2].event).toBe("PreToolUse");
    expect(groups[2].hooks).toHaveLength(1);
    expect(groups[0].hooks).toHaveLength(0); // SessionStart is empty
  });
});

describe("matchingHooks", () => {
  it("returns only hooks whose matcher matches the tool", () => {
    const group = {
      event: "PreToolUse",
      index: 2,
      hooks: [sh({ matcher: "Edit" }), sh({ matcher: "Bash" }), sh({ matcher: null })],
    };
    const r = matchingHooks(group, "Edit");
    expect(r).toHaveLength(2); // "Edit" and null (matches all)
  });
});
