import { Container } from "pixi.js";
import type { TodoItem, WorkKind } from "../../bindings";
import { ActivityBubble } from "./ActivityBubble";
import { TodoChip } from "./TodoChip";

/** Vertical gap between the chip and the bubble (px). */
const STACK_GAP = 4;

/**
 * The above-head display cluster for a single character: TODO chip (top) + work bubble (bottom).
 * It is not a child of each sprite; WorldRenderer manages its position on a shared layer.
 */
export class Callout extends Container {
  private chip = new TodoChip();
  private bubble = new ActivityBubble();
  private tethered = false;
  // Cache the last bubble state so setTethered can toggle the tail immediately.
  private lastKind: WorkKind = "Idle";
  private lastDetail: string | null = null;
  private lastSkill: string | null = null;
  /** Whether it has been placed once (the first placement snaps instead of sliding). */
  private everPlaced = false;

  constructor() {
    super();
    this.addChild(this.chip, this.bubble);
  }

  /** Whether a leader line is currently shown (i.e. the tail is hidden). */
  get isTethered(): boolean {
    return this.tethered;
  }

  /**
   * Smoothly follow the target position (slide instead of teleporting when the
   * overlap-avoidance solver's solution jumps, to suppress jitter). Only the first placement snaps.
   * @param k interpolation factor 0..1 (smaller is smoother)
   */
  applyPosition(x: number, y: number, k: number) {
    if (!this.everPlaced) {
      this.position.set(x, y);
      this.everPlaced = true;
      return;
    }
    this.x += (x - this.x) * k;
    this.y += (y - this.y) * k;
  }

  /** Apply the state and re-stack the chip and bubble vertically. */
  setState(
    kind: WorkKind,
    detail: string | null,
    activeSkill: string | null,
    todos: TodoItem[]
  ) {
    this.lastKind = kind;
    this.lastDetail = detail;
    this.lastSkill = activeSkill;
    this.chip.set(todos);
    this.bubble.set(kind, detail, activeSkill, !this.tethered);
    this.relayout();
  }

  /** true when connecting with a leader line. Toggles the bubble's tail immediately (§4). */
  setTethered(on: boolean) {
    if (this.tethered === on) return;
    this.tethered = on;
    this.bubble.set(this.lastKind, this.lastDetail, this.lastSkill, !on);
    this.relayout();
  }

  private relayout() {
    // Relative to the cluster center (0,0), put the chip on top and the bubble below.
    const chipH = this.chip.boxHeight;
    const bubbleH = this.bubble.height;
    const totalH = chipH + (chipH > 0 ? STACK_GAP : 0) + bubbleH;
    const top = -totalH / 2;
    if (chipH > 0) {
      this.chip.position.set(0, top + chipH / 2);
      this.bubble.position.set(0, top + chipH + STACK_GAP + bubbleH / 2);
    } else {
      this.chip.position.set(0, 0);
      this.bubble.position.set(0, 0);
    }
  }

  /** Combined bounding box (width/height) for layout. */
  get size(): { w: number; h: number } {
    const w = Math.max(this.chip.boxWidth, this.bubble.width);
    const chipH = this.chip.boxHeight;
    const h = chipH + (chipH > 0 ? STACK_GAP : 0) + this.bubble.height;
    return { w, h };
  }

  /** Whether either the chip or the bubble has substance (i.e. is subject to layout). */
  get visibleSize(): boolean {
    return this.bubble.width > 0 || this.chip.boxWidth > 0;
  }
}
