import { create } from "zustand";

export type Cell = 0 | 1 | 2; // 0=empty, 1=body, 2=eye
export type Target = "orchestrator" | "employee";

/** An employee's model. Used to draw distinct pixel-art sprites per model. */
export type ModelKind = "haiku" | "sonnet" | "opus" | "fable";

/** Employee edit variants (shared default plus per-model). */
export type EmployeeVariant = "employee" | ModelKind;

/** Edit target keys for the editor (orchestrator / shared employee / per-model). */
export type EditKey = "orchestrator" | EmployeeVariant;

export interface CharTemplate {
  grid: Cell[][]; // 16×16
  bodyColor: number;
  eyeColor: number;
}

export const GRID_SIZE = 16;
const STORAGE_KEY = "claude-code-park:characters";

/** List of edit target keys iterated for initialization and persistence. */
export const EDIT_KEYS: EditKey[] = [
  "orchestrator",
  "employee",
  "haiku",
  "sonnet",
  "opus",
  "fable",
];

// Stamps a string template into the center of a 16x16 grid.
// '#'=body(1), 'o'=eye(2), anything else=empty(0)
function stamp(rows: string[]): Cell[][] {
  const grid: Cell[][] = Array.from({ length: GRID_SIZE }, () =>
    Array<Cell>(GRID_SIZE).fill(0)
  );
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const r0 = Math.floor((GRID_SIZE - h) / 2);
  const c0 = Math.floor((GRID_SIZE - w) / 2);
  rows.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) {
      const ch = row[c];
      const v: Cell = ch === "#" ? 1 : ch === "o" ? 2 : 0;
      if (v !== 0) grid[r0 + r][c0 + c] = v;
    }
  });
  return grid;
}

const ORCHESTRATOR_ROWS = [
  ".#########.",
  ".##o###o##.",
  ".##o###o##.",
  "###########",
  ".#########.",
  ".#########.",
  "..#.#.#.#..",
  "..#.#.#.#..",
];

const EMPLOYEE_ROWS = [
  ".#####.",
  ".#o#o#.",
  ".#####.",
  ".#####.",
  ".#####.",
  ".#####.",
  ".#.#.#.",
  ".#.#.#.",
];

// Per-model employee sprites. Body size encodes rank (haiku=small < sonnet=standard < opus=large < fable=largest).
// sonnet keeps the standard build of the original employee default (EMPLOYEE_ROWS).
const HAIKU_ROWS = [
  ".###.",
  "#o#o#",
  ".###.",
  ".###.",
  ".#.#.",
];

const SONNET_ROWS = EMPLOYEE_ROWS;

// opus is large with minimal ornamentation (a single small spike on top of the head).
const OPUS_ROWS = [
  "....#....",
  ".#######.",
  ".#######.",
  ".#o###o#.",
  ".#######.",
  ".#######.",
  ".#######.",
  ".#######.",
  ".##.#.##.",
  ".#.....#.",
];

// fable sits above opus: the widest build, topped with a three-point crown.
const FABLE_ROWS = [
  "..#..#..#..",
  ".#########.",
  "###########",
  "##o#####o##",
  "###########",
  "###########",
  "###########",
  "###########",
  "###########",
  ".###.#.###.",
  ".##.....##.",
];

const ROWS_FOR: Record<EditKey, string[]> = {
  orchestrator: ORCHESTRATOR_ROWS,
  employee: EMPLOYEE_ROWS,
  haiku: HAIKU_ROWS,
  sonnet: SONNET_ROWS,
  opus: OPUS_ROWS,
  fable: FABLE_ROWS,
};

type Templates = Record<EditKey, CharTemplate>;

/** Default template for each edit target. Employee variants don't use custom colors (fixed role color plus black eyes). */
export function defaults(): Templates {
  const out = {} as Templates;
  for (const key of EDIT_KEYS) {
    out[key] = {
      grid: stamp(ROWS_FOR[key]),
      bodyColor: 0xcc785c,
      eyeColor: 0x1f2329,
    };
  }
  return out;
}

