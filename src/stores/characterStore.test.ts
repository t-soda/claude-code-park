import { describe, it, expect } from "vitest";
import {
  classifyModel,
  employeeVariant,
  defaults,
  GRID_SIZE,
} from "./characterStore";

describe("classifyModel", () => {
  it("classifies full model ids", () => {
    expect(classifyModel("claude-opus-4-8")).toBe("opus");
    expect(classifyModel("claude-3-5-sonnet-20241022")).toBe("sonnet");
    expect(classifyModel("claude-haiku-4-5")).toBe("haiku");
  });

  it("classifies bare aliases case-insensitively", () => {
    expect(classifyModel("Opus")).toBe("opus");
    expect(classifyModel("SONNET")).toBe("sonnet");
    expect(classifyModel("haiku")).toBe("haiku");
  });

  it("treats opus-containing aliases (e.g. opusplan) as opus", () => {
    expect(classifyModel("opusplan")).toBe("opus");
  });

  it("returns null when model is missing or unrecognized", () => {
    expect(classifyModel(null)).toBeNull();
    expect(classifyModel(undefined)).toBeNull();
    expect(classifyModel("")).toBeNull();
    expect(classifyModel("inherit")).toBeNull();
    expect(classifyModel("default")).toBeNull();
  });
});

describe("employeeVariant", () => {
  it("maps a runtime model to its model-specific template key", () => {
    expect(employeeVariant("claude-sonnet-4-6")).toBe("sonnet");
    expect(employeeVariant("claude-opus-4-8")).toBe("opus");
    expect(employeeVariant("claude-haiku-4-5")).toBe("haiku");
  });

  it("falls back to the shared 'employee' key when model is unknown", () => {
    // Use the shared default sprite when the runtime model is unavailable (unspecified / inherit).
    expect(employeeVariant(null)).toBe("employee");
    expect(employeeVariant(undefined)).toBe("employee");
    expect(employeeVariant("inherit")).toBe("employee");
  });
});

describe("model employee default grids", () => {
  it("provides a 16x16 grid for every model kind", () => {
    const d = defaults();
    for (const kind of ["haiku", "sonnet", "opus"] as const) {
      const grid = d[kind].grid;
      expect(grid).toHaveLength(GRID_SIZE);
      for (const row of grid) expect(row).toHaveLength(GRID_SIZE);
    }
  });

  it("draws distinctly sized bodies (haiku < sonnet < opus)", () => {
    const d = defaults();
    const filled = (kind: "haiku" | "sonnet" | "opus") =>
      d[kind].grid.flat().filter((c) => c !== 0).length;
    expect(filled("haiku")).toBeLessThan(filled("sonnet"));
    expect(filled("sonnet")).toBeLessThan(filled("opus"));
  });
});
