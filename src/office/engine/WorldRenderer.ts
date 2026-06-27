import { Container, Graphics, TilingSprite } from "pixi.js";
import { ICON, hitIcon, signIconLayout } from "./signMenuLayout";
import type { Session, SubAgentRun } from "../../bindings";
import type { LogTarget } from "../../stores/openLogStore";
import { useOpenLogStore } from "../../stores/openLogStore";
import { Callout } from "./Callout";
import { layoutCallouts, nextTethered, type CalloutBox } from "./calloutLayout";
import type { HookFlash } from "../../stores/hookStore";
import {
  planRoom,
  planTown,
  townSignature,
  type PlacedRoom,
  type RoomPlan,
} from "./roomLayout";
import { cellToWorld, TILE_W, TILE_H, type Cell } from "./iso";
import { makeObject, hasTexture, tileTexture, type Orientation, type VariantKey } from "./assetManifest";
import { placeDecor } from "./decorPlacer";
import type { IsoFloor } from "./IsoFloor";
import { RoomSign } from "./RoomSign";
import { EmployeeSprite } from "./EmployeeSprite";
import { OrchestratorSprite } from "./OrchestratorSprite";
import { makeWander, stepWander, type WanderState, type CellRect } from "./Wanderer";
import { HookRail } from "./HookRail";
import { HookBeam, pairKey } from "./HookBeam";
import { groupBySlot, eventToSlotIndex, matchingHooks, type SlotGroup } from "../hookLifecycle";
import type { EffectiveHooks } from "../../ipc/commands";

/** Internal key for looking up the Orchestrator's wander state (won't collide with employee agent_id). */
const ORCHESTRATOR_KEY = "__orchestrator__";

/** Speed at which callouts follow toward the overlap-avoidance solution. */
const CALLOUT_FOLLOW = 8;
/** Displacement (px) at which the leader line appears/disappears (hysteresis). */
const TETHER_ON = 20;
const TETHER_OFF = 12;
/** Margin (px) when pulling the scene toward the view origin. */
const SCENE_PAD = 80;
/** Headroom above (for callouts) and slack below (for grounding) reserved in the content height. */
const TOP_HEADROOM = 110;
const BOTTOM_ROOM = 50;
/** Number of cells to nudge wall furniture toward the wall (shifted back by the padding cell to hug it). */
const WALL_HUG = 1.45;

interface RoomView {
  orch: OrchestratorSprite;
  employees: Map<string, EmployeeSprite>;
  /** key(ORCHESTRATOR_KEY / employee key) → wander state. */
  wander: Map<string, WanderState>;
  /** This room's furniture sprites (children of contentLayer). */
  furniture: Container[];
  /** The room's identifying sign (child of signLayer). */
  sign: RoomSign;
  /** The menu icon to the right of the sign (child of signLayer). */
  menuIcon: Container;
  /** The "open terminal" icon to the right of the sign (child of signLayer). */
  terminalIcon: Container;
  /** Absolute cell position of room-local (0,0). */
  col0: number;
  row0: number;
  plan: RoomPlan;
  orchestratorWorking: boolean;
  /** Signature used to decide whether to rebuild furniture. */
  furnitureSig: string;
  /** The lifecycle rail on the back wall (child of signLayer). */
  rail: HookRail;
  /** This session's cwd (lookup key for effective hooks). */
  project: string;
}

/** Whether working (fixed seat) or not. Idle and non-Active wander. */
function isWorking(status: string, kind: string): boolean {
  return status === "Active" && kind !== "Idle";
}

/** Stable key for an employee (prefer agent_id, otherwise fall back to ordinal). */
function empKey(run: SubAgentRun, i: number): string {
  return run.agent_id || `idx${i}`;
}

/** Session display name shown on the sign (same logic as the Orchestrator sprite's name tag). */
function sessionLabel(s: Session): string {
  return s.slug ?? s.project.split("/").pop() ?? s.session_id.slice(0, 6);
}

/** Build the common style for sign-adjacent icons (rounded base + brass border), draw the glyph, and return it. */
function makeSignIcon(drawGlyph: (g: Graphics) => void): Container {
  const icon = new Container();
  const g = new Graphics();
  g.roundRect(0, 0, ICON.size, ICON.size, 6).fill(0x3a2e22).stroke({ width: 2, color: 0xcaa64e, alpha: 0.95 });
  drawGlyph(g);
  icon.addChild(g);
  return icon;
}

