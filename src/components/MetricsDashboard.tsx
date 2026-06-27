import { useEffect, useState } from "react";
import { MAIN_KEY } from "../office/constants";
import { useMetricsSource } from "../stores/configSource";
import { useT, type MessageKey, type Params } from "../i18n";

type WinKey = "today" | "7d" | "30d";
const WINDOWS: { key: WinKey; labelKey: MessageKey }[] = [
  { key: "today", labelKey: "metrics.rangeToday" },
  { key: "7d", labelKey: "metrics.range7d" },
  { key: "30d", labelKey: "metrics.range30d" },
];

type T = (key: MessageKey, params?: Params) => string;

const fmtPct = (u: number) => `${Math.round(u * 100)}%`;
const fmtSec = (raw: number | bigint, t: T) => {
  const s = Number(raw);
  if (s < 60) return t("metrics.unitSeconds", { n: s });
  if (s < 3600) return t("metrics.unitMinutes", { n: Math.round(s / 60) });
  return t("metrics.unitHours", { n: (s / 3600).toFixed(1) });
};

export function MetricsDashboard({ project }: { project?: string }) {
  const { metrics, loading, loaded, error, load, ensureLoaded } =
    useMetricsSource(project);
  const t = useT();
  const [win, setWin] = useState<WinKey>("today");

  useEffect(() => {
    // Fetch only on the first mount. Reopening shows the cache immediately and skips the full scan.
    ensureLoaded();
  }, [ensureLoaded]);

  // Sorted by activity share, highest first.
  const rows = [...metrics].sort((a, b) => {
    const sa = a.windows[win]?.share ?? 0;
    const sb = b.windows[win]?.share ?? 0;
    return sb - sa;
  });

  const displayName = (name: string) =>
    name === MAIN_KEY ? t("metrics.orchestratorMain") : name;

  // Show a skeleton during the first load (never fetched successfully yet) instead of blank space.
  // metrics returns MAIN_KEY + all agent rows even with zero activity, so it is never empty; use loaded to decide.
  // From the second time on, loaded=true, so the cache is shown immediately (no skeleton).
  const showSkeleton = loading && !loaded;

  return (
    <div className="panel">
      <div className="toolbar">
        <div>
          <h2>{t("metrics.title")}</h2>
          <div className="sub">{t("metrics.subtitle")}</div>
        </div>
        <button className="btn secondary" onClick={load} disabled={loading}>
          {loading ? t("metrics.aggregating") : t("metrics.refresh")}
        </button>
      </div>

      <div className="window-tabs">
        {WINDOWS.map((w) => (
          <button
            key={w.key}
            className={`tab ${win === w.key ? "active" : ""}`}
            onClick={() => setWin(w.key)}
          >
            {t(w.labelKey)}
          </button>
        ))}
      </div>

      {error && <div className="err">{error}</div>}

      <table className="mtable">
        <thead>
          <tr>
            <th>Agent</th>
            <th>{t("metrics.colShare")}</th>
            <th className="num">{t("metrics.colTime")}</th>
            <th className="num">{t("metrics.colCalls")}</th>
            <th className="num">{t("metrics.colTools")}</th>
            <th className="num">{t("metrics.colFailRate")}</th>
            <th className="num">{t("metrics.colTokensOut")}</th>
          </tr>
        </thead>
        <tbody>
          {showSkeleton &&
            Array.from({ length: 5 }).map((_, i) => (
              <tr key={`skel-${i}`} className="skel-row" aria-hidden="true">
                <td>
                  <span className="skel skel-name" />
                </td>
                <td>
                  <span className="skel skel-bar" />
                </td>
                <td className="num">
                  <span className="skel skel-num" />
                </td>
                <td className="num">
                  <span className="skel skel-num" />
                </td>
                <td className="num">
                  <span className="skel skel-num" />
                </td>
                <td className="num">
                  <span className="skel skel-num" />
                </td>
                <td className="num">
                  <span className="skel skel-num" />
                </td>
              </tr>
            ))}
          {rows.map((m) => {
            const w = m.windows[win];
            if (!w) return null;
            return (
              <tr key={m.agent_name}>
                <td className="agent-name">{displayName(m.agent_name)}</td>
                <td>
                  <div className="util-bar">
                    <span style={{ width: `${Math.round(w.share * 100)}%` }} />
                    <em>{fmtPct(w.share)}</em>
                  </div>
                </td>
                <td className="num">{fmtSec(w.active_seconds, t)}</td>
                <td className="num">{w.invocations}</td>
                <td className="num">{w.tool_calls}</td>
                <td className="num">{fmtPct(w.failure_rate)}</td>
                <td className="num">{Number(w.tokens_out).toLocaleString()}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length === 0 && !loading && (
        <div className="empty">{t("metrics.empty")}</div>
      )}
    </div>
  );
}
