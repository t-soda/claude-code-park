import { describe, it, expect } from "vitest";
import type { ReplayData, ReplayEvent } from "../bindings";
import {
  LINGER_MS,
  activeRowIndex,
  createReplayCursor,
  durationMs,
  flashesFor,
  logRows,
} from "./replayEngine";
import { ev } from "./testFixtures";

function data(events: ReplayEvent[], subagents: ReplayData["subagents"] = []): ReplayData {
  const last = events.length > 0 ? events[events.length - 1].at_ms : 0;
  const subEnd = subagents.reduce((m, s) => Math.max(m, s.stop_ms), 0);
  return {
    meta: {
      session_id: "SID",
      project: "/home/u/proj",
      slug: "fix-bug",
      git_branch: "main",
      first_prompt: "fix the bug",
      started_at_ms: 1_000_000,
      ended_at_ms: 1_000_000 + Math.max(last, subEnd),
      status: "Ended",
    },
    subagents,
    events,
  };
}

/** prompt at 0, Read at 5s, turn end at 10s. */
function basicData(): ReplayData {
  return data([
    ev(0, "SessionStart"),
    ev(0, "Activity", { work: "Thinking" }),
    ev(0, "UserPrompt", { text: "fix the bug" }),
    ev(5000, "Activity", { work: "Reading", tool_name: "Read", detail: "Button.tsx" }),
    ev(5000, "PreToolUse", { tool_name: "Read", correlation_id: "c1" }),
    ev(8000, "PostToolUse", { tool_name: "Read", correlation_id: "c1", is_error: false }),
    ev(10000, "Activity", { work: "Idle" }),
    ev(10000, "TurnEnd"),
  ]);
}

