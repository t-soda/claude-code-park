import { Container, Graphics, Sprite, Text } from "pixi.js";
import type { SlotGroup } from "../hookLifecycle";
import { socketOffsets } from "./hookRailLayout";
import { hookSlotTexture } from "./assetManifest";

/** Spacing between sockets (px). */
const SPACING = 26;
/** Lifetime of the fired/passed pulse (sec). */
const PULSE_TTL = 1.2;
/** Device color (purple, same family as HookBadge) / empty-socket color. */
const DEVICE_COLOR = 0xc084fc;
const EMPTY_COLOR = 0x4a525f;
const FIRED_COLOR = 0xffe08a;
const PASSED_COLOR = 0x9aa4b2;
const BLOCKED_COLOR = 0xff5a5a;

/** Pulse variant: fired = matched a registration, passed = passed through,
 * blocked = a hook on this socket blocked its lifecycle. */
export type PulseVariant = "fired" | "passed" | "blocked";

const PULSE_COLOR: Record<PulseVariant, number> = {
  fired: FIRED_COLOR,
  passed: PASSED_COLOR,
  blocked: BLOCKED_COLOR,
};

/** Internal state of one socket (for pulse management). */
interface Socket {
  node: Container;
  base: Graphics; // fallback drawing or texture base
  glow: Graphics;
  triggeredAt: number;
  variant: PulseVariant;
}

/**
 * A rail of 9 sockets along the room's back wall. The origin is the "rail center".
 * Used by setting a position on the parent (scene/world space).
 */
export class HookRail extends Container {
  private sockets: Socket[] = [];
  private groups: SlotGroup[] = [];
  private offsets: number[];

  constructor() {
    super();
    this.offsets = socketOffsets(9, SPACING);
    for (let i = 0; i < 9; i++) {
      const node = new Container();
      node.x = this.offsets[i];
      const glow = new Graphics();
      const base = new Graphics();
      node.addChild(glow, base);
      this.addChild(node);
      this.sockets.push({ node, base, glow, triggeredAt: -Infinity, variant: "passed" });
    }
  }

  /** Apply slot data (device/empty, count). Assumes length 9. */
  set(groups: SlotGroup[]) {
    this.groups = groups;
    for (let i = 0; i < this.sockets.length; i++) {
      this.drawSocket(this.sockets[i], groups[i]?.hooks.length ?? 0);
    }
  }

  private drawSocket(s: Socket, count: number) {
    s.node.removeChildren();
    s.node.addChild(s.glow);
    const tex = hookSlotTexture(count > 0 ? "device" : "empty");
    if (tex) {
      const sp = new Sprite(tex);
      sp.anchor.set(0.5);
      s.node.addChild(sp);
    } else {
      s.base.clear();
      if (count > 0) {
        // Device: a small rounded box + a gear-like dot in the center.
        s.base
          .roundRect(-8, -8, 16, 16, 3)
          .fill({ color: 0x2a2433 })
          .stroke({ width: 1.5, color: DEVICE_COLOR });
        s.base.circle(0, 0, 3).fill(DEVICE_COLOR);
      } else {
        // Empty socket: a dark ring.
        s.base.circle(0, 0, 6).stroke({ width: 1.5, color: EMPTY_COLOR });
      }
      s.node.addChild(s.base);
    }
    if (count > 1) {
      const t = new Text({
        text: `${count}`,
        style: { fontFamily: "sans-serif", fontSize: 9, fill: 0xffffff },
      });
      t.anchor.set(0, 1);
      t.position.set(6, 10);
      s.node.addChild(t);
    }
  }

  /** Trigger a slot's pulse (see PulseVariant). */
  trigger(slotIndex: number, variant: PulseVariant, nowSec: number) {
    const s = this.sockets[slotIndex];
    if (!s) return;
    s.triggeredAt = nowSec;
    s.variant = variant;
  }

  /** Local offset of slot i from the rail center (used as the beam start point). */
  socketLocalPos(slotIndex: number): { x: number; y: number } {
    return { x: this.offsets[slotIndex] ?? 0, y: 0 };
  }

  groupAt(slotIndex: number): SlotGroup | undefined {
    return this.groups[slotIndex];
  }

  /** For stage-global px, return the index of the containing socket (null if none). */
  hitSlot(cx: number, cy: number): number | null {
    for (let i = 0; i < this.sockets.length; i++) {
      const b = this.sockets[i].node.getBounds();
      if (cx >= b.minX && cx <= b.maxX && cy >= b.minY && cy <= b.maxY) return i;
    }
    return null;
  }

  /** Per frame: decay the pulse (zoom + glow) over time. */
  update(nowSec: number) {
    for (const s of this.sockets) {
      const age = nowSec - s.triggeredAt;
      s.glow.clear();
      if (age < 0 || age > PULSE_TTL) {
        s.node.scale.set(1);
        continue;
      }
      const p = age / PULSE_TTL; // 0->1
      const color = PULSE_COLOR[s.variant];
      const strong = s.variant !== "passed";
      const r = 10 + p * 10;
      s.glow.circle(0, 0, r).fill({ color, alpha: (1 - p) * (strong ? 0.5 : 0.25) });
      s.node.scale.set(1 + Math.max(0, 0.3 - p) * (strong ? 1.2 : 0.5));
    }
  }
}
