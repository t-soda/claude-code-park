import { useEffect, useRef } from "react";
import { useWorldStore } from "../stores/worldStore";
import { useHookStore } from "../stores/hookStore";
import { useEffectiveHooksStore, uniqueProjects } from "../stores/effectiveHooksStore";
import { useConfigStore } from "../stores/configStore";
import { Stage } from "./engine/Stage";
import { WorldRenderer } from "./engine/WorldRenderer";
import { handleHoverTip } from "./hoverTip";
import { useCharacterStore } from "../stores/characterStore";
import { useOpenLogStore } from "../stores/openLogStore";
import { CharacterLogDialog } from "../components/CharacterLogDialog";
import { useHookDetailStore } from "../stores/hookDetailStore";
import { HookDetailDialog } from "../components/HookDetailDialog";
import { RoomMenuOverlay } from "../components/RoomMenuOverlay";
import { useUiPrefsStore } from "../stores/uiPrefsStore";
import { useRoomMenuStore } from "../stores/roomMenuStore";
import { useT, useI18nStore, t as tr } from "../i18n";
import { Toast } from "../components/Toast";
import { useToastStore } from "../stores/toastStore";
import { api } from "../ipc/commands";

/**
 * Switching tabs unmounts OfficeView and disposes Pixi, so we stash the pan
 * position outside the view and restore it when returning to the office (UI state retention).
 */
let savedPan = { x: 0, y: 0 };
let savedZoom = 1;

/**
 * Top-down office view. Mounts the Pixi Application onto the canvas and
 * projects worldStore's session list into sprites via WorldRenderer.
 */