describe("createReplayCursor", () => {
  it("is Idle before the first event", () => {
    const cursor = createReplayCursor(data([ev(5000, "Activity", { work: "Reading", tool_name: "Read" })]));
    const frame = cursor.seek(1000);
    expect(frame.sessions).toHaveLength(1);
    expect(frame.sessions[0].current.kind).toBe("Idle");
    expect(frame.sessions[0].status).toBe("Active");
  });

  it("applies activity exactly at its timestamp", () => {
    const cursor = createReplayCursor(basicData());
    expect(cursor.seek(4999).sessions[0].current.kind).toBe("Thinking");
    const at = cursor.seek(5000).sessions[0];
    expect(at.current.kind).toBe("Reading");
    expect(at.current.tool_name).toBe("Read");
    expect(at.current.detail).toBe("Button.tsx");
    expect(cursor.seek(10000).sessions[0].current.kind).toBe("Idle");
  });

  it("shows a subagent only within [spawn, stop+linger] and Ended after", () => {
    const sub = {
      agent_id: "A",
      subagent_type: "reviewer",
      description: null,
      model: null,
      spawn_ms: 2000,
      stop_ms: 6000,
    };
    const cursor = createReplayCursor(
      data(
        [
          ev(2000, "SubagentSpawn", { detail: "reviewer" }),
          ev(4000, "Activity", { agent_id: "A", work: "Searching", tool_name: "Grep" }),
          ev(6000, "SubagentStop", { agent_id: "A" }),
          ev(20000, "TurnEnd"),
        ],
        [sub]
      )
    );
    expect(cursor.seek(1999).sessions[0].subagents).toHaveLength(0);
    const active = cursor.seek(4000).sessions[0].subagents[0];
    expect(active.status).toBe("Active");
    expect(active.current.kind).toBe("Searching");
    // Still lingering right after stop, Ended once the linger window passes.
    expect(cursor.seek(6000 + LINGER_MS).sessions[0].subagents[0].status).toBe("Active");
    expect(cursor.seek(6000 + LINGER_MS + 1).sessions[0].subagents[0].status).toBe("Ended");
  });

  it("never creates a sprite for an unlinked (empty agent_id) subagent", () => {
    const sub = {
      agent_id: "",
      subagent_type: "ghost",
      description: null,
      model: null,
      spawn_ms: 0,
      stop_ms: 0,
    };
    const cursor = createReplayCursor(data([ev(1000, "TurnEnd")], [sub]));
    expect(cursor.seek(500).sessions[0].subagents).toHaveLength(0);
  });

  it("seek(T) equals many small advances to T (determinism)", () => {
    const d = basicData();
    const a = createReplayCursor(d);
    const b = createReplayCursor(d);
    let frameB = b.seek(0);
    for (let t = 0; t <= 10000; t += 250) {
      frameB = b.advance(t).frame;
    }
    const frameA = a.seek(10000);
    expect(frameB.sessions).toEqual(frameA.sessions);
  });

  it("advance returns the same frame reference when nothing crossed", () => {
    const cursor = createReplayCursor(basicData());
    const first = cursor.advance(1000).frame;
    const second = cursor.advance(2000).frame;
    expect(second).toBe(first);
    const third = cursor.advance(5000).frame;
    expect(third).not.toBe(first);
  });

  it("advance reports crossed events once, and going backward is a flash-free seek", () => {
    const cursor = createReplayCursor(basicData());
    // Events at exactly 0 are part of the initial seek(0) state, not "crossed".
    const { crossed } = cursor.advance(5000);
    expect(crossed.map((e) => e.kind)).toEqual(["Activity", "PreToolUse"]);
    expect(cursor.advance(5000).crossed).toHaveLength(0);
    const back = cursor.advance(1000);
    expect(back.crossed).toHaveLength(0);
    expect(back.frame.sessions[0].current.kind).toBe("Thinking");
  });

  it("clears a subagent's activity to Idle on SubagentStop instead of lingering on its last tool", () => {
    const sub = {
      agent_id: "A",
      subagent_type: "reviewer",
      description: null,
      model: null,
      spawn_ms: 0,
      stop_ms: 3000,
    };
    const cursor = createReplayCursor(
      data(
        [
          ev(0, "SubagentSpawn"),
          ev(1000, "Activity", { agent_id: "A", work: "Running", tool_name: "Bash" }),
          ev(3000, "SubagentStop", { agent_id: "A" }),
        ],
        [sub]
      )
    );
    const during = cursor.seek(3000 + 1).sessions[0].subagents[0].current;
    expect(during.kind).toBe("Idle");
    expect(during.tool_name).toBeNull();
  });

  it("rebuilds the frame when only a linger window expires (no event crossed)", () => {
    const sub = {
      agent_id: "A",
      subagent_type: null,
      description: null,
      model: null,
      spawn_ms: 0,
      stop_ms: 1000,
    };
    const cursor = createReplayCursor(
      data([ev(0, "SessionStart"), ev(20000, "TurnEnd")], [sub])
    );
    cursor.advance(2000);
    const after = cursor.advance(1000 + LINGER_MS + 1);
    expect(after.crossed).toHaveLength(0);
    expect(after.frame.sessions[0].subagents[0].status).toBe("Ended");
  });
});

describe("flashesFor", () => {
  it("maps kinds to live event names and keys by agent_id ?? session_id", () => {
    const flashes = flashesFor(
      [
        ev(0, "UserPrompt"),
        ev(0, "PreToolUse", { tool_name: "Read", correlation_id: "c1" }),
        ev(0, "SubagentStop", { agent_id: "A" }),
        ev(0, "Activity", { work: "Reading" }), // not a flash
      ],
      1000,
      "SID"
    );
    // Later orchestrator events win within a tick (one flash per actor).
    expect(Object.keys(flashes).sort()).toEqual(["A", "SID"]);
    expect(flashes.SID.event).toBe("PreToolUse");
    expect(flashes.SID.tool).toBe("Read");
    expect(flashes.SID.correlationId).toBe("c1");
    expect(flashes.A.event).toBe("SubagentStop");
  });

  it("gives every emission a unique firedAt (renderer dedupes by equality)", () => {
    const flashes = flashesFor(
      [ev(0, "TurnEnd"), ev(0, "SubagentStop", { agent_id: "A" })],
      1000,
      "SID"
    );
    expect(flashes.SID.firedAt).not.toBe(flashes.A.firedAt);
  });

  it("maps TurnEnd to Stop and UserPrompt to UserPromptSubmit", () => {
    expect(flashesFor([ev(0, "TurnEnd")], 0, "SID").SID.event).toBe("Stop");
    expect(flashesFor([ev(0, "UserPrompt")], 0, "SID").SID.event).toBe("UserPromptSubmit");
  });
});

