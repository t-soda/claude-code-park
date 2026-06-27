import { Application, Container, Graphics } from "pixi.js";
import { IsoFloor } from "./IsoFloor";
import { FLOOR_THEMES, timeOfDayForHour, type TimeOfDay } from "./timeOfDay";
import { loadAssets } from "./assetManifest";
import { computeZoom, anchorPan, clampAxis } from "./zoomMath";
import { isClick } from "./clickDetect";

/** Pan slack allowed outside the content. The amount movable even when the content fits on screen. */
const MARGIN = 160;
/** The bare color visible where the floor isn't drawn yet (only briefly right after startup). */
const SKY_COLOR = "#10162e";
/** Interval for re-checking the time of day (ms). When it crosses, swap the floor/wall tint. */
const TIME_CHECK_MS = 60_000;
/** Lower/upper bounds of the zoom factor. */
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 3.0;
/** Sensitivity from wheel delta to zoom factor. */
const ZOOM_SENSITIVITY = 0.0015;

/**
 * The rendering stage for the top-down office.
 * Places the iso floor (IsoFloor, backmost) plus rooms and characters on world, and pans in 2D.
 */
export class Stage {
  readonly app: Application;
  readonly world: Container;
  /** Screen-space layer overlaid on top of world (under pan/zoom). For dialog tethering. */
  readonly dialogTetherG: Graphics;
  /** The iso floor/wall layer. WorldRenderer integrates it as the backmost element of its own scene. */
  floor: IsoFloor | null = null;
  /** Called after the time-of-day theme is applied (a hook for WorldRenderer to redraw the floor). */
  onThemeChange: (() => void) | null = null;
  /** Called in canvas-relative px when a character (not the background) is clicked (not dragged). */
  onTap: ((cx: number, cy: number) => void) | null = null;
  /** Called in canvas-relative px whenever the cursor moves over the canvas (for hover tooltips). */
  onHover: ((cx: number, cy: number) => void) | null = null;
  /** Returns whether something clickable sits under the cursor (canvas-relative px); switches to a pointer cursor on hover. */
  onHoverCursor: ((cx: number, cy: number) => boolean) | null = null;
  /** The currently displayed time of day. Swapped only when the re-check changes it. */
  private currentTod: TimeOfDay = "day";
  /** Periodic timer for re-checking the time of day (cleared in destroy). */
  private timeTimer: number | null = null;
  /** Width/height of the content stacked on world (used to clamp the pan amount). */
  private contentWidth = 0;
  private contentHeight = 0;
  /** True while dragging to pan; suppresses hover-cursor updates so the grab/grabbing cursor wins. */
  private panning = false;

  constructor() {
    this.app = new Application();
    this.world = new Container();
    this.dialogTetherG = new Graphics();
  }

  async init(canvas: HTMLCanvasElement): Promise<void> {
    await this.app.init({
      canvas,
      antialias: false,
      background: SKY_COLOR,
      resizeTo: canvas.parentElement ?? window,
      autoDensity: true,
      resolution: window.devicePixelRatio || 1,
      // WKWebView does not support WebGPU, so use WebGL explicitly.
      preference: "webgl",
    });
    this.app.stage.addChild(this.world);
    this.app.stage.addChild(this.dialogTetherG);

    // Preload the floor/wall/furniture PNGs (fall back to code drawing on failure).
    await loadAssets();

    // Prepare the floor theme matching the current time of day.
    this.currentTod = timeOfDayForHour(new Date().getHours());
    const theme = FLOOR_THEMES[this.currentTod];
    this.floor = new IsoFloor(theme);
    this.app.renderer.background.color = theme.bg;

    // Follow the changing time and swap the floor/wall tint when the time of day crosses over.
    this.timeTimer = window.setInterval(() => {
      const next = timeOfDayForHour(new Date().getHours());
      if (next !== this.currentTod) this.applyTheme(next);
    }, TIME_CHECK_MS);

    // Wheel. With ⌘/Ctrl held (including trackpad pinch) it zooms; otherwise it pans (Miro standard).
    canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const rect = canvas.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        const oldScale = this.world.scale.x;
        const newScale = computeZoom(oldScale, e.deltaY, ZOOM_SENSITIVITY, MIN_ZOOM, MAX_ZOOM);
        if (newScale === oldScale) return;
        this.world.scale.set(newScale);
        // Change only the factor while keeping the world point under the cursor fixed.
        this.setWorld(
          anchorPan(cx, this.world.x, oldScale, newScale),
          anchorPan(cy, this.world.y, oldScale, newScale)
        );
      } else {
        this.setWorld(this.world.x - e.deltaX, this.world.y - e.deltaY);
      }
    });

    // Pan by dragging the background (Miro-style). Sprites are non-interactive, so
    // dragging anywhere pans the background.
    canvas.style.cursor = "grab";
    let startX = 0;
    let startY = 0;
    let baseX = 0;
    let baseY = 0;
    const onMove = (e: PointerEvent) => {
      this.setWorld(baseX + (e.clientX - startX), baseY + (e.clientY - startY));
    };
    const onUp = (e: PointerEvent) => {
      this.panning = false;
      canvas.style.cursor = "grab";
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      // If it didn't move, treat as a click. Notify in canvas-relative coordinates (= Pixi stage global space).
      if (isClick(e.clientX - startX, e.clientY - startY)) {
        const rect = canvas.getBoundingClientRect();
        this.onTap?.(e.clientX - rect.left, e.clientY - rect.top);
      }
    };
    canvas.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return; // left button only
      startX = e.clientX;
      startY = e.clientY;
      baseX = this.world.x;
      baseY = this.world.y;
      this.panning = true;
      canvas.style.cursor = "grabbing";
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    });
    canvas.addEventListener("pointermove", (e) => {
      const rect = canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      this.onHover?.(cx, cy);
      // Show a pointer cursor over clickable elements; keep grab/grabbing while panning.
      if (!this.panning) {
        canvas.style.cursor = this.onHoverCursor?.(cx, cy) ? "pointer" : "grab";
      }
    });
  }

  /** Apply the given time-of-day theme to the floor/walls and base color (tint swap). */
  private applyTheme(tod: TimeOfDay): void {
    const theme = FLOOR_THEMES[tod];
    if (!this.floor) return;
    this.currentTod = tod;
    this.floor.setTheme(theme);
    this.app.renderer.background.color = theme.bg;
    // The floor doesn't know the room layout, so ask WorldRenderer to redraw.
    this.onThemeChange?.();
  }

  setContentSize(w: number, h: number): void {
    this.contentWidth = w;
    this.contentHeight = h;
  }

  /** Clamp and place world within the content extent + margin (factor included; the background is inside world so it follows automatically). */
  setWorld(x: number, y: number): void {
    const vw = this.app.renderer.width;
    const vh = this.app.renderer.height;
    const s = this.world.scale.x;
    this.world.x = clampAxis(x, this.contentWidth * s, vw, MARGIN);
    this.world.y = clampAxis(y, this.contentHeight * s, vh, MARGIN);
  }

  /** Set the factor directly and re-clamp the current pan position (for state restore). */
  setZoom(scale: number): void {
    this.world.scale.set(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale)));
    this.setWorld(this.world.x, this.world.y);
  }

  destroy(): void {
    if (this.timeTimer !== null) {
      clearInterval(this.timeTimer);
      this.timeTimer = null;
    }
    // Guard against crashing if destroy runs before init (renderer not yet created).
    if (this.app.renderer) {
      this.app.destroy(true, { children: true });
    }
  }
}