/**
 * Projects the session list from worldStore onto top-down iso "rooms".
 * 1 session = 1 room. Rust is the single source of truth, so this stays a pure projection.
 */
export class WorldRenderer {
  private views = new Map<string, RoomView>();
  private lastFlash = new Map<string, number>();
  private lastT: number | null = null;

  /** Scene holding floor, furniture, and characters (carries an offset that pulls it toward the view origin). */
  private scene = new Container();
  /** Open-ground floor tiled outside the rooms (backmost; only when ground.png exists). */
  private bg: TilingSprite | null = null;
  /** Layer that holds furniture and characters sorted by depth. */
  private contentLayer = new Container();
  /** Layer holding the room signs (in front of furniture, behind callouts). */
  private signLayer = new Container();
  /** Shared layer holding all callouts (frontmost). */
  private calloutLayer = new Container();
  private tetherG = new Graphics();
  private callouts = new Map<string, Callout>();
  /** Screen-space Graphics for dialog tethers (owned by Stage; injected by OfficeView). */
  private dialogTetherG: Graphics | null = null;
  /** Hook firing beam (frontmost). */
  private beam = new HookBeam();
  /** Whether to show hook visualization (rail + badge + beam). OfficeView reflects uiPrefs. */
  private hookView = true;

  /** Most recent town layout (used to redraw the floor when the time of day changes). */
  private lastPlaced: PlacedRoom[] = [];
  private townSig = "";

  constructor(
    layer: Container,
    private floor: IsoFloor,
    private onContentSize?: (w: number, h: number) => void
  ) {
    this.contentLayer.sortableChildren = true;
    this.calloutLayer.addChild(this.tetherG);
    this.calloutLayer.addChild(this.beam);
    this.scene.addChild(this.floor, this.contentLayer, this.signLayer, this.calloutLayer);
    // Open-ground floor (backmost). Tile it if ground.png exists. Size is adjusted in relayoutFloor.
    const groundTex = this.groundTexture();
    if (groundTex) {
      this.bg = new TilingSprite({ texture: groundTex, width: 1, height: 1 });
      this.bg.tint = this.floor.getTheme().groundTint;
      this.scene.addChildAt(this.bg, 0);
    }
    layer.addChild(this.scene);
  }

  /** Cell → world coordinates (convert room-local cell to absolute cell and project). */
  private worldOf(view: RoomView, col: number, row: number) {
    return cellToWorld(view.col0 + col, view.row0 + row);
  }

  /**
   * Find a character at canvas-relative px (= Pixi stage global space).
   * Returns the frontmost (highest zIndex) target whose global AABB (Orchestrator/employee) contains the point.
   */
  hitTest(cx: number, cy: number): LogTarget | null {
    let best: { target: LogTarget; z: number } | null = null;
    const consider = (target: LogTarget, sprite: Container) => {
      const b = sprite.getBounds(); // AABB in stage global space
      if (cx < b.minX || cx > b.maxX || cy < b.minY || cy > b.maxY) return;
      const z = sprite.zIndex;
      if (!best || z >= best.z) best = { target, z };
    };
    for (const [sessionId, view] of this.views) {
      consider({ sessionId, agentId: null, title: view.orch.label }, view.orch);
      for (const emp of view.employees.values()) {
        if (!emp.agentId) continue; // employees whose JSONL can't be identified aren't clickable
        consider({ sessionId, agentId: emp.agentId, title: emp.label }, emp);
      }
    }
    return best ? (best as { target: LogTarget; z: number }).target : null;
  }

  /** Find a rail socket at canvas-relative px (for opening slot details on click). */
  hitTestRail(cx: number, cy: number): { group: SlotGroup } | null {
    for (const st of this.views.values()) {
      const slot = st.rail.hitSlot(cx, cy);
      if (slot != null) {
        const group = st.rail.groupAt(slot);
        if (group) return { group };
      }
    }
    return null;
  }

  /** Shared hit-test logic for sign-adjacent icons. pick selects the target icon. */
  private hitTestSignIcon(
    cx: number,
    cy: number,
    pick: (st: RoomView) => Container
  ): { id: string; st: RoomView } | null {
    for (const [id, st] of this.views) {
      const b = pick(st).getBounds(); // AABB in global space
      if (hitIcon(cx, cy, { minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY })) {
        return { id, st };
      }
    }
    return null;
  }

