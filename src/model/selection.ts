// Selection across the Groups Control panels: one subject at a time.
// Every action returns the whole next state, so no panel keeps a selection
// that no longer drives the pairs list or the preview.
import { displayGroupName, type FontModel, type SideId } from './font'
import type { PreviewSubject } from './preview'
import type { KerningEntry } from './types'

export type Focus = 'font' | 'groups' | 'pairs'

export type Selection = {
  /** The panel in use (its column is outlined). */
  focus: Focus
  /** What feeds the pairs list; the pairs panel never feeds itself. */
  list: 'font' | 'groups'
  font: Set<string>
  /** Shift-click ranges start here; a name, so filtering cannot shift it. */
  fontAnchor: string | null
  /** The group shown in the content grid: solid while focused, else dashed. */
  group: string | null
  content: Set<string>
  contentAnchor: string | null
  /** Pair keys `left\0right`. */
  pairs: Set<string>
}

export type Modifiers = { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }

const none = () => new Set<string>()

export function initialSelection(group: string | null): Selection {
  return { focus: 'groups', list: 'groups', font: none(), fontAnchor: null, group, content: none(), contentAnchor: null, pairs: none() }
}

/** Plain click selects one; Cmd/Ctrl toggles; Shift extends from the anchor. */
export function clickSet(
  current: Set<string>,
  list: string[],
  index: number,
  anchor: string | null,
  e: Modifiers,
): { set: Set<string>; anchor: string | null } {
  const name = list[index]
  const from = anchor === null ? -1 : list.indexOf(anchor)
  if (e.shiftKey && from >= 0) {
    const [a, b] = [from, index].sort((x, y) => x - y)
    return { set: new Set(list.slice(a, b + 1)), anchor }
  }
  if (e.metaKey || e.ctrlKey) {
    const set = new Set(current)
    if (set.has(name)) set.delete(name)
    else set.add(name)
    return { set, anchor: name }
  }
  return { set: new Set([name]), anchor: name }
}

const isPlain = (e: Modifiers) => !e.shiftKey && !e.metaKey && !e.ctrlKey

/** A group from the grid or the menu: everything else lets go. */
export function selectGroup(group: string | null): Selection {
  return initialSelection(group)
}

/** A grouped glyph opens its group with the glyph selected (W:1324-1360). */
export function showMember(group: string, name: string): Selection {
  return { ...initialSelection(group), content: new Set([name]), contentAnchor: name }
}

/**
 * Click in the font grid. A plain click on a grouped glyph jumps to its
 * group; anything else selects here, keeping the group only as the content
 * grid's context.
 */
export function clickFont(
  s: Selection,
  names: string[],
  index: number,
  e: Modifiers,
  groupOf: (name: string) => string | null,
): Selection {
  const group = groupOf(names[index])
  if (isPlain(e) && group) return showMember(group, names[index])
  const { set, anchor } = clickSet(s.font, names, index, s.fontAnchor, e)
  return { ...s, focus: 'font', list: 'font', font: set, fontAnchor: anchor, content: none(), contentAnchor: null, pairs: none() }
}

/** Click in the content grid: the group is the subject again. */
export function clickContent(s: Selection, members: string[], index: number, e: Modifiers): Selection {
  const { set, anchor } = clickSet(s.content, members, index, s.contentAnchor, e)
  return { ...s, focus: 'groups', list: 'groups', font: none(), fontAnchor: null, content: set, contentAnchor: anchor, pairs: none() }
}

export function selectPairs(s: Selection, pairs: Set<string>): Selection {
  return { ...s, focus: 'pairs', pairs }
}

export function focusPairs(s: Selection): Selection {
  return s.focus === 'pairs' ? s : { ...s, focus: 'pairs' }
}

/**
 * Glyphs added to a group leave the font selection. Added to the open group,
 * they become its selection; otherwise the rest of the font selection stays.
 */
export function glyphsAdded(s: Selection, group: string, added: string[]): Selection {
  if (group === s.group) return { ...s, focus: 'groups', list: 'groups', font: none(), fontAnchor: null, content: new Set(added), contentAnchor: null, pairs: none() }
  const font = new Set([...s.font].filter((n) => !added.includes(n)))
  if (font.size === s.font.size) return s
  if (font.size) return { ...s, font, pairs: none() }
  return { ...s, focus: 'groups', list: 'groups', font, fontAnchor: null, pairs: none() }
}

