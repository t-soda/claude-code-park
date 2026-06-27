import { describe, it, expect, vi, beforeEach } from "vitest";

const listAgents = vi.fn();
const getHooks = vi.fn();
const listSkills = vi.fn();
const listCommands = vi.fn();
const updateHooks = vi.fn();

vi.mock("../ipc/commands", () => ({
  api: {
    listAgents: (p?: string) => listAgents(p),
    getHooks: (p?: string) => getHooks(p),
    listSkills: (p?: string) => listSkills(p),
    listCommands: (p?: string) => listCommands(p),
    updateHooks: (h: unknown, p?: string) => updateHooks(h, p),
  },
}));

import { useScopedConfigStore } from "./scopedConfigStore";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  for (const f of [listAgents, getHooks, listSkills, listCommands, updateHooks]) f.mockReset();
  useScopedConfigStore.setState({ byProject: {} });
  listAgents.mockResolvedValue([{ name: "a" }]);
  getHooks.mockResolvedValue({ Stop: [] });
  listSkills.mockResolvedValue([]);
  listCommands.mockResolvedValue([]);
});

describe("scopedConfigStore.ensure", () => {
  it("fetches 4 kinds with a project argument and builds a slice", async () => {
    await useScopedConfigStore.getState().ensure("/work/p");
    expect(listAgents).toHaveBeenCalledWith("/work/p");
    const slice = useScopedConfigStore.getState().byProject["/work/p"];
    expect(slice.loaded).toBe(true);
    expect(slice.agents).toHaveLength(1);
  });

  it("does not refetch an already-fetched project", async () => {
    await useScopedConfigStore.getState().ensure("/work/p");
    await useScopedConfigStore.getState().ensure("/work/p");
    expect(listAgents).toHaveBeenCalledTimes(1);
  });

  it("concurrent ensure for the same project calls the API only once (in-flight dedupe)", async () => {
    const d = deferred<{ name: string }[]>();
    listAgents.mockReturnValue(d.promise);

    const p1 = useScopedConfigStore.getState().ensure("/work/p");
    const p2 = useScopedConfigStore.getState().ensure("/work/p");
    // While still unresolved, listAgents should have been called only once.
    expect(listAgents).toHaveBeenCalledTimes(1);

    d.resolve([{ name: "a" }]);
    await Promise.all([p1, p2]);

    expect(listAgents).toHaveBeenCalledTimes(1);
    expect(useScopedConfigStore.getState().byProject["/work/p"].loaded).toBe(true);
  });
});

describe("scopedConfigStore.updateHooks", () => {
  it("saves with a project and updates the slice's hooks", async () => {
    await useScopedConfigStore.getState().ensure("/work/p");
    updateHooks.mockResolvedValue({ Stop: [{ matcher: null, hooks: [] }] });
    await useScopedConfigStore.getState().updateHooks("/work/p", { Stop: [] });
    expect(updateHooks).toHaveBeenCalledWith({ Stop: [] }, "/work/p");
    expect(useScopedConfigStore.getState().byProject["/work/p"].hooks.Stop).toHaveLength(1);
  });
});