  /** If a sign menu icon is at canvas-relative px, return its project. */
  hitTestSignMenu(cx: number, cy: number): { project: string } | null {
    const hit = this.hitTestSignIcon(cx, cy, (st) => st.menuIcon);
    return hit ? { project: hit.st.project } : null;
  }

  /** If a terminal icon is at canvas-relative px, return its session. */
  hitTestSignTerminal(cx: number, cy: number): { sessionId: string; project: string } | null {
    const hit = this.hitTestSignIcon(cx, cy, (st) => st.terminalIcon);
    return hit ? { sessionId: hit.id, project: hit.st.project } : null;
  }

  /** Receive the screen-space tether Graphics (OfficeView passes the Stage's). */
  setDialogTether(g: Graphics) {
    this.dialogTetherG = g;
  }

  /** If a log dialog is open, draw a line from the character to its attach point. */
  private drawDialogTether() {
    const g = this.dialogTetherG;
    if (!g) return;
    g.clear();
    const { target, dialogAnchor } = useOpenLogStore.getState();
    if (!target || !dialogAnchor) return;
    const pos = this.spriteGlobalPos(target);
    if (!pos) return;
    g.moveTo(pos.x, pos.y)
      .lineTo(dialogAnchor.x, dialogAnchor.y)
      .stroke({ width: 1, color: 0x9aa4b2, alpha: 0.7 });
  }

  /** The target character's current global coordinates (overhead anchor). Used as the line's start point; null if not found. */
  spriteGlobalPos(target: LogTarget): { x: number; y: number } | null {
    const view = this.views.get(target.sessionId);
    if (!view) return null;
    let sprite: Container | undefined;
    if (target.agentId == null) {
      sprite = view.orch;
    } else {
      for (const emp of view.employees.values()) {
        if (emp.agentId === target.agentId) {
          sprite = emp;
          break;
        }
      }
    }
    if (!sprite) return null;
    const p = sprite.getGlobalPosition();
    return { x: p.x, y: p.y };
  }

  /** The room's waiting area (absolute cell rectangle). */
  private waitRect(view: RoomView): CellRect {
    const w = view.plan.waiting;
    return {
      col0: view.col0 + w.col0,
      col1: view.col0 + w.col1,
      row0: view.row0 + w.row0,
      row1: view.row0 + w.row1,
    };
  }

