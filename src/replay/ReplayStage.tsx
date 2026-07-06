import { useEffect, useRef } from "react";
import { Stage } from "../office/engine/Stage";
import { WorldRenderer } from "../office/engine/WorldRenderer";
import { useReplayStore } from "../stores/replayStore";
import { useCharacterStore } from "../stores/characterStore";
import { useUiPrefsStore } from "../stores/uiPrefsStore";
import { useOpenLogStore } from "../stores/openLogStore";
import { useHookDetailStore } from "../stores/hookDetailStore";
import { CharacterLogDialog } from "../components/CharacterLogDialog";
import { HookDetailDialog } from "../components/HookDetailDialog";
import { useI18nStore } from "../i18n";
import { handleHoverTip } from "../office/hoverTip";
import { api, type EffectiveHooks } from "../ipc/commands";
import type { ReplayFrame } from "./replayEngine";
import type { HookFlash } from "../stores/hookStore";

/** Pan/zoom stash across mounts, independent from the live office view's. */
let savedPan = { x: 0, y: 0 };
let savedZoom = 1;

/**
 * The office canvas of the replay player. Mounts its own Pixi Stage + WorldRenderer
 * (never shared with the live OfficeView) and projects replayStore frames/flashes.
 * The Pixi ticker drives both the store's virtual clock and the render loop.
 */
export function ReplayStage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;
    let destroyed = false;
    const stage = new Stage();
    const destroyOnce = () => {
      if (destroyed) return;
      destroyed = true;
      stage.destroy();
    };
    let renderer: WorldRenderer | null = null;
    let effectiveHooksByProject: Record<string, EffectiveHooks> | null = null;
    const unsubs: (() => void)[] = [];

    stage.init(canvas).then(() => {
      if (disposed) {
        destroyOnce();
        return;
      }
      renderer = new WorldRenderer(
        stage.world,
        stage.floor!,
        (w, h) => stage.setContentSize(w, h),
        { showSignIcons: false }
      );
      stage.onThemeChange = () => renderer?.refreshFloor();

      const syncFrame = () => {
        const frame = useReplayStore.getState().frame;
        if (frame) renderer?.sync(frame.sessions);
      };
      syncFrame();
      renderer.setHookView(useUiPrefsStore.getState().hookView);
      renderer.setDelegationView(useUiPrefsStore.getState().delegationView);
      unsubs.push(
        useUiPrefsStore.subscribe((s) => {
          renderer?.setHookView(s.hookView);
          renderer?.setDelegationView(s.delegationView);
          // applyEffectiveHooks no-ops while hookView is off, so flipping it on
          // mid-session must re-apply the already-fetched rails, not just toggle
          // visibility of whatever was (or wasn't) set at fetch time.
          if (s.hookView && effectiveHooksByProject) {
            renderer?.applyEffectiveHooks(effectiveHooksByProject);
          }
        })
      );
      unsubs.push(
        useI18nStore.subscribe(() => {
          syncFrame();
          renderer?.redrawAll();
        })
      );
      stage.setZoom(savedZoom);
      stage.setWorld(savedPan.x, savedPan.y);

      // Project store changes into the renderer. The cursor returns the same frame
      // reference when nothing changed, so reference checks skip redundant syncs.
      let lastFrame: ReplayFrame | null = useReplayStore.getState().frame;
      let lastFlashes: Record<string, HookFlash> = useReplayStore.getState().flashes;
      unsubs.push(
        useReplayStore.subscribe((s) => {
          if (s.frame !== lastFrame) {
            lastFrame = s.frame;
            if (s.frame) renderer?.sync(s.frame.sessions);
          }
          if (s.flashes !== lastFlashes) {
            lastFlashes = s.flashes;
            renderer?.applyHooks(s.flashes);
          }
        })
      );
      unsubs.push(useCharacterStore.subscribe(() => renderer?.redrawAll()));

      // Rails show the project's *current* hook config, fetched once — hook
      // configuration is not recorded in transcripts (noted in the player UI).
      const project = useReplayStore.getState().data?.meta.project;
      if (project) {
        void api
          .getEffectiveHooks(project)
          .then((eff) => {
            if (disposed) return;
            effectiveHooksByProject = { [project]: eff };
            renderer?.applyEffectiveHooks(effectiveHooksByProject);
          })
          .catch(() => {});
      }

      // Character click -> log dialog (reads the real JSONL, works for ended
      // sessions). Rail click -> hook slot detail. No terminal / room menu here.
      renderer.setDialogTether(stage.dialogTetherG);
      stage.onTap = (cx, cy) => {
        const rail = renderer?.hitTestRail(cx, cy) ?? null;
        if (rail) {
          useOpenLogStore.getState().close();
          useHookDetailStore.getState().open(rail.group, { x: cx, y: cy });
          return;
        }
        const target = renderer?.hitTest(cx, cy) ?? null;
        if (target) {
          useHookDetailStore.getState().close();
          useOpenLogStore.getState().open(target, { x: cx, y: cy });
        } else {
          useOpenLogStore.getState().close();
          useHookDetailStore.getState().close();
        }
      };
      stage.onHoverCursor = (cx, cy) =>
        !!(renderer?.hitTestRail(cx, cy) || renderer?.hitTest(cx, cy));
      stage.onHover = (cx, cy) => {
        const tip = tipRef.current;
        if (tip && renderer) handleHoverTip(renderer, cx, cy, tip);
      };

      stage.app.ticker.add(() => {
        useReplayStore.getState().tick(performance.now());
        renderer?.update(performance.now() / 1000);
      });
    });

    return () => {
      disposed = true;
      // Freeze playback while unmounted (the ticker that advances it is gone).
      useReplayStore.getState().pause();
      useOpenLogStore.getState().close();
      useHookDetailStore.getState().close();
      for (const u of unsubs) u();
      if (stage.app.renderer) {
        savedPan = { x: stage.world.x, y: stage.world.y };
        savedZoom = stage.world.scale.x;
      }
      destroyOnce();
    };
  }, []);

  return (
    <div className="office-wrap">
      <canvas ref={canvasRef} className="office-canvas" />
      <div ref={tipRef} className="hook-tip" style={{ display: "none" }} />
      <CharacterLogDialog />
      <HookDetailDialog />
    </div>
  );
}
