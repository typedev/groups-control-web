import { describe, expect, it } from 'vitest'
import { FontModel } from './font'
import { buildPairRows, sortPairRows } from './pairs'
import type { FontData } from './types'

const glyph = { u: [], w: 500, l: 0, r: 0, p: [] }
const data: FontData = {
  info: { unitsPerEm: 1000, ascender: null, descender: null, capHeight: null, xHeight: null, italicAngle: 0 },
  order: ['A', 'Aacute', 'a', 'b', 'V'],
  glyphs: { A: glyph, Aacute: glyph, a: glyph, b: glyph, V: glyph },
  groups: { 'public.kern1.A': ['A', 'Aacute'], 'public.kern1.a': ['a'], 'public.kern2.V': ['V'] },
  kerning: [
    ['b', 'V', 5],
    ['Aacute', 'public.kern2.V', -60],
    ['public.kern1.a', 'public.kern2.V', 0],
    ['public.kern1.A', 'public.kern2.V', -80],
  ],
  lang: [['b', 'V', 1, 'No language the font supports uses both sides']],
}

describe('pair rows', () => {
  const font = new FontModel(data)
  const rows = buildPairRows(font, data.kerning)

  it('sorts groups first (A before a), exceptions after their group, glyphs last', () => {
    const sorted = sortPairRows(rows, { column: 'left', descending: false })
    expect(sorted.map((r) => r.left)).toEqual(['public.kern1.A', 'Aacute', 'public.kern1.a', 'b'])
  })

  it('marks exceptions and lang problems', () => {
    const byLeft = Object.fromEntries(rows.map((r) => [r.left, r]))
    expect(byLeft['Aacute'].exception).toBe(1)
    expect(byLeft['public.kern1.A'].exception).toBe(0)
    expect(byLeft['b'].lang?.status).toBe(1)
    expect(byLeft['public.kern1.A'].leftIsGroup).toBe(true)
  })

  it('sorts by value', () => {
    expect(sortPairRows(rows, { column: 'value', descending: false }).map((r) => r.value)).toEqual([-80, -60, 0, 5])
    expect(sortPairRows(rows, { column: 'value', descending: true })[0].value).toBe(5)
  })
})