describe("logRows / activeRowIndex", () => {
  it("keeps narrative rows and tool activities, drops Pre/Post and tool-less activities", () => {
    const rows = logRows(basicData());
    expect(rows.map((r) => r.kind)).toEqual([
      "SessionStart",
      "UserPrompt",
      "Activity", // Read
      "TurnEnd",
    ]);
  });

  it("collapses consecutive TurnEnd rows from the double turn-boundary entries", () => {
    const rows = logRows(
      data([
        ev(1000, "TurnEnd"), // turn_duration
        ev(1001, "TurnEnd"), // stop_hook_summary
        ev(2000, "UserPrompt"),
        ev(3000, "TurnEnd"),
        ev(3000, "SubagentStop", { agent_id: "A" }),
        ev(3001, "SubagentStop", { agent_id: "A" }), // kept: not a TurnEnd pair
      ])
    );
    expect(rows.map((r) => r.kind)).toEqual([
      "TurnEnd",
      "UserPrompt",
      "TurnEnd",
      "SubagentStop",
      "SubagentStop",
    ]);
  });

  it("still collapses the TurnEnd pair when a same-instant SubagentStop sorts between them", () => {
    // A regression case: an unrelated subagent's SubagentStop happens to land between
    // the turn boundary's two TurnEnd entries after the at_ms stable sort, which used
    // to defeat a "check the immediately preceding row" dedup.
    const rows = logRows(
      data([
        ev(1000, "TurnEnd"), // turn_duration
        ev(1000, "SubagentStop", { agent_id: "A" }),
        ev(1001, "TurnEnd"), // stop_hook_summary
      ])
    );
    expect(rows.map((r) => r.kind)).toEqual(["TurnEnd", "SubagentStop"]);
  });

  it("keeps a second turn boundary after a Stop-hook continuation (no prompt between)", () => {
    // A Stop hook blocking the stop makes the orchestrator resume work and end the
    // turn again later without any UserPrompt in between; the second boundary is a
    // real event and must survive the pair-collapsing.
    const rows = logRows(
      data([
        ev(1000, "TurnEnd"), // turn_duration
        ev(1001, "TurnEnd"), // stop_hook_summary (hook blocked the stop)
        ev(2000, "Activity", { work: "Editing", tool_name: "Edit" }),
        ev(3000, "TurnEnd"), // the real, second turn end
        ev(3001, "TurnEnd"),
      ])
    );
    expect(rows.map((r) => r.kind)).toEqual(["TurnEnd", "Activity", "TurnEnd"]);
  });

  it("finds the last row at or before the playhead by binary search", () => {
    const rows = logRows(basicData());
    expect(activeRowIndex(rows, -1)).toBe(-1);
    expect(activeRowIndex(rows, 0)).toBe(1); // SessionStart & UserPrompt at 0 -> last one
    expect(activeRowIndex(rows, 4999)).toBe(1);
    expect(activeRowIndex(rows, 5000)).toBe(2);
    expect(activeRowIndex(rows, 99999)).toBe(rows.length - 1);
  });
});

describe("durationMs", () => {
  it("is ended minus started, floored at 0", () => {
    expect(durationMs(basicData())).toBe(10000);
  });
});
