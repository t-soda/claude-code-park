import { Container, Graphics, Text } from "pixi.js";
import type { SubAgentRun } from "../../bindings";
import { HookBadge, type BadgeVariant } from "./HookBadge";
import { useCharacterStore, employeeVariant } from "../../stores/characterStore";
import { drawPixelGrid } from "./drawPixelGrid";
import { t } from "../../i18n";

/**
 * Vertical shear (rad) applied for facing. Aligns the shoulder line with the iso tile edge.
 * For 2:1 dimetric (128x64 diamond, edge slope 26.57° = 2:1 horizontal:vertical),
 * use atan(0.5)=26.57° so the on-screen shoulder slope is tan(skew.y)=1/2.
 */
const FACING_SKEW = Math.atan(0.5);

/** Derive a stable color from the subagent_type name (same role yields the same color). */
function colorFor(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  // HSL->RGB (fixed saturation and lightness)
  const s = 0.55;
  const l = 0.6;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hue < 60) [r, g, b] = [c, x, 0];
  else if (hue < 120) [r, g, b] = [x, c, 0];
  else if (hue < 180) [r, g, b] = [0, c, x];
  else if (hue < 240) [r, g, b] = [0, x, c];
  else if (hue < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return (
    (Math.round((r + m) * 255) << 16) |
    (Math.round((g + m) * 255) << 8) |
    Math.round((b + m) * 255)
  );
}

/**
 * Sprite for a sub agent (employee) that has come in and is working.
 * A small pixel figure + role name + work bubble.
 */
export class EmployeeSprite extends Container {
  private bodyG = new Graphics();
  private nameLabel: Text;
  /** Local Y of the above-head anchor where the callout is placed (relative to the sprite origin). */
  readonly headOffsetY = -52;
  /** Lift amount to stand the feet at the cell center (because the body is drawn centered on the origin). */
  readonly footLift = 22;
  private phase: number;
  private working = false;
  private color: number;
  private hookBadge: HookBadge;
  /** The runtime model that actually ran. Used to vary the pixel art (null = shared default art). */
  private model: string | null = null;
  /** Whether currently drawn facing away (from behind). Fill the eyes with the body color to hide the face. */
  private back = false;
  /** The agent_id of this employee (sub agent). Empty string means not yet identified from JSONL. */
  readonly agentId: string;
  /** Display name used as the title of the dialog opened on click. */
  readonly label: string;

  constructor(run: SubAgentRun, phase: number) {
    super();
    this.phase = phase;
    this.agentId = run.agent_id;
    this.label = run.subagent_type ?? t("sprite.dispatchFallback");
    this.color = colorFor(run.subagent_type ?? run.agent_id);
    this.nameLabel = new Text({
      text: "",
      style: {
        fontFamily: "sans-serif",
        fontSize: 10,
        fill: 0x2b2f37,
        stroke: { color: 0xffffff, width: 3, join: "round" },
      },
    });
    this.nameLabel.anchor.set(0.5, 0);
    this.addChild(this.bodyG, this.nameLabel);
    this.nameLabel.position.set(0, 32);
    this.drawBody();
    // Employees are small, so place the badge slightly below and to the right of the anchor
    // to avoid overlapping the work bubble (which extends upward from the head anchor headOffsetY).
    this.hookBadge = new HookBadge();
    this.hookBadge.position.set(32, -36);
    this.addChild(this.hookBadge);
    this.apply(run);
  }

  private drawBody() {
    // If the model is known, draw a per-model build; if unspecified/undeterminable,
    // fall back to the editor-editable shared default art.
    const grid = this.modelGrid();
    // Body uses the role color, eyes are fixed black (the template colors aren't used for employees).
    // When facing away, fill the eyes with the body color too, making it the back of a faceless head.
    const eye = this.back ? this.color : 0x1f2329;
    drawPixelGrid(this.bodyG, grid, { body: this.color, eye }, 6);
  }

  /** Return the pixel-art grid corresponding to the model this employee actually ran. */
  private modelGrid() {
    // Vary by runtime model; fall back to the shared default ("employee") when undeterminable.
    const key = employeeVariant(this.model);
    return useCharacterStore.getState()[key].grid;
  }

  /** Redraw, called externally when the template changes. */
  redraw() {
    this.drawBody();
  }

  /**
   * Flip the body horizontally and shear it according to the direction of travel (the bubble and label are not flipped).
   * - scale.x (left/right): screen-x facing. Vertical dot columns stay vertical.
   * - skew.y (vertical shear): tilt the shoulder line to the iso tile-edge angle. The on-screen
   *   slope is set by tan(skew.y) and does not depend on scale.x, so the 4 directions (left/right x front/back)
   *   are built from the signs of dir and back (up-right = right shoulder down / down-right = left shoulder down / up-left = left shoulder down / down-left = right shoulder down).
   * - back: when facing away, redraw from behind (eyes removed).
   */
  setFacing(dir: 1 | -1, back: boolean) {
    this.bodyG.scale.x = dir;
    this.bodyG.skew.y = FACING_SKEW * dir * (back ? 1 : -1);
    if (back !== this.back) {
      this.back = back;
      this.drawBody();
    }
  }

  apply(run: SubAgentRun) {
    this.nameLabel.text = run.subagent_type ?? t("sprite.dispatchFallback");
    this.working = run.status === "Active" && run.current.kind !== "Idle";
    this.alpha = run.status === "Active" ? 1 : 0.45;
    // The runtime model is identified after creation, so redraw the body when it changes.
    if (run.model !== this.model) {
      this.model = run.model;
      this.drawBody();
    }
  }

  /** Flash the hook fired/passed badge. */
  triggerHook(label: string, nowSec: number, variant: BadgeVariant = "fired") {
    this.hookBadge.trigger(label, nowSec, variant);
  }

  update(t: number) {
    // Jitter slightly, as if typing.
    this.bodyG.y = this.working ? Math.abs(Math.sin(t * 8 + this.phase)) * 2 : 0;
    this.hookBadge.update(t);
  }
}
