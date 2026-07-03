import { useUpdateStore } from "../stores/updateStore";
import { useT } from "../i18n";

/**
 * Slim banner under the tab bar offering an in-app update when a newer
 * GitHub Release exists. "Later" hides it; the offer stays available in Settings.
 */
export function UpdateBanner() {
  const t = useT();
  const status = useUpdateStore((s) => s.status);
  const version = useUpdateStore((s) => s.version);
  const progress = useUpdateStore((s) => s.progress);
  const dismissed = useUpdateStore((s) => s.dismissed);
  const installAndRelaunch = useUpdateStore((s) => s.installAndRelaunch);
  const dismiss = useUpdateStore((s) => s.dismiss);

  if (dismissed) return null;

  if (status === "available") {
    return (
      <div className="update-banner">
        <span>{t("update.available", { version: version ?? "?" })}</span>
        <button className="btn" onClick={installAndRelaunch}>
          {t("update.updateNow")}
        </button>
        <button className="btn secondary" onClick={dismiss}>
          {t("update.later")}
        </button>
      </div>
    );
  }
  if (status === "downloading") {
    return (
      <div className="update-banner">
        <span>
          {progress != null
            ? t("update.downloadingPct", { percent: progress })
            : t("update.downloading")}
        </span>
      </div>
    );
  }
  if (status === "installed") {
    return (
      <div className="update-banner">
        <span>{t("update.restarting")}</span>
      </div>
    );
  }
  return null;
}