  /** Reflect the session list (create/update/delete). */
  sync(sessions: Session[]) {
    const visible = sessions.filter((s) => s.status !== "Ended");
    const liveIds = new Set(visible.map((s) => s.session_id));

    // Destroy views for sessions that have left.
    for (const [id, st] of this.views) {
      if (!liveIds.has(id)) {
        st.orch.destroy({ children: true });
        for (const e of st.employees.values()) e.destroy({ children: true });
        for (const f of st.furniture) f.destroy({ children: true });
        st.sign.destroy({ children: true });
        st.menuIcon.destroy({ children: true });
        st.terminalIcon.destroy({ children: true });
        st.rail.destroy({ children: true });
        this.views.delete(id);
        this.lastFlash.delete(st.orch.sessionId);
      }
    }

    // Sprite diffing and layout calculation per session.
    const rooms: Array<{ sessionId: string; plan: RoomPlan }> = [];
    const freshSprites = new Map<string, { orch: boolean; emps: string[] }>();

    visible.forEach((session, idx) => {
      const fresh: string[] = [];
      let orchFresh = false;
      let st = this.views.get(session.session_id);
      if (!st) {
        const orch = new OrchestratorSprite(session, idx * 0.7);
        this.contentLayer.addChild(orch);
        const sign = new RoomSign();
        this.signLayer.addChild(sign);
        const rail = new HookRail();
        rail.visible = this.hookView;
        this.signLayer.addChild(rail);
        // Three-line (hamburger) menu icon to the right of the sign.
        const menuIcon = makeSignIcon((g) => {
          for (let i = 0; i < 3; i++) {
            g.rect(7, 8 + i * 6, ICON.size - 14, 2).fill(0xf6ecc9);
          }
        });
        this.signLayer.addChild(menuIcon);
        // Terminal icon styled like ">_".
        const terminalIcon = makeSignIcon((g) => {
          g.moveTo(8, 9).lineTo(13, 14).lineTo(8, 19).stroke({ width: 2, color: 0xf6ecc9 });
          g.rect(14, 18, 7, 2).fill(0xf6ecc9);
        });
        this.signLayer.addChild(terminalIcon);
        st = {
          orch,
          employees: new Map(),
          wander: new Map(),
          furniture: [],
          sign,
          menuIcon,
          terminalIcon,
          col0: 0,
          row0: 0,
          plan: planRoom([], 0),
          orchestratorWorking: false,
          furnitureSig: "",
          rail,
          project: session.project,
        };
        this.views.set(session.session_id, st);
        orchFresh = true;
      } else {
        st.orch.apply(session);
        st.project = session.project;
      }

      // Diff the employee sprites (arrivals/departures).
      const runs = session.subagents.filter((r) => r.status !== "Ended");
      const liveKeys = new Set(runs.map((r, i) => empKey(r, i)));
      for (const [key, sprite] of st.employees) {
        if (!liveKeys.has(key)) {
          sprite.destroy({ children: true });
          st.employees.delete(key);
          st.wander.delete(key);
          this.lastFlash.delete(key);
        }
      }
      runs.forEach((run, i) => {
        const key = empKey(run, i);
        let sprite = st!.employees.get(key);
        if (!sprite) {
          sprite = new EmployeeSprite(run, i * 0.9 + 0.3);
          this.contentLayer.addChild(sprite);
          st!.employees.set(key, sprite);
          fresh.push(key);
        } else {
          sprite.apply(run);
        }
      });

      // Room layout calculation (working = fixed desk, idle = wandering in the waiting area).
      const workingSorted = runs
        .map((r, i) => ({ key: empKey(r, i), working: isWorking(r.status, r.current.kind) }))
        .filter((e) => e.working)
        .map((e) => e.key)
        .sort();
      const idleCount = runs.length - workingSorted.length;
      st.plan = planRoom(workingSorted, idleCount);
      st.orchestratorWorking = isWorking(session.status, session.current.kind);
      rooms.push({ sessionId: session.session_id, plan: st.plan });
      freshSprites.set(session.session_id, { orch: orchFresh, emps: fresh });
    });

    // Arrange the town (multiple rooms) onto the meta-grid.
    const placed = planTown(rooms);
    const placedById = new Map(placed.map((p) => [p.sessionId, p]));
    const sessionById = new Map(visible.map((s) => [s.session_id, s]));
    for (const p of placed) {
      const st = this.views.get(p.sessionId);
      if (!st) continue;
      st.col0 = p.col0;
      st.row0 = p.row0;
      const session = sessionById.get(p.sessionId);
      if (session) st.sign.setLabel(sessionLabel(session));
      this.positionSign(st);
    }
    this.lastPlaced = placed;

    // When the town composition changes, redraw the floor and update the scene offset and content extent.
    const sig = townSignature(placed);
    if (sig !== this.townSig) {
      this.townSig = sig;
      this.relayoutFloor();
    }

    // Rebuild furniture (per room, only when the desk arrangement changes).
    for (const st of this.views.values()) {
      const fsig = this.furnitureSignature(st);
      if (fsig !== st.furnitureSig) {
        this.buildFurniture(st);
        st.furnitureSig = fsig;
      }
    }

    // Place new sprites at their destination immediately without sliding.
    for (const [sessionId, f] of freshSprites) {
      const st = this.views.get(sessionId);
      if (!st || !placedById.has(sessionId)) continue;
      if (f.orch) {
        const c = st.orchestratorWorking
          ? st.plan.orchestrator
          : this.waitCenterLocal(st.plan);
        const w = this.worldOf(st, c.col, c.row);
        st.orch.position.set(w.x, w.y - st.orch.footLift);
        st.orch.zIndex = w.y;
      }
      for (const key of f.emps) {
        const sprite = st.employees.get(key);
        if (!sprite) continue;
        const slot = st.plan.desks.get(key);
        const cell = slot ? slot.cell : this.waitCenterLocal(st.plan);
        const w = this.worldOf(st, cell.col, cell.row);
        sprite.position.set(w.x, w.y - sprite.footLift);
        sprite.zIndex = w.y;
      }
    }

    this.syncCallouts(visible);
  }

