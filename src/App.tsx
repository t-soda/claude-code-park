import { useEffect, useState } from "react";
import { OfficeView } from "./office/OfficeView";
import { ReplayView } from "./replay/ReplayView";
import { useWorldStore } from "./stores/worldStore";
import { useConfigStore } from "./stores/configStore";
import { useScopedConfigStore } from "./stores/scopedConfigStore";
import { useEffectiveHooksStore } from "./stores/effectiveHooksStore";
import { AgentsManager } from "./components/AgentsManager";
import { HooksManager } from "./components/HooksManager";
import { SkillsManager } from "./components/SkillsManager";
import { Settings } from "./components/Settings";
import { MetricsDashboard } from "./components/MetricsDashboard";
import { UpdateBanner } from "./components/UpdateBanner";
import { useUpdateStore } from "./stores/updateStore";
import { useT } from "./i18n";

type Tab = "office" | "replay" | "metrics" | "agents" | "hooks" | "skills" | "settings";

// For labels without an i18n key (nav.*), use the fixed brand name as-is.
const TABS: { id: Tab; label: string }[] = [
  { id: "office", label: "" },
  { id: "replay", label: "Replay" },
  { id: "metrics", label: "Metrics" },
  { id: "agents", label: "Agent" },
  { id: "hooks", label: "Hooks" },
  { id: "skills", label: "Skills" },
  { id: "settings", label: "" },
];

export function App() {
  const t = useT();
  const [tab, setTab] = useState<Tab>("office");
  const start = useWorldStore((s) => s.start);
  const loadConfig = useConfigStore((s) => s.loadAll);
  const watchConfig = useConfigStore((s) => s.watch);
  const watchScoped = useScopedConfigStore((s) => s.watch);
  const watchEffective = useEffectiveHooksStore((s) => s.watch);
  const configError = useConfigStore((s) => s.error);

  useEffect(() => {
    // On startup: begin subscribing and fetch the initial state, load config, and watch the CLI for changes.
    // Metrics are heavy (a full scan of all projects), so we don't fetch them on startup;
    // they are lazy-loaded the first time the Metrics tab is opened (via ensureLoaded in MetricsDashboard).
    start().catch((e) => console.error("Failed to fetch initial state:", e));
    loadConfig();
    watchConfig();
    // Project-scoped config and effective hooks also follow CLI-side changes live (incl. project .claude).
    watchScoped();
    watchEffective();
    // Silently check GitHub Releases for a newer version (shows a banner only if one exists).
    useUpdateStore.getState().checkForUpdate({ silent: true });
  }, [start, loadConfig, watchConfig, watchScoped, watchEffective]);

  return (
    <div className="app">
      <div className="tabbar" data-tauri-drag-region>
        <span className="brand" data-tauri-drag-region>Claude Code Park</span>
        {TABS.map((item) => (
          <button
            key={item.id}
            className={`tab ${tab === item.id ? "active" : ""}`}
            onClick={() => setTab(item.id)}
          >
            {item.id === "office"
              ? t("nav.office")
              : item.id === "settings"
                ? t("nav.settings")
                : item.label}
          </button>
        ))}
      </div>
      <UpdateBanner />
      <div className="content">
        {tab === "office" && <OfficeView />}
        {tab === "replay" && <ReplayView />}
        {tab === "metrics" && <MetricsDashboard />}
        {tab === "agents" && <AgentsManager />}
        {tab === "hooks" && <HooksManager />}
        {tab === "skills" && <SkillsManager />}
        {tab === "settings" && <Settings />}
        {configError && tab !== "office" && (
          <div className="err" style={{ padding: "0 24px" }}>
            {t("app.configError", { error: configError })}
          </div>
        )}
      </div>
    </div>
  );
}
