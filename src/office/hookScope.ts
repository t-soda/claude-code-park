import type { ScopedHook } from "../bindings";
import type { EffectiveHooks, HooksMap } from "../ipc/commands";
import { LIFECYCLE_EVENTS, eventToSlotIndex } from "./hookLifecycle";
import { t } from "../i18n";

/** Scope -> display label (origin directory). Shared with HookDetailDialog. Resolved in the current locale. */
export function hookScopeLabels(): Record<string, string> {
  return {
    user: t("scope.user"),
    project: t("scope.project"),
    local: t("scope.local"),
    plugin: t("scope.plugin"),
  };
}

/** One row in the project section (editable; entryIndex into HooksMap[event] is used for deletion). */
export interface ProjectHookRow {
  entryIndex: number;
  matcher: string | null;
  commands: string[];
}

/** Display row model for one event (user/local are read-only, project is editable). */
export interface EventRows {
  event: string;
  userHooks: ScopedHook[];
  projectRows: ProjectHookRow[];
  localHooks: ScopedHook[];
  pluginHooks: ScopedHook[];
  count: number;
  empty: boolean;
}

/** Ordering of displayed event names: lifecycle order + non-standard events sorted at the end. */
export function eventOrder(effective: EffectiveHooks, projectHooks: HooksMap): string[] {
  const extras = [...new Set([...Object.keys(effective), ...Object.keys(projectHooks)])]
    .filter((ev) => eventToSlotIndex(ev) === -1)
    .sort();
  return [...LIFECYCLE_EVENTS, ...extras];
}

/** Builds the row model for one event. project rows come from the editable HooksMap; user/local/plugin from the effective hooks. */
export function buildEventRows(
  event: string,
  effective: EffectiveHooks,
  projectHooks: HooksMap,
): EventRows {
  const scoped = effective[event] ?? [];
  const userHooks = scoped.filter((h) => h.scope === "user");
  const localHooks = scoped.filter((h) => h.scope === "local");
  const pluginHooks = scoped.filter((h) => h.scope === "plugin");
  const projectRows: ProjectHookRow[] = (projectHooks[event] ?? []).map((entry, entryIndex) => ({
    entryIndex,
    matcher: entry.matcher,
    commands: entry.hooks.map((h) => h.command ?? `[${h.type}]`),
  }));
  const projectCount = projectRows.reduce((n, r) => n + r.commands.length, 0);
  const count = userHooks.length + localHooks.length + pluginHooks.length + projectCount;
  return { event, userHooks, projectRows, localHooks, pluginHooks, count, empty: count === 0 };
}
