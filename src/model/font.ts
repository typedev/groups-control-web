// Read model of the open font: what the UI draws, derived once from the
// worker's payload. Desktop behaviour references are Font-Rover paths.
import { GroupIndex, isKerningGroup, KerningTable, KERN1, KERN2, pairKey, resolveKernPair } from './kerning'
import { OutlineCache } from './outlines'
import { pyRound } from './pyround'
import type { Delta, FontData, GlyphRecord, KerningEntry, LangEntry, LangStatus } from './types'

export type SideId = 'kern1' | 'kern2'
export const prefixOf = (side: SideId) => (side === 'kern1' ? KERN1 : KERN2)

/** 0 none, 1 left glyph is an exception, 2 right, 3 both (orphan pair). */
export type ExceptionType = 0 | 1 | 2 | 3

export type GroupValidation = {
  empty: boolean
  missing: string[]
  marginMismatch: boolean
  /** Margin of the key glyph on the group's side (null: no outline / missing). */
  keyMargin: number | null
}

/** groups_grid/_model.py display name: every occurrence of the prefix removed. */
export const displayGroupName = (name: string, side: SideId) => name.split(prefixOf(side)).join('')

/** utils/margin_edit.py same_margin: None equals only None, else round(a) == round(b). */
export function sameMargin(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b
  return pyRound(a) === pyRound(b)
}

export class FontModel {
  readonly index: GroupIndex
  readonly kerning: KerningTable
  readonly outlines: OutlineCache
  readonly glyphSet: Set<string>
  private lang = new Map<string, { status: LangStatus; note: string }>()
  private byLeft = new Map<string, number[]>()
  private byRight = new Map<string, number[]>()
  private sideCache = new Map<SideId, SideData>()
  private validation = new Map<string, GroupValidation>()

  constructor(readonly data: FontData, outlines?: OutlineCache) {
    this.index = new GroupIndex(data.groups)
    this.kerning = new KerningTable(data.kerning)
    this.outlines = outlines ?? new OutlineCache(data.glyphs)
    this.glyphSet = new Set(data.order)
    data.kerning.forEach(([l, r], i) => {
      push(this.byLeft, l, i)
      push(this.byRight, r, i)
    })
    for (const [l, r, status, note] of data.lang) this.lang.set(pairKey(l, r), { status, note })
  }

  get info() {
    return this.data.info
  }

  /**
   * A new model with a worker delta applied. Dict order follows Python's:
   * changed keys keep their place, new keys go to the end. Outlines are shared.
   */
  withDelta(delta: Delta): FontModel {
    const groups = { ...this.data.groups }
    for (const name of delta.groups.removed) delete groups[name]
    Object.assign(groups, delta.groups.changed)

    const removed = new Set(delta.kerning.removed.map(([l, r]) => pairKey(l, r)))
    const changed = new Map(delta.kerning.changed.map((e) => [pairKey(e[0], e[1]), e]))
    const kerning: KerningEntry[] = []
    for (const entry of this.data.kerning) {
      const key = pairKey(entry[0], entry[1])
      if (removed.has(key)) continue
      const update = changed.get(key)
      kerning.push(update ?? entry)
      changed.delete(key)
    }
    kerning.push(...changed.values())

    const lang = new Map(this.data.lang.map((e) => [pairKey(e[0], e[1]), e]))
    for (const [l, r] of delta.lang.clear) lang.delete(pairKey(l, r))
    for (const e of delta.lang.set) lang.set(pairKey(e[0], e[1]), e)
    const langList: LangEntry[] = [...lang.values()]

    return new FontModel({ ...this.data, groups, kerning, lang: langList }, this.outlines)
  }

  glyph(name: string): GlyphRecord | undefined {
    return this.data.glyphs[name]
  }

  /** Right margin for side 1 (kern1), left margin for side 2. */
  sideMargin(name: string, side: SideId): number | null {
    const g = this.data.glyphs[name]
    if (!g) return null
    return side === 'kern1' ? g.r : g.l
  }

  side(side: SideId): SideData {
    let data = this.sideCache.get(side)
    if (!data) {
      data = buildSide(this.data, side)
      this.sideCache.set(side, data)
    }
    return data
  }

  /** groups_grid/_model.py GroupValidation (beam off). */
  validate(group: string, side: SideId): GroupValidation {
    const hit = this.validation.get(group)
    if (hit) return hit
    const names = this.data.groups[group] ?? []
    const result: GroupValidation = { empty: names.length === 0, missing: [], marginMismatch: false, keyMargin: null }
    if (!result.empty) {
      const key = names[0]
      if (!this.glyphSet.has(key)) result.missing.push(key)
      else result.keyMargin = this.sideMargin(key, side)
      const keyPresent = this.glyphSet.has(key)
      for (const name of names.slice(1)) {
        if (!this.glyphSet.has(name)) {
          result.missing.push(name)
          continue
        }
        if (keyPresent && result.keyMargin !== null && !sameMargin(this.sideMargin(name, side), result.keyMargin)) {
          result.marginMismatch = true
        }
      }
    }
    this.validation.set(group, result)
    return result
  }

