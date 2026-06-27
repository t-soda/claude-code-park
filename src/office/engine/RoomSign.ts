import { Container, Graphics, Text } from "pixi.js";

/** Sign styling (porting the old building's company sign onto the iso room). */
const SIGN = {
  PANEL: 0x3a2e22, // background (dark espresso brown)
  BORDER: 0xcaa64e, // border (brass gold)
  TEXT: 0xf6ecc9, // text (cream gold)
  PAD_X: 16,
  PAD_Y: 8,
  RADIUS: 7,
  MIN_W: 110,
  FONT: 15,
} as const;

/**
 * Room identification sign. Floated at the back (top) of the room to show at a glance which session's room it is.
 * The background width stretches to fit the session name.
 */
export class RoomSign extends Container {
  private g = new Graphics();
  private text: Text;
  private current = "";

  constructor() {
    super();
    this.text = new Text({
      text: "",
      style: {
        fontFamily: "sans-serif",
        fontSize: SIGN.FONT,
        fontWeight: "bold",
        fill: SIGN.TEXT,
        letterSpacing: 0.5,
        stroke: { color: 0x241a10, width: 2, join: "round" },
      },
    });
    this.text.anchor.set(0.5);
    this.addChild(this.g, this.text);
  }

  /** Set the session label to display (redraw only when it changes). */
  setLabel(label: string): void {
    if (label === this.current) return;
    this.current = label;
    this.text.text = label;

    const panelW = Math.max(SIGN.MIN_W, Math.ceil(this.text.width) + 2 * SIGN.PAD_X);
    const panelH = Math.ceil(this.text.height) + 2 * SIGN.PAD_Y;
    const x = -panelW / 2;
    const y = -panelH / 2;

    this.g.clear();
    this.g
      .roundRect(x, y, panelW, panelH, SIGN.RADIUS)
      .fill(SIGN.PANEL)
      .stroke({ width: 2.5, color: SIGN.BORDER, alpha: 0.95 });
    this.g
      .roundRect(x + 3, y + 3, panelW - 6, panelH - 6, SIGN.RADIUS - 2)
      .stroke({ width: 1, color: SIGN.BORDER, alpha: 0.5 });
  }
}
