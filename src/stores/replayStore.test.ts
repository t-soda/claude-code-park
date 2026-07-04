import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReplayData } from "../bindings";
import { ev } from "../replay/testFixtures";

// Mock the Tauri IPC to verify only the store's playback behavior.
const listReplaySessions = vi.fn();
const getReplayData = vi.fn();
vi.mock("../ipc/commands", () => ({
  api: {
    listReplaySessions: () => listReplaySessions(),
    getReplayData: (sessionId: string) => getReplayData(sessionId),
  },
}));

import { useReplayStore } from "./replayStore";

/** A 10-second session: prompt at 0, Read at 5s, turn end at 10s. */
function fixture(): ReplayData {
  return {
    meta: {
      session_id: "SID",
      project: "/home/u/proj",
      slug: null,
      git_branch: null,
      first_prompt: "go",
      started_at_ms: 1_000_000,
      ended_at_ms: 1_010_000,
    },
    subagents: [],
    events: [
      ev(0, "SessionStart"),
      ev(0, "UserPrompt", { text: "go" }),
      ev(5000, "Activity", { work: "Reading", tool_name: "Read" }),
      ev(5000, "PreToolUse", { tool_name: "Read", correlation_id: "c1" }),
      ev(10000, "TurnEnd"),
    ],
  };
}

async function openFixture(): Promise<void> {
  getReplayData.mockResolvedValue(fixture());
  await useReplayStore.getState().open("SID");
}

beforeEach(() => {
  listReplaySessions.mockReset();
  getReplayData.mockReset();
  useReplayStore.getState().close();
  useReplayStore.setState({ list: null, listLoading: false, listError: null, speed: 1 });
});

describe("replayStore.open", () => {
  it("loads data and starts paused at 0 with a frame built", async () => {
    await openFixture();
    const s = useReplayStore.getState();
    expect(s.data?.meta.session_id).toBe("SID");
    expect(s.playing).toBe(false);
    expect(s.playheadMs).toBe(0);
    expect(s.frame?.sessions).toHaveLength(1);
  });

  it("ignores a stale open resolving after close", async () => {
    let resolve!: (d: ReplayData) => void;
    getReplayData.mockReturnValue(new Promise<ReplayData>((r) => (resolve = r)));
    const p = useReplayStore.getState().open("SID");
    useReplayStore.getState().close();
    resolve(fixture());
    await p;
    expect(useReplayStore.getState().data).toBeNull();
  });
});

describe("replayStore.tick", () => {
  it("advances the playhead by real dt times speed while playing", async () => {
    await openFixture();
    const s = useReplayStore.getState();
    s.tick(1000); // baseline for dt
    s.play();
    useReplayStore.getState().tick(1100); // +100ms real
    expect(useReplayStore.getState().playheadMs).toBe(100);
    useReplayStore.getState().setSpeed(16);
    useReplayStore.getState().tick(1200); // +100ms real at 16x
    expect(useReplayStore.getState().playheadMs).toBe(100 + 1600);
  });

  it("does not advance while paused", async () => {
    await openFixture();
    useReplayStore.getState().tick(1000);
    useReplayStore.getState().tick(2000);
    expect(useReplayStore.getState().playheadMs).toBe(0);
  });

  it("emits flashes for crossed events", async () => {
    await openFixture();
    useReplayStore.getState().tick(1000);
    useReplayStore.getState().play();
    useReplayStore.getState().setSpeed(16);
    useReplayStore.getState().tick(1400); // +400ms real = 6400 virtual: crosses prompt + Read
    const flashes = useReplayStore.getState().flashes;
    expect(flashes.SID?.event).toBe("PreToolUse");
    expect(flashes.SID?.tool).toBe("Read");
  });

  it("clamps at the end and auto-pauses", async () => {
    await openFixture();
    useReplayStore.getState().tick(1000);
    useReplayStore.getState().play();
    useReplayStore.getState().setSpeed(16);
    useReplayStore.getState().tick(2000); // +1000ms real = 16s virtual > 10s duration
    const s = useReplayStore.getState();
    expect(s.playheadMs).toBe(10000);
    expect(s.playing).toBe(false);
  });

  it("play() from the end restarts from 0", async () => {
    await openFixture();
    useReplayStore.getState().seek(10000);
    useReplayStore.getState().play();
    const s = useReplayStore.getState();
    expect(s.playheadMs).toBe(0);
    expect(s.playing).toBe(true);
  });
});

