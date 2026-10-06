/**
 * Lines for centred labels laid out left to right (preview glyph names): a
 * label goes on the upper line (0) unless it would run into the previous
 * label there, then on the lower one (1); when it fits on neither, on the
 * line whose last label ends first. `null` items get no label (-1).
 */
export function staggerLabels(items: ({ center: number; width: number } | null)[], gap: number): number[] {
  const ends = [-Infinity, -Infinity]
  return items.map((item) => {
    if (!item) return -1
    const start = item.center - item.width / 2
    const line = start >= ends[0] + gap ? 0 : start >= ends[1] + gap ? 1 : ends[0] <= ends[1] ? 0 : 1
    ends[line] = item.center + item.width / 2
    return line
  })
}
