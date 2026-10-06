import { describe, expect, it } from 'vitest'
import { staggerLabels } from './labels'

const at = (center: number, width: number) => ({ center, width })

describe('staggerLabels', () => {
  it('keeps short labels on one line', () => {
    expect(staggerLabels([at(10, 10), at(40, 10), at(70, 10)], 6)).toEqual([0, 0, 0])
  })

  it('alternates long labels above / below', () => {
    expect(staggerLabels([at(20, 60), at(50, 60), at(80, 60), at(110, 60)], 6)).toEqual([0, 1, 0, 1])
  })

  it('goes back up as soon as the upper line is free', () => {
    expect(staggerLabels([at(20, 60), at(50, 20), at(70, 10)], 6)).toEqual([0, 1, 0])
  })

  it('skips items without a label', () => {
    expect(staggerLabels([at(20, 60), null, at(50, 60)], 6)).toEqual([0, -1, 1])
  })
})