describe("replayStore.seek", () => {
  it("clamps into range, rebuilds the frame, and clears flashes", async () => {
    await openFixture();
    useReplayStore.getState().tick(1000);
    useReplayStore.getState().play();
    useReplayStore.getState().setSpeed(16);
    useReplayStore.getState().tick(1400); // generate some flashes
    expect(Object.keys(useReplayStore.getState().flashes)).not.toHaveLength(0);

    useReplayStore.getState().seek(999999);
    let s = useReplayStore.getState();
    expect(s.playheadMs).toBe(10000);
    expect(s.flashes).toEqual({});

    useReplayStore.getState().seek(-50);
    s = useReplayStore.getState();
    expect(s.playheadMs).toBe(0);
    expect(s.frame?.sessions[0].current.kind).not.toBe("Reading");
  });
});

describe("replayStore.loadList", () => {
  it("fetches the browser list once and stores errors", async () => {
    listReplaySessions.mockResolvedValue([fixture().meta]);
    await useReplayStore.getState().loadList();
    expect(useReplayStore.getState().list).toHaveLength(1);

    listReplaySessions.mockRejectedValue(new Error("boom"));
    await useReplayStore.getState().loadList();
    const s = useReplayStore.getState();
    expect(s.listError).toContain("boom");
    // A previously successful list must survive a later transient failure instead
    // of the browser flipping from "sessions available" to "no sessions".
    expect(s.list).toHaveLength(1);
  });

  it("leaves list null (not []) when the very first fetch fails", async () => {
    listReplaySessions.mockRejectedValue(new Error("boom"));
    await useReplayStore.getState().loadList();
    const s = useReplayStore.getState();
    expect(s.listError).toContain("boom");
    expect(s.list).toBeNull();
  });
});

describe("replayStore.open failure", () => {
  it("clears any stale previous session instead of leaving it live under an error", async () => {
    await openFixture();
    expect(useReplayStore.getState().data?.meta.session_id).toBe("SID");

    getReplayData.mockRejectedValue(new Error("not found"));
    await useReplayStore.getState().open("OTHER");
    const s = useReplayStore.getState();
    expect(s.dataError).toContain("not found");
    expect(s.data).toBeNull();
    expect(s.frame).toBeNull();
  });
});

describe("replayStore.play", () => {
  it("does nothing for a zero-duration session instead of flickering playing on/off", async () => {
    getReplayData.mockResolvedValue({
      meta: {
        session_id: "SID",
        project: "/home/u/proj",
        slug: null,
        git_branch: null,
        first_prompt: "go",
        started_at_ms: 1_000_000,
        ended_at_ms: 1_000_000,
      },
      subagents: [],
      events: [ev(0, "SessionStart")],
    } satisfies ReplayData);
    await useReplayStore.getState().open("SID");
    useReplayStore.getState().play();
    expect(useReplayStore.getState().playing).toBe(false);
  });
});

describe("replayStore.tick dt clamp", () => {
  it("caps a single tick's advance so a paused/backgrounded gap doesn't jump the playhead", async () => {
    await openFixture();
    useReplayStore.getState().tick(1000); // baseline
    useReplayStore.getState().play();
    // Simulate a large real-time gap (e.g. a backgrounded tab pausing the ticker
    // for a minute) resolving in one tick call.
    useReplayStore.getState().tick(1000 + 60_000);
    // Clamped to MAX_TICK_DT_MS (2000ms) at 1x speed, not the full 60s gap.
    expect(useReplayStore.getState().playheadMs).toBe(2000);
  });
});
