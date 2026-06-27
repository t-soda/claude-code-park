import { describe, it, expect, beforeEach } from "vitest";
import { useRoomMenuStore } from "./roomMenuStore";

beforeEach(() => useRoomMenuStore.getState().close());

describe("roomMenuStore", () => {
  it("open keeps project and anchor, with selected null", () => {
    useRoomMenuStore.getState().open("/p", { x: 10, y: 20 });
    const s = useRoomMenuStore.getState();
    expect(s.project).toBe("/p");
    expect(s.anchor).toEqual({ x: 10, y: 20 });
    expect(s.selected).toBeNull();
  });

  it("select picks an item, back goes back", () => {
    useRoomMenuStore.getState().open("/p", { x: 0, y: 0 });
    useRoomMenuStore.getState().select("hooks");
    expect(useRoomMenuStore.getState().selected).toBe("hooks");
    useRoomMenuStore.getState().back();
    expect(useRoomMenuStore.getState().selected).toBeNull();
    expect(useRoomMenuStore.getState().project).toBe("/p");
  });

  it("close sets everything to null", () => {
    useRoomMenuStore.getState().open("/p", { x: 0, y: 0 });
    useRoomMenuStore.getState().close();
    expect(useRoomMenuStore.getState().project).toBeNull();
    expect(useRoomMenuStore.getState().anchor).toBeNull();
    expect(useRoomMenuStore.getState().selected).toBeNull();
  });
});
