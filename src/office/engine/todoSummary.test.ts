import { describe, it, expect } from "vitest";
import { summarizeTodos } from "./todoSummary";
import type { TodoItem } from "../../bindings";

const t = (content: string, status: string, activeForm: string): TodoItem => ({
  content,
  status,
  active_form: activeForm,
});

describe("summarizeTodos", () => {
  it("returns null for empty list", () => {
    expect(summarizeTodos([])).toBeNull();
  });

  it("counts completed and picks the in_progress activeForm as current", () => {
    const s = summarizeTodos([
      t("a", "completed", "aing"),
      t("b", "in_progress", "bing"),
      t("c", "pending", "cing"),
    ]);
    expect(s).toEqual({ completed: 1, total: 3, current: "bing", allDone: false });
  });

  it("falls back to first pending content when nothing is in_progress", () => {
    const s = summarizeTodos([
      t("a", "completed", "aing"),
      t("b", "pending", "bing"),
    ]);
    expect(s?.current).toBe("b");
  });

  it("marks allDone and null current when all completed", () => {
    const s = summarizeTodos([t("a", "completed", "aing")]);
    expect(s).toEqual({ completed: 1, total: 1, current: null, allDone: true });
  });

  it("truncates a long current label", () => {
    const long = "a".repeat(40);
    const s = summarizeTodos([t(long, "in_progress", long)]);
    expect(s!.current!.length).toBeLessThanOrEqual(25);
    expect(s!.current!.endsWith("…")).toBe(true);
  });
});
