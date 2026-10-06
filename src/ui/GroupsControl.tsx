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
import * as Sel from '../model/selection'
import type { DesignspaceInfo, GroupScope, HistoryState, OpResult, Refused, ToolSpec } from '../worker/protocol'
import { ToolDialog } from './ToolDialog'
import { DiffGroupsDialog } from './DiffGroupsDialog'
import { Button, Check, HelpButton, KeepKerningSwitch, Menu, MenuItem, MenuSeparator, Segmented, Select, TextInput } from './controls'
import { setHelpContext, showHelp, type HelpTopic } from '../help'
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
} from './canvas/cells'
import type { DialogSpec } from './Dialog'
import { HistoryPanel } from './HistoryPanel'
import { PairsList } from './PairsList'
import { Preview, type PreviewInput, type PreviewKeys } from './Preview'
import { Splitter } from './Splitter'
import { usePalette } from './palette'

type Ask = (spec: Omit<DialogSpec, 'onClose'>) => Promise<{ value: string | null; input: string }>
export type Run = <R>(call: () => Promise<OpResult<R>>) => Promise<OpResult<R> | null>

type Props = {
  font: FontModel
  /** Opened file name, for exported file names. */
  fontName: string
  readOnly: boolean
  run: Run
  ask: Ask
  /** Set when the font is a master of an open designspace. */
  designspace?: DesignspaceInfo
}

