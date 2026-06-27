import type { AgentDef, CommandDef, SkillDef, AgentMetrics } from "../bindings";
import type { HooksMap } from "../ipc/commands";
import { useConfigStore } from "./configStore";
import { useScopedConfigStore, type ScopedConfigSlice } from "./scopedConfigStore";
import { useMetricsStore } from "./metricsStore";
import { useScopedMetricsStore } from "./scopedMetricsStore";

export interface ConfigSource {
  agents: AgentDef[];
  hooks: HooksMap;
  skills: SkillDef[];
  commands: CommandDef[];
  loaded: boolean;
  error: string | null;
  ensure: () => void;
  /** Force-refetches this scope's config, bypassing the cache (e.g. when a panel reopens). */
  reload: () => void;
  saveAgent: (agent: AgentDef, create: boolean) => Promise<void>;
  deleteAgent: (name: string) => Promise<void>;
  toggleSkill: (name: string, disable: boolean) => Promise<void>;
  saveSkill: (skill: SkillDef, create: boolean) => Promise<void>;
  updateHooks: (hooks: HooksMap) => Promise<void>;
}

const EMPTY: ScopedConfigSlice = {
  agents: [], hooks: {}, skills: [], commands: [], loaded: false, error: null,
};

type GlobalState = ReturnType<typeof useConfigStore.getState>;
type ScopedState = ReturnType<typeof useScopedConfigStore.getState>;

export function bundleGlobal(s: GlobalState): ConfigSource {
  return {
    agents: s.agents,
    hooks: s.hooks,
    skills: s.skills,
    commands: s.commands,
    loaded: s.loaded,
    error: s.error,
    ensure: () => {},
    reload: () => void s.loadAll(),
    saveAgent: s.saveAgent,
    deleteAgent: s.deleteAgent,
    toggleSkill: s.toggleSkill,
    saveSkill: s.saveSkill,
    updateHooks: s.updateHooks,
  };
}

export function bundleScoped(s: ScopedState, project: string): ConfigSource {
  const slice = s.byProject[project] ?? EMPTY;
  return {
    agents: slice.agents,
    hooks: slice.hooks,
    skills: slice.skills,
    commands: slice.commands,
    loaded: slice.loaded,
    error: slice.error,
    ensure: () => s.ensure(project),
    reload: () => void s.reload(project),
    saveAgent: (agent, create) => s.saveAgent(project, agent, create),
    deleteAgent: (name) => s.deleteAgent(project, name),
    toggleSkill: (name, disable) => s.toggleSkill(project, name, disable),
    saveSkill: (skill, create) => s.saveSkill(project, skill, create),
    updateHooks: (hooks) => s.updateHooks(project, hooks),
  };
}

/** Returns the global config source when project is unspecified, or the project-scoped one when specified. */
export function useConfigSource(project?: string): ConfigSource {
  const global = useConfigStore();
  const scoped = useScopedConfigStore();
  return project ? bundleScoped(scoped, project) : bundleGlobal(global);
}

export interface MetricsSource {
  metrics: AgentMetrics[];
  loading: boolean;
  loaded: boolean;
  error: string | null;
  load: () => void;
  ensureLoaded: () => void;
}

const EMPTY_METRICS = { metrics: [] as AgentMetrics[], loading: false, loaded: false, error: null };

/** Returns the global metrics source when project is unspecified, or the project-scoped one when specified. */
export function useMetricsSource(project?: string): MetricsSource {
  const global = useMetricsStore();
  const scoped = useScopedMetricsStore();
  if (!project) {
    return {
      metrics: global.metrics,
      loading: global.loading,
      loaded: global.loaded,
      error: global.error,
      load: () => void global.load(),
      ensureLoaded: () => void global.ensureLoaded(),
    };
  }
  const slice = scoped.byProject[project] ?? EMPTY_METRICS;
  return {
    metrics: slice.metrics,
    loading: slice.loading,
    loaded: slice.loaded,
    error: slice.error,
    load: () => void scoped.load(project),
    ensureLoaded: () => void scoped.ensureLoaded(project),
  };
}
