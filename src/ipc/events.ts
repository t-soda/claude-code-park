import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { Session, HookEvent } from "../bindings";

/** Names of the diff events emitted from Rust (must match the watcher). */
export const EV = {
  sessionsUpdated: "state://sessions/updated",
  configChanged: "state://config/changed",
  lifecycleFired: "state://lifecycle/fired",
} as const;

/** Subscribes to session-update events. Use the return value to unsubscribe. */
export function onSessionsUpdated(
  cb: (sessions: Session[]) => void
): Promise<UnlistenFn> {
  return listen<Session[]>(EV.sessionsUpdated, (e) => cb(e.payload));
}

/** Subscribes to config-change events from the CLI side. The payload is a kind string. */
export function onConfigChanged(
  cb: (kind: string) => void
): Promise<UnlistenFn> {
  return listen<string>(EV.configChanged, (e) => cb(e.payload));
}

/** Subscribes to lifecycle-fired events triggered by transcript reconstruction. */
export function onLifecycleFired(
  cb: (event: HookEvent) => void
): Promise<UnlistenFn> {
  return listen<HookEvent>(EV.lifecycleFired, (e) => cb(e.payload));
}
