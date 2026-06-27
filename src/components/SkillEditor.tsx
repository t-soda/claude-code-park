import { useState } from "react";
import type { SkillDef } from "../bindings";
import { useConfigSource } from "../stores/configSource";
import { useT } from "../i18n";

const EMPTY: SkillDef = {
  name: "",
  description: "",
  disable_model_invocation: false,
  argument_hint: null,
  allowed_tools: [],
  disabled: false,
  body: "",
  dir: "",
  source: { kind: "user" },
};

/** Form for creating a new skill (also used for editing). */
export function SkillEditor({ project, onClose }: { project?: string; onClose: () => void }) {
  const { saveSkill } = useConfigSource(project);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [allowedTools, setAllowedTools] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const t = useT();

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await saveSkill(
        {
          ...EMPTY,
          name: name.trim(),
          description: description.trim(),
          allowed_tools: allowedTools.split(/[,\s]+/).filter(Boolean),
          body,
        },
        true
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
        <h2>{t("skillEditor.title")}</h2>
        <div className="field">
          <label>{t("skillEditor.nameLabel")}</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("skillEditor.namePlaceholder")} />
        </div>
        <div className="field">
          <label>{t("skillEditor.descLabel")}</label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="field">
          <label>{t("skillEditor.toolsLabel")}</label>
          <input
            value={allowedTools}
            onChange={(e) => setAllowedTools(e.target.value)}
            placeholder="Bash(git:*) Read(*.md)"
          />
        </div>
        <div className="field">
          <label>{t("skillEditor.bodyLabel")}</label>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} />
        </div>
        {error && <div className="err">{error}</div>}
        <div className="row-actions">
          <button className="btn" disabled={saving || !name.trim()} onClick={submit}>
            {saving ? t("common.saving") : t("common.create")}
          </button>
          <button className="btn secondary" onClick={onClose}>
            {t("common.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
