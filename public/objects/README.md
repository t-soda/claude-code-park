# PNG assets for the field

`assetManifest.ts` loads the PNGs in this directory (`public/objects/`) and in `public/tiles/` at startup.
**If a file is missing it automatically falls back to code drawing**, so you can drop assets in one at a time and they show up as you go.

## Authoring rules (common to all assets)

- **Width must always be 128px** (1 cell = `TILE_W`).
- **Fit the foot diamond of a single cell inside the bottom 128×64 region of the canvas.** Tall furniture (desks, etc.) extends upward from there (height is free).
- Transparent background. To keep the pixel-art look, assume nearest-neighbor sampling (`nearest` on the engine side).
- Grounding is automatic: `anchor=(0.5, (H-32)/H)`, position = cell center. Following the rules above, both floor tiles and tall furniture ground correctly.
- The camera is fixed. There are only two facings: **lower-right (frontRight) / upper-left (backLeft)**.

## Expected file names

### Tiles (`public/tiles/`, tiled like the floor)
| File | Purpose | Target size |
|---|---|---|
| `floor.png` | Floor tile (1 cell) | 128×64 |
| `wall-left.png` | Wall, lower-left facing (back-left edge) | 128×(free height) |
| `wall-right.png` | Wall, lower-right facing (back-right edge) | 128×(free height) |

### Objects (`public/objects/`)
| File | Purpose |
|---|---|
| `desk-front-right.png` | Desk, lower-right facing |
| `desk-back-left.png` | Desk, upper-left facing |
| `president-desk-front-right.png` | President desk, lower-right facing |
| `president-desk-back-left.png` | President desk, upper-left facing |
| `chair.png` | Chair (optional; currently not auto-placed) |
| `shelf-wall-left.png` | Shelf, along the left wall (the edge descending lower-left on screen) |
| `shelf-wall-right.png` | Shelf, along the right wall (the edge descending lower-right on screen) |
| `shelf.png` | Shelf, shared left/right fallback (used when no side-specific image exists) |
| `vending-wall-left.png` | Vending machine, along the left wall |
| `vending-wall-right.png` | Vending machine, along the right wall |
| `vending.png` | Vending machine, shared left/right fallback |
| `plant.png` | Furniture (scattered on the floor) |
| `plant2.png` | Furniture (scattered on the floor; a different kind of houseplant) |
| `whiteboard.png` | Furniture (scattered on the floor; a whiteboard on casters) |

Wall-side furniture (`placement: "wall"`) automatically picks `*-wall-left.png` / `*-wall-right.png`
depending on which wall the placement cell sits against (left wall = the `col===ROOM_PAD` column, right wall = the `row===ROOM_PAD` row). For a side with no side-specific image it falls back to the
shared `shelf.png` / `vending.png`, and if those are missing too it falls back to code drawing.
If left and right look swapped, swap the left/right files (or the `wallLeft`/`wallRight` paths in `assetManifest.ts`).

## Adding more furniture

Just add one entry to `REGISTRY` in `src/office/engine/assetManifest.ts`:

```ts
lamp: {
  category: "furniture",
  placement: "floor",        // "wall" | "floor" | "corner"
  variants: { single: { path: "/objects/lamp.png", texture: null, draw: lampDraw } },
},
```

Any `furniture` with a `placement` is auto-placed into free cells by `decorPlacer` (deterministic from the `session_id` seed, so the same arrangement every time). `draw` is the fallback when the PNG is missing (optional).