function Column({
  active,
  drop,
  topic,
  children,
  className = '',
}: {
  active: boolean
  drop?: boolean
  /** Help topic shown while this panel is in use. */
  topic: HelpTopic
  children: ReactNode
  className?: string
}) {
  return (
    <section
      onPointerDownCapture={() => setHelpContext(topic)}
      className={`flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border bg-surface transition-[border-color,box-shadow] ${
        drop
          ? 'border-drop shadow-[0_0_0_1px_var(--c-drop)]'
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

export function GroupsControl({ font, fontName, readOnly, run, ask, designspace }: Props) {
  const theme = usePalette()
  const [side, setSide] = useState<SideId>('kern1')
  const sideData = font.side(side)
  const prefix = prefixOf(side)

  // Column 1
  const [searchMode, setSearchMode] = useState<SearchMode>('name')
  const [searchText, setSearchText] = useState('')
  const [sortMode, setSortMode] = useState<SortMode>('order')
  const [hideGrouped, setHideGrouped] = useState(true)
  const [kernFilter, setKernFilter] = useState<KernFilter>('all')
  /** Scripts shown in the font grid; empty = all. */
  const [scriptFilter, setScriptFilter] = useState<string[]>([])

  // Column 2
  const [groupScroll, setGroupScroll] = useState<{ index: number; key: number } | null>(null)
  const [keepKerning, setKeepKerning] = useState(true)

  // One subject across the panels (model/selection.ts).
  const [sel, setSel] = useState<Sel.Selection>(() => Sel.initialSelection(null))
  const group = sel.group

  const [widths, setWidths] = useState([1 / 3, 1 / 3, 1 / 3])
  const [groupsFraction, setGroupsFraction] = useState(0.55)
  const [previewFraction, setPreviewFraction] = useState(0.3)

  // The beam (Font-Rover utils/beam.py): margins measured at one height.
  // Remembered per browser; the grids re-check once a drag settles.
  const [beam, setBeamState] = useState<{ on: boolean; y: number | null }>(() => {
    try {
      const v = JSON.parse(localStorage.getItem('gc.beam') ?? 'null')
      if (v && typeof v.on === 'boolean') return { on: v.on, y: typeof v.y === 'number' ? v.y : null }
    } catch {
      // ignore
    }
    return { on: false, y: null }
  })
  const setBeam = useCallback((next: { on: boolean; y: number | null }) => {
    setBeamState(next)
    try {
      localStorage.setItem('gc.beam', JSON.stringify(next))
    } catch {
      // private mode
    }
  }, [])
  const beamY = beam.on ? beam.y : null
  const [gridBeamY, setGridBeamY] = useState(beamY)
  useEffect(() => {
    const id = setTimeout(() => setGridBeamY(beamY), 60)
    return () => clearTimeout(id)
  }, [beamY])
  const toggleBeam = useCallback(() => {
    if (beam.on) setBeam({ on: false, y: beam.y })
    else {
      const info = fontRef.current.info
      const y = beam.y ?? (info.xHeight ? Math.round(info.xHeight / 2) : Math.round(info.unitsPerEm * 0.25))
      setBeam({ on: true, y })
    }
  }, [beam, setBeam])
  const moveBeam = useCallback((y: number) => setBeam({ on: true, y: Math.round(y) }), [setBeam])
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
    (group: string | null, scroll = true) => {
      setSel(Sel.selectGroup(group))
      if (group && scroll) setGroupScroll({ index: font.side(side).groups.indexOf(group), key: Date.now() })
    },
    [font, side],
  )

  // Side switch: reload, select group 0 (W:2203, 1459-1471). Not on edits.
  const fontRef = useRef(font)
  fontRef.current = font
  useEffect(() => {
    setSel(Sel.initialSelection(fontRef.current.side(side).groups[0] ?? null))
  }, [side])

  const stats = `${sideData.groups.length} groups | ${sideData.grouped.size}/${font.data.order.length} glyphs grouped`

  const refreshHistory = useCallback(async () => setHistory(await python.call('history', [])), [])
  useEffect(() => {
    void refreshHistory()
  }, [font, refreshHistory])

  const fontNames = useMemo(() => {
    const ordered = sortMode === 'unicode' ? sortByUnicode(font.data.order, font.data.glyphs) : font.data.order
    const match = searchMatcher(searchMode, searchText)
    const scripts = scriptFilter.length ? new Set(scriptFilter) : null
    return ordered.filter(
      (n) =>
        (!scripts || scripts.has(font.scriptOf(n))) &&
        (!match || match(n, font.data.glyphs[n])) &&
        visibleInFontGrid(n, sideData, kernFilter, hideGrouped),
    )
  }, [font, sortMode, searchMode, searchText, sideData, kernFilter, hideGrouped, scriptFilter])

  // Hidden glyphs, deleted groups and departed members leave the selection.
  useEffect(() => {
    const visible = new Set(fontNames)
    setSel((s) => Sel.prune(s, visible, font.data.groups))
  }, [font, fontNames])

  const members = useMemo(() => (group ? font.data.groups[group] ?? [] : []), [font, group])
  const badges = useMemo(() => (group ? memberBadges(font, group, side, gridBeamY) : []), [font, group, side, gridBeamY])

  const pairRows = useMemo(() => buildPairRows(font, Sel.pairEntries(font, sel, side, fontNames)), [font, sel, side, fontNames])

  /** WIN:1750-1808 — what the bottom preview shows. */
  const previewInput = useMemo<PreviewInput>(() => {
    const pairs = pairRows
      .filter((r) => sel.pairs.has(`${r.left}\u0000${r.right}`))
      .map((r) => [r.left, r.right] as [string, string])
    if (sel.focus === 'pairs' && pairs.length) {
      const title = pairs.length === 1 ? pairs[0].map((k) => (k in font.data.groups ? `@${displayGroupName(k, k.startsWith('public.kern1.') ? 'kern1' : 'kern2')}` : k)).join('  ') : ''
      return { kind: 'pairs', pairs, title }
    }
    const line = Sel.previewLine(font, sel, side, fontNames)
    return line && { kind: 'line', ...line }
  }, [font, side, sel, fontNames, pairRows])

  /** Selected font glyphs in grid order. */
  const fontSelected = () => Sel.fontSelected(sel, fontNames)

  // -- editing actions ------------------------------------------------------------

  const reportRefused = async (refused: Refused, title: string) => {
    if (refused.length) await ask({ title, body: refusedText(refused, side), buttons: [{ label: 'OK', value: 'ok', kind: 'suggested' }] })
  }

  const addToGroup = async (group: string, names: string[], index: number) => {
    const res = await run(() => python.call('addGlyphs', [group, names, keepKerning, index]))
    if (!res) return
    setSel((s) => Sel.glyphsAdded(s, group, res.result.added))
    await reportRefused(res.result.grouped, 'Glyphs not added')
  }

  const removeFromGroup = async (names: string[]) => {
    if (!group) return
    const res = await run(() => python.call('removeGlyphs', [group, names, keepKerning]))
    if (res) setSel(Sel.contentCleared)
  }

  const reorder = async (names: string[], insert: number) => {
    if (!group) return
    await run(() => python.call('move', [group, names, insert]))
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
    setSel((s) => Sel.selectGroup(s.group))
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
    if (await run(() => python.call('deleteGroup', [group, keepKerning]))) setSel(Sel.groupCleared)
  }

  const renameGroup = async () => {
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
    const keys = [...sel.pairs].filter((k) => visible.has(k))
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
    if (await run(() => python.call('deletePairs', [pairs]))) setSel(Sel.pairsCleared)
  }

  // -- import / export (Font-Rover import_export.py) -----------------------------------

  const [tools, setTools] = useState<ToolSpec[]>([])
  const [diffOpen, setDiffOpen] = useState(false)
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
    const how = await ask({
      title: `Import groups from ${file.name}`,
      body:
        'Merge: the groups the file lists take its members (glyphs leave their other group); the groups it does not list stay as they are.\n' +
        'Replace: the chosen groups of this font become exactly those in the file; groups it does not list are deleted.\n\n' +
        `Kerning follows the new membership (Keep Kerning ${keepKerning ? 'on' : 'off'}).`,
      buttons: [
        { label: 'Cancel', value: 'cancel' },
        { label: 'Replace…', value: 'replace' },
        { label: 'Merge…', value: 'merge', kind: 'suggested' },
      ],
    })
    if (!how.value || how.value === 'cancel') return
    const mode = how.value as 'merge' | 'replace'
    const pick = await ask({
      title: `${mode === 'merge' ? 'Merge' : 'Replace'} which groups?`,
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
      preview = await python.call('importPreview', [text, scope, mode, keepKerning])
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
    if (await run(() => python.call('importApply', []))) setSel(Sel.groupCleared)
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
      if (content && group) return { kind: 'content', insert: content.insert }
      const cell = groupsGrid.current?.hit(x, y)
      if (cell && cell.index >= 0 && d.source === 'font') return { kind: 'group', index: cell.index }
      if (d.source === 'content' && fontGrid.current?.hit(x, y)) return { kind: 'font' }
      return null
    },
    [group],
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
      if (target.kind === 'content' && group) {
        if (drag.source === 'font') void addToGroup(group, drag.names, target.insert)
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
      drawFontCell(ctx, font, name, r, { selected: sel.font.has(name), active: sel.content.has(name), mark }, theme)
    },
    [font, fontNames, sideData, sel.font, sel.content, theme],
  )

  const drawGroup = useCallback(
    (ctx: CanvasRenderingContext2D, i: number, r: CellRect) => {
      const name = sideData.groups[i]
      drawGroupCell(ctx, font, name, r, side, font.validate(name, side, gridBeamY), {
        selected: name === group && sel.focus === 'groups',
        active: name === group,
        dropHover: i === groupHover,
      }, theme)
    },
    [font, sideData, side, group, sel.focus, groupHover, theme, gridBeamY],
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
        { selected: sel.content.has(name), badge: badges[i], missing: !font.glyphSet.has(name) },
        theme,
      )
      if (contentInsert === i) drawInsertBar(ctx, r, false, theme.accent)
      else if (contentInsert === members.length && i === members.length - 1) drawInsertBar(ctx, r, true, theme.accent)
    },
    [font, members, side, sel.content, badges, theme, contentInsert],
  )

  // -- clicks -------------------------------------------------------------------------

  const onFontClick = (i: number, e: MouseEvent) => {
    if (consumeClick()) return
    const next = Sel.clickFont(sel, fontNames, i, e, (n) => font.groupOf(n, side))
    setSel(next)
    // W:1324-1360: a single grouped glyph jumps to its group.
    if (next.group !== sel.group && next.group) {
      setGroupScroll({ index: sideData.groups.indexOf(next.group), key: Date.now() })
    }
  }

  const onGroupClick = (i: number) => {
    if (consumeClick()) return
    selectGroup(sideData.groups[i], false)
  }

  const onContentClick = (i: number, e: MouseEvent) => {
    if (consumeClick()) return
    setSel(Sel.clickContent(sel, members, i, e))
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
    startDrag('font', sel.font.has(name) ? fontSelected() : [name], e)
  }
  const contentPointerDown = (i: number, e: PointerEvent) => {
    const name = members[i]
    startDrag('content', sel.content.has(name) ? Sel.contentSelected(sel, members) : [name], e)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 px-3 pb-1 pt-2.5">
        <KeepKerningSwitch on={keepKerning} onChange={setKeepKerning} onHelp={() => showHelp('keepKerning')} />
        <Divider />
        <Button disabled={readOnly || !sel.font.size} onClick={createGroup} title="Create a group from the selected glyphs">
          <span aria-hidden className="text-base leading-none">+</span> Add group
        </Button>
        <Button disabled={readOnly || !group} onClick={renameGroup} title="Rename the selected group">
          Rename
        </Button>
        <Button disabled={readOnly || !group} onClick={deleteGroup} title="Delete the selected group">
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
          {(close) => {
            const item = (t: ToolSpec) => (
              <MenuItem key={t.id} title={t.description} onClick={() => { close(); setTool(t) }}>
                {t.name}…
              </MenuItem>
            )
            const byName = (a: ToolSpec, b: ToolSpec) => a.name.localeCompare(b.name)
            const masterTools = designspace ? tools.filter((t) => t.needsDesignspace).sort(byName) : []
            return (
              <>
                {tools.filter((t) => !t.needsDesignspace).sort(byName).map(item)}
                {designspace && (
                  <>
                    <MenuSeparator />
                    <div className="px-2.5 pb-0.5 pt-1 text-xs font-medium text-muted">Between masters</div>
                    {masterTools.map(item)}
                    <MenuItem
                      title="Show the kerning groups that are not the same in every master, as glyph cells."
                      onClick={() => {
                        close()
                        setDiffOpen(true)
                      }}
                    >
                      Diff Groups…
                    </MenuItem>
                  </>
                )}
              </>
            )
          }}
        </Menu>
        <span className="ml-auto whitespace-nowrap text-xs text-muted">{stats}</span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 px-3 py-1.5" style={{ flex: 1 - previewFraction }}>
        <div className="flex min-h-0 min-w-0 flex-col" style={{ width: `${widths[0] * 100}%` }}>
          <Column active={sel.focus === 'font'} drop={dropTarget?.kind === 'font'} topic="font" className="flex-1">
            <Toolbar>
              <div className="flex min-w-0 flex-[1_1_100%] gap-2">
                <Select value={searchMode} onChange={(e) => setSearchMode(e.target.value as SearchMode)} aria-label="Search by">
                  <option value="name">Name</option>
                  <option value="unicode">Unicode</option>
                  <option value="component">Component</option>
                </Select>
                <TextInput
                  className="flex-1"
                  type="search"
                  placeholder={searchMode === 'name' ? 'Search: A*, *.sc' : searchMode === 'unicode' ? 'Search: 0041, 04*' : 'Built with: A, acute*'}
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  aria-label="Search glyphs"
                />
              </div>
              <Select value={sortMode} onChange={(e) => setSortMode(e.target.value as SortMode)} aria-label="Sort">
                <option value="order">Glyph order</option>
                <option value="unicode">Unicode order</option>
              </Select>
              <ScriptFilter font={font} value={scriptFilter} onChange={setScriptFilter} />
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
              <span className="ml-auto">
                <HelpButton label="Help: Font panel" onClick={() => showHelp('font')} />
              </span>
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
              {sel.font.size ? `, ${sel.font.size} selected` : ''}
            </Footer>
          </Column>
        </div>
        <Splitter direction="horizontal" onDrag={(d) => resize(0, d)} />
        <div className="flex min-h-0 min-w-0 flex-col" style={{ width: `${widths[1] * 100}%` }}>
          <Column active={sel.focus === 'groups'} topic="groups" className="min-h-0 flex-1">
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
                value={group ?? ''}
                onChange={(e) => selectGroup(e.target.value || null)}
                aria-label="Group"
              >
                {!group && <option value="">—</option>}
                {sideData.groups.map((g) => (
                  <option key={g} value={g}>
                    {displayGroupName(g, side)}
                  </option>
                ))}
              </Select>
              <HelpButton label="Help: Groups panel" onClick={() => showHelp('groups')} />
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
                {group ? (
                  <>
                    <span className="text-[13px] font-semibold text-ink">{displayGroupName(group, side)}</span>
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
          <Column active={sel.focus === 'pairs'} topic="pairs" className="flex-1">
            <Toolbar>
              <span className="text-[13px] font-semibold">Pairs</span>
              <span className="min-w-0 flex-1 truncate text-xs text-muted">
                {Sel.pairsTitle(sel, side, fontNames)}
              </span>
              <Button
                disabled={readOnly || !pairRows.some((r) => sel.pairs.has(`${r.left}\u0000${r.right}`))}
                onClick={deletePairs}
              >
                Delete pairs
              </Button>
              <HelpButton label="Help: Pairs panel" onClick={() => showHelp('pairs')} />
            </Toolbar>
            <PairsList
              rows={pairRows}
              selected={sel.pairs}
              onSelect={(keys) => setSel((s) => Sel.selectPairs(s, keys))}
              onFocus={() => setSel(Sel.focusPairs)}
              onDelete={readOnly ? undefined : deletePairs}
              onEditKey={(e) => previewKeys.current?.(e) ?? false}
            />
          </Column>
        </div>
      </div>
      <Splitter direction="vertical" onDrag={(d) => setPreviewFraction((f) => Math.min(0.75, Math.max(0.12, f - d)))} />
      <div
        className="mx-3 mb-3 flex min-h-0 flex-col overflow-hidden rounded-xl border border-line bg-surface"
        style={{ flex: previewFraction }}
        onPointerDownCapture={() => setHelpContext('preview')}
        onFocusCapture={() => setHelpContext('preview')}
      >
        <Preview
          font={font}
          side={side}
          input={previewInput}
          run={run}
          readOnly={readOnly}
          keysRef={previewKeys}
          beamY={beamY}
          onToggleBeam={toggleBeam}
          onMoveBeam={moveBeam}
          onHelp={() => showHelp('preview')}
        />
      </div>
      </div>

      {diffOpen && designspace && (
        <DiffGroupsDialog
          font={font}
          info={designspace}
          readOnly={readOnly}
          keepKerning={keepKerning}
          run={run}
          onClose={() => setDiffOpen(false)}
        />
      )}

      {tool && (
        <ToolDialog
          tool={tool}
          readOnly={readOnly}
          hasSelectedGroup={!!group}
          designspace={designspace}
          onPlan={(options) =>
            python.call('toolPlan', [
              tool.id,
              {
                ...options,
                _selectedGroups: group ? [group] : [],
                _side: side,
                _keepKerning: keepKerning,
                // Font grid selection, then selected members of the open group.
                _selectedGlyphs: [...sel.font, ...sel.content],
              },
            ])
          }
          onApply={async () => {
            const res = await run(() => python.call('toolApply', []))
            if (res) setSel(Sel.groupCleared)
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

/** Font grid: show only glyphs of the chosen scripts (none chosen = all). */
function ScriptFilter({ font, value, onChange }: { font: FontModel; value: string[]; onChange: (v: string[]) => void }) {
  const counts = font.scriptCounts()
  const chosen = new Set(value)
  const label =
    value.length === 0
      ? 'All scripts'
      : value.length <= 2
        ? value.map((c) => font.scriptLabel(c)).join(', ')
        : `${value.length} scripts`
  return (
    <Menu label={<span className={value.length ? 'text-accent' : ''}>{label}</span>} width="w-56">
      {() => (
        <>
          <MenuItem onClick={() => onChange([])} disabled={!value.length}>
            Show all scripts
          </MenuItem>
          <MenuSeparator />
          {counts.map(([code, n]) => (
            <label key={code} className="flex items-center gap-2 rounded-lg px-2.5 py-1 text-[13px] hover:bg-raised">
              <input
                type="checkbox"
                className="size-3.5 accent-[var(--c-accent)]"
                checked={chosen.has(code)}
                onChange={(e) => onChange(e.target.checked ? [...value, code] : value.filter((c) => c !== code))}
              />
              <span className="flex-1">{font.scriptLabel(code)}</span>
              <span className="tabular-nums text-xs text-muted">{n}</span>
            </label>
          ))}
        </>
      )}
    </Menu>
  )
}
