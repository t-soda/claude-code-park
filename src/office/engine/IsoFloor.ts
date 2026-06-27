import { Container, Graphics, Sprite, Texture } from "pixi.js";
import { cellToWorld, TILE_W, TILE_H, type Cell } from "./iso";
import type { PlacedRoom } from "./roomLayout";
import type { FloorTheme } from "./timeOfDay";
import { tileTexture, tileAnchorY } from "./assetManifest";

/** Wall-face height (from baseboard to just under the cap) (world px, raised on the 2 back edges, code-drawn). */
const WALL_H = 102;
/** Thickness of the wall top (cap). */
const WALL_CAP = 9;
/** Height of the wall-base panel (wainscot). */
const WALL_BASE = 24;
/** How far to shrink the mat (rug) inward from the tile (0..1). */
const RUG_INSET = 0.82;

/** Scale each channel of a hex color by factor f (shading). Clamp to 0..255. */
function shade(color: number, f: number): number {
  const r = Math.min(255, Math.round(((color >> 16) & 0xff) * f));
  const g = Math.min(255, Math.round(((color >> 8) & 0xff) * f));
  const b = Math.min(255, Math.round((color & 0xff) * f));
  return (r << 16) | (g << 8) | b;
}

/**
 * The backmost layer drawing the iso top-down floor + room walls.
 * Floor/walls tile single-cell PNG tiles (assetManifest) if they loaded;
 * otherwise fall back to code drawing (checkerboard + 3D walls). Seat mats and room outlines are always code-drawn.
 * The whole thing is baked into one texture via cacheAsTexture to keep per-frame cost low
 * (redraw + re-bake only when the room layout or theme changes).
 */
export class IsoFloor extends Container {
  /** Layer that tiles the floor PNGs (backmost). */
  private floorTiles = new Container();
  /** Layer that draws mats, outlines, and the fallback floor/walls. */
  private base = new Graphics();
  /** Layer that tiles the wall PNGs (frontmost, the back walls). */
  private wallTiles = new Container();
  private theme: FloorTheme;
  private cached = false;

  constructor(theme: FloorTheme) {
    super();
    this.theme = theme;
    this.addChild(this.floorTiles, this.base, this.wallTiles);
  }

  setTheme(theme: FloorTheme): void {
    this.theme = theme;
  }

  /** The current theme (used by WorldRenderer for the ground tint). */
  getTheme(): FloorTheme {
    return this.theme;
  }

  /** Apply the rooms, redraw the floor/walls, and bake into a texture. */
  layout(rooms: PlacedRoom[]): void {
    this.clearLayers();
    const g = this.base;
    const t = this.theme;
    const hw = TILE_W / 2;
    const hh = TILE_H / 2;

    const floorTex = tileTexture("floor");

    for (const room of rooms) {
      const { col0, row0, plan } = room;

      // --- Floor (PNG tiles or checkerboard fallback) ---
      for (let r = 0; r < plan.rows; r++) {
        for (let c = 0; c < plan.cols; c++) {
          if (floorTex) {
            this.placeTile(this.floorTiles, floorTex, col0 + c, row0 + r);
          } else {
            const { x, y } = cellToWorld(col0 + c, row0 + r);
            const fill = (c + r) % 2 === 0 ? t.floorA : t.floorB;
            g.poly([x, y - hh, x + hw, y, x, y + hh, x - hw, y])
              .fill({ color: fill })
              .stroke({ width: 1, color: t.line, alpha: 0.18 });
          }
        }
      }

      // --- Seat mats (always code-drawn; laid over the floor PNGs) ---
      this.rug(g, col0, row0, plan.orchestrator, t.rugOrchestrator, hw, hh);
      for (const slot of plan.desks.values()) {
        this.rug(g, col0, row0, slot.cell, t.rug, hw, hh);
      }

      // --- Room outline ---
      const top = cellToWorld(col0, row0);
      const right = cellToWorld(col0 + plan.cols - 1, row0);
      const left = cellToWorld(col0, row0 + plan.rows - 1);
      const bottom = cellToWorld(col0 + plan.cols - 1, row0 + plan.rows - 1);
      const T = { x: top.x, y: top.y - hh };
      const R = { x: right.x + hw, y: right.y };
      const L = { x: left.x - hw, y: left.y };
      const B = { x: bottom.x, y: bottom.y + hh };
      g.poly([T.x, T.y, R.x, R.y, B.x, B.y, L.x, L.y]).stroke({
        width: 1.5,
        color: t.line,
        alpha: 0.55,
      });

      // --- Walls on the 2 back edges (code-drawn; multi-layered cap/face/baseboard) ---
      // Draw the right edge T->R first, then the left edge T->L (the left wall is in front at the corner).
      // Left and right receive different light, so vary shading by side to give depth.
      this.wall(g, T, R, "right");
      this.wall(g, T, L, "left");
    }

    this.bake(rooms.length > 0);
  }

