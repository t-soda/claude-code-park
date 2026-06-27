/** Time of day. The unit for swapping floor/wall tints. */
export type TimeOfDay = "day" | "evening" | "night";

/** Color theme for the iso floor/wall (drops background images and expresses the time of day via tint). */
export interface FloorTheme {
  /** Light color of the floor-tile checkerboard. */
  floorA: number;
  /** Dark color of the floor-tile checkerboard. */
  floorB: number;
  /** Wall color. */
  wall: number;
  /** Bright color of the wall coping (top edge). */
  wallTop: number;
  /** Floor perimeter, room outlines, and tile grout. */
  line: number;
  /** Mat laid under desks (visually grouping the seats). */
  rug: number;
  /** Special mat laid under the Orchestrator seat. */
  rugOrchestrator: number;
  /** Canvas background (the base color seen outside the floor). */
  bg: number;
  /** id of the ground asset to use (assetManifest). Night uses a dedicated image; day/evening tint the shared image. */
  groundId: string;
  /** Multiplicative tint applied to the ground image (time-of-day color). White (no change) for dedicated images. */
  groundTint: number;
}

/** Floor theme per time of day. Based on a warm palette, shifting to cool colors at night. */
export const FLOOR_THEMES: Record<TimeOfDay, FloorTheme> = {
  day: {
    floorA: 0xd8cbb0,
    floorB: 0xccbfa2,
    wall: 0xb39b78,
    wallTop: 0xd7c39c,
    line: 0x7d6c50,
    rug: 0x5f7d8a,
    rugOrchestrator: 0xc0954a,
    bg: 0x6f86a8,
    groundId: "groundDay",
    groundTint: 0xffffff,
  },
  evening: {
    floorA: 0xc1a98e,
    floorB: 0xb59c80,
    wall: 0x8c6f5b,
    wallTop: 0xb38f6f,
    line: 0x5e4836,
    rug: 0x5a6b78,
    rugOrchestrator: 0xa67c3c,
    bg: 0x6b4e73,
    groundId: "groundEvening",
    groundTint: 0xffffff,
  },
  night: {
    floorA: 0x6f6a86,
    floorB: 0x64607c,
    wall: 0x4a4763,
    wallTop: 0x6c6690,
    line: 0x2c2940,
    rug: 0x40506e,
    rugOrchestrator: 0x6a5a86,
    bg: 0x10162e,
    groundId: "groundNight",
    groundTint: 0xffffff,
  },
};

/**
 * Determine the time of day from the hour (0-23).
 * Day 6:00-16:59 / evening 17:00-18:59 / night 19:00-5:59 (wrapping past midnight).
 */
export function timeOfDayForHour(hour: number): TimeOfDay {
  if (hour >= 6 && hour < 17) return "day";
  if (hour >= 17 && hour < 19) return "evening";
  return "night";
}
