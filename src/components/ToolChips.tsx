/** Shared component that renders a tool list as chips. With limit set, shows only the first N. */
export function ToolChips({ tools, limit }: { tools: string[]; limit?: number }) {
  if (tools.length === 0) return null;
  const shown = limit ? tools.slice(0, limit) : tools;
  return (
    <div className="chips">
      {shown.map((t) => (
        <span className="chip" key={t}>
          {t}
        </span>
      ))}
    </div>
  );
}
