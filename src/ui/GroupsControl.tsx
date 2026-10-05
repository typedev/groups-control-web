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
import type { GroupScope, HistoryState, OpResult, Refused, ToolSpec } from '../worker/protocol'
import { ToolDialog } from './ToolDialog'
import { Button, Check, KeepKerningSwitch, Menu, MenuItem, MenuSeparator, Segmented, Select, TextInput } from './controls'
import { download, sidecarName } from '../save'
import { python } from '../runtime'
import { CanvasGrid, type CellRect, type GridHandle } from './canvas/CanvasGrid'
import {
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
import { useAccentColor } from '../theme'

type Source = 'font' | 'groups' | 'pairs'
type Ask = (spec: Omit<DialogSpec, 'onClose'>) => Promise<{ value: string | null; input: string }>
export type Run = <R>(call: () => Promise<OpResult<R>>) => Promise<OpResult<R> | null>

type Props = {
  font: FontModel
  /** Opened file name, for exported file names. */
  fontName: string
  readOnly: boolean
  run: Run
  ask: Ask
  onStats: (text: string) => void
}

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
      className={`flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border bg-surface transition-[border-color,box-shadow] ${
        drop
          ? 'border-[#33bf59] shadow-[0_0_0_1px_#33bf59]'
          : active
            ? 'border-accent shadow-[0_0_0_1px_var(--c-accent)]'
            : 'border-line'
      } ${className}`}
    >
      {children}
    </section>
  )
}

function Toolbar({ children }: { children: ReactNode }) {
  return <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-2.5 py-2">{children}</div>
}

function Footer({ children }: { children: ReactNode }) {
  return <div className="shrink-0 truncate border-t border-line px-3 py-1.5 text-xs text-muted">{children}</div>
}

const Divider = () => <span aria-hidden className="mx-1 h-5 w-px bg-line" />

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

