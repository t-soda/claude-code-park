import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  check: vi.fn(),
  relaunch: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: mocks.check }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: mocks.relaunch }));

import { useUpdateStore } from "./updateStore";

type DownloadEvent =
  | { event: "Started"; data: { contentLength?: number } }
  | { event: "Progress"; data: { chunkLength: number } }
  | { event: "Finished" };

function fakeUpdate(version: string, events: DownloadEvent[] = []) {
  return {
    version,
    downloadAndInstall: vi.fn(async (onEvent?: (e: DownloadEvent) => void) => {
      for (const e of events) onEvent?.(e);
    }),
    close: vi.fn(async () => {}),
  };
}

describe("updateStore", () => {
  beforeEach(async () => {
    // Clear the module-level pending Update handle via a no-update check
    // (reset status first so the check isn't skipped by the in-flight guard).
    useUpdateStore.setState({ status: "idle" });
    mocks.check.mockReset().mockResolvedValue(null);
    await useUpdateStore.getState().checkForUpdate({ silent: true });
    mocks.check.mockReset();
    mocks.relaunch.mockReset().mockResolvedValue(undefined);
    useUpdateStore.setState({
      status: "idle",
      version: null,
      progress: null,
      error: null,
      dismissed: false,
    });
  });

  it("silent check with no update stays idle (no banner)", async () => {
    mocks.check.mockResolvedValue(null);
    await useUpdateStore.getState().checkForUpdate({ silent: true });
    expect(useUpdateStore.getState().status).toBe("idle");
  });

  it("manual check with no update reports upToDate", async () => {
    mocks.check.mockResolvedValue(null);
    await useUpdateStore.getState().checkForUpdate();
    expect(useUpdateStore.getState().status).toBe("upToDate");
  });

  it("check that finds an update becomes available with its version", async () => {
    mocks.check.mockResolvedValue(fakeUpdate("0.2.0"));
    await useUpdateStore.getState().checkForUpdate({ silent: true });
    const s = useUpdateStore.getState();
    expect(s.status).toBe("available");
    expect(s.version).toBe("0.2.0");
  });

  it("silent check failure stays idle; manual failure reports the error", async () => {
    mocks.check.mockRejectedValue(new Error("offline"));
    await useUpdateStore.getState().checkForUpdate({ silent: true });
    expect(useUpdateStore.getState().status).toBe("idle");

    await useUpdateStore.getState().checkForUpdate();
    const s = useUpdateStore.getState();
    expect(s.status).toBe("error");
    expect(s.error).toContain("offline");
  });

  it("installAndRelaunch downloads with progress and relaunches", async () => {
    const update = fakeUpdate("0.2.0", [
      { event: "Started", data: { contentLength: 100 } },
      { event: "Progress", data: { chunkLength: 40 } },
      { event: "Progress", data: { chunkLength: 60 } },
      { event: "Finished" },
    ]);
    mocks.check.mockResolvedValue(update);
    await useUpdateStore.getState().checkForUpdate();
    await useUpdateStore.getState().installAndRelaunch();

    const s = useUpdateStore.getState();
    expect(update.downloadAndInstall).toHaveBeenCalledOnce();
    expect(s.status).toBe("installed");
    expect(s.progress).toBe(100);
    expect(mocks.relaunch).toHaveBeenCalledOnce();
  });

  it("download failure reports the error and does not relaunch", async () => {
    const update = fakeUpdate("0.2.0");
    update.downloadAndInstall.mockRejectedValue(new Error("disk full"));
    mocks.check.mockResolvedValue(update);
    await useUpdateStore.getState().checkForUpdate();
    await useUpdateStore.getState().installAndRelaunch();

    const s = useUpdateStore.getState();
    expect(s.status).toBe("error");
    expect(s.error).toContain("disk full");
    expect(mocks.relaunch).not.toHaveBeenCalled();
  });

  it("re-checking closes the previous Update handle before replacing it", async () => {
    const first = fakeUpdate("0.2.0");
    mocks.check.mockResolvedValue(first);
    await useUpdateStore.getState().checkForUpdate();

    const second = fakeUpdate("0.3.0");
    mocks.check.mockResolvedValue(second);
    await useUpdateStore.getState().checkForUpdate();

    expect(first.close).toHaveBeenCalledOnce();
    expect(second.close).not.toHaveBeenCalled();
    expect(useUpdateStore.getState().version).toBe("0.3.0");
  });

  it("installAndRelaunch without a pending update is a no-op", async () => {
    await useUpdateStore.getState().installAndRelaunch();
    expect(useUpdateStore.getState().status).toBe("idle");
    expect(mocks.relaunch).not.toHaveBeenCalled();
  });
});
