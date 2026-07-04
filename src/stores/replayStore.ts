import { create } from "zustand";
import type { ReplayData, ReplaySessionMeta } from "../bindings";
import { api } from "../ipc/commands";
import {
  createReplayCursor,
  durationMs,
  flashesFor,
  type ReplayCursor,
  type ReplayFrame,
} from "../replay/replayEngine";
import { pruneEvents, type HookFlash } from "./hookStore";

/** Same badge lifetime as the live hookStore. */
const FLASH_TTL_MS = 3_000;

export type ReplaySpeed = 1 | 4 | 16;

interface ReplayState {
  /** Session browser list. null = not fetched yet. */
  list: ReplaySessionMeta[] | null;
  listLoading: boolean;
  listError: string | null;
  /** The session being replayed. null = browser is showing. */
  data: ReplayData | null;
  dataLoading: boolean;
  dataError: string | null;
  playheadMs: number;
  speed: ReplaySpeed;
  playing: boolean;
  frame: ReplayFrame | null;
  flashes: Record<string, HookFlash>;
  loadList(): Promise<void>;
  open(sessionId: string): Promise<void>;
  close(): void;
  play(): void;
  pause(): void;
  setSpeed(speed: ReplaySpeed): void;
  seek(ms: number): void;
  /** Driven by the replay stage's Pixi ticker with performance.now(). */
  tick(nowRealMs: number): void;
}

// Non-serializable playback internals live outside the store state.
let cursor: ReplayCursor | null = null;
let lastRealMs: number | null = null;
/** Guards against a stale open() resolving after another open()/close(). */
let openSeq = 0;

export const useReplayStore = create<ReplayState>((set, get) => ({
  list: null,
  listLoading: false,
  listError: null,
  data: null,
  dataLoading: false,
  dataError: null,
  playheadMs: 0,
  speed: 1,
  playing: false,
  frame: null,
  flashes: {},

  async loadList() {
    if (get().listLoading) return;
    set({ listLoading: true, listError: null });
    try {
      const list = await api.listReplaySessions();
      set({ list, listLoading: false });
    } catch (e) {
      set({ listError: String(e), listLoading: false, list: [] });
    }
  },

  async open(sessionId) {
    const seq = ++openSeq;
    set({ dataLoading: true, dataError: null });
    try {
      const data = await api.getReplayData(sessionId);
      if (seq !== openSeq) return; // superseded by another open()/close()
      cursor = createReplayCursor(data);
      lastRealMs = null;
      set({
        data,
        dataLoading: false,
        playheadMs: 0,
        playing: false,
        frame: cursor.seek(0),
        flashes: {},
      });
    } catch (e) {
      if (seq !== openSeq) return;
      set({ dataError: String(e), dataLoading: false });
    }
  },

  close() {
    openSeq++;
    cursor = null;
    lastRealMs = null;
    set({
      data: null,
      dataLoading: false,
      dataError: null,
      playheadMs: 0,
      playing: false,
      frame: null,
      flashes: {},
    });
  },

  play() {
    const s = get();
    if (!s.data || !cursor) return;
    // Replaying from the end starts over (natural "watch again").
    if (s.playheadMs >= durationMs(s.data)) {
      set({ playheadMs: 0, frame: cursor.seek(0), flashes: {} });
    }
    set({ playing: true });
  },

  pause() {
    set({ playing: false });
  },

  setSpeed(speed) {
    set({ speed });
  },

  seek(ms) {
    const s = get();
    if (!s.data || !cursor) return;
    const t = Math.min(durationMs(s.data), Math.max(0, ms));
    // Scrubbing emits no flashes (a seek across hundreds of events must not flood beams).
    set({ playheadMs: t, frame: cursor.seek(t), flashes: {} });
  },

  tick(nowRealMs) {
    const s = get();
    const dtMs = lastRealMs === null ? 0 : nowRealMs - lastRealMs;
    lastRealMs = nowRealMs;
    if (!s.data || !cursor) return;

    let flashes = s.flashes;
    if (Object.keys(flashes).length > 0) {
      const pruned = pruneEvents(flashes, nowRealMs, FLASH_TTL_MS);
      if (Object.keys(pruned).length !== Object.keys(flashes).length) {
        flashes = pruned;
      }
    }

    if (!s.playing) {
      if (flashes !== s.flashes) set({ flashes });
      return;
    }

    const duration = durationMs(s.data);
    const t = Math.min(duration, s.playheadMs + dtMs * s.speed);
    const { frame, crossed } = cursor.advance(t);
    if (crossed.length > 0) {
      flashes = {
        ...flashes,
        ...flashesFor(crossed, nowRealMs, s.data.meta.session_id),
      };
    }
    set({
      playheadMs: t,
      frame,
      flashes,
      // Auto-pause at the end of the session.
      playing: t < duration,
    });
  },
}));
