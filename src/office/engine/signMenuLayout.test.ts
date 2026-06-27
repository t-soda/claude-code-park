import { describe, it, expect } from "vitest";
import { hitIcon, signIconLayout, ICON } from "./signMenuLayout";

const rect = { minX: 100, minY: 50, maxX: 124, maxY: 74 };

describe("hitIcon", () => {
  it("hit when inside the rectangle", () => {
    expect(hitIcon(110, 60, rect)).toBe(true);
    expect(hitIcon(100, 50, rect)).toBe(true);
  });
  it("miss when outside the rectangle", () => {
    expect(hitIcon(99, 60, rect)).toBe(false);
    expect(hitIcon(110, 75, rect)).toBe(false);
  });
});

describe("signIconLayout", () => {
  it("the terminal icon sits next to the right edge of the sign, with the menu lined up to its right", () => {
    const { terminal, menu } = signIconLayout(200, 40);
    expect(terminal.x).toBe(200 + ICON.gap);
    expect(terminal.y).toBe(40);
    expect(menu.x).toBe(terminal.x + ICON.size + ICON.gap);
    expect(menu.y).toBe(40);
  });
});
