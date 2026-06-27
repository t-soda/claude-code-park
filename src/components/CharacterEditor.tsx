import { useRef, useState } from "react";
import {
  useCharacterStore,
  GRID_SIZE,
  type Cell,
  type Target,
  type EmployeeVariant,
} from "../stores/characterStore";
import { useT, type MessageKey } from "../i18n";

type Tool = Cell; // 0=eraser, 1=body, 2=eye

// Tool number -> i18n key.
const TOOL_KEY: Record<Tool, MessageKey> = {
  0: "characterEditor.toolErase",
  1: "characterEditor.toolBody",
  2: "characterEditor.toolEye",
};

// Employee variants (employees with no model specified fall back to variantCommon; others use the model name as-is).
const VARIANTS: EmployeeVariant[] = ["employee", "haiku", "sonnet", "opus"];

function hex(n: number): string {
  return `#${n.toString(16).padStart(6, "0")}`;
}

export function CharacterEditor() {
  const tr = useT();
  const [target, setTarget] = useState<Target>("orchestrator");
  // For employees, which variant (common / per-model) to edit.
  const [variant, setVariant] = useState<EmployeeVariant>("employee");
  const [tool, setTool] = useState<Tool>(1);
  const painting = useRef(false);

  // The store key that is actually being edited.
  const editKey = target === "orchestrator" ? "orchestrator" : variant;
  const template = useCharacterStore((s) => s[editKey]);
  const setCell = useCharacterStore((s) => s.setCell);
  const setColor = useCharacterStore((s) => s.setColor);
  const reset = useCharacterStore((s) => s.reset);
  const clear = useCharacterStore((s) => s.clear);

  const isEmployee = target === "employee";
  const cellColor = (v: Cell): string => {
    if (v === 0) return "transparent";
    if (v === 2) return isEmployee ? hex(0x1f2329) : hex(template.eyeColor);
    return isEmployee ? hex(0x7f8aa3) : hex(template.bodyColor);
  };

  const paint = (r: number, c: number) => setCell(editKey, r, c, tool);

  return (
    // Embedded inside a .card in the settings tab, so this is a plain container without .panel.
    <div style={{ paddingTop: 4 }}>
      <div className="toolbar" style={{ gap: 8, marginBottom: 12 }}>
        <span className="label">{tr("characterEditor.target")}</span>
        <button
          className={`tab ${target === "orchestrator" ? "active" : ""}`}
          onClick={() => setTarget("orchestrator")}
        >
          Orchestrator
        </button>
        <button
          className={`tab ${target === "employee" ? "active" : ""}`}
          onClick={() => setTarget("employee")}
        >
          Agent
        </button>
      </div>

      {isEmployee && (
        <div className="toolbar" style={{ gap: 8, marginBottom: 12 }}>
          <span className="label">{tr("characterEditor.model")}</span>
          {VARIANTS.map((v) => (
            <button
              key={v}
              className={`tab ${variant === v ? "active" : ""}`}
              onClick={() => setVariant(v)}
            >
              {v === "employee" ? tr("characterEditor.variantCommon") : v}
            </button>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${GRID_SIZE}, 18px)`,
            gridTemplateRows: `repeat(${GRID_SIZE}, 18px)`,
            border: "1px solid var(--border, #333)",
            userSelect: "none",
            background:
              "repeating-conic-gradient(#2a2e38 0% 25%, #232730 0% 50%) 0 / 18px 18px",
          }}
          onMouseLeave={() => (painting.current = false)}
        >
          {template.grid.map((row, r) =>
            row.map((v, c) => (
              <div
                key={`${r}-${c}`}
                onMouseDown={() => {
                  painting.current = true;
                  paint(r, c);
                }}
                onMouseEnter={() => {
                  if (painting.current) paint(r, c);
                }}
                onMouseUp={() => (painting.current = false)}
                style={{
                  width: 18,
                  height: 18,
                  boxSizing: "border-box",
                  border: "1px solid rgba(255,255,255,0.04)",
                  background: cellColor(v),
                  cursor: "pointer",
                }}
              />
            ))
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <div className="label" style={{ marginBottom: 4 }}>
              {tr("characterEditor.tools")}
            </div>
            <div className="toolbar" style={{ gap: 6 }}>
              {([1, 2, 0] as Tool[]).map((t) => (
                <button
                  key={t}
                  className={`tab ${tool === t ? "active" : ""}`}
                  onClick={() => setTool(t)}
                >
                  {tr(TOOL_KEY[t])}
                </button>
              ))}
            </div>
          </div>

          <div style={{ opacity: isEmployee ? 0.4 : 1 }}>
            <div className="label" style={{ marginBottom: 4 }}>
              {tr("characterEditor.colorHeading")}
              {isEmployee && tr("characterEditor.colorAutoNote")}
            </div>
            <label className="field" style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {tr("characterEditor.bodyColor")}
              <input
                type="color"
                disabled={isEmployee}
                value={hex(template.bodyColor)}
                onChange={(e) =>
                  setColor(editKey, "body", parseInt(e.target.value.slice(1), 16))
                }
              />
            </label>
            <label className="field" style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {tr("characterEditor.eyeColor")}
              <input
                type="color"
                disabled={isEmployee}
                value={hex(template.eyeColor)}
                onChange={(e) =>
                  setColor(editKey, "eye", parseInt(e.target.value.slice(1), 16))
                }
              />
            </label>
          </div>

          <div className="card-actions" style={{ gap: 8 }}>
            <button className="btn secondary" onClick={() => reset(editKey)}>
              {tr("characterEditor.resetDefault")}
            </button>
            <button className="btn danger" onClick={() => clear(editKey)}>
              {tr("characterEditor.clearAll")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
