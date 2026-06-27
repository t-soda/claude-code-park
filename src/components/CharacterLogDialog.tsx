import { useEffect, useLayoutEffect, useRef } from "react";
import { useOpenLogStore, isToolRow, dialogPlacement, dialogMaxHeight } from "../stores/openLogStore";
import { useUiPrefsStore } from "../stores/uiPrefsStore";
import type { TimelineEntry } from "../bindings";
import { useT, type MessageKey } from "../i18n";

/** Dialog width (must match .log-dialog in the CSS). */
const DIALOG_W = 420;

function timeLabel(ts: string | null): string {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function CharacterLogDialog() {
  const { target, anchor, timeline, error, setDialogAnchor, close } = useOpenLogStore();
  const lifecycleView = useUiPrefsStore((s) => s.lifecycleView);
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);

  // Close on Esc.
  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [target, close]);

  // Compute placement and attach point after the actual size is known (fixed to the open position, so once is enough).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !anchor) return;
    const parent = el.parentElement;
    const vw = parent?.clientWidth ?? window.innerWidth;
    const vh = parent?.clientHeight ?? window.innerHeight;
    // Apply the max height first, then measure the actual size (so the character-side corner stays on the character even for tall logs).
    el.style.maxHeight = `${dialogMaxHeight(anchor, { w: vw, h: vh })}px`;
    const h = el.offsetHeight;
    const { left, top, attach } = dialogPlacement(anchor, { w: vw, h: vh }, { w: DIALOG_W, h });
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    setDialogAnchor(attach);
    // In addition to opening a different character (anchor/target), also recompute when the
    // dialog height changes once the timeline resolves (to avoid the line being offset because it stayed fixed at the skeleton height).
  }, [anchor, target, timeline, setDialogAnchor]);

  if (!target) return null;

  return (
    <div ref={ref} className="log-dialog" onPointerDown={(e) => e.stopPropagation()}>
      <div className="log-dialog-head">
        <span className="log-dialog-title">{target.title}</span>
        <button className="log-dialog-close" onClick={close} aria-label={t("common.close")}>
          ✕
        </button>
      </div>
      <div className="log-dialog-body">
        {timeline === null ? (
          // Loading skeleton (reuses .skel from the Metrics screen)
          Array.from({ length: 6 }).map((_, i) => (
            <div key={`skel-${i}`} className="log-row" aria-hidden="true">
              <span className="skel skel-name" />
            </div>
          ))
        ) : error ? (
          <div className="err">{t("characterLog.fetchError", { error })}</div>
        ) : timeline.length === 0 ? (
          <div className="log-empty">{t("characterLog.empty")}</div>
        ) : (
          // Show newest first.
          [...timeline].reverse().map((entry, i) => <LogRow key={i} entry={entry} showTool={lifecycleView} />)
        )}
      </div>
    </div>
  );
}

function LogRow({ entry, showTool }: { entry: TimelineEntry; showTool: boolean }) {
  const t = useT();
  return (
    <div className="log-row">
      <span className="log-kind">{t(`activityLog.${entry.kind}` as MessageKey)}</span>
      {entry.detail && <span className="log-detail">{entry.detail}</span>}
      {showTool && isToolRow(entry) && <span className="log-tool">🛠️ {entry.tool_name}</span>}
      <span className="log-time">{timeLabel(entry.ts)}</span>
    </div>
  );
}
