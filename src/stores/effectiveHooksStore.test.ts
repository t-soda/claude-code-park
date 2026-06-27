import { describe, it, expect } from "vitest";
import { uniqueProjects } from "./effectiveHooksStore";

describe("uniqueProjects", () => {
  it("dedupes while excluding empty projects", () => {
    const r = uniqueProjects([
      { project: "/a" },
      { project: "/a" },
      { project: "/b" },
      { project: "" },
    ]);
    expect(r.sort()).toEqual(["/a", "/b"]);
  });
});
