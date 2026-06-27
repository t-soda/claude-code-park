import { Assets, Container, Graphics, Sprite, Texture } from "pixi.js";
import { TILE_W, TILE_H } from "./iso";

/**
 * A single, data-driven catalog registering all field assets (floor, wall, desk, Orchestrator desk, furniture).
 * Adding more later only requires one entry in REGISTRY.
 *
 * - The default is code-based iso solid drawing (fallback). If the PNG at `path` loads, prefer it.
 * - PNG authoring convention: width must always be TILE_W(=128)px. Fit the cell's foot diamond into the
 *   "128×64 region at the canvas bottom edge" and let tall furniture extend upward from there (free height).
 *   Grounding aligns automatically with anchor=(0.5,(H-32)/H) and position=cell center.
 * - The camera is fixed, so there are only two facings: "down-right (frontRight) / up-left (backLeft)".
 */

/** Facing for desks etc. frontRight=down-right / backLeft=up-left. */
export type Orientation = "frontRight" | "backLeft";
/** Furniture placement rule. */
export type Placement = "wall" | "floor" | "corner";
export type AssetCategory =
  | "ground"
  | "floor"
  | "wall"
  | "desk"
  | "orchestratorDesk"
  | "chair"
  | "furniture"
  | "hookSlot";

/**
 * Variant selection key. Represents the desk facing (frontRight/backLeft) and,
 * for wall furniture, which back wall it sits along (wallLeft=edge descending lower-left / wallRight=edge descending lower-right).
 */
export type VariantKey = "single" | Orientation | "wallLeft" | "wallRight";

interface Variant {
  /** PNG path under public. */
  path: string;
  /** Loaded texture (null if not loaded / failed). */
  texture: Texture | null;
  /** Code-drawing fallback when there's no PNG (origin = cell center, rising upward). */
  draw?: (g: Graphics) => void;
}

interface AssetDef {
  category: AssetCategory;
  /** Placement rule for furniture. */
  placement?: Placement;
  /** Weight in the placement draw (higher = more likely; default 1). */
  weight?: number;
  variants: Partial<Record<VariantKey, Variant>>;
}

const hw = TILE_W / 2;
const hh = TILE_H / 2;

/** Draw an iso rectangular box resting on the cell floor. halfW/halfH=base radius, height=rise. */
function isoBox(
  g: Graphics,
  halfW: number,
  halfH: number,
  height: number,
  faces: { top: number; left: number; right: number }
): void {
  const ty = -height;
  const bR = { x: halfW, y: 0 };
  const bB = { x: 0, y: halfH };
  const bL = { x: -halfW, y: 0 };
  const tT = { x: 0, y: -halfH + ty };
  const tR = { x: halfW, y: ty };
  const tB = { x: 0, y: halfH + ty };
  const tL = { x: -halfW, y: ty };
  g.poly([bL.x, bL.y, bB.x, bB.y, tB.x, tB.y, tL.x, tL.y]).fill(faces.left);
  g.poly([bB.x, bB.y, bR.x, bR.y, tR.x, tR.y, tB.x, tB.y]).fill(faces.right);
  g.poly([tT.x, tT.y, tR.x, tR.y, tB.x, tB.y, tL.x, tL.y]).fill(faces.top);
}

/** Desk (top + monitor). dir shifts the monitor toward the facing side so the orientation is clear even in the fallback. */
function deskDraw(dir: 1 | -1): (g: Graphics) => void {
  return (g) => {
    const dt = -22;
    isoBox(g, hw * 0.82, hh * 0.82, 22, {
      top: 0xb07f4f,
      right: 0x8a6038,
      left: 0x6f4d2c,
    });
    const mx = 9 * dir;
    g.poly([mx, dt - 11, mx + 16, dt - 2, mx + 16, dt - 23, mx, dt - 32]).fill(0x2b2f3a);
    g.poly([mx, dt - 11, mx - 16, dt - 2, mx - 16, dt - 23, mx, dt - 32]).fill(0x1d212b);
    g.poly([mx, dt - 16, mx + 11, dt - 11, mx + 11, dt - 23, mx, dt - 28]).fill(0x3f5a86);
  };
}

/** Orchestrator desk (larger + brass trim). */
function orchestratorDeskDraw(dir: 1 | -1): (g: Graphics) => void {
  return (g) => {
    const dt = -26;
    isoBox(g, hw * 0.95, hh * 0.95, 26, {
      top: 0x6f5640,
      right: 0x564231,
      left: 0x423224,
    });
    // Brass edging (the two front edges of the top face).
    g.poly([0, hh * 0.95 + dt, hw * 0.95, dt, hw * 0.95, dt + 3, 0, hh * 0.95 + dt + 3])
      .fill(0xcaa64e);
    g.poly([0, hh * 0.95 + dt, -hw * 0.95, dt, -hw * 0.95, dt + 3, 0, hh * 0.95 + dt + 3])
      .fill(0xb8923f);
    const mx = 10 * dir;
    g.poly([mx, dt - 12, mx + 17, dt - 3, mx + 17, dt - 25, mx, dt - 34]).fill(0x2b2f3a);
    g.poly([mx, dt - 17, mx + 12, dt - 12, mx + 12, dt - 25, mx, dt - 30]).fill(0x4a6ea0);
  };
}

