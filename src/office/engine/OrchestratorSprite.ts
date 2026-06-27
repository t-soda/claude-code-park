import { Container, Graphics, Text } from "pixi.js";
import type { Session } from "../../bindings";
import { HookBadge, type BadgeVariant } from "./HookBadge";
import { useCharacterStore } from "../../stores/characterStore";
import { drawPixelGrid } from "./drawPixelGrid";

const ORCHESTRATOR_PX = 11; // side length of one dot (px, before scaling)
const ORCHESTRATOR_SCALE = 2 / 3; // overall scale of the Orchestrator sprite
/**
 * Vertical shear (rad) applied for facing. Aligns the shoulder line with the iso tile edge.
 * For 2:1 dimetric (128x64 diamond, edge slope 26.57° = 2:1 horizontal:vertical),
 * use atan(0.5)=26.57° so the on-screen shoulder slope is tan(skew.y)=1/2.
 */
const FACING_SKEW = Math.atan(0.5);

/**
 * Sprite for the main Claude Code session (Orchestrator).
 * Pixel-art rendering of characterStore's orchestrator template + an above-head work bubble.
 */
export class OrchestratorSprite extends Container {
  private bodyG = new Graphics();
  private nameLabel: Text;
  /** Local Y of the above-head anchor where the callout is placed (relative to the sprite origin, in scaled parent coordinates). */
  readonly headOffsetY = -82 * ORCHESTRATOR_SCALE;
  /** Lift amount to stand the feet at the cell center (body is drawn centered on the origin, in scaled parent coordinates). */
  readonly footLift = 40 * ORCHESTRATOR_SCALE;
  private phase: number;
  private working = false;
  private session: Session;
  private hookBadge: HookBadge;
  /** Whether currently drawn facing away (from behind). Fill the eyes with the body color to hide the face. */
  private back = false;

  /** session_id of the associated main session. Used by WorldRenderer for hook matching. */
  get sessionId(): string {
    return this.session.session_id;
  }

  /** Session label shown in the tooltip/sign (slug -> project name -> start of session_id). */
  get label(): string {
    return (
      this.session.slug ?? this.session.project.split("/").pop() ?? this.session.session_id.slice(0, 6)
    );
  }

  constructor(session: Session, phase: number) {
    super();
    this.scale.set(ORCHESTRATOR_SCALE);
    this.phase = phase;
    this.session = session;
    this.nameLabel = new Text({
      text: "",
      style: {
        fontFamily: "sans-serif",
        fontSize: 11,
        fill: 0x2b2f37,
        stroke: { color: 0xffffff, width: 3, join: "round" },
      },
    });
    this.nameLabel.anchor.set(0.5, 0);
    this.addChild(this.bodyG, this.nameLabel);
    this.drawBody();
    this.nameLabel.position.set(0, 52);
    // To avoid overlapping the work bubble (which extends upward from the head anchor headOffsetY),
    // place it slightly below and to the right of the anchor (tunable on real devices).
    this.hookBadge = new HookBadge();
    this.hookBadge.position.set(48, -60);
    this.addChild(this.hookBadge);
    this.apply(session);
  }

  /** Draw the body using characterStore's current template. */
  private drawBody() {
    const t = useCharacterStore.getState().orchestrator;
    // When facing away, fill the eyes with the body color too, making it the back of a faceless head.
    const eye = this.back ? t.bodyColor : t.eyeColor;
    drawPixelGrid(this.bodyG, t.grid, { body: t.bodyColor, eye }, ORCHESTRATOR_PX);
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

  /** Apply the session state to the sprite. */
  apply(session: Session) {
    this.session = session;
    // The nameplate is always fixed. The session label is shown on the sign/tooltip side.
    this.nameLabel.text = "Orchestrator";
    // Bob only when Active and not Idle. Idle and left are static.
    this.working =
      session.status === "Active" && session.current.kind !== "Idle";
    this.alpha = session.status === "Active" ? 1 : 0.5;
  }

  /** Flash the hook fired/passed badge. */
  triggerHook(label: string, nowSec: number, variant: BadgeVariant = "fired") {
    this.hookBadge.trigger(label, nowSec, variant);
  }

  /** Per-frame animation. t is in seconds. */
  update(t: number) {
    // Bob up and down only when Active.
    const bob = this.working ? Math.sin(t * 4 + this.phase) * 3 : 0;
    this.bodyG.y = bob;
    this.hookBadge.update(t);
  }
}
