import { create } from "zustand";

/**
 * Client-side display preferences for the town screen (persisted in localStorage).
 * Not business logic, so it doesn't go in the Rust settings.json.
 */
const STORAGE_KEY = "claude-code-park:ui-prefs";

/** Pure function reading lifecycleView from the persisted JSON (missing key defaults to true; only an explicit false is false). */
export function parseLifecyclePref(raw: string | null): boolean {
  if (!raw) return true;
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    return obj?.lifecycleView !== false;
  } catch {
    return true;
  }
}

/** Pure function reading hookView from the persisted JSON (missing key defaults to true; only an explicit false is false). */
export function parseHookViewPref(raw: string | null): boolean {
  if (!raw) return true;
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    return obj?.hookView !== false;
  } catch {
    return true;
  }
}

function load(): { lifecycleView: boolean; hookView: boolean } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return { lifecycleView: parseLifecyclePref(raw), hookView: parseHookViewPref(raw) };
  } catch {
    return { lifecycleView: true, hookView: true };
  }
}

function persist(state: { lifecycleView: boolean; hookView: boolean }): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ lifecycleView: state.lifecycleView, hookView: state.hookView })
    );
  } catch {
    // Silently ignore when storage is unavailable (a cosmetic preference, not fatal).
  }
}

interface UiPrefsState {
  /** Whether to show tool-name tags in the log dialog. */
  lifecycleView: boolean;
  setLifecycleView: (on: boolean) => void;
  /** Whether to show the entire hook visualization (rail + firing badges + round-trip beams). */
  hookView: boolean;
  setHookView: (on: boolean) => void;
}

export const useUiPrefsStore = create<UiPrefsState>((set, get) => ({
  ...load(),
  setLifecycleView(on) {
    set({ lifecycleView: on });
    persist(get());
  },
  setHookView(on) {
    set({ hookView: on });
    persist(get());
  },
}));
