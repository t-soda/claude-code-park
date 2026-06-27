import type { TodoItem } from "../../bindings";

export interface TodoSummary {
  completed: number;
  total: number;
  /** Display label for the current task (the in_progress activeForm, or the first pending content otherwise). null when all complete. */
  current: string | null;
  allDone: boolean;
}

const MAX = 24;

function truncate(s: string): string {
  const v = s.trim();
  return v.length <= MAX ? v : v.slice(0, MAX) + "…";
}

/** Summarize a TodoItem array for compact display. null for an empty array. */
export function summarizeTodos(todos: TodoItem[]): TodoSummary | null {
  if (todos.length === 0) return null;
  const total = todos.length;
  const completed = todos.filter((t) => t.status === "completed").length;
  const allDone = completed === total;

  let current: string | null = null;
  if (!allDone) {
    const active = todos.find((t) => t.status === "in_progress");
    const fallback = todos.find((t) => t.status === "pending");
    const label = active?.active_form ?? fallback?.content ?? null;
    current = label ? truncate(label) : null;
  }
  return { completed, total, current, allDone };
}
