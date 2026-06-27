import { useUiPrefsStore } from "../stores/uiPrefsStore";
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
            checked={lifecycleView}
            onChange={(e) => setLifecycleView(e.target.checked)}
          />{" "}
          {t("settings.showToolNames")}
        </label>
      </div>

      <div className="card">
        <div className="title">{t("settings.characterEditor")}</div>
        <CharacterEditor />
      </div>
    </div>
  );
}