  /** Center of the waiting area (room-local cell). Used as the initial position for new idle characters. */
  private waitCenterLocal(plan: RoomPlan): Cell {
    const w = plan.waiting;
    return { col: (w.col0 + w.col1) / 2, row: (w.row0 + w.row1) / 2 };
  }

  /** Float the sign above the back (top) wall of the room. */
  private positionSign(view: RoomView) {
    const hh = TILE_H / 2;
    const top = cellToWorld(view.col0, view.row0);
    const cx = cellToWorld(
      view.col0 + (view.plan.cols - 1) / 2,
      view.row0 + (view.plan.rows - 1) / 2
    ).x;
    // Up by wall (48) + coping + margin.
    view.sign.position.set(cx, top.y - hh - 78);
    const signHalf = view.sign.width / 2;
    const icons = signIconLayout(view.sign.x + signHalf, view.sign.y - ICON.size / 2);
    view.terminalIcon.position.set(icons.terminal.x, icons.terminal.y);
    view.menuIcon.position.set(icons.menu.x, icons.menu.y);
    // Place the rail horizontally a bit below the sign, in front of the back wall.
    view.rail.position.set(cx, top.y - hh - 44);
  }

  /** Redraw the floor for the current town layout and update the scene offset and content extent. */
  private relayoutFloor() {
    this.floor.layout(this.lastPlaced);
    const b = this.bounds(this.lastPlaced);
    this.scene.position.set(-b.minX + SCENE_PAD, -b.minY + SCENE_PAD);
    this.onContentSize?.(
      b.maxX - b.minX + 2 * SCENE_PAD,
      b.maxY - b.minY + 2 * SCENE_PAD
    );
    // Cover the open ground over the content extent plus a wide margin (so it never runs out while panning).
    if (this.bg) {
      const M = 2000;
      this.bg.position.set(b.minX - M, b.minY - M);
      this.bg.width = b.maxX - b.minX + 2 * M;
      this.bg.height = b.maxY - b.minY + 2 * M;
    }
  }

  /** World-coordinate bounds covering all rooms (including walls, headroom, and grounding slack). */
  private bounds(placed: PlacedRoom[]) {
    const hw = TILE_W / 2;
    const hh = TILE_H / 2;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const r of placed) {
      const top = cellToWorld(r.col0, r.row0);
      const right = cellToWorld(r.col0 + r.plan.cols - 1, r.row0);
      const left = cellToWorld(r.col0, r.row0 + r.plan.rows - 1);
      const bottom = cellToWorld(r.col0 + r.plan.cols - 1, r.row0 + r.plan.rows - 1);
      minX = Math.min(minX, left.x - hw);
      maxX = Math.max(maxX, right.x + hw);
      minY = Math.min(minY, top.y - hh - TOP_HEADROOM);
      maxY = Math.max(maxY, bottom.y + hh + BOTTOM_ROOM);
    }
    if (!isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    return { minX, minY, maxX, maxY };
  }

  /** Furniture signature based on desk arrangement (cell + facing) plus the room's absolute position (rebuilt on change). */
  private furnitureSignature(view: RoomView): string {
    const desks = [...view.plan.desks.values()]
      .map((s) => `${s.cell.col},${s.cell.row},${s.facing}`)
      .join(";");
    return `@${view.col0},${view.row0}|${view.plan.cols}x${view.plan.rows}|${view.plan.orchestrator.col},${view.plan.orchestrator.row},${view.plan.orchestratorFacing}|${desks}`;
  }

  /** Determine the zIndex bias from the desk facing (down-right is front, up-left is back). */
  private deskZBias(facing: Orientation): number {
    return facing === "frontRight" ? 0.6 : -0.6;
  }

