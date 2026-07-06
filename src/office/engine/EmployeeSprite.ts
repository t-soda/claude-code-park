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

/**
 * Hashes a string to a 32-bit int with an avalanche finalizer, so keys that share a long
 * common prefix and differ only in a trailing character or two (e.g. sequential agent ids)
 * still land on well-spread-out values instead of a cluster (a plain polynomial rolling hash
 * would otherwise carry that small difference straight through to the output).
 */
function hashStr(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (Math.imul(h, 31) + key.charCodeAt(i)) | 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Derive a stable color from a key (same key yields the same color). Hue, saturation, and
 * lightness are all hashed independently (each from a differently-suffixed copy of the key)
 * so the result spans a genuine 3D color space instead of a single ring of hues at fixed
 * saturation/lightness, where neighboring hues tend to look too similar to tell apart.
 */
function colorFor(key: string): number {
  const hue = hashStr(key) % 360;
  const s = 0.5 + ((hashStr(`${key}#s`) % 100) / 100) * 0.35; // 0.50 - 0.85
  const l = 0.45 + ((hashStr(`${key}#l`) % 100) / 100) * 0.3; // 0.45 - 0.75
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
    // Keyed by agent_id (unique per spawn) rather than subagent_type, so repeatedly-dispatched
    // roles (e.g. many "general-purpose" or same-model calls) still come out visually varied
    // instead of clustering on one hue. Falls back to subagent_type only in the brief window
    // before the JSONL sidecar identifies the agent_id (still "" at that point).
    this.color = colorFor(run.agent_id || run.subagent_type || "unknown");
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
