// Group membership index and kerning lookup — a drawing-only port of
// ufo-spacing-lib's FontGroupsManager lookups and resolve_kern_pair.
// Mutations never happen here: the worker owns them.
import type { Groups, KerningEntry } from './types'

export type Side = 'L' | 'R'

export const KERN1 = 'public.kern1.'
export const KERN2 = 'public.kern2.'

export const isKerningGroup = (name: string) => name.startsWith('public.kern')
export const isSide1Group = (name: string) => name.includes('kern1')

/** `public.kern1.O` → `O`; other names unchanged. */
export function shortGroupName(name: string): string {
  if (name.startsWith(KERN1) || name.startsWith(KERN2)) return name.slice(KERN1.length)
  return name
}

export const pairKey = (left: string, right: string) => `${left}\u0000${right}`

/** `A.uuid123` → `A` (ufo-spacing-lib cut_unique_suffix). */
export function cutUniqueSuffix(name: string): string {
  const i = name.lastIndexOf('.uuid')
  if (i >= 0 && /^\d+$/.test(name.slice(i + 5))) return name.slice(0, i)
  return name
}

export class GroupIndex {
  /** glyph → kern1 group (side 1, "left"); the first group listing it wins. */
  readonly left = new Map<string, string>()
  /** glyph → kern2 group (side 2, "right"). */
  readonly right = new Map<string, string>()
  /** Glyphs listed in more than one group on a side: glyph → extra groups. */
  readonly conflicts = new Map<string, string[]>()

  constructor(readonly groups: Groups) {
    for (const [name, members] of Object.entries(groups)) {
      if (!members.length || !isKerningGroup(name)) continue
      const map = isSide1Group(name) ? this.left : this.right
      for (const glyph of members) {
        const existing = map.get(glyph)
        if (existing === undefined) map.set(glyph, name)
        else this.conflicts.set(glyph, [...(this.conflicts.get(glyph) ?? []), name])
      }
    }
  }

  /** Group of a glyph on a side, or the glyph name itself when ungrouped. */
  groupFor(glyph: string, side: Side): string {
    return (side === 'L' ? this.left : this.right).get(glyph) ?? glyph
  }
}

export class KerningTable {
  private values = new Map<string, number>()

  constructor(entries: KerningEntry[]) {
    for (const [l, r, v] of entries) this.values.set(pairKey(l, r), v)
  }

  get size(): number {
    return this.values.size
  }

  get(left: string, right: string): number | undefined {
    return this.values.get(pairKey(left, right))
  }

  has(left: string, right: string): boolean {
    return this.values.has(pairKey(left, right))
  }
}

export type KernPairInfo = {
  /** The kerning key that supplies the value (glyph or group names). */
  left: string
  right: string
  value: number | null
  isException: boolean
  leftGroup: string
  rightGroup: string
}

/**
 * Lookup order glyph–glyph → glyph–group → group–glyph → group–group
 * (glyph+group wins over group+glyph, as in the UFO spec).
 */
export function resolveKernPair(
  kerning: KerningTable,
  index: GroupIndex,
  pair: [string, string],
): KernPairInfo {
  const leftName = cutUniqueSuffix(pair[0])
  const rightName = cutUniqueSuffix(pair[1])
  const leftGroup = index.groupFor(leftName, 'L')
  const rightGroup = index.groupFor(rightName, 'R')
  const leftInGroup = isKerningGroup(leftGroup)
  const rightInGroup = isKerningGroup(rightGroup)
  const base = { leftGroup, rightGroup }

  let v = kerning.get(leftName, rightName)
  if (v !== undefined) {
    return { ...base, left: leftName, right: rightName, value: v, isException: leftInGroup || rightInGroup }
  }
  v = kerning.get(leftName, rightGroup)
  if (v !== undefined) {
    return { ...base, left: leftName, right: rightGroup, value: v, isException: leftInGroup }
  }
  v = kerning.get(leftGroup, rightName)
  if (v !== undefined) {
    return { ...base, left: leftGroup, right: rightName, value: v, isException: rightInGroup }
  }
  v = kerning.get(leftGroup, rightGroup)
  if (v !== undefined) {
    return { ...base, left: leftGroup, right: rightGroup, value: v, isException: false }
  }
  return { ...base, left: leftGroup, right: rightGroup, value: null, isException: false }
}
