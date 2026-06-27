import { describe, it, expect } from "vitest";
import { socketOffsets } from "./hookRailLayout";

describe("socketOffsets", () => {
  it("returns center-aligned, evenly spaced x offsets", () => {
    const xs = socketOffsets(3, 20);
    expect(xs).toEqual([-20, 0, 20]);
  });
  it("symmetric about the center even for an even count", () => {
    const xs = socketOffsets(2, 20);
    expect(xs).toEqual([-10, 10]);
  });
});
