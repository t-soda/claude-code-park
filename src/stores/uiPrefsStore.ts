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

/** Pure function reading delegationView from the persisted JSON (missing key defaults to true; only an explicit false is false). */
export function parseDelegationViewPref(raw: string | null): boolean {
  if (!raw) return true;
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    return obj?.delegationView !== false;
  } catch {
    return true;
  }
}

interface PersistedPrefs {
  lifecycleView: boolean;
  hookView: boolean;
  delegationView: boolean;
}

function load(): PersistedPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return {
      lifecycleView: parseLifecyclePref(raw),
      hookView: parseHookViewPref(raw),
      delegationView: parseDelegationViewPref(raw),
    };
  } catch {
    return { lifecycleView: true, hookView: true, delegationView: true };
  }
}

function persist(state: PersistedPrefs): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        lifecycleView: state.lifecycleView,
        hookView: state.hookView,
        delegationView: state.delegationView,
      })
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
  /** Whether the subagent delegation arcs are always shown in the town (hover still reveals them when off). */
  delegationView: boolean;
  setDelegationView: (on: boolean) => void;
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
  setDelegationView(on) {
    set({ delegationView: on });
    persist(get());
  },
}));