  private clearLayers(): void {
    this.base.clear();
    for (const c of this.floorTiles.removeChildren()) c.destroy();
    for (const c of this.wallTiles.removeChildren()) c.destroy();
  }

  /** Place a single-cell tile/wall PNG at the cell using a ground anchor (fine-tune with offset). */
  private placeTile(
    layer: Container,
    tex: Texture,
    col: number,
    row: number,
    offset: { x: number; y: number } = { x: 0, y: 0 }
  ): void {
    const { x, y } = cellToWorld(col, row);
    const s = new Sprite(tex);
    s.anchor.set(0.5, tileAnchorY(tex.height));
    s.position.set(x + offset.x, y + offset.y);
    layer.addChild(s);
  }

  /** Bake (clear the cache if rooms is empty). */
  private bake(hasRooms: boolean): void {
    if (!hasRooms) {
      if (this.cached) {
        this.cacheAsTexture(false);
        this.cached = false;
      }
      return;
    }
    if (!this.cached) {
      this.cacheAsTexture({ resolution: 2, antialias: true });
      this.cached = true;
    } else {
      this.updateCacheTexture();
    }
  }

  /** Lay an inward-shrunk diamond mat at the cell center. */
  private rug(
    g: Graphics,
    col0: number,
    row0: number,
    cell: Cell,
    color: number,
    hw: number,
    hh: number
  ): void {
    const { x, y } = cellToWorld(col0 + cell.col, row0 + cell.row);
    const w = hw * RUG_INSET;
    const h = hh * RUG_INSET;
    g.poly([x, y - h, x + w, y, x, y + h, x - w, y]).fill({ color, alpha: 0.9 });
  }

  /**
   * Draw a wall along the floor's back edge a->b (code-drawn).
   * A multi-layered build of baseboard (wainscot) -> wall face (subtle top-to-bottom gradient) ->
   * cap (molding + top highlight) gives richness close to PNG tiles. side is the lit side (left = bright / right = dark).
   */
  private wall(
    g: Graphics,
    a: { x: number; y: number },
    b: { x: number; y: number },
    side: "left" | "right"
  ): void {
    const t = this.theme;
    const lit = side === "left" ? 1.07 : 0.9; // left wall brighter, right wall darker
    const face = shade(t.wall, lit);
    const cap = shade(t.wallTop, side === "left" ? 1.04 : 0.93);

    // Fill one horizontal band over height h0->h1 (upward from the base).
    const band = (h0: number, h1: number, color: number): void => {
      g.poly([a.x, a.y - h0, b.x, b.y - h0, b.x, b.y - h1, a.x, a.y - h1]).fill({ color });
    };

    const faceMid = WALL_BASE + (WALL_H - WALL_BASE) * 0.5;
    // Dark contact shadow at the base.
    band(0, 5, shade(face, 0.5));
    // Wainscot (slightly darker lower panel).
    band(5, WALL_BASE, shade(face, 0.72));
    // Chair rail: bright top edge + a thin drop shadow just above it.
    band(WALL_BASE, WALL_BASE + 2, shade(face, 1.15));
    band(WALL_BASE + 2, WALL_BASE + 3, shade(face, 0.85));
    // Wall face: lower half slightly darker, upper half at the base color, to convey light from above.
    band(WALL_BASE + 3, faceMid, shade(face, 0.95));
    band(faceMid, WALL_H - 2, face);
    // Drop shadow just under the cap.
    band(WALL_H - 2, WALL_H, shade(face, 0.78));
    // Cap (molding) + a bright reveal on the top surface.
    band(WALL_H, WALL_H + WALL_CAP - 2, cap);
    band(WALL_H + WALL_CAP - 2, WALL_H + WALL_CAP, shade(cap, 1.16));
  }
}
