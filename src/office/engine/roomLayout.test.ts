import { describe, it, expect } from "vitest";
import { planRoom, planTown, townSignature, ROOM_PAD, ROOMS_PER_ROW } from "./roomLayout";

describe("planRoom", () => {
  it("always places an isolated orchestrator seat facing into the room", () => {
    const room = planRoom([], 0);
    expect(room.orchestrator.row).toBe(ROOM_PAD);
    expect(room.orchestratorFacing).toBe("frontRight");
    expect(room.desks.size).toBe(0);
    expect(room.waiting.row1).toBeGreaterThanOrEqual(room.waiting.row0);
  });

  it("seats agents as facing pairs: even=frontRight, odd=backLeft", () => {
    const room = planRoom(["a", "b", "c", "d"], 0);
    expect(room.desks.size).toBe(4);
    expect(room.desks.get("a")!.facing).toBe("frontRight");
    expect(room.desks.get("b")!.facing).toBe("backLeft");
    expect(room.desks.get("c")!.facing).toBe("frontRight");
    expect(room.desks.get("d")!.facing).toBe("backLeft");
  });

  it("places the two desks of an island adjacent (no aisle between them)", () => {
    const room = planRoom(["a", "b"], 0);
    const a = room.desks.get("a")!.cell;
    const b = room.desks.get("b")!.cell;
    expect(b.row).toBe(a.row);
    expect(b.col).toBe(a.col + 1);
  });

  it("gives every desk a distinct cell", () => {
    const room = planRoom(["a", "b", "c", "d", "e", "f"], 0);
    const seen = new Set([...room.desks.values()].map((s) => `${s.cell.col},${s.cell.row}`));
    expect(seen.size).toBe(6);
  });

  it("keeps all desks inside the room interior", () => {
    const room = planRoom(["a", "b", "c", "d", "e"], 2);
    for (const slot of room.desks.values()) {
      expect(slot.cell.col).toBeGreaterThanOrEqual(ROOM_PAD);
      expect(slot.cell.col).toBeLessThanOrEqual(room.cols - ROOM_PAD - 1);
      expect(slot.cell.row).toBeGreaterThanOrEqual(ROOM_PAD);
      expect(slot.cell.row).toBeLessThanOrEqual(room.rows - ROOM_PAD - 1);
    }
  });

  it("classifies free cells without overlapping occupied cells", () => {
    const room = planRoom(["a", "b"], 1);
    const occupied = new Set<string>([`${room.orchestrator.col},${room.orchestrator.row}`]);
    for (const s of room.desks.values()) occupied.add(`${s.cell.col},${s.cell.row}`);
    const all = [...room.free.wall, ...room.free.corner, ...room.free.floor];
    for (const c of all) expect(occupied.has(`${c.col},${c.row}`)).toBe(false);
  });
});

describe("planTown", () => {
  it("wraps rooms onto meta-rows of ROOMS_PER_ROW", () => {
    const rooms = Array.from({ length: ROOMS_PER_ROW + 1 }, (_, i) => ({
      sessionId: `s${i}`,
      plan: planRoom([], 0),
    }));
    const placed = planTown(rooms);
    expect(placed[0].col0).toBe(0);
    expect(placed[0].row0).toBe(0);
    expect(placed[ROOMS_PER_ROW].col0).toBe(0);
    expect(placed[ROOMS_PER_ROW].row0).toBeGreaterThan(0);
  });

  it("never overlaps rooms within a meta-row", () => {
    const rooms = [
      { sessionId: "a", plan: planRoom(["x"], 0) },
      { sessionId: "b", plan: planRoom(["y"], 0) },
    ];
    const placed = planTown(rooms);
    expect(placed[1].col0).toBeGreaterThanOrEqual(placed[0].col0 + rooms[0].plan.cols);
  });
});

describe("townSignature", () => {
  it("changes when desk count changes", () => {
    const a = planTown([{ sessionId: "s", plan: planRoom(["x"], 0) }]);
    const b = planTown([{ sessionId: "s", plan: planRoom(["x", "y"], 0) }]);
    expect(townSignature(a)).not.toBe(townSignature(b));
  });
});
