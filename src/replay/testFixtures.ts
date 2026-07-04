import type { ReplayEvent, ReplayEventKind } from "../bindings";

/** Builds a ReplayEvent fixture, defaulting every field to null/absent. */
export function ev(
  at_ms: number,
  kind: ReplayEventKind,
  over: Partial<ReplayEvent> = {}
): ReplayEvent {
  return {
    at_ms,
    kind,
    agent_id: null,
    work: null,
    tool_name: null,
    detail: null,
    active_skill: null,
    correlation_id: null,
    is_error: null,
    text: null,
    ...over,
  };
}
