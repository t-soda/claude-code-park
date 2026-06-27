import { useEffect, useState } from "react";
import type { AgentDef } from "../bindings";
import { useConfigSource } from "../stores/configSource";
import { useEffectiveAgentsStore } from "../stores/effectiveAgentsStore";
import {
  agentScopeLabels,
  resolveEffectiveAgents,
  type EffectiveAgentRow,
} from "../office/agentScope";
import { useT } from "../i18n";
import { AgentDetail } from "./AgentDetail";
import { AgentEditor } from "./AgentEditor";
import { ToolChips } from "./ToolChips";

type Mode = { kind: "none" } | { kind: "detail" | "edit"; agent: AgentDef } | { kind: "create" };

export function AgentsManager({ project }: { project?: string }) {
  const src = useConfigSource(project);
  const eff = useEffectiveAgentsStore();
  const t = useT();
  const [mode, setMode] = useState<Mode>({ kind: "none" });

  // The menu version keys effective agents by project; the header version keys them by "".
  // When project="", the backend returns user + user-scoped plugin agents (no directory concept).
  const effKey = project ?? "";

  useEffect(() => {
    src.ensure();
    eff.ensure([effKey]);
  }, [src.ensure, eff.ensure, effKey]);

  // Both the menu and header versions show user/project/plugin agents merged (winner resolution happens on the front end).
  const rows: EffectiveAgentRow[] = resolveEffectiveAgents(eff.byProject[effKey] ?? []);

  // When the detail/edit/create view closes, re-fetch effective agents (to reflect edits immediately).
  const close = () => {
    setMode({ kind: "none" });
    eff.refresh();
  };

  return (
    <div className="panel">
      <div className="toolbar">
        <div>
          <h2>Agent（Sub Agents）</h2>
          <div className="sub">
            {t("agents.description")}
          </div>
        </div>
        <button className="btn" onClick={() => setMode({ kind: "create" })}>
          {t("agents.hire")}
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="empty">
          {t("agents.empty")}
        </div>
      ) : (
        rows.map((row) => {
          const a = row.agent;
          const scopeLabel =
            a.source.kind === "plugin"
              ? `${agentScopeLabels().plugin} (${a.source.plugin})`
              : agentScopeLabels()[row.scope] ?? row.scope;
          return (
            <div
              className="card clickable"
              key={a.file_path}
              onClick={() => setMode({ kind: "detail", agent: a })}
            >
              <div className="title">
                👤 {a.name}
                <span className={`scope-tag scope-${row.scope}`}>{scopeLabel}</span>
                {row.overriddenScopes.length > 0 && (
                  <span className="scope-tag override">
                    {t("common.overrides", { scopes: row.overriddenScopes.map((s) => agentScopeLabels()[s] ?? s).join(", ") })}
                  </span>
                )}
              </div>
              <div className="desc">{a.description || "—"}</div>
              <ToolChips tools={a.tools} limit={6} />
            </div>
          );
        })
      )}

      {mode.kind === "detail" && (
        <AgentDetail
          agent={mode.agent}
          project={project}
          onClose={close}
          onEdit={() => setMode({ kind: "edit", agent: mode.agent })}
        />
      )}
      {mode.kind === "edit" && (
        <AgentEditor initial={mode.agent} project={project} onClose={close} />
      )}
      {mode.kind === "create" && <AgentEditor project={project} onClose={close} />}
    </div>
  );
}
