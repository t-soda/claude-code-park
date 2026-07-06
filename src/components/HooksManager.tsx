import { Fragment, useEffect, useState } from "react";
import type { EffectiveHooks, HooksMap } from "../ipc/commands";
import { useConfigSource } from "../stores/configSource";
import { LIFECYCLE_EVENTS } from "../office/hookLifecycle";
import { useEffectiveHooksStore } from "../stores/effectiveHooksStore";
import { hookScopeLabels, eventOrder, buildEventRows } from "../office/hookScope";
import { useT } from "../i18n";

// The dropdown is also ordered by firing timing (flow order).
const EVENTS = LIFECYCLE_EVENTS;

/** Keep only plugin-scoped hooks (dropping empty events). Used to avoid duplicates in the header version. */
function pluginOnly(effective: EffectiveHooks): EffectiveHooks {
  const out: EffectiveHooks = {};
  for (const [event, hooks] of Object.entries(effective)) {
    const plugins = hooks.filter((h) => h.scope === "plugin");
    if (plugins.length > 0) out[event] = plugins;
  }
  return out;
}

// Treat the whole flow as a single gradient (blue -> orange) and return the
// solid color at step position t(0..1). Shared across the number, line, and arrow so it stays continuous.
const FLOW_FROM = [106, 163, 255]; // --accent-2 #6aa3ff
const FLOW_TO = [240, 136, 62]; // --accent  #f0883e
function flowColor(t: number): string {
  const c = FLOW_FROM.map((v, i) => Math.round(v + (FLOW_TO[i] - v) * t));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

export function HooksManager({ project }: { project?: string }) {
  const t = useT();
  const src = useConfigSource(project);
  const hooks = src.hooks;
  const updateHooks = src.updateHooks;
  const eff = useEffectiveHooksStore();

  // The menu version keys effective hooks by project; the header version keys them by "".
  // When project="", the backend returns user + user-scoped plugin hooks (no directory concept).
  const effKey = project ?? "";
  const effRaw = eff.byProject[effKey] ?? {};
  // In the header version the editable rows (projectRows) are the user settings themselves, so the
  // effective user/local rows would be duplicates. Pull in only the plugin scope to show read-only.
  const effective = project ? effRaw : pluginOnly(effRaw);
  // Source scope of the editable rows (projectRows): project for the menu version, user settings for the header version.
  const editScope = project ? "project" : "user";

  // Display order of events (lifecycle order + non-standard events at the end).
  // Computed from both the editable project hooks and the effective hooks keys.
  const events = eventOrder(effective, hooks);

  useEffect(() => {
    // Force a fresh read every time the panel opens so externally edited settings.json /
    // settings.local.json are reflected (the cache would otherwise keep a stale/empty result).
    // Deliberately keyed only on effKey: src.reload/eff.reload are recreated on every render
    // (they wrap store state that reload() itself just updated), so including them here would
    // retrigger the effect on every render and loop forever.
    src.reload();
    eff.reload([effKey]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effKey]);

  const [event, setEvent] = useState<string>(EVENTS[0]);
  const [matcher, setMatcher] = useState("");
  const [command, setCommand] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Delete confirmation modal (implemented in-app because window.confirm is ignored in WKWebView).
  const [pending, setPending] = useState<{ ev: string; idx: number; label: string } | null>(null);

  const clone = (): HooksMap => JSON.parse(JSON.stringify(hooks));

  const add = async () => {
    if (!command.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const next = clone();
      const entry = {
        matcher: matcher.trim() || null,
        hooks: [{ type: "command", command: command.trim() }],
      };
      next[event] = [...(next[event] ?? []), entry];
      await updateHooks(next);
      await eff.refresh();
      setMatcher("");
      setCommand("");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const askRemove = (ev: string, idx: number) => {
    const target = hooks[ev]?.[idx];
    const label = target?.hooks?.[0]?.command ?? t("hooks.fallbackLabel", { event: ev });
    setPending({ ev, idx, label });
  };

  const confirmRemove = async () => {
    if (!pending) return;
    const { ev, idx } = pending;
    setPending(null);
    const next = clone();
    next[ev] = next[ev].filter((_, i) => i !== idx);
    if (next[ev].length === 0) delete next[ev];
    await updateHooks(next);
    await eff.refresh();
  };

  return (
    <div className="panel">
      <h2>Hooks</h2>
      <div className="sub">
        {t("hooks.description")}
        <br />
        {t("hooks.vizHint")}
      </div>

      <div className="card">
        <div className="title">{t("hooks.addTitle")}</div>
        <div className="field">
          <label>{t("hooks.eventLabel")}</label>
          <select value={event} onChange={(e) => setEvent(e.target.value)}>
            {EVENTS.map((ev) => (
              <option key={ev} value={ev}>
                {ev}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>{t("hooks.matcherLabel")}</label>
          <input
            value={matcher}
            onChange={(e) => setMatcher(e.target.value)}
            placeholder={t("hooks.matcherPlaceholder")}
          />
        </div>
        <div className="field">
          <label>{t("hooks.commandLabel")}</label>
          <input
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder={t("hooks.commandPlaceholder")}
          />
        </div>
        {error && <div className="err">{error}</div>}
        <div className="card-actions">
          <button className="btn" disabled={busy || !command.trim()} onClick={add}>
            {t("hooks.addAndSave")}
          </button>
        </div>
      </div>

      <div className="hook-flow">
        {events.map((ev, idx) => {
          const last = events.length - 1;
          const color = flowColor(last > 0 ? idx / last : 0);
          const colorNext = flowColor(last > 0 ? (idx + 1) / last : 0);
          const rows = buildEventRows(ev, effective, hooks);
          const empty = rows.empty;
          return (
            <Fragment key={ev}>
              <div className={`hook-row${empty ? " hook-row-empty" : ""}`}>
                <div className="hook-rail" aria-hidden="true">
                  <span className="hook-step-num" style={{ background: color }}>
                    {idx + 1}
                  </span>
                  {idx < last && (
                    <span className="hook-rail-line" style={{ background: color }} />
                  )}
                </div>
                <div className="card hook-step">
                  <div className="title">
                    <span className="hook-event">{ev}</span>
                    <span className="badge">
                      {empty ? t("hooks.unset") : t("hooks.count", { count: rows.count })}
                    </span>
                  </div>
                  {empty ? (
                    <div className="hook-empty-hint">
                      {t("hooks.emptyTiming")}
                    </div>
                  ) : (
                    <>
                      {rows.userHooks.map((h, i) => (
                        <div key={`u-${i}`} className="hook-detail-row">
                          <span className="hook-scope hook-scope-user">{hookScopeLabels().user}</span>
                          {h.matcher && (
                            <div className="hook-detail-matcher">
                              matcher: <code>{h.matcher}</code>
                            </div>
                          )}
                          <div className="cmd-row">{h.command}</div>
                        </div>
                      ))}
                      {rows.projectRows.map((row) => (
                        <div key={`p-${row.entryIndex}`} className="hook-detail-row">
                          <span className={`hook-scope hook-scope-${editScope}`}>
                            {hookScopeLabels()[editScope]}
                          </span>
                          {row.matcher && (
                            <div className="hook-detail-matcher">
                              matcher: <code>{row.matcher}</code>
                            </div>
                          )}
                          {row.commands.map((cmd, j) => (
                            <div className="cmd-row" key={j}>
                              {cmd}
                            </div>
                          ))}
                          <div className="card-actions">
                            <button
                              className="btn danger"
                              onClick={() => askRemove(ev, row.entryIndex)}
                            >
                              {t("common.delete")}
                            </button>
                          </div>
                        </div>
                      ))}
                      {rows.localHooks.map((h, i) => (
                        <div key={`l-${i}`} className="hook-detail-row">
                          <span className="hook-scope hook-scope-local">{hookScopeLabels().local}</span>
                          {h.matcher && (
                            <div className="hook-detail-matcher">
                              matcher: <code>{h.matcher}</code>
                            </div>
                          )}
                          <div className="cmd-row">{h.command}</div>
                        </div>
                      ))}
                      {rows.pluginHooks.map((h, i) => (
                        <div key={`pl-${i}`} className="hook-detail-row">
                          <span className="hook-scope hook-scope-plugin">
                            {h.plugin ? `${hookScopeLabels().plugin} (${h.plugin})` : hookScopeLabels().plugin}
                          </span>
                          {h.matcher && (
                            <div className="hook-detail-matcher">
                              matcher: <code>{h.matcher}</code>
                            </div>
                          )}
                          <div className="cmd-row">{h.command}</div>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              </div>
              {idx < last && (
                <div className="hook-connector" aria-hidden="true">
                  <span
                    className="hook-connector-line"
                    style={{
                      background: `linear-gradient(to bottom, ${color}, ${colorNext})`,
                    }}
                  />
                  <span
                    className="hook-connector-chevron"
                    style={{
                      borderColor: colorNext,
                      filter: `drop-shadow(0 0 3px ${colorNext})`,
                    }}
                  />
                </div>
              )}
            </Fragment>
          );
        })}
      </div>

      {pending && (
        <div className="confirm-backdrop" onClick={() => setPending(null)}>
          <div className="confirm-box" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-title">{t("hooks.confirmDeleteTitle")}</div>
            <div className="confirm-msg">
              <code>{pending.label}</code>
            </div>
            <div className="confirm-actions">
              <button className="btn secondary" onClick={() => setPending(null)}>
                {t("common.cancel")}
              </button>
              <button className="btn danger" onClick={confirmRemove}>
                {t("common.delete")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