  /** Rebuild the room's furniture (Orchestrator desk, employee desks, random decor). */
  private buildFurniture(view: RoomView) {
    for (const f of view.furniture) f.destroy({ children: true });
    view.furniture = [];
    const add = (
      id: string,
      variant: VariantKey | undefined,
      cell: Cell,
      zBias: number,
      cellOffset: { col: number; row: number } = { col: 0, row: 0 }
    ) => {
      const o = makeObject(id, variant);
      const w = this.worldOf(view, cell.col + cellOffset.col, cell.row + cellOffset.row);
      o.position.set(w.x, w.y);
      o.zIndex = w.y + zBias;
      this.contentLayer.addChild(o);
      view.furniture.push(o);
    };

    // Orchestrator desk.
    add("orchestratorDesk", view.plan.orchestratorFacing, view.plan.orchestrator, this.deskZBias(view.plan.orchestratorFacing));
    // Employees' fixed desks (per facing).
    for (const slot of view.plan.desks.values()) {
      add("desk", slot.facing, slot.cell, this.deskZBias(slot.facing));
    }
    // Random decor (deterministic, seeded by session_id).
    // Don't render decor whose PNG isn't placed via code drawing (to avoid clutter from placeholder shelves, etc.).
    for (const d of placeDecor(view.plan, view.orch.sessionId)) {
      if (!hasTexture(d.id, d.variant)) continue;
      // Nudge wall furniture back by the padding cell so it hugs the wall
      // (left wall = decrease col = toward upper-left / right wall = decrease row = toward upper-right).
      const offset =
        d.variant === "wallLeft"
          ? { col: -WALL_HUG, row: 0 }
          : d.variant === "wallRight"
            ? { col: 0, row: -WALL_HUG }
            : { col: 0, row: 0 };
      add(d.id, d.variant, d.cell, 0, offset);
    }
  }

  // --- Below: callout (overhead display) logic follows the existing approach ---

  private syncCallouts(visible: Session[]) {
    const liveCalloutKeys = new Set<string>();
    visible.forEach((session) => {
      const st = this.views.get(session.session_id);
      if (!st) return;
      liveCalloutKeys.add(session.session_id);
      this.ensureCallout(session.session_id).setState(
        session.current.kind,
        session.current.detail,
        session.current.active_skill,
        session.current.todos
      );
      const runs = session.subagents.filter((r) => r.status !== "Ended");
      runs.forEach((run, i) => {
        const key = empKey(run, i);
        liveCalloutKeys.add(key);
        this.ensureCallout(key).setState(
          run.current.kind,
          run.current.detail,
          run.current.active_skill,
          run.current.todos
        );
      });
    });
    for (const [key, c] of this.callouts) {
      if (!liveCalloutKeys.has(key)) {
        c.destroy({ children: true });
        this.callouts.delete(key);
      }
    }
    this.scene.addChild(this.calloutLayer); // keep it frontmost
  }

  /** Reflect a characterStore template change across all sprites. */
  redrawAll() {
    for (const st of this.views.values()) {
      st.orch.redraw();
      for (const e of st.employees.values()) e.redraw();
    }
  }

  /** Ground texture for the current theme (falls back from the dedicated image to the shared ground). */
  private groundTexture() {
    return tileTexture(this.floor.getTheme().groundId) ?? tileTexture("ground");
  }

  /** On a time-of-day theme change, redraw the floor and update the ground image and tint to match (called from Stage). */
  refreshFloor() {
    this.floor.layout(this.lastPlaced);
    if (this.bg) {
      const tex = this.groundTexture();
      if (tex) this.bg.texture = tex;
      this.bg.tint = this.floor.getTheme().groundTint;
    }
  }

  /** Set whether hook visualization is shown. When off, hide the rails and beams. */
  setHookView(on: boolean) {
    this.hookView = on;
    for (const st of this.views.values()) st.rail.visible = on;
    this.beam.visible = on;
  }

  /** Reflect per-project effective hooks onto each room's rail. */
  applyEffectiveHooks(byProject: Record<string, EffectiveHooks>) {
    if (!this.hookView) return;
    for (const st of this.views.values()) {
      const eff = byProject[st.project] ?? {};
      st.rail.set(groupBySlot(eff));
    }
  }

  /** Reflect hookStore flashes onto sprite badges + rail lighting + beams. */
  applyHooks(flashes: Record<string, HookFlash>) {
    if (!this.hookView) return;
    if (Object.keys(flashes).length === 0) return;
    const nowSec = performance.now() / 1000;
    for (const st of this.views.values()) {
      const sid = st.orch.sessionId;
      this.maybeTrigger(sid, flashes[sid], (label) => {
        st.orch.triggerHook(label, nowSec);
        this.fireRail(st, flashes[sid], sid, st.orch.x, st.orch.y + st.orch.headOffsetY, nowSec);
      });
      for (const [agentId, emp] of st.employees) {
        this.maybeTrigger(agentId, flashes[agentId], (label) => {
          emp.triggerHook(label, nowSec);
          this.fireRail(st, flashes[agentId], agentId, emp.x, emp.y + emp.headOffsetY, nowSec);
        });
      }
    }
  }

