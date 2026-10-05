import { describe, expect, it } from 'vitest'
import { displayGroupName, FontModel, sameMargin, searchMatcher, sortByUnicode, visibleInFontGrid } from './font'
import { pyRound } from './pyround'
import type { FontData, GlyphRecord } from './types'

const g = (u: number[], l: number | null, r: number | null): GlyphRecord => ({ u, w: 500, l, r, p: [] })

const data: FontData = {
  info: { unitsPerEm: 1000, ascender: 750, descender: -250, capHeight: 700, xHeight: 500, italicAngle: 0 },
  order: ['A', 'Aacute', 'B', 'O', 'Q', 'V', 'space', 'A.alt'],
  glyphs: {
    A: g([65], 10, 10),
    Aacute: g([193], 10, 10.5),
    B: g([66], 60, 30),
    O: g([79], 40, 40),
    Q: g([81], 40, 52),
    V: g([86], 5, 5),
    space: g([32], null, null),
    'A.alt': g([], 12, 12),
  },
  groups: {
    'public.kern1.A': ['A', 'Aacute'],
    'public.kern1.O': ['O', 'Q'],
    'public.kern1.empty': [],
    'public.kern1.ghost': ['O', 'Missing'],
    'public.kern2.V': ['V'],
    other: ['B'],
  },
  kerning: [
    ['public.kern1.A', 'public.kern2.V', -80],
    ['Aacute', 'public.kern2.V', -60],
    ['B', 'V', -10],
    ['public.kern1.O', 'public.kern2.V', -20],
    ['Q', 'V', -25],
  ],
  lang: [['B', 'V', 3, 'Different scripts: Latn | Cyrl']],
}

describe('pyRound', () => {
  it('rounds halves to even like Python', () => {
    expect([0.5, 1.5, 2.5, -0.5, -1.5, -2.5, 2.4, 2.6, -2.6].map(pyRound)).toEqual([0, 2, 2, 0, -2, -2, 2, 3, -3])
  })
})

describe('FontModel', () => {
  const font = new FontModel(data)

  it('validates groups like GroupValidation', () => {
    expect(font.validate('public.kern1.A', 'kern1')).toEqual({ empty: false, missing: [], marginMismatch: false, keyMargin: 10 })
    expect(font.validate('public.kern1.O', 'kern1').marginMismatch).toBe(true)
    expect(font.validate('public.kern1.empty', 'kern1').empty).toBe(true)
    expect(font.validate('public.kern1.ghost', 'kern1').missing).toEqual(['Missing'])
    expect(font.validate('public.kern2.V', 'kern2').keyMargin).toBe(5)
  })

  it('builds side sets', () => {
    const s1 = font.side('kern1')
    expect(s1.groups).toEqual(['public.kern1.A', 'public.kern1.O', 'public.kern1.empty', 'public.kern1.ghost'])
    expect([...s1.grouped].sort()).toEqual(['A', 'Aacute', 'Missing', 'O', 'Q'])
    expect([...s1.kerned].sort()).toEqual(['Aacute', 'B', 'Q'])
    expect([...font.side('kern2').kerned]).toEqual(['V'])
  })

  it('lists pairs of a group with member exceptions', () => {
    expect(font.pairsOfGroup('public.kern1.O', 'kern1')).toEqual([
      ['public.kern1.O', 'public.kern2.V', -20],
      ['Q', 'V', -25],
    ])
    expect(font.pairsOfGroup('public.kern2.V', 'kern2')).toHaveLength(5)
  })

  it('classifies exceptions on the stored key', () => {
    expect(font.exceptionType('public.kern1.A', 'public.kern2.V').type).toBe(0)
    expect(font.exceptionType('Aacute', 'public.kern2.V')).toEqual({ type: 1, leftParent: 'public.kern1.A', rightParent: 'public.kern2.V' })
    expect(font.exceptionType('Q', 'V').type).toBe(3)
    expect(font.exceptionType('B', 'V').type).toBe(2)
  })

  it('finds the group of a glyph on a side', () => {
    expect(font.groupOf('Q', 'kern1')).toBe('public.kern1.O')
    expect(font.groupOf('B', 'kern1')).toBeNull()
    expect(font.langOf('B', 'V')?.status).toBe(3)
    expect(font.langOf('Q', 'V')).toBeNull()
  })
})

describe('helpers', () => {
  it('compares margins with None handling', () => {
    expect(sameMargin(10, 10.4)).toBe(true)
    expect(sameMargin(10, 10.5)).toBe(true) // round(10.5) == 10
    expect(sameMargin(11, 11.5)).toBe(false) // round(11.5) == 12
    expect(sameMargin(null, null)).toBe(true)
    expect(sameMargin(null, 0)).toBe(false)
  })

  it('strips the side prefix for display', () => {
    expect(displayGroupName('public.kern1.O', 'kern1')).toBe('O')
  })

  it('searches names and code points', () => {
    const glyphs = data.glyphs
    const byName = searchMatcher('name', 'A*, O')!
    expect(data.order.filter((n) => byName(n, glyphs[n]))).toEqual(['A', 'Aacute', 'O', 'A.alt'])
    expect(data.order.filter((n) => searchMatcher('name', '*cute')!(n, glyphs[n]))).toEqual(['Aacute'])
    expect(data.order.filter((n) => searchMatcher('name', 'a')!(n, glyphs[n]))).toEqual([])
    expect(data.order.filter((n) => searchMatcher('unicode', 'U+0041 0x4f')!(n, glyphs[n]))).toEqual(['A', 'O'])
    expect(data.order.filter((n) => searchMatcher('unicode', '00C*')!(n, glyphs[n]))).toEqual(['Aacute'])
    expect(searchMatcher('name', '  ')).toBeNull()
  })

  it('sorts by unicode with pseudo code points', () => {
    expect(sortByUnicode(data.order, data.glyphs)).toEqual(['space', 'A', 'A.alt', 'B', 'O', 'Q', 'V', 'Aacute'])
  })

  it('applies font grid visibility', () => {
    const side = new FontModel(data).side('kern1')
    expect(visibleInFontGrid('A', side, 'all', true)).toBe(false)
    expect(visibleInFontGrid('A', side, 'all', false)).toBe(true)
    expect(visibleInFontGrid('A', side, 'kerned', false)).toBe(false)
    expect(visibleInFontGrid('B', side, 'kerned', true)).toBe(true)
    expect(visibleInFontGrid('V', side, 'not_kerned', true)).toBe(true)
  })
})
