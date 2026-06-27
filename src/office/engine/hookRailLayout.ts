/** Return the x offset of each of count sockets, center-aligned at spacing intervals. */
export function socketOffsets(count: number, spacing: number): number[] {
  const out: number[] = [];
  const start = -((count - 1) * spacing) / 2;
  for (let i = 0; i < count; i++) out.push(start + i * spacing);
  return out;
}
