import type { SkillDef } from "../bindings";
import { t } from "../i18n";

/** Scope -> display label (origin). Resolved in the current locale. */
export function skillScopeLabels(): Record<string, string> {
  return {
    user: t("scope.user"),
    project: t("scope.project"),
    plugin: t("scope.plugin"),
  };
}

/** The single winner plus the lower-scope labels it overrode. */
export interface EffectiveSkillRow {
  skill: SkillDef;
  scope: string; // "user" | "project" | "plugin"
  overriddenScopes: string[];
}

/** precedence: user > project > plugin (lower value wins). Opposite of Agent. plugins are namespaced and never collide. */
const RANK: Record<string, number> = { user: 0, project: 1, plugin: 2 };
const rankOf = (scope: string): number => RANK[scope] ?? 9;

/**
 * Resolves the winner among all scoped skills per name using User>Project.
 * plugin skills are namespaced (<plugin>:<skill>) and never collide, so they are always independent entries.
 */
export function resolveEffectiveSkills(skills: SkillDef[]): EffectiveSkillRow[] {
  const byName = new Map<string, SkillDef[]>();
  for (const s of skills) {
    const arr = byName.get(s.name) ?? [];
    arr.push(s);
    byName.set(s.name, arr);
  }
  const rows: EffectiveSkillRow[] = [];
  for (const group of byName.values()) {
    const sorted = [...group].sort((x, y) => rankOf(x.source.kind) - rankOf(y.source.kind));
    const winner = sorted[0];
    const overriddenScopes = sorted.slice(1).map((s) => s.source.kind);
    rows.push({ skill: winner, scope: winner.source.kind, overriddenScopes });
  }
  rows.sort(
    (a, b) => rankOf(a.scope) - rankOf(b.scope) || a.skill.name.localeCompare(b.skill.name)
  );
  return rows;
}
