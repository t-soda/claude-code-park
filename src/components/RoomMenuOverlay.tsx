import { useLayoutEffect, useRef } from "react";
import { useRoomMenuStore, type RoomMenuItem } from "../stores/roomMenuStore";
import { dialogPlacement } from "../stores/openLogStore";
import { MetricsDashboard } from "./MetricsDashboard";
import { HooksManager } from "./HooksManager";
import { AgentsManager } from "./AgentsManager";
import { SkillsManager } from "./SkillsManager";
import { useT } from "../i18n";

const ITEMS: { id: RoomMenuItem; label: string }[] = [
  { id: "metrics", label: "Metrics" },
  { id: "hooks", label: "Hooks" },
  { id: "agents", label: "Agent" },
  { id: "skills", label: "Skills" },
];

const MENU_W = 160;

function ScopedPanel({ item, project }: { item: RoomMenuItem; project: string }) {
  switch (item) {
    case "metrics":
      return <MetricsDashboard project={project} />;
    case "hooks":
      return <HooksManager project={project} />;
    case "agents":
      return <AgentsManager project={project} />;
    case "skills":
      return <SkillsManager project={project} />;
  }
}

/** Shortened project name for display (the trailing directory name). */
function shortName(project: string): string {
  const parts = project.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? project;
}

const ITEM_LABEL: Record<RoomMenuItem, string> = {
  metrics: "Metrics",
  hooks: "Hooks",
  agents: "Agent",
  skills: "Skills",
};

export function RoomMenuOverlay() {
  const { project, anchor, selected, select, back, close } = useRoomMenuStore();
  const menuRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const t = useT();

  // Menu placement:
  // - With no item selected (just opened), show it near the sign (anchor).
  // - With an item selected, follow the top-left of the panel (Metrics window, etc.) so it
  //   always sits adjacent regardless of screen size (making it easy to switch items).
  useLayoutEffect(() => {
    const place = () => {
      const el = menuRef.current;
      const parent = el?.parentElement;
      if (!el || !parent) return;

      if (selected && panelRef.current) {
        // Anchored to the panel's top-left, placed just to its left and top-aligned (clamped to the left edge if it doesn't fit).
        const p = panelRef.current.getBoundingClientRect();
        const w = parent.getBoundingClientRect();
        const panelLeft = p.left - w.left;
        const panelTop = p.top - w.top;
        const gap = 8;
        const left = Math.max(8, panelLeft - gap - el.offsetWidth);
        el.style.left = `${left}px`;
        el.style.top = `${Math.max(8, panelTop)}px`;
        return;
      }

      if (!anchor) return;
      const { left, top } = dialogPlacement(
        anchor,
        { w: parent.clientWidth, h: parent.clientHeight },
        { w: MENU_W, h: el.offsetHeight }
      );
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
    };

    place();
    // While an item is selected the panel is centered, so make the menu follow on resize.
    if (selected) {
      window.addEventListener("resize", place);
      return () => window.removeEventListener("resize", place);
    }
  }, [anchor, project, selected]);

  if (!project) return null;

  return (
    <>
      {/* Floating panel that overlays the selected item next to the menu. */}
      {selected && (
        <div ref={panelRef} className="room-panel" onPointerDown={(e) => e.stopPropagation()}>
          <div className="room-panel-head">
            <button className="btn secondary" onClick={back}>
              {t("roomMenu.backToMenu")}
            </button>
            <span className="room-panel-scope">
              📁 {shortName(project)} ／ {ITEM_LABEL[selected]}
            </span>
            <button className="log-dialog-close" onClick={close} aria-label={t("common.close")}>
              ✕
            </button>
          </div>
          <div className="room-panel-body">
            <ScopedPanel item={selected} project={project} />
          </div>
        </div>
      )}

      {/* Small menu (always shown while open; does not close when an item is selected). */}
      <div
        ref={menuRef}
        className="room-menu"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="room-menu-head">📁 {shortName(project)}</div>
        {ITEMS.map((it) => (
          <button
            key={it.id}
            className={`room-menu-item${selected === it.id ? " active" : ""}`}
            onClick={() => select(it.id)}
          >
            {it.label}
          </button>
        ))}
      </div>
    </>
  );
}
