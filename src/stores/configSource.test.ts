import { describe, it, expect, vi } from "vitest";

vi.mock("../ipc/commands", () => ({ api: {} }));

import { bundleGlobal, bundleScoped } from "./configSource";

describe("bundleGlobal", () => {
  it("bundles singleton state into the unified shape as-is", () => {
    const saveAgent = vi.fn();
    const b = bundleGlobal({
      agents: [{ name: "a" }],
      hooks: {},
      skills: [],
      commands: [],
      loaded: true,
      error: null,
      saveAgent,
      deleteAgent: vi.fn(),
      toggleSkill: vi.fn(),
      saveSkill: vi.fn(),
      updateHooks: vi.fn(),
    } as never);
    expect(b.agents).toHaveLength(1);
    expect(b.loaded).toBe(true);
    b.saveAgent({ name: "x" } as never, true);
    expect(saveAgent).toHaveBeenCalledWith({ name: "x" }, true);
  });
});

describe("bundleScoped", () => {
  it("bundles the matching project slice and delegates edits with project supplied", () => {
    const updateHooks = vi.fn();
    const store = {
      byProject: { "/p": { agents: [], hooks: { Stop: [] }, skills: [], commands: [], loaded: true, error: null } },
      ensure: vi.fn(),
      saveAgent: vi.fn(),
      deleteAgent: vi.fn(),
      toggleSkill: vi.fn(),
      saveSkill: vi.fn(),
      updateHooks,
    };
    const b = bundleScoped(store as never, "/p");
    expect(b.loaded).toBe(true);
    expect(b.hooks.Stop).toEqual([]);
    b.updateHooks({ Stop: [] });
    expect(updateHooks).toHaveBeenCalledWith("/p", { Stop: [] });
  });

  it("returns an empty slice with loaded=false for an unfetched project", () => {
    const store = { byProject: {}, ensure: vi.fn(), saveAgent: vi.fn(), deleteAgent: vi.fn(), toggleSkill: vi.fn(), saveSkill: vi.fn(), updateHooks: vi.fn() };
    const b = bundleScoped(store as never, "/x");
    expect(b.loaded).toBe(false);
    expect(b.agents).toEqual([]);
  });
});
