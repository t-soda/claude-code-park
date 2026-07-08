import type {
  ActivityState,
  ReplayData,
  ReplayEvent,
  Session,
  SubAgentRun,
} from "../bindings";
import { mergeFlash, type HookFlash } from "../stores/hookStore";

/**
 * How long (virtual ms) a stopped sub agent keeps its sprite after SubagentStop,
 * so the stop flash is visible before the despawn removes the employee.
 */
export const LINGER_MS = 1_500;

/** A synthesized world snapshot at one playhead position. */
export interface ReplayFrame {
  sessions: Session[];
}

/**
 * Deterministic state-at-time over a ReplayData event stream.
 * seek() refolds from 0 (O(n), fine for tens of thousands of events);
 * advance() applies only the events crossed since the previous position.
 */
export interface ReplayCursor {
  seek(tMs: number): ReplayFrame;
  advance(tMs: number): { frame: ReplayFrame; crossed: ReplayEvent[] };
}

/** Total playable length of the session. */
export function durationMs(data: ReplayData): number {
  return Math.max(0, data.meta.ended_at_ms - data.meta.started_at_ms);
}

const IDLE: ActivityState = {
  kind: "Idle",
  tool_name: null,
  detail: null,
  since: null,
  active_skill: null,
  todos: [],
};

/** ActivityState from an Activity replay event (todos are a documented v1 non-goal). */
function activityFrom(ev: ReplayEvent): ActivityState {
  return {
    kind: ev.work ?? "Idle",
    tool_name: ev.tool_name,
    detail: ev.detail,
    since: null,
    active_skill: ev.active_skill,
    todos: [],
  };
}

export function createReplayCursor(data: ReplayData): ReplayCursor {
  const { events, subagents, meta } = data;
  // Frame-affecting boundaries with no event of their own: the end of each stopped
  // sub agent's linger window (Active -> Ended flips the sprite away).
  const despawnsAt: number[] = subagents
    .filter((s) => s.agent_id !== "")
    .map((s) => s.stop_ms + LINGER_MS)
    .sort((a, b) => a - b);

  // Fold state.
  let nextEvent = 0; // index of the first event with at_ms > playhead
  let nextDespawn = 0;
  let playhead = -1;
  let orch: ActivityState = IDLE;
  const agentState = new Map<string, ActivityState>();
  let frame: ReplayFrame = { sessions: [] };

  function applyEvent(ev: ReplayEvent): void {
    // A stopped subagent's last activity must not linger, showing "still running
    // Bash" for the whole despawn window after it has actually stopped.
    if (ev.kind === "SubagentStop") {
      if (ev.agent_id !== null) agentState.set(ev.agent_id, IDLE);
      return;
    }
    if (ev.kind !== "Activity") return;
    if (ev.agent_id === null) {
      orch = activityFrom(ev);
    } else {
      agentState.set(ev.agent_id, activityFrom(ev));
    }
  }

  function buildFrame(tMs: number): ReplayFrame {
    const runs: SubAgentRun[] = [];
    for (const sub of subagents) {
      if (sub.agent_id === "" || sub.spawn_ms > tMs) continue;
      runs.push({
        agent_id: sub.agent_id,
        subagent_type: sub.subagent_type,
        description: sub.description,
        model: sub.model,
        started_at: null,
        // Liveness bookkeeping is a live-tracking concern; replay derives status
        // purely from the timeline above.
        last_event_at: null,
        completed_at: null,
        // Ended after the linger window: the renderer's existing filter then
        // removes the sprite (the desired "employee leaves" behavior).
        status: tMs <= sub.stop_ms + LINGER_MS ? "Active" : "Ended",
        current: agentState.get(sub.agent_id) ?? IDLE,
        // Delegation linkage for the arcs. tool_use_id is unused by the renderer
        // (linking already happened in the backend), so it stays null here.
        tool_use_id: null,
        parent_agent_id: sub.parent_agent_id,
        spawn_depth: sub.spawn_depth,
      });
    }
    const session: Session = {
      session_id: meta.session_id,
      project: meta.project,
      git_branch: meta.git_branch,
      slug: meta.slug,
      // Always Active: bypasses the live renderer's Ended filter, and keeps the
      // room visible after the final TurnEnd (which sets the orchestrator Idle).
      status: "Active",
      started_at: null,
      last_event_at: null,
      current: orch,
      is_main: true,
      subagents: runs,
    };
    return { sessions: [session] };
  }

  function seek(tMs: number): ReplayFrame {
    nextEvent = 0;
    nextDespawn = 0;
    orch = IDLE;
    agentState.clear();
    while (nextEvent < events.length && events[nextEvent].at_ms <= tMs) {
      applyEvent(events[nextEvent]);
      nextEvent++;
    }
    while (nextDespawn < despawnsAt.length && despawnsAt[nextDespawn] <= tMs) {
      nextDespawn++;
    }
    playhead = tMs;
    frame = buildFrame(tMs);
    return frame;
  }

  function advance(tMs: number): { frame: ReplayFrame; crossed: ReplayEvent[] } {
    if (tMs < playhead) {
      // Backward jumps are a seek; scrubbing must not emit flash events.
      return { frame: seek(tMs), crossed: [] };
    }
    const crossed: ReplayEvent[] = [];
    while (nextEvent < events.length && events[nextEvent].at_ms <= tMs) {
      applyEvent(events[nextEvent]);
      crossed.push(events[nextEvent]);
      nextEvent++;
    }
    let despawned = false;
    while (nextDespawn < despawnsAt.length && despawnsAt[nextDespawn] <= tMs) {
      nextDespawn++;
      despawned = true;
    }
    playhead = tMs;
    if (crossed.length > 0 || despawned) {
      frame = buildFrame(tMs);
    }
    return { frame, crossed };
  }

  seek(0);
  return { seek, advance };
}

