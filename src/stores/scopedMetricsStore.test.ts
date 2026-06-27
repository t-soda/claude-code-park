import { describe, it, expect, vi, beforeEach } from "vitest";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const getMetrics = vi.fn();
vi.mock("../ipc/commands", () => ({ api: { getMetrics: (p?: string) => getMetrics(p) } }));

import { useScopedMetricsStore } from "./scopedMetricsStore";

beforeEach(() => {
  getMetrics.mockReset();
  useScopedMetricsStore.setState({ byProject: {} });
});

describe("scopedMetricsStore", () => {
  it("ensureLoaded fetches with a project and fills the slice", async () => {
    getMetrics.mockResolvedValueOnce([{ agent_name: "a", windows: {} }]);
    await useScopedMetricsStore.getState().ensureLoaded("/p");
    expect(getMetrics).toHaveBeenCalledWith("/p");
    expect(useScopedMetricsStore.getState().byProject["/p"].metrics).toHaveLength(1);
    expect(useScopedMetricsStore.getState().byProject["/p"].loaded).toBe(true);
  });

  it("ensureLoaded does not refetch an already-fetched project", async () => {
    getMetrics.mockResolvedValue([]);
    await useScopedMetricsStore.getState().ensureLoaded("/p");
    await useScopedMetricsStore.getState().ensureLoaded("/p");
    expect(getMetrics).toHaveBeenCalledTimes(1);
  });

  it("on failure, sets error and loaded stays false", async () => {
    getMetrics.mockRejectedValueOnce(new Error("boom"));
    await useScopedMetricsStore.getState().load("/p");
    expect(useScopedMetricsStore.getState().byProject["/p"].error).toContain("boom");
    expect(useScopedMetricsStore.getState().byProject["/p"].loaded).toBe(false);
  });

  it("concurrent ensureLoaded for the same project calls the API only once (in-flight dedupe)", async () => {
    const d = deferred<{ agent_name: string; windows: Record<string, unknown> }[]>();
    getMetrics.mockReturnValue(d.promise);

    const p1 = useScopedMetricsStore.getState().ensureLoaded("/p");
    const p2 = useScopedMetricsStore.getState().ensureLoaded("/p");
    expect(getMetrics).toHaveBeenCalledTimes(1);

    d.resolve([{ agent_name: "a", windows: {} }]);
    await Promise.all([p1, p2]);

    expect(getMetrics).toHaveBeenCalledTimes(1);
    expect(useScopedMetricsStore.getState().byProject["/p"].loaded).toBe(true);
  });

  it("concurrent load for the same project calls the API only once (in-flight dedupe)", async () => {
    const d = deferred<{ agent_name: string; windows: Record<string, unknown> }[]>();
    getMetrics.mockReturnValue(d.promise);

    const p1 = useScopedMetricsStore.getState().load("/p");
    const p2 = useScopedMetricsStore.getState().load("/p");
    expect(getMetrics).toHaveBeenCalledTimes(1);

    d.resolve([]);
    await Promise.all([p1, p2]);

    expect(getMetrics).toHaveBeenCalledTimes(1);
  });
});
