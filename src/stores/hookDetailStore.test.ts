import { describe, it, expect, beforeEach } from "vitest";
import { useHookDetailStore } from "./hookDetailStore";

describe("useHookDetailStore", () => {
  beforeEach(() => useHookDetailStore.getState().close());
  it("holds group and anchor on open, clears them on close", () => {
    const group = { event: "PreToolUse", index: 2, hooks: [] };
    useHookDetailStore.getState().open(group, { x: 10, y: 20 });
    expect(useHookDetailStore.getState().group?.event).toBe("PreToolUse");
    expect(useHookDetailStore.getState().anchor).toEqual({ x: 10, y: 20 });
    useHookDetailStore.getState().close();
    expect(useHookDetailStore.getState().group).toBeNull();
  });
});
