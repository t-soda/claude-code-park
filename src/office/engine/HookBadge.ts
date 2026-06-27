import { Container, Graphics, Text } from "pixi.js";

/** Seconds the badge stays visible (including fade-out). */
const TTL_SEC = 2.5;
/** Color symbolizing a hook firing (purple). */
const FIRED_COLOR = 0xc084fc;
/** Gray for a checkpoint passed (no firing). Same family as the leader line. */
const PASSED_COLOR = 0x9aa4b2;

/** Badge variant: fired (🪝) or passed (▷). Passed is also shown in learning mode. */
export type BadgeVariant = "fired" | "passed";

/** Small badge that flashes above the head on firing. A layer independent of ActivityBubble. */
export class HookBadge extends Container {
  private bg: Graphics;
  private labelText: Text;
  private triggeredAt = -Infinity;

  constructor() {
    super();
    this.bg = new Graphics();
    this.labelText = new Text({
      text: "",
      style: { fontFamily: "sans-serif", fontSize: 11, fill: 0xffffff },
    });
    this.labelText.anchor.set(0.5);
    this.addChild(this.bg, this.labelText);
    this.visible = false;
  }

  /** Start flashing in response to a new firing/passing. */
  trigger(text: string, nowSec: number, variant: BadgeVariant = "fired") {
    this.labelText.text = text;
    const w = this.labelText.width + 14;
    const h = this.labelText.height + 8;
    // Fired stands out with purple + dark background; passed is subdued with gray + pale background.
    const color = variant === "fired" ? FIRED_COLOR : PASSED_COLOR;
    const fill = variant === "fired" ? 0x2a1f3a : 0x222730;
    this.bg.clear();
    this.bg
      .roundRect(-w / 2, -h / 2, w, h, 5)
      .fill({ color: fill, alpha: variant === "fired" ? 0.92 : 0.8 })
      .stroke({ width: 1.5, color, alpha: variant === "fired" ? 0.95 : 0.85 });
    this.triggeredAt = nowSec;
    this.visible = true;
  }

  /** Call every frame. Pulse and fade with elapsed time, then hide once TTL passes. */
  update(nowSec: number) {
    if (!this.visible) return;
    const age = nowSec - this.triggeredAt;
    if (age > TTL_SEC) {
      this.visible = false;
      return;
    }
    // Progress 0->1. Pop in the first half, fade out in the second.
    const p = age / TTL_SEC;
    const pulse = 1 + Math.max(0, 0.25 - p) * 1.5; // slight zoom early on
    this.scale.set(pulse);
    this.alpha = p < 0.6 ? 1 : 1 - (p - 0.6) / 0.4;
  }
}