/**
 * Normalizes an AgentDef.model string into a model kind.
 * Matches both full IDs ("claude-opus-4-8") and aliases ("opus" / "opusplan") by substring.
 * Returns null when unspecified or undeterminable ("inherit", etc.), falling back to the shared default sprite.
 */
export function classifyModel(model: string | null | undefined): ModelKind | null {
  if (!model) return null;
  const m = model.toLowerCase();
  if (m.includes("fable")) return "fable";
  if (m.includes("haiku")) return "haiku";
  if (m.includes("opus")) return "opus";
  if (m.includes("sonnet")) return "sonnet";
  return null;
}

/**
 * Determines the template key for an employee sprite from a runtime model string.
 * Falls back to the shared default sprite "employee" when undeterminable (unspecified / "inherit", etc.).
 */
export function employeeVariant(model: string | null | undefined): EmployeeVariant {
  return classifyModel(model) ?? "employee";
}

function numOr(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

// Normalizes an arbitrary value into a 16x16 Cell grid. Returns null if the shape differs.
function normalizeGrid(g: unknown): Cell[][] | null {
  if (!Array.isArray(g) || g.length !== GRID_SIZE) return null;
  const out: Cell[][] = [];
  for (const row of g) {
    if (!Array.isArray(row) || row.length !== GRID_SIZE) return null;
    out.push(row.map((v) => (v === 1 || v === 2 ? (v as Cell) : 0)));
  }
  return out;
}

function loadTemplate(raw: unknown, fallback: CharTemplate): CharTemplate {
  const obj = raw as Record<string, unknown> | null | undefined;
  return {
    grid: normalizeGrid(obj?.grid) ?? fallback.grid,
    bodyColor: numOr(obj?.bodyColor, fallback.bodyColor),
    eyeColor: numOr(obj?.eyeColor, fallback.eyeColor),
  };
}

function load(): Templates {
  const d = defaults();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return d;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out = {} as Templates;
    for (const key of EDIT_KEYS) out[key] = loadTemplate(parsed?.[key], d[key]);
    return out;
  } catch {
    return d;
  }
}

function persist(state: Templates): void {
  try {
    const obj: Record<string, CharTemplate> = {};
    for (const key of EDIT_KEYS) obj[key] = state[key];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
  } catch {
    // Silently ignore if storage is unavailable (cosmetic, not critical).
  }
}

interface CharacterState extends Templates {
  setCell: (target: EditKey, row: number, col: number, value: Cell) => void;
  setColor: (target: EditKey, kind: "body" | "eye", color: number) => void;
  reset: (target: EditKey) => void;
  clear: (target: EditKey) => void;
}

export const useCharacterStore = create<CharacterState>((set, get) => ({
  ...load(),

  setCell(target, row, col, value) {
    if (row < 0 || row >= GRID_SIZE || col < 0 || col >= GRID_SIZE) return;
    const cur = get()[target];
    if (cur.grid[row][col] === value) return;
    const grid = cur.grid.map((r, ri) =>
      ri === row ? r.map((c, ci) => (ci === col ? value : c)) : r
    );
    set({ [target]: { ...cur, grid } } as Pick<CharacterState, EditKey>);
    persist(get());
  },

  setColor(target, kind, color) {
    const cur = get()[target];
    const next =
      kind === "body" ? { ...cur, bodyColor: color } : { ...cur, eyeColor: color };
    set({ [target]: next } as Pick<CharacterState, EditKey>);
    persist(get());
  },

  reset(target) {
    const d = defaults();
    set({ [target]: d[target] } as Pick<CharacterState, EditKey>);
    persist(get());
  },

  clear(target) {
    const cur = get()[target];
    const grid: Cell[][] = Array.from({ length: GRID_SIZE }, () =>
      Array<Cell>(GRID_SIZE).fill(0)
    );
    set({ [target]: { ...cur, grid } } as Pick<CharacterState, EditKey>);
    persist(get());
  },
}));