export function GroupsControl({ font, fontName, readOnly, run, ask, onStats }: Props) {
  const dark = useDark()
  const accentColor = useAccentColor()
  const theme = useMemo(() => themeFor(dark, accentColor), [dark, accentColor])
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

  // -- import / export (Font-Rover import_export.py) -----------------------------------

  const [tools, setTools] = useState<ToolSpec[]>([])
  const [tool, setTool] = useState<ToolSpec | null>(null)
  useEffect(() => {
    void python.call('toolList', []).then(setTools)
  }, [])
  const importInput = useRef<HTMLInputElement>(null)
  const historyInput = useRef<HTMLInputElement>(null)

  const exportGroups = async (scope: GroupScope) => {
    const { text } = await python.call('exportGroups', [scope])
    download(sidecarName(fontName, scope === 'kern' ? '_kern_groups.txt' : scope === 'other' ? '_other_groups.txt' : '_groups.txt'), text)
  }

  const importGroups = async (file: File) => {
    const text = await file.text()
    const pick = await ask({
      title: `Import groups from ${file.name}`,
      body: 'Import replaces the chosen groups of this font with those in the file. Kerning follows the new membership.',
      buttons: [
        { label: 'Cancel', value: 'cancel' },
        { label: 'Other groups', value: 'other' },
        { label: 'Kerning groups', value: 'kern' },
        { label: 'All groups', value: 'all', kind: 'suggested' },
      ],
    })
    if (!pick.value || pick.value === 'cancel') return
    const scope = pick.value as GroupScope
    let preview
    try {
      preview = await python.call('importPreview', [text, scope])
    } catch (err) {
      await ask({ title: 'Cannot import', body: err instanceof Error ? err.message : String(err), buttons: [{ label: 'OK', value: 'ok', kind: 'suggested' }] })
      return
    }
    const body = preview.lines.join('\n')
    if (!preview.ok || !preview.changes) {
      await ask({ title: preview.ok ? 'Nothing to import' : 'Cannot import', body, buttons: [{ label: 'OK', value: 'ok', kind: 'suggested' }] })
      return
    }
    const answer = await ask({
      title: `Import ${preview.imported} group${preview.imported === 1 ? '' : 's'}?`,
      body,
      buttons: [
        { label: 'Cancel', value: 'cancel' },
        { label: 'Import', value: 'import', kind: 'destructive' },
      ],
    })
    if (answer.value !== 'import') return
    if (await run(() => python.call('importApply', []))) {
      setSelectedGroup(null)
      setActiveGroup(null)
      setContentSelection(new Set())
    }
  }

  const saveHistory = async () => {
    download(sidecarName(fontName, '_history.txt'), (await python.call('history', [])).text)
  }

  const loadHistory = async (file: File) => {
    const res = await python.call('loadHistory', [await file.text()])
    setHistory(res)
    if (res.notes.length) {
      await ask({ title: 'History loaded with notes', body: res.notes.join('\n'), buttons: [{ label: 'OK', value: 'ok', kind: 'suggested' }] })
    }
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
      }, theme.accent)
    },
    [font, sideData, side, selectedGroup, activeGroup, source, groupHover, theme],
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
      if (contentInsert === i) drawInsertBar(ctx, r, false, theme.accent)
      else if (contentInsert === members.length && i === members.length - 1) drawInsertBar(ctx, r, true, theme.accent)
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
      <div className="flex shrink-0 flex-wrap items-center gap-2 px-3 pb-1 pt-2.5">
        <KeepKerningSwitch on={keepKerning} onChange={setKeepKerning} />
        <Divider />
        <Button disabled={readOnly || !fontSelection.size} onClick={createGroup} title="Create a group from the selected glyphs">
          <span aria-hidden className="text-base leading-none">+</span> Add group
        </Button>
        <Button disabled={readOnly || !selectedGroup} onClick={renameGroup} title="Rename the selected group">
          Rename
        </Button>
        <Button disabled={readOnly || !selectedGroup} onClick={deleteGroup} title="Delete the selected group">
          Delete
        </Button>
        <Divider />
        <div className="relative">
          <Button aria-expanded={historyOpen} onClick={() => setHistoryOpen((o) => !o)}>
            History
            {history?.count ? (
              <span className="rounded-full bg-raised px-1.5 text-xs tabular-nums text-muted">{history.count}</span>
            ) : null}
          </Button>
          {historyOpen && history && (
            <HistoryPanel
              history={history}
              onRecording={async (on) => setHistory(await python.call('setHistoryRecording', [on]))}
              onClear={async () => setHistory(await python.call('clearHistory', []))}
              onSave={saveHistory}
              onLoad={() => historyInput.current?.click()}
              onClose={() => setHistoryOpen(false)}
            />
          )}
          <input
            ref={historyInput}
            type="file"
            accept=".txt,text/plain"
            className="hidden"
            aria-label="Load history file"
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) void loadHistory(file)
            }}
          />
        </div>
        <Menu label="Groups">
          {(close) => (
            <>
              <MenuItem disabled={readOnly} onClick={() => { close(); importInput.current?.click() }}>
                Import groups…
              </MenuItem>
              <MenuSeparator />
              {(['all', 'kern', 'other'] as const).map((scope) => (
                <MenuItem key={scope} onClick={() => { close(); void exportGroups(scope) }}>
                  Export {scope === 'all' ? 'all groups' : scope === 'kern' ? 'kerning groups' : 'other groups'}
                </MenuItem>
              ))}
            </>
          )}
        </Menu>
        <input
          ref={importInput}
          type="file"
          accept=".txt,text/plain"
          className="hidden"
          aria-label="Import groups file"
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) void importGroups(file)
          }}
        />
        <Menu label="Tools" width="w-72">
          {(close) =>
            [...tools].sort((a, b) => a.name.localeCompare(b.name)).map((t) => (
              <MenuItem key={t.id} title={t.description} onClick={() => { close(); setTool(t) }}>
                {t.name}…
              </MenuItem>
            ))
          }
        </Menu>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 px-3 py-1.5" style={{ flex: 1 - previewFraction }}>
        <div className="flex min-h-0 min-w-0 flex-col" style={{ width: `${widths[0] * 100}%` }}>
          <Column active={source === 'font'} drop={dropTarget?.kind === 'font'} className="flex-1">
            <Toolbar>
              <div className="flex min-w-0 flex-[1_1_100%] gap-2">
                <Select value={searchMode} onChange={(e) => setSearchMode(e.target.value as SearchMode)} aria-label="Search by">
                  <option value="name">Name</option>
                  <option value="unicode">Unicode</option>
                </Select>
                <TextInput
                  className="flex-1"
                  type="search"
                  placeholder={searchMode === 'name' ? 'Search: A*, *.sc' : 'Search: 0041, 04*'}
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  aria-label="Search glyphs"
                />
              </div>
              <Select value={sortMode} onChange={(e) => setSortMode(e.target.value as SortMode)} aria-label="Sort">
                <option value="order">Glyph order</option>
                <option value="unicode">Unicode order</option>
              </Select>
              <Select value={kernFilter} onChange={(e) => setKernFilter(e.target.value as KernFilter)} aria-label="Kerning filter">
                <option value="all">All glyphs</option>
                <option value="kerned">Kerned</option>
                <option value="not_kerned">Not kerned</option>
              </Select>
              <Check
                label="Hide grouped"
                checked={hideGrouped}
                disabled={kernFilter !== 'all'}
                onChange={(e) => setHideGrouped(e.target.checked)}
              />
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
            <Footer>
              {fontNames.length} of {font.data.order.length} glyphs
              {fontSelection.size ? `, ${fontSelection.size} selected` : ''}
            </Footer>
          </Column>
        </div>
        <Splitter direction="horizontal" onDrag={(d) => resize(0, d)} />
        <div className="flex min-h-0 min-w-0 flex-col" style={{ width: `${widths[1] * 100}%` }}>
          <Column active={source === 'groups'} className="min-h-0 flex-1">
            <Toolbar>
              <Segmented<SideId>
                tone="accent"
                label="Side"
                value={side}
                onChange={setSide}
                options={[
                  { value: 'kern1', label: 'Side 1', title: 'Left side of a pair (public.kern1)' },
                  { value: 'kern2', label: 'Side 2', title: 'Right side of a pair (public.kern2)' },
                ]}
              />
              <Select
                className="min-w-24 flex-1"
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
              </Select>
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
              <div className="flex items-baseline gap-2 border-t border-line px-3 pb-1 pt-2 text-xs text-muted">
                {activeGroup ? (
                  <>
                    <span className="text-[13px] font-semibold text-ink">{displayGroupName(activeGroup, side)}</span>
                    {`${members.length} glyph${members.length === 1 ? '' : 's'}, first is the key glyph`}
                  </>
                ) : (
                  'Select a group to see its glyphs'
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
              <span className="text-[13px] font-semibold">Pairs</span>
              <span className="min-w-0 flex-1 truncate text-xs text-muted">
                {listSource === 'font' && fontSelection.size
                  ? [...fontSelection][0]
                  : selectedGroup
                    ? `@.${displayGroupName(selectedGroup, side)} and its members`
                    : ''}
              </span>
              <Button
                disabled={readOnly || !pairRows.some((r) => pairSelection.has(`${r.left}\u0000${r.right}`))}
                onClick={deletePairs}
              >
                Delete pairs
              </Button>
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
      <div className="mx-3 mb-3 flex min-h-0 flex-col overflow-hidden rounded-xl border border-line bg-surface" style={{ flex: previewFraction }}>
        <Preview font={font} side={side} input={previewInput} run={run} readOnly={readOnly} keysRef={previewKeys} />
      </div>
      </div>

      {tool && (
        <ToolDialog
          tool={tool}
          readOnly={readOnly}
          hasSelectedGroup={!!selectedGroup}
          onPlan={(options) =>
            python.call('toolPlan', [tool.id, { ...options, _selectedGroups: selectedGroup ? [selectedGroup] : [], _side: side }])
          }
          onApply={async () => {
            const res = await run(() => python.call('toolApply', []))
            if (res) {
              setSelectedGroup(null)
              setActiveGroup(null)
              setContentSelection(new Set())
            }
            return !!res
          }}
          onClose={() => setTool(null)}
        />
      )}

      {drag?.active && (
        <div
          className="pointer-events-none fixed z-40 rounded-lg bg-ink px-2.5 py-1 text-xs font-medium text-surface shadow-lg"
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
