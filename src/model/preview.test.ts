import { describe, expect, it } from 'vitest'
import { pairStops, wrapWithContext, type PreviewToken } from './preview'

const g = (n: string, c = 'H'): PreviewToken => ({ n, c, m: true })
const names = (rows: PreviewToken[][]) => rows.map((r) => r.map((t) => t.n).join(' '))

describe('wrapWithContext', () => {
  it('shares neighbouring controls on one row', () => {
    expect(names(wrapWithContext([g('A'), g('B'), g('a', 'n')], () => 1))).toEqual(['H A H B H n a n'])
  })
  it('wraps and repeats a shared control at the row start', () => {
    // each glyph is 10 wide; H A H = 30, + B H = 50 > 40
    expect(names(wrapWithContext([g('A'), g('B')], () => 10, 40))).toEqual(['H A H', 'H B H'])
  })
  it('always puts at least one glyph on a row', () => {
    expect(names(wrapWithContext([g('A')], () => 100, 10))).toEqual(['H A H'])
  })
})

describe('pairStops', () => {
  it('lists left glyphs of editable pairs', () => {
    const rows: PreviewToken[][] = [[{ n: 'H', ctx: true }, { n: 'A', pl: true }, { n: 'V' }, { n: 'H', ctx: true }]]
    expect(pairStops(rows)).toEqual([[0, 1]])
  })
})
