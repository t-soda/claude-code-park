import { create } from "zustand";
import type { SlotGroup } from "../office/hookLifecycle";
import type { Anchor } from "./openLogStore";

interface HookDetailState {
  group: SlotGroup | null;
  anchor: Anchor | null;
  open: (group: SlotGroup, anchor: Anchor) => void;
  close: () => void;
}

export const useHookDetailStore = create<HookDetailState>((set) => ({
  group: null,
  anchor: null,
  open: (group, anchor) => set({ group, anchor }),
  close: () => set({ group: null, anchor: null }),
}));
