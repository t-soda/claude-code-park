import { useEffect, useLayoutEffect, useRef } from "react";
import { useHookDetailStore } from "../stores/hookDetailStore";
import { dialogPlacement } from "../stores/openLogStore";
import { hookScopeLabels } from "../office/hookScope";
import { useT } from "../i18n";

/** Dialog width (shared with .log-dialog). */
const DIALOG_W = 320;

export function HookDetailDialog() {
  const { group, anchor, close } = useHookDetailStore();
  const ref = useRef<HTMLDivElement>(null);
  const t = useT();

  useEffect(() => {
    if (!group) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [group, close]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !anchor) return;
    const parent = el.parentElement;
    const vw = parent?.clientWidth ?? window.innerWidth;
    const vh = parent?.clientHeight ?? window.innerHeight;
    const { left, top } = dialogPlacement(anchor, { w: vw, h: vh }, { w: DIALOG_W, h: el.offsetHeight });
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }, [anchor, group]);

  if (!group) return null;

  return (
    <div ref={ref} className="log-dialog" onPointerDown={(e) => e.stopPropagation()}>
      <div className="log-dialog-head">
        <span className="log-dialog-title">
          🪝 {group.event} <span className="hook-order">#{group.index + 1}</span>
        </span>
        <button className="log-dialog-close" onClick={close} aria-label={t("common.close")}>
          ✕
        </button>
      </div>
      <div className="log-dialog-body">
        {group.hooks.length === 0 ? (
          <div className="log-empty">{t("hookDetail.empty")}</div>
        ) : (
          group.hooks.map((h, i) => (
            <div key={`${h.scope}-${h.matcher ?? ""}-${h.command}-${i}`} className="hook-detail-row">
              <span className={`hook-scope hook-scope-${h.scope}`}>
                {h.scope === "plugin" && h.plugin
                  ? `${hookScopeLabels()[h.scope] ?? h.scope} (${h.plugin})`
                  : hookScopeLabels()[h.scope] ?? h.scope}
              </span>
              {h.matcher && (
                <div className="hook-detail-matcher">
                  matcher: <code>{h.matcher}</code>
                </div>
              )}
              <div className="cmd-row">{h.command}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
