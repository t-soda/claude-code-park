import { useState } from "react";
import type { AgentDef } from "../bindings";
import { useConfigSource } from "../stores/configSource";
import { useT } from "../i18n";

const EMPTY: AgentDef = {
  name: "",
  description: "",
  tools: [],
  model: null,
  color: null,
  body: "",
  file_path: "",
  source: { kind: "user" },
};

/** Form for hiring (creating) or editing an employee. */
export function AgentEditor({
  initial,
  project,
  onClose,
}: {
  initial?: AgentDef;
  project?: string;
  onClose: () => void;
}) {
  const create = !initial;
  const { saveAgent } = useConfigSource(project);
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [tools, setTools] = useState((initial?.tools ?? []).join(", "));
  const [model, setModel] = useState(initial?.model ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const t = useT();

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await saveAgent(
        {
          ...(initial ?? EMPTY),
          name: name.trim(),
          description: description.trim(),
          tools: tools
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
          model: model.trim() || null,
          body,
        },
        create
      );
      onClose();
    } catch (e) {
      setError(String(e));
      setSaving(false);
    }
  };

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <button className="close" onClick={onClose}>
          ✕
        </button>
        <h2>{create ? t("agentEditor.titleHire") : t("agentEditor.titleEdit", { name: initial?.name ?? "" })}</h2>
        <div className="field">
          <label>{t("agentEditor.nameLabel")}</label>
          <input
            value={name}
            disabled={!create}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("agentEditor.namePlaceholder")}
          />
        </div>
        <div className="field">
          <label>{t("agentEditor.descLabel")}</label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t("agentEditor.descPlaceholder")}
          />
        </div>
        <div className="field">
          <label>{t("agentEditor.toolsLabel")}</label>
          <input
            value={tools}
            onChange={(e) => setTools(e.target.value)}
            placeholder="Read, Grep, Edit"
          />
        </div>
        <div className="field">
          <label>{t("agentEditor.modelLabel")}</label>
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            <option value="">inherit</option>
            <option value="opus">opus</option>
            <option value="sonnet">sonnet</option>
            <option value="haiku">haiku</option>
          </select>
        </div>
        <div className="field">
          <label>{t("agentEditor.roleLabel")}</label>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} />
        </div>
        {error && <div className="err">{error}</div>}
        <div className="row-actions">
          <button className="btn" disabled={saving || !name.trim()} onClick={submit}>
            {saving ? t("common.saving") : create ? t("agentEditor.hire") : t("common.save")}
          </button>
          <button className="btn secondary" onClick={onClose}>
            {t("common.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
