import type { Cell } from "./iso";
import { ROOM_PAD, type RoomPlan } from "./roomLayout";
import { listFurniture, type VariantKey } from "./assetManifest";

/**
 * Deterministically place furniture into the room's free cells.
 * Seeded by session_id, so the arrangement stays the same every frame / re-sync (no jitter).
 * Adding one furniture line to the manifest (assetManifest) brings it into placement without touching this.
 */

export interface DecorItem {
  id: string;
  cell: Cell;
  /** For wall furniture, the wall side it sits along (edge descending lower-left=wallLeft / edge descending lower-right=wallRight). undefined for floor furniture. */
  variant?: VariantKey;
}

/** Fraction of the wall-side pool to fill. */
const WALL_DENSITY = 0.25;
/** Fraction of the floor pool to fill (sparsely). */
const FLOOR_DENSITY = 0.1;

/** String → 32-bit seed. */
function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32: a lightweight, deterministic PRNG. */
function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Weighted draw. */
function weightedPick<T extends { weight: number }>(items: T[], rng: () => number): T {
  const total = items.reduce((s, it) => s + it.weight, 0);
  let r = rng() * total;
  for (const it of items) {
    r -= it.weight;
    if (r <= 0) return it;
  }
  return items[items.length - 1];
}

/** Return the result of placing furniture into free cells (deterministic). */
export function placeDecor(plan: RoomPlan, seedStr: string): DecorItem[] {
  const rng = mulberry32(hashSeed(seedStr));
  const furniture = listFurniture();
  const wallFurn = furniture.filter((f) => f.placement === "wall" || f.placement === "corner");
  const floorFurn = furniture.filter((f) => f.placement === "floor");

  const wallPool = shuffle([...plan.free.corner, ...plan.free.wall], rng);
  const floorPool = shuffle([...plan.free.floor], rng);

  const items: DecorItem[] = [];
  const fill = (pool: Cell[], furn: typeof furniture, density: number, wallSided: boolean) => {
    if (!furn.length) return;
    const count = Math.round(pool.length * density);
    for (let i = 0; i < count; i++) {
      const cell = pool[i];
      // Left wall = ci===0 → col===ROOM_PAD / right wall = ri===0 → row===ROOM_PAD. Corners (both) are treated as left wall.
      const variant: VariantKey | undefined = wallSided
        ? cell.col === ROOM_PAD
          ? "wallLeft"
          : "wallRight"
        : undefined;
      items.push({ id: weightedPick(furn, rng).id, cell, variant });
    }
  };
  fill(wallPool, wallFurn, WALL_DENSITY, true);
  fill(floorPool, floorFurn, FLOOR_DENSITY, false);
  return items;
}