/** After edits that rebuild the groups (import, tools): nothing is open. */
export function groupCleared(s: Selection): Selection {
  return { ...s, group: null, content: none(), contentAnchor: null }
}

export function contentCleared(s: Selection): Selection {
  return s.content.size ? { ...s, content: none(), contentAnchor: null } : s
}

export function pairsCleared(s: Selection): Selection {
  return s.pairs.size ? { ...s, pairs: none() } : s
}

/**
 * Drop what is no longer there: font glyphs hidden by the filters, a deleted
 * group, members that left the group. Returns `s` itself when nothing changed.
 */
export function prune(s: Selection, visible: Set<string>, groups: Record<string, string[]>): Selection {
  const font = [...s.font].filter((n) => visible.has(n))
  const group = s.group !== null && s.group in groups ? s.group : null
  const members = new Set(group ? groups[group] : [])
  const content = [...s.content].filter((n) => members.has(n))
  if (font.length === s.font.size && group === s.group && content.length === s.content.size) return s
  return {
    ...s,
    font: new Set(font),
    fontAnchor: s.fontAnchor !== null && visible.has(s.fontAnchor) ? s.fontAnchor : null,
    list: font.length ? s.list : 'groups',
    group,
    content: new Set(content),
    contentAnchor: s.contentAnchor !== null && members.has(s.contentAnchor) ? s.contentAnchor : null,
  }
}

// -- what the selection shows --------------------------------------------------------

/** Selected font glyphs in grid order. */
export const fontSelected = (s: Selection, names: string[]) => names.filter((n) => s.font.has(n))

/** Members selected in the content grid, in group order. */
export const contentSelected = (s: Selection, members: string[]) => members.filter((n) => s.content.has(n))

/** `A, B, C +2` */
export function namesTitle(names: string[]): string {
  return names.slice(0, 3).join(', ') + (names.length > 3 ? ` +${names.length - 3}` : '')
}

/** Font glyphs feed the list only while some are selected. */
export function listsFont(s: Selection, fontNames: string[]): string[] | null {
  if (s.list !== 'font') return null
  const names = fontSelected(s, fontNames)
  return names.length ? names : null
}

/** The pairs list: the selected glyphs' own pairs, or the group's with its members' exceptions. */
export function pairEntries(font: FontModel, s: Selection, side: SideId, fontNames: string[]): KerningEntry[] {
  const glyphs = listsFont(s, fontNames)
  if (glyphs) return font.pairsWithKeys(glyphs, side)
  if (s.group !== null && s.group in font.data.groups) return font.pairsOfGroup(s.group, side)
  return []
}

export function pairsTitle(s: Selection, side: SideId, fontNames: string[]): string {
  const glyphs = listsFont(s, fontNames)
  if (glyphs) return namesTitle(glyphs)
  return s.group ? `@.${displayGroupName(s.group, side)} and its members` : ''
}

export type Line = { title: string; subject: Omit<PreviewSubject, 'mode'> }

/**
 * The dependency line (WIN:1750-1808). Several font glyphs are compared with
 * the first — a group in the making; members with their group's key glyph.
 */
export function previewLine(font: FontModel, s: Selection, side: SideId, fontNames: string[]): Line | null {
  const glyphs = listsFont(s, fontNames)
  if (glyphs) {
    if (glyphs.length === 1) {
      const group = font.groupOf(glyphs[0], side)
      const members = group ? font.data.groups[group] : glyphs
      return { title: glyphs[0], subject: { names: glyphs, side, key: members[0] ?? glyphs[0], members } }
    }
    return { title: namesTitle(glyphs), subject: { names: glyphs, side, key: glyphs[0], members: glyphs } }
  }
  if (s.group === null || !(s.group in font.data.groups)) return null
  const members = font.data.groups[s.group]
  const group = `@ ${displayGroupName(s.group, side)}`
  const picked = contentSelected(s, members)
  if (picked.length === 1) return { title: picked[0], subject: { names: picked, side, key: members[0] ?? picked[0], members } }
  if (picked.length) return { title: `${group}: ${namesTitle(picked)}`, subject: { names: picked, side, key: members[0] ?? null, members } }
  return { title: group, subject: { names: members, side, key: members[0] ?? null, members } }
}
