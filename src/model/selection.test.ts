import { describe, expect, it } from 'vitest'
import { FontModel } from './font'
import * as Sel from './selection'
import type { FontData } from './types'

const glyph = { u: [], w: 500, l: 0, r: 0, p: [] }
const data: FontData = {
  info: { unitsPerEm: 1000, ascender: null, descender: null, capHeight: null, xHeight: null, italicAngle: 0 },
  order: ['A', 'Aacute', 'B', 'O', 'V', 'W'],
  glyphs: { A: glyph, Aacute: glyph, B: glyph, O: glyph, V: glyph, W: glyph },
  groups: { 'public.kern1.A': ['A', 'Aacute'], 'public.kern2.V': ['V', 'W'] },
  kerning: [
    ['public.kern1.A', 'public.kern2.V', -80],
    ['Aacute', 'public.kern2.V', -60],
    ['B', 'V', -10],
    ['O', 'public.kern2.V', -20],
    ['O', 'W', -5],
  ],
  lang: [],
}
const font = new FontModel(data)
const names = data.order
const groupOf = (n: string) => font.groupOf(n, 'kern1')
const plain = { shiftKey: false, metaKey: false, ctrlKey: false }
const ctrl = { ...plain, ctrlKey: true }
const shift = { ...plain, shiftKey: true }
const A = 'public.kern1.A'

/** A group with a selected member and a selected pair. */
const busy = (): Sel.Selection =>
  Sel.selectPairs(Sel.clickContent(Sel.selectGroup(A), ['A', 'Aacute'], 1, plain), new Set(['Aacute\u0000public.kern2.V']))

describe('selection actions', () => {
  it('a free font glyph keeps the group as context only', () => {
    const s = Sel.clickFont(busy(), names, 2, plain, groupOf)
    expect(s).toMatchObject({ focus: 'font', list: 'font', group: A, fontAnchor: 'B' })
    expect([...s.font]).toEqual(['B'])
    expect(s.content.size).toBe(0)
    expect(s.pairs.size).toBe(0)
  })

  it('a plain click on a grouped glyph opens its group', () => {
    const start = Sel.clickFont(Sel.initialSelection(null), names, 2, plain, groupOf)
    const s = Sel.clickFont(start, names, 1, plain, groupOf)
    expect(s).toMatchObject({ focus: 'groups', list: 'groups', group: A, contentAnchor: 'Aacute' })
    expect(s.font.size).toBe(0)
    expect([...s.content]).toEqual(['Aacute'])
  })

  it('Ctrl adds a grouped glyph to the font selection', () => {
    const s = Sel.clickFont(Sel.clickFont(Sel.selectGroup(null), names, 2, plain, groupOf), names, 0, ctrl, groupOf)
    expect([...s.font].sort()).toEqual(['A', 'B'])
    expect(s.group).toBeNull()
  })

  it('a group clears the font selection and its anchor', () => {
    const s = Sel.selectGroup(A)
    expect(s.font.size).toBe(0)
    expect(s.fontAnchor).toBeNull()
    expect(s.focus).toBe('groups')
  })

  it('a member click takes the focus back from the font and the pairs', () => {
    const fromFont = Sel.clickFont(Sel.selectGroup(A), names, 2, plain, groupOf)
    const s = Sel.clickContent(fromFont, ['A', 'Aacute'], 0, plain)
    expect(s).toMatchObject({ focus: 'groups', list: 'groups' })
    expect(s.font.size).toBe(0)
    expect(Sel.clickContent(busy(), ['A', 'Aacute'], 0, plain).pairs.size).toBe(0)
  })

  it('pairs take the focus and keep the subject that feeds them', () => {
    const fromFont = Sel.clickFont(Sel.selectGroup(A), names, 2, plain, groupOf)
    const s = Sel.selectPairs(fromFont, new Set(['B\u0000V']))
    expect(s).toMatchObject({ focus: 'pairs', list: 'font', group: A })
    expect([...s.font]).toEqual(['B'])
  })

  it('Shift extends from an anchor name, ignored when it is gone', () => {
    const s = Sel.clickFont(Sel.clickFont(Sel.selectGroup(null), names, 2, plain, groupOf), names, 4, shift, groupOf)
    expect([...s.font]).toEqual(['B', 'O', 'V'])
    const filtered = ['O', 'V', 'W']
    expect([...Sel.clickFont(s, filtered, 2, shift, groupOf).font]).toEqual(['W'])
  })

  it('a member anchor does not carry over to another group', () => {
    const s = Sel.selectGroup('public.kern1.other')
    expect(s.contentAnchor).toBeNull()
    expect([...Sel.clickContent(s, ['x', 'y', 'z'], 2, shift).content]).toEqual(['z'])
  })

  it('added glyphs leave the font selection', () => {
    const start = Sel.clickFont(Sel.clickFont(Sel.selectGroup(A), names, 2, plain, groupOf), names, 3, ctrl, groupOf)
    const open = Sel.glyphsAdded(start, A, ['B', 'O'])
    expect(open).toMatchObject({ focus: 'groups', list: 'groups' })
    expect(open.font.size).toBe(0)
    expect([...open.content]).toEqual(['B', 'O'])

    const other = Sel.glyphsAdded(start, 'public.kern1.X', ['B'])
    expect([...other.font]).toEqual(['O'])
    expect(other.focus).toBe('font')
    expect(Sel.glyphsAdded(other, 'public.kern1.X', ['O'])).toMatchObject({ focus: 'groups', list: 'groups' })
  })

  it('prune drops hidden glyphs, a deleted group and departed members', () => {
    const s = Sel.clickFont(Sel.clickFont(Sel.selectGroup(A), names, 2, plain, groupOf), names, 3, ctrl, groupOf)
    expect(Sel.prune(s, new Set(names), data.groups)).toBe(s)
    const hidden = Sel.prune(s, new Set(['O']), data.groups)
    expect([...hidden.font]).toEqual(['O'])
    expect(hidden.fontAnchor).toBe('O')
    expect(Sel.prune(s, new Set(), data.groups).list).toBe('groups')

    const member = Sel.clickContent(Sel.selectGroup(A), ['A', 'Aacute'], 1, plain)
    expect(Sel.prune(member, new Set(names), { [A]: ['A'] }).content.size).toBe(0)
    expect(Sel.prune(member, new Set(names), {}).group).toBeNull()
  })
})

