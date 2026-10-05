// The Groups Control workspace: font grid | groups + content | pairs list.
// Behaviour follows Font-Rover groups_control/window.py.
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent, type ReactNode } from 'react'
import {
  displayGroupName,
  prefixOf,
  searchMatcher,
  sortByUnicode,
  visibleInFontGrid,
  type FontModel,
  type KernFilter,
  type SearchMode,
  type SideId,
  type SortMode,
} from '../model/font'
import { freeName, nameProblem } from '../model/naming'
import { buildPairRows } from '../model/pairs'
import type { HistoryState, OpResult, Refused } from '../worker/protocol'
import { python } from '../runtime'
import { CanvasGrid, type CellRect, type GridHandle } from './canvas/CanvasGrid'
import {
  DROP_GREEN,
  drawContentCell,
  drawFontCell,
  drawGroupCell,
  drawInsertBar,
  FONT_CELL,
  GROUP_CELL,
  memberBadges,
  themeFor,
} from './canvas/cells'
import type { DialogSpec } from './Dialog'
import { HistoryPanel } from './HistoryPanel'
import { PairsList } from './PairsList'
import { Preview, type PreviewInput, type PreviewKeys } from './Preview'
import { Splitter } from './Splitter'
import { useDark } from './useDark'

type Source = 'font' | 'groups' | 'pairs'
type Ask = (spec: Omit<DialogSpec, 'onClose'>) => Promise<{ value: string | null; input: string }>
export type Run = <R>(call: () => Promise<OpResult<R>>) => Promise<OpResult<R> | null>

type Props = {
  font: FontModel
  readOnly: boolean
  run: Run
  ask: Ask
  onStats: (text: string) => void
}

const control =
  'rounded-md border border-zinc-300 bg-white px-1.5 py-0.5 text-xs dark:border-zinc-700 dark:bg-zinc-900'
const toolButton =
  'rounded-md border border-zinc-300 px-2 py-0.5 text-xs hover:bg-zinc-100 disabled:opacity-40 disabled:hover:bg-transparent dark:border-zinc-700 dark:hover:bg-zinc-800'

/** Plain click selects one; Cmd/Ctrl toggles; Shift extends from the anchor. */
function nextSelection(current: Set<string>, list: string[], index: number, anchor: number | null, e: MouseEvent): Set<string> {
  const name = list[index]
  if (e.shiftKey && anchor !== null) {
    const [a, b] = [anchor, index].sort((x, y) => x - y)
    return new Set(list.slice(a, b + 1))
  }
  if (e.metaKey || e.ctrlKey) {
    const next = new Set(current)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    return next
  }
  return new Set([name])
}

function Column({ active, drop, children, className = '' }: { active: boolean; drop?: boolean; children: ReactNode; className?: string }) {
  return (
    <section
      className={`flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border-2 ${className}`}
      style={{ borderColor: drop ? DROP_GREEN : active ? '#3b82f6' : 'transparent' }}
    >
      {children}
    </section>
  )
}

function Toolbar({ children }: { children: ReactNode }) {
  return <div className="flex h-9 shrink-0 items-center gap-1.5 px-1.5 text-xs">{children}</div>
}

/** W:1031-1048 _report_grouped body. */
function refusedText(refused: Refused, side: SideId): string {
  return (
    'Already in a group on this side — remove them from it first:\n\n' +
    refused.map(([g, group]) => (group ? `${g}  →  @${displayGroupName(group, side)}` : g)).join('\n')
  )
}

// -- drag & drop ----------------------------------------------------------------

type DragSource = 'font' | 'content'
type DropTarget =
  | { kind: 'content'; insert: number }
  | { kind: 'group'; index: number }
  | { kind: 'font' }
  | null
type Drag = { source: DragSource; names: string[]; x0: number; y0: number; active: boolean; x: number; y: number }