  /**
   * groups_control/window.py _update_pairs_list: kerning keys with the given
   * names on the side (side 1 = left key, side 2 = right key), deduplicated.
   */
  pairsWithKeys(names: Iterable<string>, side: SideId): KerningEntry[] {
    const map = side === 'kern1' ? this.byLeft : this.byRight
    const seen = new Set<number>()
    for (const name of names) for (const i of map.get(name) ?? []) seen.add(i)
    return [...seen].sort((a, b) => a - b).map((i) => this.data.kerning[i])
  }

  pairsOfGroup(group: string, side: SideId): KerningEntry[] {
    return this.pairsWithKeys([group, ...(this.data.groups[group] ?? [])], side)
  }

  /** kern_pairs_list/utils.py detect_exception_type, on the stored key. */
  exceptionType(left: string, right: string): { type: ExceptionType; leftParent: string; rightParent: string } {
    const info = resolveKernPair(this.kerning, this.index, [left, right])
    const leftParent = info.leftGroup
    const rightParent = info.rightGroup
    if (!info.isException) return { type: 0, leftParent, rightParent }
    const ld = left !== leftParent
    const rd = right !== rightParent
    const type: ExceptionType = ld && rd ? 3 : ld ? 1 : rd ? 2 : 0
    return { type, leftParent, rightParent }
  }

  langOf(left: string, right: string) {
    return this.lang.get(pairKey(left, right)) ?? null
  }

  /** The current side's group of a glyph (first group listing it), or null. */
  groupOf(glyph: string, side: SideId): string | null {
    const group = this.index.groupFor(glyph, side === 'kern1' ? 'L' : 'R')
    return isKerningGroup(group) && group !== glyph ? group : null
  }
}

export type SideData = {
  /** Kerning groups of this side, sorted by full name (codepoint order). */
  groups: string[]
  /** All members of this side's groups (also names missing from the font). */
  grouped: Set<string>
  /** Glyphs that are a key on this side as themselves (not via a group). */
  kerned: Set<string>
}

function buildSide(data: FontData, side: SideId): SideData {
  const prefix = prefixOf(side)
  const groups = Object.keys(data.groups)
    .filter((n) => n.startsWith(prefix))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  const grouped = new Set<string>()
  for (const g of groups) for (const m of data.groups[g]) grouped.add(m)
  const kerned = new Set<string>()
  const at = side === 'kern1' ? 0 : 1
  for (const entry of data.kerning) {
    const key = entry[at]
    if (!(key in data.groups)) kerned.add(key)
  }
  return { groups, grouped, kerned }
}

function push(map: Map<string, number[]>, key: string, value: number) {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}

// -- font grid filters (glyph_filter/engine.py, groups_control/font_marks.py) --

export type KernFilter = 'all' | 'kerned' | 'not_kerned'
export type SearchMode = 'name' | 'unicode'
export type SortMode = 'order' | 'unicode'

function wildcard(pattern: string): RegExp {
  const body = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${body}$`)
}

/** Search terms split on commas/whitespace; a glyph matches if any term does. */
export function searchMatcher(mode: SearchMode, text: string): ((name: string, glyph: GlyphRecord) => boolean) | null {
  const terms = text.split(/[,\s]+/).filter(Boolean)
  if (!terms.length) return null
  if (mode === 'name') {
    const tests = terms.map((t) => (t.includes('*') ? wildcard(t) : t))
    return (name) => tests.some((t) => (typeof t === 'string' ? t === name : t.test(name)))
  }
  const tests = terms.map((raw) => {
    const t = raw.replace(/^(U\+|0x)/i, '').toUpperCase()
    if (t.includes('*')) {
      const re = wildcard(t)
      return (cp: number) => re.test(cp.toString(16).toUpperCase().padStart(4, '0'))
    }
    const value = parseInt(t, 16)
    return (cp: number) => cp === value
  })
  return (_name, glyph) => glyph.u.some((cp) => tests.some((test) => test(cp)))
}

/** Unicode order; unencoded glyphs take the code point of their base name. */
export function sortByUnicode(order: string[], glyphs: Record<string, GlyphRecord>): string[] {
  const code = (name: string): number => {
    const g = glyphs[name]
    if (g?.u.length) return g.u[0]
    const base = glyphs[name.split('.')[0]]
    return base?.u.length ? base.u[0] + 0.5 : Infinity
  }
  return order
    .map((name, i) => ({ name, i, c: code(name) }))
    .sort((a, b) => a.c - b.c || a.i - b.i)
    .map((x) => x.name)
}

export function visibleInFontGrid(
  name: string,
  side: SideData,
  filter: KernFilter,
  hideGrouped: boolean,
): boolean {
  if (side.grouped.has(name)) return filter === 'all' && !hideGrouped
  if (filter === 'kerned') return side.kerned.has(name)
  if (filter === 'not_kerned') return !side.kerned.has(name)
  return true
}
