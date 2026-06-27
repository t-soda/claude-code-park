import { Container, Graphics, Text } from "pixi.js";
import type { TodoItem } from "../../bindings";
import { summarizeTodos } from "./todoSummary";
import { t } from "../../i18n";

/** In-progress color (green) and done color (gray). Aligned with stateToVisual's Editing/Idle. */
const COLOR_PROGRESS = 0x34d399;
const COLOR_DONE = 0x6b7280;

/** TODO progress chip shown above a character's head (compact single line). */
export class TodoChip extends Container {
  private bg = new Graphics();
  private text: Text;

  constructor() {
    super();
    this.text = new Text({
      text: "",
      style: { fontFamily: "sans-serif", fontSize: 11, fill: 0xffffff },
    });
    this.text.anchor.set(0.5);
    this.addChild(this.bg, this.text);
    this.visible = false;
  }

  /** Apply the TODOs. Hidden if empty. */
  set(todos: TodoItem[]) {
    const s = summarizeTodos(todos);
    if (!s) {
      this.visible = false;
      return;
    }
    this.visible = true;
    const color = s.allDone ? COLOR_DONE : COLOR_PROGRESS;
    const label = s.allDone
      ? t("todoChip.allDone", { total: s.total })
      : s.current
        ? `✓ ${s.completed}/${s.total}  ▶ ${s.current}`
        : `✓ ${s.completed}/${s.total}`;
    this.text.text = label;
    const w = this.text.width + 16;
    const h = this.text.height + 8;
    this.bg.clear();
    this.bg
      .roundRect(-w / 2, -h / 2, w, h, 5)
      .fill({ color: 0x12241c, alpha: 0.85 })
      .stroke({ width: 1.5, color, alpha: 0.9 });
    this.text.position.set(0, 0);
  }

  /** The chip's current height (for layout). 0 when hidden. */
  get boxHeight(): number {
    return this.visible ? this.text.height + 8 : 0;
  }

  /** The chip's current width (for layout). 0 when hidden. */
  get boxWidth(): number {
    return this.visible ? this.text.width + 16 : 0;
  }
}
