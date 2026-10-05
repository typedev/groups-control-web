// Rows of the kern pairs list (Font-Rover kern_pairs_list/model.py, utils.py).
import type { ExceptionType, FontModel } from './font'
import { KERN1, KERN2, shortGroupName } from './kerning'
import type { KerningEntry, LangStatus } from './types'

export type PairRow = {
  left: string
  right: string
  value: number
  leftIsGroup: boolean
  rightIsGroup: boolean
  exception: ExceptionType
  lang: { status: LangStatus; note: string } | null
  sortLeft: string
  sortRight: string
}

/** Case-insensitive, A before a: name.lower() + (\0 0 | \0 1) + name. */
const nameKey = (name: string) => {
  const upper = name[0] !== undefined && name[0] !== name[0].toLowerCase()
  return name.toLowerCase() + (upper ? '\u00000' : '\u00001') + name
}

/** Groups first, their exceptions right after them, standalone glyphs last. */
function sideSortKey(name: string, isGroup: boolean, parent: string | null): string {
  if (isGroup) return nameKey(shortGroupName(name)) + '\u0000'
  if (parent) return nameKey(shortGroupName(parent)) + '\u0001' + nameKey(name)
  return nameKey(name) + '\u0002'
}

export function buildPairRows(font: FontModel, entries: KerningEntry[]): PairRow[] {
  return entries.map(([left, right, value]) => {
    const leftIsGroup = left.startsWith(KERN1)
    const rightIsGroup = right.startsWith(KERN2)
    const exc = font.exceptionType(left, right)
    const leftParent = exc.type === 1 || exc.type === 3 ? exc.leftParent : null
    const rightParent = exc.type === 2 || exc.type === 3 ? exc.rightParent : null
    return {
      left,
      right,
      value,
      leftIsGroup,
      rightIsGroup,
      exception: exc.type,
      lang: font.langOf(left, right),
      sortLeft: sideSortKey(left, leftIsGroup, leftParent),
      sortRight: sideSortKey(right, rightIsGroup, rightParent),
    }
  })
}

export type PairSortColumn = 'left' | 'right' | 'value' | 'exc' | 'lang'
export type PairSort = { column: PairSortColumn; descending: boolean }

const cmp = (a: string | number, b: string | number) => (a < b ? -1 : a > b ? 1 : 0)

export function sortPairRows(rows: PairRow[], sort: PairSort): PairRow[] {
  const byLeft = (a: PairRow, b: PairRow) => cmp(a.sortLeft, b.sortLeft) || cmp(a.sortRight, b.sortRight)
  const key: Record<PairSortColumn, (a: PairRow, b: PairRow) => number> = {
    left: byLeft,
    right: (a, b) => cmp(a.sortRight, b.sortRight) || cmp(a.sortLeft, b.sortLeft),
    value: (a, b) => a.value - b.value || byLeft(a, b),
    exc: (a, b) => a.exception - b.exception || byLeft(a, b),
    lang: (a, b) => (a.lang?.status ?? 0) - (b.lang?.status ?? 0) || byLeft(a, b),
  }
  const sorted = [...rows].sort(key[sort.column])
  return sort.descending ? sorted.reverse() : sorted
}