function chairDraw(g: Graphics): void {
  isoBox(g, hw * 0.34, hh * 0.34, 16, {
    top: 0x55606f,
    right: 0x424b58,
    left: 0x363d48,
  });
  g.poly([-hw * 0.34, 0, 0, -hh * 0.34, 0, -hh * 0.34 - 28, -hw * 0.34, -28]).fill(0x424b58);
}

function shelfDraw(g: Graphics): void {
  isoBox(g, hw * 0.78, hh * 0.5, 56, {
    top: 0x9a7c54,
    right: 0x7c6242,
    left: 0x614c33,
  });
  for (const yy of [-18, -36]) {
    g.poly([0, hh * 0.5, hw * 0.78, 0, hw * 0.78, yy, 0, hh * 0.5 + yy]).stroke({
      width: 2,
      color: 0x4a3925,
      alpha: 0.7,
    });
  }
}

function vendingDraw(g: Graphics): void {
  isoBox(g, hw * 0.6, hh * 0.55, 60, {
    top: 0xe2574a,
    right: 0xc23c30,
    left: 0x9c2c22,
  });
  g.poly([6, hh * 0.2, hw * 0.55, -4, hw * 0.55, -46, 6, -40]).fill(0xf4d27a);
}

function plantDraw(g: Graphics): void {
  isoBox(g, hw * 0.28, hh * 0.28, 14, {
    top: 0xb06a44,
    right: 0x8f5234,
    left: 0x713f28,
  });
  g.circle(-7, -28, 12).fill(0x4e8d4a);
  g.circle(7, -25, 13).fill(0x57a052);
  g.circle(0, -40, 13).fill(0x60ad5b);
}

const REGISTRY: Record<string, AssetDef> = {
  // Open-ground floor tiled outside the rooms (laid via TilingSprite as a rectangular seamless texture).
  // Dedicated image per time of day. Unplaced ones fall back to ground (shared).
  ground: {
    category: "ground",
    variants: { single: { path: "/tiles/ground.png", texture: null } },
  },
  groundDay: {
    category: "ground",
    variants: { single: { path: "/tiles/ground_day.png", texture: null } },
  },
  groundEvening: {
    category: "ground",
    variants: { single: { path: "/tiles/ground_evening.png", texture: null } },
  },
  groundNight: {
    category: "ground",
    variants: { single: { path: "/tiles/ground_night.png", texture: null } },
  },
  floor: {
    category: "floor",
    // The floor fallback is drawn as a checkerboard by IsoFloor, so it has no draw.
    variants: { single: { path: "/tiles/floor.png", texture: null } },
  },
  // Walls tile the two back edges. Down-left = back-left edge / down-right = back-right edge.
  wallLeft: {
    category: "wall",
    variants: { single: { path: "/tiles/wall-left.png", texture: null } },
  },
  wallRight: {
    category: "wall",
    variants: { single: { path: "/tiles/wall-right.png", texture: null } },
  },
  desk: {
    category: "desk",
    variants: {
      frontRight: { path: "/objects/desk-front-right.png", texture: null, draw: deskDraw(1) },
      backLeft: { path: "/objects/desk-back-left.png", texture: null, draw: deskDraw(-1) },
    },
  },
  orchestratorDesk: {
    category: "orchestratorDesk",
    variants: {
      frontRight: {
        path: "/objects/orchestrator-desk-front-right.png",
        texture: null,
        draw: orchestratorDeskDraw(1),
      },
      backLeft: {
        path: "/objects/orchestrator-desk-back-left.png",
        texture: null,
        draw: orchestratorDeskDraw(-1),
      },
    },
  },
  chair: {
    category: "chair",
    variants: { single: { path: "/objects/chair.png", texture: null, draw: chairDraw } },
  },
  // Wall furniture uses a dedicated PNG per wall side. If the left/right dedicated images are missing, fall back to single.
  shelf: {
    category: "furniture",
    placement: "wall",
    variants: {
      wallLeft: { path: "/objects/shelf-wall-left.png", texture: null, draw: shelfDraw },
      wallRight: { path: "/objects/shelf-wall-right.png", texture: null, draw: shelfDraw },
      single: { path: "/objects/shelf.png", texture: null, draw: shelfDraw },
    },
  },
  vending: {
    category: "furniture",
    placement: "wall",
    variants: {
      wallLeft: { path: "/objects/vending-wall-left.png", texture: null, draw: vendingDraw },
      wallRight: { path: "/objects/vending-wall-right.png", texture: null, draw: vendingDraw },
      single: { path: "/objects/vending.png", texture: null, draw: vendingDraw },
    },
  },
  plant: {
    category: "furniture",
    placement: "floor",
    variants: { single: { path: "/objects/plant.png", texture: null, draw: plantDraw } },
  },
  // PNG-only (no fallback drawing). Nothing is drawn while the image is missing.
  plant2: {
    category: "furniture",
    placement: "floor",
    variants: { single: { path: "/objects/plant2.png", texture: null } },
  },
  whiteboard: {
    category: "furniture",
    placement: "floor",
    variants: { single: { path: "/objects/whiteboard.png", texture: null } },
  },
  // Sockets for the hook rail. No PNG placed yet → HookRail draws via code.
  // Dropping a PNG at the path below later automatically swaps in the texture.
  hookSlotDevice: {
    category: "hookSlot",
    variants: { single: { path: "/objects/hook-device.png", texture: null } },
  },
  hookSlotEmpty: {
    category: "hookSlot",
    variants: { single: { path: "/objects/hook-socket.png", texture: null } },
  },
};

