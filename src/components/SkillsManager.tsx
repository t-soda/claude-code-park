import { useEffect, useState } from "react";
import { useT } from "../i18n";
import { useConfigSource } from "../stores/configSource";
import { useEffectiveSkillsStore } from "../stores/effectiveSkillsStore";
import {
  skillScopeLabels,
  resolveEffectiveSkills,
  type EffectiveSkillRow,
} from "../office/skillScope";
import { SkillEditor } from "./SkillEditor";
import { ToolChips } from "./ToolChips";

export function SkillsManager({ project }: { project?: string }) {
  const src = useConfigSource(project);
  const eff = useEffectiveSkillsStore();
  const t = useT();
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  // The menu version keys effective skills by project; the header version keys them by "".
  // When project="", the backend returns user + user-scoped plugin skills (no directory concept).
  const effKey = project ?? "";

  useEffect(() => {
    src.ensure();
    eff.ensure([effKey]);
  }, [src.ensure, eff.ensure, effKey]);

  // Both the menu and header versions show user/project/plugin skills merged (winner resolution happens on the front end).
  const rows: EffectiveSkillRow[] = resolveEffectiveSkills(eff.byProject[effKey] ?? []);

  // The menu version allows toggling/editing only project-sourced skills; the header version only user-sourced ones.
  const editableScope = project ? "project" : "user";

  const toggle = async (name: string, currentlyDisabled: boolean) => {
    setBusy(name);
    try {
      await src.toggleSkill(name, !currentlyDisabled); // switching to disabled = disable:true
      await eff.refresh();
    } finally {
      setBusy(null);
    }
  };

  const closeEditor = () => {
    setCreating(false);
    eff.refresh();
  };

  return (
    <div className="panel">
      <div className="toolbar">
        <div>
          <h2>Skills</h2>
          <div className="sub">{t("skills.description")}</div>
        </div>
        <button className="btn" onClick={() => setCreating(true)}>
          {t("skills.newSkill")}
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="empty">{t("skills.empty")}</div>
      ) : (
        rows.map((row) => {
          const s = row.skill;
          const editable = s.source.kind === editableScope;
          const scopeLabel =
            s.source.kind === "plugin"
              ? `${skillScopeLabels().plugin} (${s.source.plugin})`
              : skillScopeLabels()[row.scope] ?? row.scope;
          return (
            <div className="card" key={s.dir}>
              <div className="title">
                🛠 {s.name}
                <span className={`badge ${s.disabled ? "off" : "on"}`}>
                  {s.disabled ? t("skills.disabled") : t("skills.enabled")}
                </span>
                <span className={`scope-tag scope-${row.scope}`}>{scopeLabel}</span>
                {row.overriddenScopes.length > 0 && (
                  <span className="scope-tag override">
                    {t("common.overrides", { scopes: row.overriddenScopes.map((sc) => skillScopeLabels()[sc] ?? sc).join(", ") })}
                  </span>
                )}
              </div>
              <div className="desc">{s.description || "—"}</div>
              <ToolChips tools={s.allowed_tools} />
              {editable ? (
                <div className="card-actions">
                  <button
                    className="btn secondary"
                    disabled={busy === s.name}
                    onClick={() => toggle(s.name, s.disabled)}
                  >
                    {s.disabled ? t("skills.enable") : t("skills.disable")}
                  </button>
                </div>
              ) : (
                <div className="sub" style={{ marginTop: 10 }}>
                  {t("common.readOnlyFrom", { scope: scopeLabel })}
                </div>
              )}
            </div>
          );
        })
      )}

      {creating && <SkillEditor project={project} onClose={closeEditor} />}
    </div>
  );
}
