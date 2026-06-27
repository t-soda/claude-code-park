import { describe, it, expect } from "vitest";
import type { AgentDef } from "../bindings";
import { agentScopeLabels, resolveEffectiveAgents } from "./agentScope";
import { useI18nStore } from "../i18n";

const ag = (name: string, kind: "user" | "project" | "plugin", plugin?: string): AgentDef => ({
  name,
  description: "",
  tools: [],
  model: null,
  color: null,
  body: "",
  file_path: `${kind}/${name}.md`,
  source: (plugin ? { kind: "plugin", plugin } : { kind }) as AgentDef["source"],
});

describe("agentScopeLabels", () => {
  it("has origin labels for 3 scopes in the ja locale", () => {
    useI18nStore.setState({ locale: "ja" });
    const labels = agentScopeLabels();
    expect(labels.user).toBe("ユーザー (~/.claude)");
    expect(labels.project).toBe("プロジェクト (.claude)");
    expect(labels.plugin).toBe("プラグイン");
  });
});

describe("resolveEffectiveAgents", () => {
  it("same name keeps only the Project>User winner, recording the loser in overriddenScopes", () => {
    const rows = resolveEffectiveAgents([ag("dup", "user"), ag("dup", "project")]);
    expect(rows).toHaveLength(1);
    expect(rows[0].agent.source.kind).toBe("project");
    expect(rows[0].scope).toBe("project");
    expect(rows[0].overriddenScopes).toEqual(["user"]);
  });

  it("plugin (namespaced) stays as a separate entry and does not override", () => {
    const rows = resolveEffectiveAgents([ag("alpha", "user"), ag("sp:review", "plugin", "sp")]);
    expect(rows).toHaveLength(2);
    const plug = rows.find((r) => r.agent.name === "sp:review")!;
    expect(plug.scope).toBe("plugin");
    expect(plug.overriddenScopes).toEqual([]);
  });

  it("project-only / user-only stays the winner", () => {
    const rows = resolveEffectiveAgents([ag("only", "user")]);
    expect(rows).toHaveLength(1);
    expect(rows[0].overriddenScopes).toEqual([]);
  });

  it("display order is project → user → plugin", () => {
    const rows = resolveEffectiveAgents([
      ag("z-plug", "plugin", "p"),
      ag("a-user", "user"),
      ag("m-proj", "project"),
    ]);
    expect(rows.map((r) => r.scope)).toEqual(["project", "user", "plugin"]);
  });
});
