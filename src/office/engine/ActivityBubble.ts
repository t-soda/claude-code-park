import { Container, Graphics, Text } from "pixi.js";
import type { WorkKind } from "../../bindings";
import { visualFor } from "../stateToVisual";

/** Work-status speech bubble shown above a character's head. */
export class ActivityBubble extends Container {
  private bg: Graphics;
  private text: Text;

  constructor() {
    super();
    this.bg = new Graphics();
    this.text = new Text({
      text: "",
      style: { fontFamily: "sans-serif", fontSize: 12, fill: 0xffffff, align: "center" },
    });
    this.text.anchor.set(0.5);
    this.addChild(this.bg, this.text);
  }

  set(kind: WorkKind, detail: string | null, activeSkill: string | null, showTail = true) {
    const v = visualFor(kind);
    const main = detail ? `${v.label}  ${detail}` : v.label;
    // While a skill is in use, show it on a second line.
    const label = activeSkill ? `${main}\n🛠️ ${activeSkill}` : main;
    this.text.text = label;
    const w = this.text.width + 18;
    const h = this.text.height + 10;
    this.bg.clear();
    this.bg
      .roundRect(-w / 2, -h / 2, w, h, 6)
      .fill({ color: 0x1b1f2a, alpha: 0.85 })
      .stroke({ width: 1.5, color: v.color, alpha: 0.9 });
    // Add a tail (downward triangle) at the bottom center of the box to make it look like speech.
    if (showTail) {
      const tailW = 12;
      const tailH = 8;
      const baseY = h / 2 - 1; // overlap the box edge by 1px to close the gap
      this.bg
        .moveTo(-tailW / 2, baseY)
        .lineTo(0, baseY + tailH)
        .lineTo(tailW / 2, baseY)
        .fill({ color: 0x1b1f2a, alpha: 0.85 })
        .stroke({ width: 1.5, color: v.color, alpha: 0.9 });
    }
    this.text.position.set(0, 0);
  }
}
