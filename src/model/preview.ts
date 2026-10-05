// Bottom preview: tokens from the worker (vendored dependencies.py) and the
// row layout of the dependency line (wrap_with_context, ported).
import type { SideId } from './font'

export type ChainMode = 'members' | 'all' | 'smart'

export type PreviewSubject = {
  names: string[]
  side: SideId
  key: string | null
  members: string[]
  mode: ChainMode
}

export type PreviewToken = {
  n: string
  /** Control glyph framing a real glyph. */
  ctx?: true
  /** Member of the group being shown. */
  m?: true
  /** Margin on the checked side differs from the key glyph's. */
  x?: true
  /** That margin. */
  g?: number
  /** The control glyph to show around this glyph. */
  c?: string
  /** Left glyph of an editable kerning pair (pairs mode). */
  pl?: true
}

const control = (name: string): PreviewToken => ({ n: name, ctx: true })

/**
 * dependencies.py wrap_with_context: `ctx G ctx` per glyph, identical
 * neighbouring controls shared, a control repeated at the start of a row it
 * was shared across. A row always takes at least one glyph.
 */
export function wrapWithContext(
  glyphs: PreviewToken[],
  advance: (name: string) => number,
  width = Infinity,
): PreviewToken[][] {
  const rows: PreviewToken[][] = []
  let row: PreviewToken[] = []
  let x = 0
  for (const token of glyphs) {
    const c = token.c
    const shared = row.length > 0 && c !== undefined && row[row.length - 1].n === c
    const added: PreviewToken[] = []
    if (c !== undefined && !shared) added.push(control(c))
    added.push(token)
    if (c !== undefined) added.push(control(c))
    const sum = (list: PreviewToken[]) => list.reduce((s, t) => s + advance(t.n), 0)
    if (row.length && x + sum(added) > width) {
      rows.push(row)
      row = []
      x = 0
      if (shared) added.unshift(control(c))
    }
    row.push(...added)
    x += sum(added)
  }
  if (row.length) rows.push(row)
  return rows
}

/** Positions of selectable pairs: [row, index of the pair's left token]. */
export function pairStops(rows: PreviewToken[][]): [number, number][] {
  const out: [number, number][] = []
  rows.forEach((row, r) => row.forEach((t, i) => t.pl && i + 1 < row.length && out.push([r, i])))
  return out
}
