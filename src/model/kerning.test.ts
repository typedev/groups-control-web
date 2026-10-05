import { describe, expect, it } from 'vitest'
import fixture from '../../fixtures/parity/resolve_kern_pair.json'
import { cutUniqueSuffix, GroupIndex, KerningTable, resolveKernPair, shortGroupName } from './kerning'
import type { KerningEntry } from './types'

describe('resolveKernPair parity with ufo-spacing-lib', () => {
  const index = new GroupIndex(fixture.groups)
  const kerning = new KerningTable(fixture.kerning as KerningEntry[])
  for (const c of fixture.cases) {
    it(`${c.pair[0]} / ${c.pair[1]}`, () => {
      const { pair, ...expected } = c
      expect(resolveKernPair(kerning, index, pair as [string, string])).toEqual(expected)
    })
  }
})

describe('helpers', () => {
  it('cuts only numeric uuid suffixes', () => {
    expect(cutUniqueSuffix('A.uuid42')).toBe('A')
    expect(cutUniqueSuffix('A.uuidx')).toBe('A.uuidx')
    expect(cutUniqueSuffix('A.ss01')).toBe('A.ss01')
  })
  it('shortens kerning group names', () => {
    expect(shortGroupName('public.kern1.O')).toBe('O')
    expect(shortGroupName('public.kern2.@MMK_R_A')).toBe('@MMK_R_A')
    expect(shortGroupName('other')).toBe('other')
  })
  it('records glyphs listed in two groups on one side', () => {
    const index = new GroupIndex(fixture.groups)
    expect(index.groupFor('W', 'R')).toBe('public.kern2.V')
    expect(index.conflicts.get('W')).toEqual(['public.kern2.dup'])
  })
})
