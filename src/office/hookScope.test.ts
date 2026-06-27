import { describe, it, expect } from "vitest";
import type { ScopedHook } from "../bindings";
import type { EffectiveHooks, HooksMap } from "../ipc/commands";
import { hookScopeLabels, eventOrder, buildEventRows } from "./hookScope";
import { useI18nStore } from "../i18n";

const sh = (over: Partial<ScopedHook> = {}): ScopedHook => ({
  scope: "user",
  matcher: null,
  command: "echo",
  ...over,
});

describe("hookScopeLabels", () => {
  it("has origin labels for 4 scopes in the ja locale", () => {
    useI18nStore.setState({ locale: "ja" });
    const labels = hookScopeLabels();
    expect(labels.user).toBe("ユーザー (~/.claude)");
    expect(labels.project).toBe("プロジェクト (.claude)");
    expect(labels.local).toBe("ローカル (.local)");
    expect(labels.plugin).toBe("プラグイン");
  });
});

describe("eventOrder", () => {
  it("returns lifecycle order with non-standard events (extras) sorted to the end", () => {
    const effective: EffectiveHooks = { Custom: [sh()], PreToolUse: [sh()] };
    const projectHooks: HooksMap = { AAA: [{ matcher: null, hooks: [] }] };
    const order = eventOrder(effective, projectHooks);
    expect(order.slice(0, 9)).toEqual([
      "SessionStart", "UserPromptSubmit", "PreToolUse", "PermissionRequest",
      "PostToolUse", "Notification", "PreCompact", "Stop", "SubagentStop",
    ]);
    expect(order.slice(9)).toEqual(["AAA", "Custom"]); // union, sorted, no duplicates
  });
});

describe("buildEventRows", () => {
  it("routes user-origin hooks to userHooks, project to projectRows, and local to localHooks", () => {
    const effective: EffectiveHooks = {
      PreToolUse: [
        sh({ scope: "user", command: "u1" }),
        sh({ scope: "project", command: "p1" }), // project does not use the effective side
        sh({ scope: "local", command: "l1", matcher: "Edit" }),
      ],
    };
    const projectHooks: HooksMap = {
      PreToolUse: [{ matcher: "Write", hooks: [{ type: "command", command: "p1" }] }],
    };
    const rows = buildEventRows("PreToolUse", effective, projectHooks);
    expect(rows.userHooks.map((h) => h.command)).toEqual(["u1"]);
    expect(rows.localHooks.map((h) => h.command)).toEqual(["l1"]);
    expect(rows.projectRows).toEqual([
      { entryIndex: 0, matcher: "Write", commands: ["p1"] },
    ]);
    expect(rows.empty).toBe(false);
  });

  it("entryIndex is the HookEntry index within projectHooks[event] (used for deletion)", () => {
    const projectHooks: HooksMap = {
      Stop: [
        { matcher: null, hooks: [{ type: "command", command: "a" }] },
        { matcher: null, hooks: [{ type: "command", command: "b" }, { type: "command", command: "c" }] },
      ],
    };
    const rows = buildEventRows("Stop", {}, projectHooks);
    expect(rows.projectRows).toEqual([
      { entryIndex: 0, matcher: null, commands: ["a"] },
      { entryIndex: 1, matcher: null, commands: ["b", "c"] },
    ]);
    expect(rows.count).toBe(3); // a + b + c
  });

  it("when all scopes are empty, empty=true / count=0", () => {
    const rows = buildEventRows("Notification", {}, {});
    expect(rows.empty).toBe(true);
    expect(rows.count).toBe(0);
    expect(rows.userHooks).toEqual([]);
    expect(rows.projectRows).toEqual([]);
    expect(rows.localHooks).toEqual([]);
  });

  it("count is the sum of each command count in user + local plus all command counts in project", () => {
    const effective: EffectiveHooks = {
      Stop: [sh({ scope: "user" }), sh({ scope: "local" })],
    };
    const projectHooks: HooksMap = {
      Stop: [{ matcher: null, hooks: [{ type: "command", command: "x" }, { type: "command", command: "y" }] }],
    };
    const rows = buildEventRows("Stop", effective, projectHooks);
    expect(rows.count).toBe(4); // user1 + local1 + project2
  });
});

describe("buildEventRows plugin scope", () => {
  it("separates plugin-origin into pluginHooks and adds to count", () => {
    const effective: EffectiveHooks = {
      SessionStart: [
        sh({ scope: "user", command: "u" }),
        sh({ scope: "plugin", command: "p", plugin: "superpowers" }),
      ],
    };
    const rows = buildEventRows("SessionStart", effective, {});
    expect(rows.userHooks.map((h) => h.command)).toEqual(["u"]);
    expect(rows.pluginHooks.map((h) => h.command)).toEqual(["p"]);
    expect(rows.pluginHooks[0].plugin).toBe("superpowers");
    expect(rows.count).toBe(2);
    expect(rows.empty).toBe(false);
  });
});