describe('what the selection shows', () => {
  const many = Sel.clickFont(Sel.clickFont(Sel.selectGroup(A), names, 3, plain, groupOf), names, 2, ctrl, groupOf)

  it('lists the pairs of every selected glyph', () => {
    expect(Sel.pairEntries(font, many, 'kern1', names).map((e) => e[0])).toEqual(['B', 'O', 'O'])
    expect(Sel.pairsTitle(many, 'kern1', names)).toBe('B, O')
  })

  it('falls back to the group when no font glyph is selected', () => {
    const empty = Sel.clickFont(Sel.clickFont(Sel.selectGroup(A), names, 2, plain, groupOf), names, 2, ctrl, groupOf)
    expect(empty.font.size).toBe(0)
    expect(Sel.pairEntries(font, empty, 'kern1', names)).toHaveLength(2)
  })

  it('lines up several font glyphs against the first in grid order', () => {
    const line = Sel.previewLine(font, many, 'kern1', names)
    expect(line?.subject).toMatchObject({ names: ['B', 'O'], key: 'B', members: ['B', 'O'] })
    expect(line?.title).toBe('B, O')
  })

  it('lines up selected members against the key glyph', () => {
    const one = Sel.clickContent(Sel.selectGroup(A), ['A', 'Aacute'], 1, plain)
    expect(Sel.previewLine(font, one, 'kern1', names)).toMatchObject({ title: 'Aacute', subject: { names: ['Aacute'], key: 'A' } })
    const both = Sel.clickContent(one, ['A', 'Aacute'], 0, ctrl)
    expect(Sel.previewLine(font, both, 'kern1', names)?.subject).toMatchObject({ names: ['A', 'Aacute'], key: 'A' })
    expect(Sel.previewLine(font, Sel.selectGroup(A), 'kern1', names)?.title).toBe('@ A')
  })

  it('a single grouped font glyph is compared with its key glyph', () => {
    const s = Sel.clickFont(Sel.selectGroup(null), names, 1, ctrl, groupOf)
    expect(Sel.previewLine(font, s, 'kern1', names)?.subject).toMatchObject({ names: ['Aacute'], key: 'A' })
  })
})
