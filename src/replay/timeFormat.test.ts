import { describe, it, expect } from "vitest";
import { formatClock } from "./timeFormat";

describe("formatClock", () => {
  it("formats minutes and seconds under an hour", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(999)).toBe("0:00");
    expect(formatClock(65_000)).toBe("1:05");
    expect(formatClock(3_599_000)).toBe("59:59");
  });

  it("adds the hour part from one hour up", () => {
    expect(formatClock(3_600_000)).toBe("1:00:00");
    expect(formatClock(3_661_000)).toBe("1:01:01");
  });

  it("floors negative values to zero", () => {
    expect(formatClock(-5000)).toBe("0:00");
  });
});
