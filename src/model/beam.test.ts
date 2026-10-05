import { describe, expect, it } from 'vitest'
import fixture from '../../fixtures/parity/beam.json'
import { crossings, marginsFromCrossings, outlineSegments, slantFactor } from './beam'
import type { GlyphRecord } from './types'

const glyphs = fixture.glyphs as unknown as Record<string, GlyphRecord>

describe('beam crossings parity with Font-Rover', () => {
  for (const c of fixture.cases) {
    it(`${c.glyph} @ ${c.y}`, () => {
      const xs = crossings(outlineSegments(glyphs, c.glyph), c.y)
      expect(xs.length).toBe(c.xs.length)
      // Outlines reach the browser rounded to 0.01 units.
      xs.forEach((x, i) => expect(Math.abs(x - c.xs[i])).toBeLessThan(0.02))
    })
  }
})

describe('beam margins', () => {
  it('measures from the outermost crossings and unskews italics', () => {
    expect(marginsFromCrossings([100, 150, 250, 300], 0, 400, 0)).toEqual([100, 100])
    expect(marginsFromCrossings([110, 210], 100, 300, 0.1)).toEqual([100, 100])
    expect(marginsFromCrossings([5], 0, 100, 0)).toBeNull()
    expect(slantFactor(0)).toBe(0)
    expect(slantFactor(-10)).toBeCloseTo(Math.tan((10 * Math.PI) / 180))
  })
})
