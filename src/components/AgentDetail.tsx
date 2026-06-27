import type { AgentDef } from "../bindings";
import { useConfigSource, useMetricsSource } from "../stores/configSource";
import { agentScopeLabels } from "../office/agentScope";
import { useT } from "../i18n";
import { ToolChips } from "./ToolChips";

/** Detail drawer for an employee (agent definition). Only project-sourced agents can be edited or fired. */
export function AgentDetail({
  agent,
  project,
  onClose,
  onEdit,
}: {
  agent: AgentDef;
  project?: string;
  onClose: () => void;
  onEdit: () => void;
}) {
  const t = useT();
  const { deleteAgent } = useConfigSource(project);
  const { metrics } = useMetricsSource(project);
  const mine = metrics.find((m) => m.agent_name === agent.name)?.windows;
  const today = mine?.today;

  // The menu version (project specified) only allows editing project-sourced agents; the header version (unspecified) only allows editing user-sourced agents.
  const editable = agent.source.kind === (project ? "project" : "user");
  const scopeLabel =
    agent.source.kind === "plugin"
      ? `${agentScopeLabels().plugin} (${agent.source.plugin})`
      : agentScopeLabels()[agent.source.kind] ?? agent.source.kind;

  const fire = async () => {
    if (!confirm(t("agentDetail.confirmFire", { name: agent.name }))) return;
    await deleteAgent(agent.name);
    onClose();
  };

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <button className="close" onClick={onClose}>
          ✕
        </button>
        <h2>
          {agent.color ? "🟢 " : "👤 "}
          {agent.name}
        </h2>
        <div className="kv">
          <span className="k">{t("agentDetail.origin")}</span>
          <span>{scopeLabel}</span>
          <span className="k">{t("agentDetail.description")}</span>
          <span>{agent.description || "—"}</span>
          <span className="k">{t("agentDetail.model")}</span>
          <span>{agent.model ?? "inherit"}</span>
          <span className="k">{t("agentDetail.color")}</span>
          <span>{agent.color ?? "—"}</span>
          <span className="k">{t("agentDetail.file")}</span>
          <span style={{ wordBreak: "break-all" }}>{agent.file_path}</span>
        </div>
        <ToolChips tools={agent.tools} />
        {today && (
          <div className="metrics-inline">
            <div className="metric-box">
              <div className="label">{t("agentDetail.shareToday")}</div>
              <div className="value">{Math.round(today.share * 100)}%</div>
            </div>
            <div className="metric-box">
              <div className="label">{t("agentDetail.callCount")}</div>
              <div className="value">{today.invocations}</div>
            </div>
            <div className="metric-box">
              <div className="label">{t("agentDetail.failRate")}</div>
              <div className="value">{Math.round(today.failure_rate * 100)}%</div>
            </div>
          </div>
        )}
        <h3 style={{ marginTop: 18, fontSize: 14 }}>{t("agentDetail.roleDef")}</h3>
        <div className="body-md">{agent.body || t("agentDetail.noBody")}</div>
        {editable ? (
          <div className="row-actions">
            <button className="btn" onClick={onEdit}>
              {t("common.edit")}
            </button>
            <button className="btn danger" onClick={fire}>
              {t("agentDetail.fire")}
            </button>
          </div>
        ) : (
          <div className="sub" style={{ marginTop: 14 }}>
            {t("common.readOnlyFrom", { scope: scopeLabel })}
          </div>
        )}
      </div>
    </div>
  );
}
