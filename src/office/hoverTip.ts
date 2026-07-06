import type { WorldRenderer } from "./engine/WorldRenderer";
import { t as tr } from "../i18n";

/**
 * Shared pointer-hover handler for the office canvas (live and replay). Shows the
 * hook-rail tooltip, and for subagents emphasizes their delegation arcs and shows
 * who called them / whom they called. Hovering the orchestrator or empty space
 * clears the emphasis and hides the tooltip.
 */
export function handleHoverTip(
  renderer: WorldRenderer,
  cx: number,
  cy: number,
  tip: HTMLElement
): void {
  const showTip = (text: string) => {
    tip.textContent = text;
    tip.style.left = `${cx + 12}px`;
    tip.style.top = `${cy + 12}px`;
    tip.style.display = "block";
  };

  const rail = renderer.hitTestRail(cx, cy);
  if (rail) {
    renderer.setDelegationHover(null);
    const g = rail.group;
    const summary =
      g.hooks.length === 0
        ? tr("office.unregistered")
        : g.hooks.map((h) => h.command).join(" / ");
    showTip(`${g.event} #${g.index + 1} — ${summary}`);
    return;
  }

  // Hovering a subagent emphasizes its delegation arcs and lists who called it /
  // whom it called. Orchestrator relations are omitted by design.
  const target = renderer.hitTest(cx, cy);
  const hover =
    target && target.agentId !== null
      ? { sessionId: target.sessionId, agentId: target.agentId }
      : null;
  renderer.setDelegationHover(hover);
  const info = hover ? renderer.delegationInfo(hover.sessionId, hover.agentId) : null;
  if (!info) {
    tip.style.display = "none";
    return;
  }
  const parts: string[] = [];
  if (info.caller) parts.push(tr("office.delegatedBy", { name: info.caller }));
  if (info.callees.length > 0)
    parts.push(tr("office.delegatesTo", { name: info.callees.join(", ") }));
  showTip(parts.join(" · "));
}