export function OfficeView() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const sessions = useWorldStore((s) => s.sessions);
  const loaded = useWorldStore((s) => s.loaded);
  const t = useT();

  const active = sessions.filter((s) => s.status !== "Ended");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;
    const stage = new Stage();
    let renderer: WorldRenderer | null = null;
    let unsub: (() => void) | null = null;
    let unsubChar: (() => void) | null = null;
    let unsubHooks: (() => void) | null = null;
    let unsubEff: (() => void) | null = null;
    let unsubEffSessions: (() => void) | null = null;
    let unsubEffConfig: (() => void) | null = null;
    let unsubHookView: (() => void) | null = null;
    let unsubLocale: (() => void) | null = null;

    stage.init(canvas).then(() => {
      if (disposed) {
        stage.destroy();
        return;
      }
      renderer = new WorldRenderer(
        stage.world,
        stage.floor!,
        (w, h) => stage.setContentSize(w, h)
      );
      // When the time-of-day theme changes, redraw the floor with the current room layout.
      stage.onThemeChange = () => renderer?.refreshFloor();
      renderer.sync(useWorldStore.getState().sessions);
      renderer.setHookView(useUiPrefsStore.getState().hookView);
      renderer.setDelegationView(useUiPrefsStore.getState().delegationView);
      unsubHookView = useUiPrefsStore.subscribe((s) => {
        renderer?.setHookView(s.hookView);
        renderer?.setDelegationView(s.delegationView);
      });
      // On language change, re-project the town labels (status bubbles, name tags, TODOs, etc.) to reflect it.
      unsubLocale = useI18nStore.subscribe(() => {
        renderer?.sync(useWorldStore.getState().sessions);
        renderer?.redrawAll();
      });
      // Restore the zoom before the pan position (so clamping accounts for the zoom).
      stage.setZoom(savedZoom);
      // After the content size is settled, restore the stashed pan position (clamping also works correctly).
      stage.setWorld(savedPan.x, savedPan.y);
      unsub = useWorldStore.subscribe((s) => renderer?.sync(s.sessions));
      unsubChar = useCharacterStore.subscribe(() => renderer?.redrawAll());
      void useHookStore.getState().start();
      unsubHooks = useHookStore.subscribe((s) =>
        renderer?.applyHooks(s.flashes)
      );
      // Reflect the effective hooks (user+project+local) into the rooms.
      const pushEff = () => {
        const eff = useEffectiveHooksStore.getState().byProject;
        renderer?.applyEffectiveHooks(eff);
      };
      const ensureEff = async () => {
        await useEffectiveHooksStore
          .getState()
          .ensure(uniqueProjects(useWorldStore.getState().sessions));
        pushEff();
      };
      void ensureEff();
      unsubEff = useEffectiveHooksStore.subscribe(pushEff);
      unsubEffSessions = useWorldStore.subscribe(() => void ensureEff());
      // Re-fetch when the user/project settings change on the CLI side.
      unsubEffConfig = useConfigStore.subscribe(() =>
        void useEffectiveHooksStore.getState().refresh()
      );
      // Character click -> log dialog. Background (empty space) click -> close.
      renderer.setDialogTether(stage.dialogTetherG);
      stage.onTap = (cx, cy) => {
        // Sign terminal icon hit test (highest priority).
        const term = renderer?.hitTestSignTerminal(cx, cy) ?? null;
        if (term) {
          void api.focusTerminal(term.sessionId, term.project).catch(() => {
            useToastStore.getState().show(tr("terminal.notFound"));
          });
          return;
        }
        // Sign menu icon hit test.
        const menu = renderer?.hitTestSignMenu(cx, cy) ?? null;
        if (menu) {
          useOpenLogStore.getState().close();
          useHookDetailStore.getState().close();
          useRoomMenuStore.getState().open(menu.project, { x: cx, y: cy });
          return;
        }
        const rail = renderer?.hitTestRail(cx, cy) ?? null;
        if (rail) {
          useOpenLogStore.getState().close();
          useHookDetailStore.getState().open(rail.group, { x: cx, y: cy });
          return;
        }
        const t = renderer?.hitTest(cx, cy) ?? null;
        if (t) {
          useHookDetailStore.getState().close();
          useOpenLogStore.getState().open(t, { x: cx, y: cy });
        } else {
          useOpenLogStore.getState().close();
          useHookDetailStore.getState().close();
          useRoomMenuStore.getState().close();
        }
      };
      // Pointer cursor when hovering anything clickable (mirrors onTap's hit-test targets).
      stage.onHoverCursor = (cx, cy) =>
        !!(
          renderer?.hitTestSignTerminal(cx, cy) ||
          renderer?.hitTestSignMenu(cx, cy) ||
          renderer?.hitTestRail(cx, cy) ||
          renderer?.hitTest(cx, cy)
        );
      stage.onHover = (cx, cy) => {
        const tip = tipRef.current;
        if (tip && renderer) handleHoverTip(renderer, cx, cy, tip);
      };
      stage.app.ticker.add(() => renderer?.update(performance.now() / 1000));
    });

    return () => {
      disposed = true;
      useOpenLogStore.getState().close();
      useHookDetailStore.getState().close();
      useRoomMenuStore.getState().close();
      unsub?.();
      unsubChar?.();
      unsubHooks?.();
      unsubEff?.();
      unsubEffSessions?.();
      unsubEffConfig?.();
      unsubHookView?.();
      unsubLocale?.();
      // Stash the current pan position before disposal (only when init has completed).
      if (stage.app.renderer) {
        savedPan = { x: stage.world.x, y: stage.world.y };
        savedZoom = stage.world.scale.x;
      }
      stage.destroy();
    };
  }, []);

  return (
    <div className="office-wrap">
      <canvas ref={canvasRef} className="office-canvas" />
      <div ref={tipRef} className="hook-tip" style={{ display: "none" }} />
      <CharacterLogDialog />
      <HookDetailDialog />
      <RoomMenuOverlay />
      <Toast />
      {loaded && active.length === 0 && (
        <div className="office-empty">
          {t("office.quietTitle")}
          <br />
          <span>{t("office.quietBody")}</span>
        </div>
      )}
    </div>
  );
}
