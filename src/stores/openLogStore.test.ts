import { describe, it, expect } from "vitest";
import { dialogPlacement, dialogMaxHeight, isToolRow } from "./openLogStore";
import type { TimelineEntry } from "../bindings";

describe("dialogPlacement", () => {
  const size = { w: 400, h: 200 };
  const viewport = { w: 1000, h: 800 };

  it("opens to the upper right if there is room above the character, with the character at the dialog's lower-left corner", () => {
    const p = dialogPlacement({ x: 500, y: 400 }, viewport, size);
    expect(p.left).toBe(500); // left edge = character x
    expect(p.top).toBe(400 - size.h); // bottom edge = character y → top=200
    expect(p.attach).toEqual({ x: 500, y: 400 }); // bottom-left corner = character
  });

  it("opens downward if there isn't enough room above, with the character at the dialog's upper-left corner", () => {
    const p = dialogPlacement({ x: 500, y: 100 }, viewport, size);
    expect(p.top).toBe(100); // downward → top = character y
    expect(p.attach).toEqual({ x: 500, y: 100 }); // top-left corner = character
  });

  it("on a right-edge click, left is clamped to stay on screen", () => {
    const p = dialogPlacement({ x: 980, y: 400 }, viewport, size);
    expect(p.left).toBe(viewport.w - size.w - 8); // 592
    expect(p.left + size.w).toBeLessThanOrEqual(viewport.w);
    expect(p.attach.y).toBe(400); // y stays at the character
  });
});

describe("dialogMaxHeight", () => {
  it("when opening upward, fits within the room above the character (excluding the screen-edge margin)", () => {
    // h=800 → cap 560. The space 392 is smaller, so 392.
    expect(dialogMaxHeight({ x: 500, y: 400 }, { w: 1000, h: 800 })).toBe(400 - 8); // 392
  });

  it("when opening downward (little room above), fits within the room below the character", () => {
    // Open downward on a short screen: cap 210 (=300*0.7), but the space below 192 is smaller, so 192.
    expect(dialogMaxHeight({ x: 500, y: 100 }, { w: 1000, h: 300 })).toBe(300 - 100 - 8); // 192
  });

  it("caps at 70% of the screen height even when there is plenty of room", () => {
    // y=750 → space above is 742, but clamp to the cap 560 (=800*0.7)
    expect(dialogMaxHeight({ x: 500, y: 750 }, { w: 1000, h: 800 })).toBe(560);
  });
});

describe("isToolRow", () => {
  const base: TimelineEntry = {
    ts: null,
    kind: "Reading",
    detail: null,
    tool_name: null,
    active_skill: null,
    block_reason: null,
  };
  it("a tool row if tool_name is present", () => {
    expect(isToolRow({ ...base, tool_name: "Read" })).toBe(true);
  });
  it("a non-tool row (thinking / turn boundary) if tool_name is absent", () => {
    expect(isToolRow({ ...base, kind: "Thinking" })).toBe(false);
  });
  it("not a tool row for a hook-block row, even though it carries the blocked tool's name", () => {
    expect(isToolRow({ ...base, kind: null, tool_name: "Bash", block_reason: "not allowed" })).toBe(false);
  });
});
