import { describe, it, expect } from "vitest";
import { isClick } from "./clickDetect";

describe("isClick", () => {
  it("treated as a click if barely moved", () => {
    expect(isClick(0, 0)).toBe(true);
    expect(isClick(3, 2)).toBe(true); // distance < 5
  });
  it("treated as a drag (not a click) if moved beyond the threshold", () => {
    expect(isClick(10, 0)).toBe(false);
    expect(isClick(4, 4)).toBe(false); // distance ~5.66 >= 5
  });
});