  /** Handle a firing event. Pre launches a pending beam, Post resolves a pending one, others fire a round-trip beam. */
  private fireRail(
    st: RoomView,
    flash: HookFlash | undefined,
    agentKey: string,
    charX: number,
    charY: number,
    nowSec: number
  ) {
    if (!flash) return;
    const slot = eventToSlotIndex(flash.event);
    if (slot < 0) return;

    // PostToolUse: just complete the matching pending (no separate beam).
    // Only when resolved, briefly light the socket to signal "completion received" (orphan Posts are ignored).
    if (flash.event === "PostToolUse") {
      const key = pairKey(flash.correlationId, agentKey, flash.tool);
      if (this.beam.resolvePending(key, flash.isError, nowSec)) {
        st.rail.trigger(slot, "fired", nowSec);
      }
      return;
    }

    const group = st.rail.groupAt(slot);
    const matched = group ? matchingHooks(group, flash.tool) : [];
    if (matched.length === 0) return; // do nothing if no hook is registered
    st.rail.trigger(slot, "fired", nowSec);
    const local = st.rail.socketLocalPos(slot);
    const socketPos = { x: st.rail.x + local.x, y: st.rail.y + local.y };

    if (flash.event === "PreToolUse") {
      const key = pairKey(flash.correlationId, agentKey, flash.tool);
      this.beam.startPending(key, { x: charX, y: charY }, socketPos, nowSec);
    } else {
      this.beam.roundTrip({ x: charX, y: charY }, socketPos, nowSec);
    }
  }

  private ensureCallout(key: string): Callout {
    let c = this.callouts.get(key);
    if (!c) {
      c = new Callout();
      this.calloutLayer.addChild(c);
      this.callouts.set(key, c);
    }
    return c;
  }

  private maybeTrigger(
    key: string,
    flash: HookFlash | undefined,
    fire: (label: string) => void
  ) {
    if (!flash) return;
    if (this.lastFlash.get(key) === flash.firedAt) return;
    this.lastFlash.set(key, flash.firedAt);
    const label = flash.tool
      ? `🪝 ${flash.event} ${flash.tool}`
      : `🪝 ${flash.event}`;
    fire(label);
  }

  /** Per-frame animation driver (t in seconds). */
  update(t: number) {
    const dt = this.lastT === null ? 0 : Math.min(0.1, Math.max(0, t - this.lastT));
    this.lastT = t;

    for (const st of this.views.values()) {
      const wait = this.waitRect(st);
      // Orchestrator: working uses the Orchestrator seat (facing into the room), idle wanders the waiting area.
      const presCell = st.orchestratorWorking ? st.plan.orchestrator : null;
      this.drive(st, ORCHESTRATOR_KEY, st.orch, presCell, st.plan.orchestratorFacing, wait, t, dt);
      // Employees: a fixed seat (with facing) if they have a desk, otherwise wandering the waiting area.
      for (const [key, emp] of st.employees) {
        const slot = st.plan.desks.get(key) ?? null;
        this.drive(st, key, emp, slot?.cell ?? null, slot?.facing ?? null, wait, t, dt);
      }
      st.orch.update(t);
      for (const e of st.employees.values()) e.update(t);
    }

    for (const st of this.views.values()) st.rail.update(t);
    this.beam.update(t);
    this.placeCallouts(dt);
    this.drawDialogTether();
  }

