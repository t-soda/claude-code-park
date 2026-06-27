import { describe, it, expect } from "vitest";
import type { SkillDef } from "../bindings";
import { skillScopeLabels, resolveEffectiveSkills } from "./skillScope";
import { useI18nStore } from "../i18n";

const sk = (name: string, kind: "user" | "project" | "plugin", plugin?: string): SkillDef => ({
  name,
  description: "",
  disable_model_invocation: false,
  argument_hint: null,
  allowed_tools: [],
  disabled: false,
  body: "",
  dir: `${kind}/${name}`,
  source: (plugin ? { kind: "plugin", plugin } : { kind }) as SkillDef["source"],
});

describe("skillScopeLabels", () => {
  it("has origin labels for 3 scopes in the ja locale", () => {
    useI18nStore.setState({ locale: "ja" });
    const labels = skillScopeLabels();
    expect(labels.user).toBe("ユーザー (~/.claude)");
    expect(labels.project).toBe("プロジェクト (.claude)");
    expect(labels.plugin).toBe("プラグイン");
  });
});

describe("resolveEffectiveSkills", () => {
  it("same name keeps only the User>Project winner (user wins), with project in overriddenScopes", () => {
    const rows = resolveEffectiveSkills([sk("dup", "project"), sk("dup", "user")]);
    expect(rows).toHaveLength(1);
    expect(rows[0].skill.source.kind).toBe("user");
    expect(rows[0].scope).toBe("user");
    expect(rows[0].overriddenScopes).toEqual(["project"]);
  });

  it("plugin (namespaced) stays as a separate entry and does not override", () => {
    const rows = resolveEffectiveSkills([sk("alpha", "user"), sk("sp:review", "plugin", "sp")]);
    expect(rows).toHaveLength(2);
    const plug = rows.find((r) => r.skill.name === "sp:review")!;
    expect(plug.scope).toBe("plugin");
    expect(plug.overriddenScopes).toEqual([]);
  });

  it("project-only / user-only stays the winner", () => {
    const rows = resolveEffectiveSkills([sk("only", "project")]);
    expect(rows).toHaveLength(1);
    expect(rows[0].overriddenScopes).toEqual([]);
  });

  it("display order is user → project → plugin", () => {
    const rows = resolveEffectiveSkills([
      sk("z-plug", "plugin", "p"),
      sk("a-proj", "project"),
      sk("m-user", "user"),
    ]);
    expect(rows.map((r) => r.scope)).toEqual(["user", "project", "plugin"]);
  });
});
