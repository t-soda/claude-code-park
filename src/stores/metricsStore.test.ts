import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Tauri IPC (api.getMetrics) to verify only the store's loading behavior.
const getMetrics = vi.fn();
vi.mock("../ipc/commands", () => ({
  api: { getMetrics: () => getMetrics() },
}));

import { useMetricsStore } from "./metricsStore";

const reset = () =>
  useMetricsStore.setState({
    metrics: [],
    loading: false,
    loaded: false,
    error: null,
  });

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  getMetrics.mockReset();
  reset();
});

describe("metricsStore.load", () => {
  it("collapses multiple calls into a single fetch (dedupes double loads)", async () => {
    const d = deferred<unknown[]>();
    getMetrics.mockReturnValue(d.promise);

    const { load } = useMetricsStore.getState();
    const p1 = load();
    const p2 = load();
    expect(getMetrics).toHaveBeenCalledTimes(1);

    d.resolve([{ agent_name: "a", windows: {} }]);
    await Promise.all([p1, p2]);

    expect(getMetrics).toHaveBeenCalledTimes(1);
    expect(useMetricsStore.getState().metrics).toHaveLength(1);
    expect(useMetricsStore.getState().loading).toBe(false);
  });

  it("loading=true while fetching, loading=false after completion", async () => {
    const d = deferred<unknown[]>();
    getMetrics.mockReturnValue(d.promise);

    const p = useMetricsStore.getState().load();
    expect(useMetricsStore.getState().loading).toBe(true);

    d.resolve([]);
    await p;
    expect(useMetricsStore.getState().loading).toBe(false);
  });

  it("keeps the previous result while refetching (shows cache while updating in the background)", async () => {
    const d1 = deferred<unknown[]>();
    getMetrics.mockReturnValueOnce(d1.promise);
    const p1 = useMetricsStore.getState().load();
    d1.resolve([{ agent_name: "a", windows: {} }]);
    await p1;
    expect(useMetricsStore.getState().metrics).toHaveLength(1);

    const d2 = deferred<unknown[]>();
    getMetrics.mockReturnValueOnce(d2.promise);
    const p2 = useMetricsStore.getState().load();
    // The previous result isn't cleared even while fetching (nothing goes blank).
    expect(useMetricsStore.getState().loading).toBe(true);
    expect(useMetricsStore.getState().metrics).toHaveLength(1);

    d2.resolve([
      { agent_name: "a", windows: {} },
      { agent_name: "b", windows: {} },
    ]);
    await p2;
    expect(useMetricsStore.getState().metrics).toHaveLength(2);
  });

  it("a call after completion triggers a new fetch", async () => {
    getMetrics.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await useMetricsStore.getState().load();
    await useMetricsStore.getState().load();
    expect(getMetrics).toHaveBeenCalledTimes(2);
  });

  it("on failure, sets error and clears loading", async () => {
    getMetrics.mockRejectedValueOnce(new Error("boom"));
    await useMetricsStore.getState().load();
    expect(useMetricsStore.getState().loading).toBe(false);
    expect(useMetricsStore.getState().error).toContain("boom");
  });

  it("loaded starts false and becomes true on a successful fetch", async () => {
    expect(useMetricsStore.getState().loaded).toBe(false);
    getMetrics.mockResolvedValueOnce([]);
    await useMetricsStore.getState().load();
    expect(useMetricsStore.getState().loaded).toBe(true);
  });

  it("loaded stays false on a failed fetch", async () => {
    getMetrics.mockRejectedValueOnce(new Error("boom"));
    await useMetricsStore.getState().load();
    expect(useMetricsStore.getState().loaded).toBe(false);
  });
});

describe("metricsStore.ensureLoaded", () => {
  it("triggers a fetch if not yet loaded", async () => {
    getMetrics.mockResolvedValueOnce([]);
    await useMetricsStore.getState().ensureLoaded();
    expect(getMetrics).toHaveBeenCalledTimes(1);
    expect(useMetricsStore.getState().loaded).toBe(true);
  });

  it("does not refetch if already loaded (makes reopening instant)", async () => {
    getMetrics.mockResolvedValueOnce([]);
    await useMetricsStore.getState().ensureLoaded();
    await useMetricsStore.getState().ensureLoaded();
    await useMetricsStore.getState().ensureLoaded();
    expect(getMetrics).toHaveBeenCalledTimes(1);
  });

  it("ensureLoaded while fetching does not trigger a new fetch", async () => {
    const d = deferred<unknown[]>();
    getMetrics.mockReturnValue(d.promise);
    const p1 = useMetricsStore.getState().load();
    const p2 = useMetricsStore.getState().ensureLoaded();
    expect(getMetrics).toHaveBeenCalledTimes(1);
    d.resolve([]);
    await Promise.all([p1, p2]);
    expect(getMetrics).toHaveBeenCalledTimes(1);
  });
});