  /** Compute one character's destination (fixed seat or wander), slide-interpolate the current position, and update depth. */
  private drive(
    st: RoomView,
    key: string,
    sprite: OrchestratorSprite | EmployeeSprite,
    seatLocal: Cell | null,
    seatFacing: Orientation | null,
    wait: CellRect,
    t: number,
    dt: number
  ) {
    let gx: number;
    let gy: number;
    let facing: 1 | -1 | null = null;
    let back = false;

    if (seatLocal) {
      const w = this.worldOf(st, seatLocal.col, seatLocal.row);
      gx = w.x;
      gy = w.y;
      // Fine-tune the seating position to match the desk art (screen coords: +x=right / +y=down).
      const isOrchestrator = key === ORCHESTRATOR_KEY;
      if (isOrchestrator && seatFacing === "frontRight") {
        gx += 35; // Orchestrator for orchestrator-desk-front-right
        gy -= 33;
      } else if (!isOrchestrator && seatFacing === "frontRight") {
        gx -= 22; // employee for desk-front-right, a bit more upper-right (and 12 more lower-left)
        gy -= 21;
      } else if (!isOrchestrator && seatFacing === "backLeft") {
        gx += 18; // employee for desk-front-left(backLeft), a bit more straight up (and 12 more lower-left)
        gy += 15;
      }
      // While seated, face the desk (PC) directly (ignore travel direction). The seating fine-tune
      // offset is the deviation from the cell center, so face the opposite direction = toward the desk.
      // This makes both Orchestrator and employees always face the PC regardless of monitor position.
      const offX = gx - w.x;
      const offY = gy - w.y;
      facing = offX > 0 ? -1 : 1;
      back = offY > 0;
      st.wander.delete(key);
    } else {
      let ws = st.wander.get(key);
      if (!ws) ws = makeWander(wait, Math.random);
      ws = stepWander(ws, wait, t, dt, Math.random);
      st.wander.set(key, ws);
      const w = cellToWorld(ws.col, ws.row); // absolute cell
      gx = w.x;
      gy = w.y;
      facing = ws.facing;
      back = ws.back;
    }

    const k = Math.min(1, dt * 6);
    const prevX = sprite.x;
    sprite.x += (gx - sprite.x) * k;
    // body is drawn centered on the origin, so lift it by footLift to stand its feet at the cell center.
    sprite.y += (gy - sprite.footLift - sprite.y) * k;

    if (facing === null) {
      const d = sprite.x - prevX;
      if (d > 0.3) facing = 1;
      else if (d < -0.3) facing = -1;
    }
    if (facing) sprite.setFacing(facing, back);
    // Depth is determined by the grounding (floor) world y. Falls between the chair (-0.5) and desk (+0.5) of the same cell.
    sprite.zIndex = sprite.y + sprite.footLift;
  }

  /** World placement of callouts (overlap avoidance + leader lines). */
  private placeCallouts(dt: number) {
    const keys: string[] = [];
    const anchors: { x: number; y: number }[] = [];
    const boxes: CalloutBox[] = [];
    for (const st of this.views.values()) {
      const oc = this.callouts.get(st.orch.sessionId);
      if (oc && oc.visibleSize) {
        const ax = st.orch.x;
        const ay = st.orch.y + st.orch.headOffsetY;
        const { w, h } = oc.size;
        keys.push(st.orch.sessionId);
        anchors.push({ x: ax, y: ay });
        boxes.push({ anchorX: ax, anchorY: ay, w, h });
      }
      for (const [key, emp] of st.employees) {
        const ec = this.callouts.get(key);
        if (!ec || !ec.visibleSize) continue;
        const ax = emp.x;
        const ay = emp.y + emp.headOffsetY;
        const { w, h } = ec.size;
        keys.push(key);
        anchors.push({ x: ax, y: ay });
        boxes.push({ anchorX: ax, anchorY: ay, w, h });
      }
    }

    const placed = layoutCallouts(boxes);
    const k = Math.min(1, dt * CALLOUT_FOLLOW);
    this.tetherG.clear();
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const c = this.callouts.get(key);
      if (!c) continue;
      const p = placed[i];
      c.applyPosition(p.x, p.y, k);
      // Follow the owner sprite's opacity.
      for (const st of this.views.values()) {
        if (st.orch.sessionId === key) {
          c.alpha = st.orch.alpha;
          break;
        }
        const emp = st.employees.get(key);
        if (emp) {
          c.alpha = emp.alpha;
          break;
        }
      }
      const idealX = boxes[i].anchorX;
      const idealY = boxes[i].anchorY - boxes[i].h / 2;
      const disp = Math.hypot(c.x - idealX, c.y - idealY);
      const tethered = nextTethered(c.isTethered, disp, TETHER_ON, TETHER_OFF);
      c.setTethered(tethered);
      if (tethered) {
        const a = anchors[i];
        const bottomY = c.y + boxes[i].h / 2;
        this.tetherG
          .moveTo(a.x, a.y)
          .lineTo(c.x, bottomY)
          .stroke({ width: 1, color: 0x9aa4b2, alpha: 0.7 });
      }
    }
  }
}
