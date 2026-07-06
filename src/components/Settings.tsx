import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { useUiPrefsStore } from "../stores/uiPrefsStore";
import { useUpdateStore } from "../stores/updateStore";
import { CharacterEditor } from "./CharacterEditor";
import { useT, useI18nStore, LOCALES, LOCALE_LABELS, isLocale } from "../i18n";

/**
 * Settings tab. Collects display toggles, the UI language, and the character editor (all in localStorage).
 */
export function Settings() {
  const t = useT();
  const lifecycleView = useUiPrefsStore((s) => s.lifecycleView);
  const setLifecycleView = useUiPrefsStore((s) => s.setLifecycleView);
  const hookView = useUiPrefsStore((s) => s.hookView);
  const setHookView = useUiPrefsStore((s) => s.setHookView);
  const trayEnabled = useUiPrefsStore((s) => s.trayEnabled);
  const setTrayEnabled = useUiPrefsStore((s) => s.setTrayEnabled);
  const delegationView = useUiPrefsStore((s) => s.delegationView);
  const setDelegationView = useUiPrefsStore((s) => s.setDelegationView);
  const locale = useI18nStore((s) => s.locale);
  const setLocale = useI18nStore((s) => s.setLocale);

  return (
    <div className="panel">
      <h2>{t("settings.title")}</h2>
      <div className="sub">{t("settings.subtitle")}</div>

      <div className="card">
        <div className="title">{t("settings.languageSection")}</div>
        <label style={{ display: "block", marginTop: 8 }}>
          {t("settings.languageLabel")}{" "}
          <select
            value={locale}
            onChange={(e) => {
              if (isLocale(e.target.value)) setLocale(e.target.value);
            }}
          >
            {LOCALES.map((l) => (
              <option key={l} value={l}>
                {LOCALE_LABELS[l]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="card">
        <div className="title">{t("settings.displaySection")}</div>
        <label style={{ display: "block", marginTop: 8 }}>
          <input
            type="checkbox"
            checked={hookView}
            onChange={(e) => setHookView(e.target.checked)}
          />{" "}
          {t("settings.showHookViz")}
        </label>
        <label style={{ display: "block", marginTop: 8 }}>
          <input
            type="checkbox"
            checked={delegationView}
            onChange={(e) => setDelegationView(e.target.checked)}
          />{" "}
          {t("settings.showDelegationLines")}
        </label>
        <label style={{ display: "block", marginTop: 8 }}>
          <input
            type="checkbox"
            checked={lifecycleView}
            onChange={(e) => setLifecycleView(e.target.checked)}
          />{" "}
          {t("settings.showToolNames")}
        </label>
        <label style={{ display: "block", marginTop: 8 }}>
          <input
            type="checkbox"
            checked={trayEnabled}
            onChange={(e) => setTrayEnabled(e.target.checked)}
          />{" "}
          {t("settings.showTrayIcon")}
        </label>
      </div>

      <div className="card">
        <div className="title">{t("settings.characterEditor")}</div>
        <CharacterEditor />
      </div>

      <UpdateCard />
    </div>
  );
}

/** "Updates" card: shows the running version and drives the in-app updater. */
function UpdateCard() {
  const t = useT();
  const status = useUpdateStore((s) => s.status);
  const version = useUpdateStore((s) => s.version);
  const progress = useUpdateStore((s) => s.progress);
  const error = useUpdateStore((s) => s.error);
  const checkForUpdate = useUpdateStore((s) => s.checkForUpdate);
  const installAndRelaunch = useUpdateStore((s) => s.installAndRelaunch);
  const [appVersion, setAppVersion] = useState<string | null>(null);

  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => {});
  }, []);

  return (
    <div className="card">
      <div className="title">{t("update.section")}</div>
      <div className="sub" style={{ marginTop: 8 }}>
        {t("update.currentVersion", { version: appVersion ?? "…" })}
      </div>
      <div className="row-actions" style={{ marginTop: 8 }}>
        {status === "available" ? (
          <button className="btn" onClick={installAndRelaunch}>
            {t("update.updateNow")}
          </button>
        ) : (
          <button
            className="btn secondary"
            disabled={status === "checking" || status === "downloading" || status === "installed"}
            onClick={() => checkForUpdate()}
          >
            {status === "checking" ? t("update.checking") : t("update.checkNow")}
          </button>
        )}
        <span className="sub">
          {status === "upToDate" && t("update.upToDate")}
          {status === "available" && t("update.available", { version: version ?? "?" })}
          {status === "downloading" &&
            (progress != null
              ? t("update.downloadingPct", { percent: progress })
              : t("update.downloading"))}
          {status === "installed" && t("update.restarting")}
          {status === "error" && (
            <span className="err">{t("update.checkError", { error: error ?? "" })}</span>
          )}
        </span>
      </div>
    </div>
  );
}