let loaded = false;

/** Load all assets' PNGs (ignore 404 etc. and fall back to code drawing). Runs only once. */
export async function loadAssets(): Promise<void> {
  if (loaded) return;
  loaded = true;
  const jobs: Promise<void>[] = [];
  for (const def of Object.values(REGISTRY)) {
    for (const v of Object.values(def.variants)) {
      if (!v) continue;
      jobs.push(
        Assets.load(v.path)
          .then((t: Texture) => {
            t.source.scaleMode = "nearest";
            v.texture = t;
          })
          .catch(() => {
            v.texture = null;
          })
      );
    }
  }
  await Promise.allSettled(jobs);
}

/**
 * Pick the Variant to display.
 * First look for a "loaded PNG" in the order requested key → single, and use it if found
 * (= falls back to the single image if there's no wall-side-specific image).
 * If none has a PNG placed, return the Variant that exists in the order requested key → single → others for code drawing
 * (the requested key is preferred, so the desk facing is preserved).
 */
function pickVariant(def: AssetDef, key?: VariantKey): Variant | undefined {
  if (key && def.variants[key]?.texture) return def.variants[key];
  if (def.variants.single?.texture) return def.variants.single;
  return (
    (key ? def.variants[key] : undefined) ??
    def.variants.single ??
    def.variants.frontRight ??
    def.variants.backLeft ??
    def.variants.wallLeft ??
    def.variants.wallRight
  );
}

/** Return the grounding anchor following the convention that the PNG's bottom 128×64 is the foot diamond. */
function objectAnchorY(h: number): number {
  return (h - TILE_H / 2) / h;
}

/**
 * Create the display Container for an object.
 * If a texture exists, a Sprite (grounding anchor); otherwise a code-drawn Graphics.
 * Either way, placing the origin at the cell center aligns the feet.
 */
export function makeObject(id: string, variant?: VariantKey): Container {
  const def = REGISTRY[id];
  const v = def ? pickVariant(def, variant) : undefined;
  if (v?.texture) {
    const s = new Sprite(v.texture);
    s.anchor.set(0.5, objectAnchorY(v.texture.height));
    return s;
  }
  const g = new Graphics();
  if (v?.draw) v.draw(g);
  return g;
}

/** Return the floor/wall tile texture (null if not loaded → caller falls back). */
export function tileTexture(id: string): Texture | null {
  return REGISTRY[id]?.variants.single?.texture ?? null;
}

/** Whether the PNG for that id (+ facing) is loaded. Used to decide to show decor "only when a PNG exists". */
export function hasTexture(id: string, variant?: VariantKey): boolean {
  const def = REGISTRY[id];
  if (!def) return false;
  return !!pickVariant(def, variant)?.texture;
}

/** Grounding anchor Y for tile sprites (used when IsoFloor creates a Sprite). */
export function tileAnchorY(h: number): number {
  return objectAnchorY(h);
}

/** Return the list of placeable furniture (furniture category) (for decorPlacer). */
export function listFurniture(): Array<{ id: string; placement: Placement; weight: number }> {
  const out: Array<{ id: string; placement: Placement; weight: number }> = [];
  for (const [id, def] of Object.entries(REGISTRY)) {
    if (def.category === "furniture") {
      out.push({ id, placement: def.placement ?? "floor", weight: def.weight ?? 1 });
    }
  }
  return out;
}

/** PNG texture for the hook socket (null if not placed → HookRail draws via code). */
export function hookSlotTexture(kind: "device" | "empty"): Texture | null {
  const id = kind === "device" ? "hookSlotDevice" : "hookSlotEmpty";
  return REGISTRY[id]?.variants.single?.texture ?? null;
}