/** Live lifecycle event names per replay kind (must match hookLifecycle's vocabulary). */
const FLASH_EVENT: Partial<Record<ReplayEvent["kind"], string>> = {
  SessionStart: "SessionStart",
  UserPrompt: "UserPromptSubmit",
  PreToolUse: "PreToolUse",
  PostToolUse: "PostToolUse",
  TurnEnd: "Stop",
  SubagentStop: "SubagentStop",
};

/** The lifecycle a replay event fires as. HookRunStart marks a recorded
 * Stop/SubagentStop hook run, so it names the stop lifecycle of its actor. */
export function flashEventFor(ev: ReplayEvent): string | null {
  if (ev.kind === "HookRunStart") {
    return ev.agent_id !== null ? "SubagentStop" : "Stop";
  }
  return FLASH_EVENT[ev.kind] ?? null;
}

/**
 * Synthesizes hook flashes for the events crossed in one tick, in the exact shape
 * hookStore feeds the renderer: keyed by agent_id ?? session_id, one flash per actor
 * (later events win within a tick, like the live Record — except a bare duplicate
 * never displaces a rich one, see mergeFlash). firedAt values are made unique per
 * emission because the renderer dedupes by firedAt equality.
 */
export function flashesFor(
  crossed: ReplayEvent[],
  nowRealMs: number,
  sessionId: string
): Record<string, HookFlash> {
  const out: Record<string, HookFlash> = {};
  let i = 0;
  for (const ev of crossed) {
    const event = flashEventFor(ev);
    if (!event) continue;
    const key = ev.agent_id ?? sessionId;
    out[key] = mergeFlash(out[key], {
      event,
      tool: ev.tool_name,
      firedAt: nowRealMs + i * 0.001,
      correlationId: ev.correlation_id,
      isError: ev.is_error,
      outcome: ev.outcome,
      durationMs: ev.duration_ms,
      hookCommand: ev.hook_command,
      blockReason: ev.block_reason,
      phase: ev.kind === "HookRunStart" ? "run-start" : "fire",
    });
    i++;
  }
  return out;
}

/**
 * The rows shown in the replay event log. Pre/PostToolUse are visual noise there
 * (the Activity row already names the tool and detail); the rest narrate the session.
 * A turn boundary writes two TurnEnd entries close together in time (turn_duration
 * and stop_hook_summary), which would otherwise show as duplicated "Turn end" lines;
 * only the first is kept, tracked by "has a TurnEnd already been kept for the current
 * turn" rather than by adjacency in `rows` — an unrelated subagent's same-instant
 * SubagentStop can otherwise sort between the pair and defeat a simple "previous row"
 * check. The flag resets on the next UserPrompt (a new turn) and on any kept Activity
 * row (work resumed without a prompt — a Stop hook blocking the stop makes the
 * orchestrator continue and end the turn again later; that second boundary is real
 * and must not be swallowed).
 */
export function logRows(data: ReplayData): ReplayEvent[] {
  const rows: ReplayEvent[] = [];
  let turnEndKept = false;
  for (const ev of data.events) {
    switch (ev.kind) {
      case "SessionStart":
      case "SubagentSpawn":
      case "SubagentStop":
        break;
      case "UserPrompt":
        turnEndKept = false;
        break;
      case "TurnEnd":
        if (turnEndKept) continue;
        turnEndKept = true;
        break;
      case "Activity":
        if (ev.tool_name === null) continue;
        turnEndKept = false;
        break;
      default:
        continue;
    }
    rows.push(ev);
  }
  return rows;
}

/** Index of the last log row at or before the playhead (-1 before the first row). Binary search. */
export function activeRowIndex(rows: ReplayEvent[], playheadMs: number): number {
  let lo = 0;
  let hi = rows.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].at_ms <= playheadMs) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}
