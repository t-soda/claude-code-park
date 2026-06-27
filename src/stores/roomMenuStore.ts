import { create } from "zustand";

export type RoomMenuItem = "metrics" | "hooks" | "agents" | "skills";

interface RoomMenuState {
  project: string | null;
  anchor: { x: number; y: number } | null;
  selected: RoomMenuItem | null;
  open: (project: string, anchor: { x: number; y: number }) => void;
  select: (item: RoomMenuItem) => void;
  back: () => void;
  close: () => void;
}

export const useRoomMenuStore = create<RoomMenuState>((set) => ({
  project: null,
  anchor: null,
  selected: null,
  open: (project, anchor) => set({ project, anchor, selected: null }),
  select: (item) => set({ selected: item }),
  back: () => set({ selected: null }),
  close: () => set({ project: null, anchor: null, selected: null }),
}));
