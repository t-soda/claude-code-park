import type { AgentDef } from "../bindings";
import { t } from "../i18n";

/** Scope -> display label (origin). Resolved in the current locale. */
export function agentScopeLabels(): Record<string, string> {
  return {
    user: t("scope.user"),
    project: t("scope.project"),
    plugin: t("scope.plugin"),
  };
}

/** The single winner plus the lower-scope labels it overrode. */
export interface EffectiveAgentRow {
  agent: AgentDef;
  scope: string; // "user" | "project" | "plugin"
  overriddenScopes: string[];
}

/** precedence: project > user > plugin (lower value wins). plugins are namespaced and never collide. */
const RANK: Record<string, number> = { project: 0, user: 1, plugin: 2 };
const rankOf = (scope: string): number => RANK[scope] ?? 9;

/**
 * Resolves the winner among all scoped agents per name using Project>User.
 * plugin agents are namespaced (<plugin>:<agent>) and never collide, so they are always independent entries.
 */
export function resolveEffectiveAgents(agents: AgentDef[]): EffectiveAgentRow[] {
  const byName = new Map<string, AgentDef[]>();
  for (const a of agents) {
    const arr = byName.get(a.name) ?? [];
    arr.push(a);
    byName.set(a.name, arr);
  }
  const rows: EffectiveAgentRow[] = [];
  for (const group of byName.values()) {
    const sorted = [...group].sort((x, y) => rankOf(x.source.kind) - rankOf(y.source.kind));
    const winner = sorted[0];
    const overriddenScopes = sorted.slice(1).map((a) => a.source.kind);
    rows.push({ agent: winner, scope: winner.source.kind, overriddenScopes });
  }
  rows.sort(
    (a, b) => rankOf(a.scope) - rankOf(b.scope) || a.agent.name.localeCompare(b.agent.name)
  );
  return rows;
}
