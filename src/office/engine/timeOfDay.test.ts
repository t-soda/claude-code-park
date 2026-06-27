import { describe, it, expect } from "vitest";
import { timeOfDayForHour, FLOOR_THEMES } from "./timeOfDay";

describe("timeOfDayForHour", () => {
  it("treats 6:00-16:59 as day", () => {
    expect(timeOfDayForHour(6)).toBe("day");
    expect(timeOfDayForHour(12)).toBe("day");
    expect(timeOfDayForHour(16)).toBe("day");
  });

  it("treats 17:00-18:59 as evening", () => {
    expect(timeOfDayForHour(17)).toBe("evening");
    expect(timeOfDayForHour(18)).toBe("evening");
  });

  it("treats 19:00-5:59 as night (wraps past midnight)", () => {
    expect(timeOfDayForHour(19)).toBe("night");
    expect(timeOfDayForHour(23)).toBe("night");
    expect(timeOfDayForHour(0)).toBe("night");
    expect(timeOfDayForHour(5)).toBe("night");
  });

  it("switches exactly at the boundaries", () => {
    expect(timeOfDayForHour(5)).toBe("night");
    expect(timeOfDayForHour(6)).toBe("day");
    expect(timeOfDayForHour(17)).toBe("evening");
    expect(timeOfDayForHour(19)).toBe("night");
  });
});

describe("FLOOR_THEMES", () => {
  it("defines a floor/wall tint theme for every time of day", () => {
    for (const tod of ["day", "evening", "night"] as const) {
      const theme = FLOOR_THEMES[tod];
      for (const key of [
        "floorA",
        "floorB",
        "wall",
        "wallTop",
        "line",
        "rug",
        "rugOrchestrator",
        "bg",
        "groundTint",
      ] as const) {
        expect(typeof theme[key]).toBe("number");
      }
      expect(typeof theme.groundId).toBe("string");
    }
  });
});