export function GroupsControl({ font, readOnly, run, ask, onStats }: Props) {
  const dark = useDark()
  const theme = themeFor(dark)
  const [side, setSide] = useState<SideId>('kern1')
  const sideData = font.side(side)
  const prefix = prefixOf(side)

  // Column 1
  const [searchMode, setSearchMode] = useState<SearchMode>('name')
  const [searchText, setSearchText] = useState('')
  const [sortMode, setSortMode] = useState<SortMode>('order')
  const [hideGrouped, setHideGrouped] = useState(true)
  const [kernFilter, setKernFilter] = useState<KernFilter>('all')
  const [fontSelection, setFontSelection] = useState<Set<string>>(new Set())
  const [fontAnchor, setFontAnchor] = useState<number | null>(null)

  // Column 2
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null)
  const [activeGroup, setActiveGroup] = useState<string | null>(null)
  const [contentSelection, setContentSelection] = useState<Set<string>>(new Set())
  const [contentAnchor, setContentAnchor] = useState<number | null>(null)
  const [groupScroll, setGroupScroll] = useState<{ index: number; key: number } | null>(null)
  const [keepKerning, setKeepKerning] = useState(true)

  // Column 3
  const [pairSelection, setPairSelection] = useState<Set<string>>(new Set())
  const [source, setSourceState] = useState<Source>('groups')
  const [listSource, setListSource] = useState<'font' | 'groups'>('groups')
  const setSource = useCallback((s: Source) => {
    setSourceState(s)
    if (s !== 'pairs') setListSource(s)
  }, [])

  const [widths, setWidths] = useState([1 / 3, 1 / 3, 1 / 3])
  const [groupsFraction, setGroupsFraction] = useState(0.55)
  const [previewFraction, setPreviewFraction] = useState(0.3)
  const previewKeys = useRef<PreviewKeys | null>(null)
  const [history, setHistory] = useState<HistoryState | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)

  const fontGrid = useRef<GridHandle>(null)
  const groupsGrid = useRef<GridHandle>(null)
  const contentGrid = useRef<GridHandle>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget>(null)
  const suppressClick = useRef(false)

  const selectGroup = useCallback(
    (group: string | null, scroll = true, sideId: SideId = side) => {
      setSelectedGroup(group)
      setActiveGroup(group)
      setContentSelection(new Set())
      setPairSelection(new Set())
      if (group && scroll) setGroupScroll({ index: font.side(sideId).groups.indexOf(group), key: Date.now() })
    },
    [font, side],
  )

  // Side switch: reload, select group 0 (W:2203, 1459-1471). Not on edits.
  const fontRef = useRef(font)
  fontRef.current = font
  useEffect(() => {
    setFontSelection(new Set())
    const first = fontRef.current.side(side).groups[0] ?? null
    setSelectedGroup(first)
    setActiveGroup(first)
    setContentSelection(new Set())
    setPairSelection(new Set())
    setSource('groups')
  }, [side, setSource])

  // A group that disappeared (deleted elsewhere, revert) is no longer shown.
  useEffect(() => {
    if (selectedGroup && !(selectedGroup in font.data.groups)) setSelectedGroup(null)
    if (activeGroup && !(activeGroup in font.data.groups)) setActiveGroup(null)
  }, [font, selectedGroup, activeGroup])

  useEffect(() => {
    onStats(`${sideData.groups.length} groups | ${sideData.grouped.size}/${font.data.order.length} glyphs grouped`)
  }, [sideData, font, onStats])

  const refreshHistory = useCallback(async () => setHistory(await python.call('history', [])), [])
  useEffect(() => {
    void refreshHistory()
  }, [font, refreshHistory])

  const fontNames = useMemo(() => {
    const ordered = sortMode === 'unicode' ? sortByUnicode(font.data.order, font.data.glyphs) : font.data.order
    const match = searchMatcher(searchMode, searchText)
    return ordered.filter(
      (n) => (!match || match(n, font.data.glyphs[n])) && visibleInFontGrid(n, sideData, kernFilter, hideGrouped),
    )
  }, [font, sortMode, searchMode, searchText, sideData, kernFilter, hideGrouped])

  const members = useMemo(() => (activeGroup ? font.data.groups[activeGroup] ?? [] : []), [font, activeGroup])
  const badges = useMemo(() => (activeGroup ? memberBadges(font, activeGroup, side) : []), [font, activeGroup, side])

  const pairRows = useMemo(() => {
    const first = [...fontSelection][0]
    const entries =
      listSource === 'font' && first !== undefined
        ? font.pairsWithKeys([first], side)
        : selectedGroup && selectedGroup in font.data.groups
          ? font.pairsOfGroup(selectedGroup, side)
          : []
    return buildPairRows(font, entries)
  }, [font, side, listSource, fontSelection, selectedGroup])

  /** WIN:1750-1808 — what the bottom preview shows. */
  const previewInput = useMemo<PreviewInput>(() => {
    const pairs = pairRows
      .filter((r) => pairSelection.has(`${r.left}\u0000${r.right}`))
      .map((r) => [r.left, r.right] as [string, string])
    if (source === 'pairs' && pairs.length) {
      const title = pairs.length === 1 ? pairs[0].map((k) => (k in font.data.groups ? `@${displayGroupName(k, k.startsWith('public.kern1.') ? 'kern1' : 'kern2')}` : k)).join('  ') : ''
      return { kind: 'pairs', pairs, title }
    }
    const glyph =
      listSource === 'font' && fontSelection.size
        ? [...fontSelection][0]
        : source !== 'font' && contentSelection.size === 1
          ? [...contentSelection][0]
          : null
    if (glyph) {
      const group = font.groupOf(glyph, side)
      const members = group ? font.data.groups[group] : [glyph]
      return { kind: 'line', title: glyph, subject: { names: [glyph], side, key: members[0] ?? glyph, members } }
    }
    if (selectedGroup && selectedGroup in font.data.groups) {
      const members = font.data.groups[selectedGroup]
      return {
        kind: 'line',
        title: `@ ${displayGroupName(selectedGroup, side)}`,
        subject: { names: members, side, key: members[0] ?? null, members },
      }
    }
    return null
  }, [font, side, source, listSource, pairRows, pairSelection, fontSelection, contentSelection, selectedGroup])

  /** Selected font glyphs in grid order. */
  const fontSelected = () => fontNames.filter((n) => fontSelection.has(n))

  // -- editing actions ------------------------------------------------------------

  const reportRefused = async (refused: Refused, title: string) => {
    if (refused.length) await ask({ title, body: refusedText(refused, side), buttons: [{ label: 'OK', value: 'ok', kind: 'suggested' }] })
  }

  const addToGroup = async (group: string, names: string[], index: number) => {
    const res = await run(() => python.call('addGlyphs', [group, names, keepKerning, index]))
    if (!res) return
    if (group === activeGroup) setContentSelection(new Set(res.result.added))
    await reportRefused(res.result.grouped, 'Glyphs not added')
  }

  const removeFromGroup = async (names: string[]) => {
    if (!activeGroup) return
    const res = await run(() => python.call('removeGlyphs', [activeGroup, names, keepKerning]))
    if (res) setContentSelection(new Set())
  }

  const reorder = async (names: string[], insert: number) => {
    if (!activeGroup) return
    await run(() => python.call('move', [activeGroup, names, insert]))
  }

  const createGroup = async () => {
    const names = fontSelected()
    if (!names.length) return
    const free = names.filter((n) => !sideData.grouped.has(n))
    const grouped: Refused = names
      .filter((n) => sideData.grouped.has(n))
      .map((n) => [n, font.groupOf(n, side) ?? ''])
    if (!free.length) return reportRefused(grouped, 'No group created')

    let short = free[0]
    let problem: string | null = null
    if (prefix + short in font.data.groups) {
      // Group Name Taken dialog (W:2268-2302); reopens until the name is fine.
      let suggestion = freeName(short, prefix, font.data.groups)
      for (;;) {
        const lead = problem ?? `Group '${short}' already exists on this side.`
        const answer = await ask({
          title: 'Group Name Taken',
          body: `${lead} Create the group under another name, or add the glyphs to the existing one.`,
          input: { value: suggestion, label: 'New group name' },
          buttons: [
            { label: 'Cancel', value: 'cancel' },
            { label: `Add to '${short}'`, value: 'add' },
            { label: 'Create', value: 'create', kind: 'suggested' },
          ],
        })
        if (answer.value === 'add') {
          const res = await run(() => python.call('addGlyphs', [prefix + short, free, keepKerning, -1]))
          if (res) {
            selectGroup(prefix + short)
            setFontSelection(new Set())
            setSource('groups')
            await reportRefused(grouped, 'Some glyphs left out')
          }
          return
        }
        if (answer.value !== 'create') return
        const name = answer.input.trim()
        problem = nameProblem(name, prefix, font.data.groups)
        if (!problem) {
          short = name
          break
        }
        suggestion = name
      }
    }
    const res = await run(() => python.call('createGroup', [prefix, short, free, keepKerning]))
    if (!res?.result.group) return
    const created = res.result.group
    // The new model is not in props yet; select once it arrives.
    pendingSelect.current = created
    setFontSelection(new Set())
    setSource('groups')
    await reportRefused(grouped, 'Some glyphs left out')
  }

  const pendingSelect = useRef<string | null>(null)
  useEffect(() => {
    const name = pendingSelect.current
    if (name && name in font.data.groups) {
      pendingSelect.current = null
      selectGroup(name)
    }
  }, [font, selectGroup])

  const deleteGroup = async () => {
    const group = selectedGroup
    if (!group) return
    const pairs = font.pairsWithKeys([group], side).length
    const members = (font.data.groups[group] ?? []).length
    const answer = await ask({
      title: `Delete group '${displayGroupName(group, side)}'?`,
      body: !pairs
        ? 'The group has no kerning of its own.'
        : keepKerning
          ? `Keep Kerning is on: its ${pairs} pair${pairs === 1 ? '' : 's'} become exceptions of its ${members} member${members === 1 ? '' : 's'}.`
          : `Keep Kerning is off: its ${pairs} pair${pairs === 1 ? '' : 's'} will be removed.`,
      buttons: [
        { label: 'Cancel', value: 'cancel' },
        { label: 'Delete', value: 'delete', kind: 'destructive' },
      ],
    })
    if (answer.value !== 'delete') return
    const res = await run(() => python.call('deleteGroup', [group, keepKerning]))
    if (res) {
      setSelectedGroup(null)
      setActiveGroup(null)
      setContentSelection(new Set())
    }
  }

  const renameGroup = async () => {
    const group = selectedGroup
    if (!group) return
    const short = displayGroupName(group, side)
    const answer = await ask({
      title: 'Rename Group',
      body: `Enter new name for group '${short}':`,
      input: { value: short, label: 'New group name' },
      buttons: [
        { label: 'Cancel', value: 'cancel' },
        { label: 'Rename', value: 'rename', kind: 'suggested' },
      ],
    })
    if (answer.value !== 'rename') return
    const name = answer.input.trim()
    if (name === short) return
    const problem = nameProblem(name, prefix, font.data.groups)
    if (problem) {
      await ask({ title: 'Cannot Rename', body: problem, buttons: [{ label: 'OK', value: 'ok', kind: 'suggested' }] })
      return
    }
    const res = await run(() => python.call('renameGroup', [group, name]))
    if (res) pendingSelect.current = res.result.group
  }

  const deletePairs = async () => {
    const visible = new Set(pairRows.map((r) => `${r.left}\u0000${r.right}`))
    const keys = [...pairSelection].filter((k) => visible.has(k))
    if (!keys.length) return
    const answer = await ask({
      title: `Delete ${keys.length} pair${keys.length === 1 ? '' : 's'}?`,
      body: 'The kerning values are removed from the font. Revert to file brings them back until you save.',
      buttons: [
        { label: 'Cancel', value: 'cancel' },
        { label: 'Delete', value: 'delete', kind: 'destructive' },
      ],
    })
    if (answer.value !== 'delete') return
    const pairs = keys.map((k) => k.split('\u0000') as [string, string])
    if (await run(() => python.call('deletePairs', [pairs]))) setPairSelection(new Set())
  }

  // -- drag & drop ------------------------------------------------------------------

  const startDrag = (source: DragSource, names: string[], e: PointerEvent) => {
    if (readOnly || !names.length) return
    setDrag({ source, names, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, active: false })
  }

  const targetAt = useCallback(
    (d: Drag, x: number, y: number): DropTarget => {
      const content = contentGrid.current?.hit(x, y)
      if (content && activeGroup) return { kind: 'content', insert: content.insert }
      const group = groupsGrid.current?.hit(x, y)
      if (group && group.index >= 0 && d.source === 'font') return { kind: 'group', index: group.index }
      if (d.source === 'content' && fontGrid.current?.hit(x, y)) return { kind: 'font' }
      return null
    },
    [activeGroup],
  )

  useEffect(() => {
    if (!drag) return
    const move = (e: globalThis.PointerEvent) => {
      const active = drag.active || Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 5
      setDrag({ ...drag, x: e.clientX, y: e.clientY, active })
      setDropTarget(active ? targetAt(drag, e.clientX, e.clientY) : null)
    }
    const up = (e: globalThis.PointerEvent) => {
      const target = drag.active ? targetAt(drag, e.clientX, e.clientY) : null
      if (drag.active) suppressClick.current = true
      setDrag(null)
      setDropTarget(null)
      if (!target) return
      if (target.kind === 'content' && activeGroup) {
        if (drag.source === 'font') void addToGroup(activeGroup, drag.names, target.insert)
        else void reorder(drag.names, target.insert)
      } else if (target.kind === 'group') {
        void addToGroup(sideData.groups[target.index], drag.names, -1)
      } else if (target.kind === 'font') {
        void removeFromGroup(drag.names)
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  })

  const consumeClick = () => {
    if (!suppressClick.current) return false
    suppressClick.current = false
    return true
  }

  // -- painters ----------------------------------------------------------------------

  const contentInsert = dropTarget?.kind === 'content' ? dropTarget.insert : -1
  const groupHover = dropTarget?.kind === 'group' ? dropTarget.index : -1

  const drawFont = useCallback(
    (ctx: CanvasRenderingContext2D, i: number, r: CellRect) => {
      const name = fontNames[i]
      const mark = sideData.grouped.has(name) ? 'grouped' : sideData.kerned.has(name) ? 'kerned' : null
      drawFontCell(ctx, font, name, r, { selected: fontSelection.has(name), mark }, theme)
    },
    [font, fontNames, sideData, fontSelection, theme],
  )

  const drawGroup = useCallback(
    (ctx: CanvasRenderingContext2D, i: number, r: CellRect) => {
      const group = sideData.groups[i]
      drawGroupCell(ctx, font, group, r, side, font.validate(group, side), {
        selected: group === selectedGroup && source === 'groups',
        active: group === activeGroup,
        dropHover: i === groupHover,
      })
    },
    [font, sideData, side, selectedGroup, activeGroup, source, groupHover],
  )

  const drawContent = useCallback(
    (ctx: CanvasRenderingContext2D, i: number, r: CellRect) => {
      const name = members[i]
      drawContentCell(
        ctx,
        font,
        name,
        r,
        side,
        { selected: contentSelection.has(name), badge: badges[i], missing: !font.glyphSet.has(name) },
        theme,
      )
      if (contentInsert === i) drawInsertBar(ctx, r, false)
      else if (contentInsert === members.length && i === members.length - 1) drawInsertBar(ctx, r, true)
    },
    [font, members, side, contentSelection, badges, theme, contentInsert],
  )

  // -- clicks -------------------------------------------------------------------------

  const onFontClick = (i: number, e: MouseEvent) => {
    if (consumeClick()) return
    const name = fontNames[i]
    const group = font.groupOf(name, side)
    const plain = !e.shiftKey && !e.metaKey && !e.ctrlKey
    if (plain && group) {
      // W:1324-1360: a single grouped glyph jumps to its group.
      selectGroup(group)
      setContentSelection(new Set([name]))
      setFontSelection(new Set())
      setSource('groups')
      return
    }
    setFontSelection(nextSelection(fontSelection, fontNames, i, fontAnchor, e))
    if (!e.shiftKey) setFontAnchor(i)
    setSource('font')
  }

  const onGroupClick = (i: number) => {
    if (consumeClick()) return
    selectGroup(sideData.groups[i], false)
    setSource('groups')
  }

  const onContentClick = (i: number, e: MouseEvent) => {
    if (consumeClick()) return
    setContentSelection(nextSelection(contentSelection, members, i, contentAnchor, e))
    if (!e.shiftKey) setContentAnchor(i)
  }

  const resize = (at: number, delta: number) =>
    setWidths((w) => {
      const next = [...w]
      const min = 0.12
      const d = Math.max(min - next[at], Math.min(delta, next[at + 1] - min))
      next[at] += d
      next[at + 1] -= d
      return next
    })

  const fontPointerDown = (i: number, e: PointerEvent) => {
    const name = fontNames[i]
    startDrag('font', fontSelection.has(name) ? fontSelected() : [name], e)
  }
  const contentPointerDown = (i: number, e: PointerEvent) => {
    const name = members[i]
    startDrag('content', contentSelection.has(name) ? members.filter((m) => contentSelection.has(m)) : [name], e)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-zinc-200 px-3 text-xs dark:border-zinc-800">
        <button type="button" className={toolButton} disabled={readOnly || !fontSelection.size} onClick={createGroup} title="Create group from selected glyphs">
          + Add
        </button>
        <button type="button" className={toolButton} disabled={readOnly || !selectedGroup} onClick={deleteGroup} title="Delete selected group">
          − Delete
        </button>
        <button type="button" className={toolButton} disabled={readOnly || !selectedGroup} onClick={renameGroup} title="Rename group">
          ✎ Rename
        </button>
        <div className="relative">
          <button type="button" className={toolButton} aria-expanded={historyOpen} onClick={() => setHistoryOpen((o) => !o)}>
            History{history?.count ? ` (${history.count})` : ''}
          </button>
          {historyOpen && history && (
            <HistoryPanel
              history={history}
              onRecording={async (on) => setHistory(await python.call('setHistoryRecording', [on]))}
              onClear={async () => setHistory(await python.call('clearHistory', []))}
              onClose={() => setHistoryOpen(false)}
            />
          )}
        </div>
        <label className="ml-auto flex items-center gap-1" title="Preserve kerning as exception pairs when modifying groups">
          <input type="checkbox" checked={keepKerning} onChange={(e) => setKeepKerning(e.target.checked)} />
          Keep Kerning
        </label>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 p-1.5" style={{ flex: 1 - previewFraction }}>
        <div className="flex min-h-0 min-w-0 flex-col" style={{ width: `${widths[0] * 100}%` }}>
          <Column active={source === 'font'} drop={dropTarget?.kind === 'font'} className="flex-1">
            <Toolbar>
              <select className={control} value={searchMode} onChange={(e) => setSearchMode(e.target.value as SearchMode)} aria-label="Search by">
                <option value="name">Name</option>
                <option value="unicode">Unicode</option>
              </select>
              <input
                className={`${control} min-w-0 flex-1`}
                placeholder={searchMode === 'name' ? 'A* , *.sc' : '0041, 04*'}
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                aria-label="Search glyphs"
              />
              <select className={control} value={sortMode} onChange={(e) => setSortMode(e.target.value as SortMode)} aria-label="Sort">
                <option value="order">Glyph order</option>
                <option value="unicode">Unicode</option>
              </select>
              <label className={`flex items-center gap-1 whitespace-nowrap ${kernFilter !== 'all' ? 'opacity-40' : ''}`}>
                <input type="checkbox" checked={hideGrouped} disabled={kernFilter !== 'all'} onChange={(e) => setHideGrouped(e.target.checked)} />
                Hide grouped
              </label>
              <select className={control} value={kernFilter} onChange={(e) => setKernFilter(e.target.value as KernFilter)} aria-label="Kerning filter">
                <option value="all">All</option>
                <option value="kerned">Kerned</option>
                <option value="not_kerned">Not kerned</option>
              </select>
            </Toolbar>
            <CanvasGrid
              label="Font glyphs"
              handle={fontGrid}
              count={fontNames.length}
              cellWidth={FONT_CELL.w}
              cellHeight={FONT_CELL.h}
              version={drawFont}
              draw={drawFont}
              onCellClick={onFontClick}
              onCellPointerDown={fontPointerDown}
            />
            <div className="px-2 py-1 text-xs text-zinc-500">
              {fontNames.length} of {font.data.order.length} glyphs
              {fontSelection.size ? ` | ${fontSelection.size} selected` : ''}
            </div>
          </Column>
        </div>
        <Splitter direction="horizontal" onDrag={(d) => resize(0, d)} />
        <div className="flex min-h-0 min-w-0 flex-col" style={{ width: `${widths[1] * 100}%` }}>
          <Column active={source === 'groups'} className="min-h-0 flex-1">
            <Toolbar>
              <div className="flex overflow-hidden rounded-md border border-zinc-300 dark:border-zinc-700" role="group" aria-label="Side">
                {(['kern1', 'kern2'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={side === s}
                    className={`px-2 py-0.5 ${side === s ? 'bg-zinc-800 text-white dark:bg-zinc-200 dark:text-zinc-900' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}
                    onClick={() => setSide(s)}
                  >
                    {s === 'kern1' ? 'Side 1' : 'Side 2'}
                  </button>
                ))}
              </div>
              <span className="ml-1 text-zinc-500">Group:</span>
              <select
                className={`${control} min-w-0 flex-1`}
                value={selectedGroup ?? ''}
                onChange={(e) => {
                  selectGroup(e.target.value || null)
                  setSource('groups')
                }}
                aria-label="Group"
              >
                {!selectedGroup && <option value="">—</option>}
                {sideData.groups.map((g) => (
                  <option key={g} value={g}>
                    {displayGroupName(g, side)}
                  </option>
                ))}
              </select>
            </Toolbar>
            <div className="flex min-h-0 flex-col" style={{ flex: groupsFraction }}>
              <CanvasGrid
                label="Groups"
                handle={groupsGrid}
                count={sideData.groups.length}
                cellWidth={GROUP_CELL.w}
                cellHeight={GROUP_CELL.h}
                version={drawGroup}
                draw={drawGroup}
                onCellClick={onGroupClick}
                scrollTo={groupScroll}
              />
            </div>
            <Splitter direction="vertical" onDrag={(d) => setGroupsFraction((f) => Math.min(0.85, Math.max(0.15, f + d)))} />
            <div className="flex min-h-0 flex-col" style={{ flex: 1 - groupsFraction }}>
              <div className="px-2 pb-1 text-xs text-zinc-500">
                {activeGroup ? (
                  <>
                    <span className="font-medium text-zinc-700 dark:text-zinc-300">{displayGroupName(activeGroup, side)}</span>
                    {` · ${members.length} glyph${members.length === 1 ? '' : 's'}`}
                  </>
                ) : (
                  'No group'
                )}
              </div>
              <CanvasGrid
                label="Group members"
                handle={contentGrid}
                count={members.length}
                cellWidth={FONT_CELL.w}
                cellHeight={FONT_CELL.h}
                version={drawContent}
                draw={drawContent}
                onCellClick={onContentClick}
                onCellPointerDown={contentPointerDown}
              />
            </div>
          </Column>
        </div>
        <Splitter direction="horizontal" onDrag={(d) => resize(1, d)} />
        <div className="flex min-h-0 min-w-0 flex-col" style={{ width: `${widths[2] * 100}%` }}>
          <Column active={source === 'pairs'} className="flex-1">
            <Toolbar>
              <span className="font-medium">Pairs</span>
              <span className="min-w-0 flex-1 truncate text-zinc-500">
                {listSource === 'font' && fontSelection.size
                  ? [...fontSelection][0]
                  : selectedGroup
                    ? `@.${displayGroupName(selectedGroup, side)} and its members`
                    : ''}
              </span>
              <button
                type="button"
                className={toolButton}
                disabled={readOnly || !pairRows.some((r) => pairSelection.has(`${r.left}\u0000${r.right}`))}
                onClick={deletePairs}
              >
                Delete Pairs
              </button>
            </Toolbar>
            <PairsList
              rows={pairRows}
              selected={pairSelection}
              onSelect={setPairSelection}
              onFocus={() => setSource('pairs')}
              onDelete={readOnly ? undefined : deletePairs}
              onEditKey={(e) => previewKeys.current?.(e) ?? false}
            />
          </Column>
        </div>
      </div>
      <Splitter direction="vertical" onDrag={(d) => setPreviewFraction((f) => Math.min(0.75, Math.max(0.12, f - d)))} />
      <div className="mx-1.5 mb-1.5 flex min-h-0 flex-col overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800" style={{ flex: previewFraction }}>
        <Preview font={font} side={side} input={previewInput} run={run} readOnly={readOnly} keysRef={previewKeys} />
      </div>
      </div>

      {drag?.active && (
        <div
          className="pointer-events-none fixed z-40 rounded-md bg-zinc-900/90 px-2 py-1 text-xs text-white shadow"
          style={{ left: drag.x + 12, top: drag.y + 12 }}
        >
          {drag.names.slice(0, 3).join(', ')}
          {drag.names.length > 3 ? ` +${drag.names.length - 3}` : ''}
          {dropTarget?.kind === 'font' ? ' — remove from group' : ''}
        </div>
      )}
    </div>
  )
}
