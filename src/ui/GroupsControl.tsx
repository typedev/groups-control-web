// The Groups Control workspace: font grid | groups + content | pairs list.
// Behaviour follows Font-Rover groups_control/window.py (read-only for now).
import { useCallback, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react'
import {
  displayGroupName,
  searchMatcher,
  sortByUnicode,
  visibleInFontGrid,
  type FontModel,
  type KernFilter,
  type SearchMode,
  type SideId,
  type SortMode,
} from '../model/font'
import { buildPairRows } from '../model/pairs'
import { CanvasGrid } from './canvas/CanvasGrid'
import {
  drawContentCell,
  drawFontCell,
  drawGroupCell,
  FONT_CELL,
  GROUP_CELL,
  memberBadges,
  themeFor,
} from './canvas/cells'
import { PairsList } from './PairsList'
import { Splitter } from './Splitter'
import { useDark } from './useDark'

type Source = 'font' | 'groups' | 'pairs'

const control =
  'rounded-md border border-zinc-300 bg-white px-1.5 py-0.5 text-xs dark:border-zinc-700 dark:bg-zinc-900'

/** Plain click selects one; Cmd/Ctrl toggles; Shift extends from the anchor. */
function nextSelection(
  current: Set<string>,
  list: string[],
  index: number,
  anchor: number | null,
  e: MouseEvent,
): Set<string> {
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

function Column({ active, children, className = '' }: { active: boolean; children: ReactNode; className?: string }) {
  return (
    <section
      className={`flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border-2 ${
        active ? 'border-blue-500' : 'border-transparent'
      } ${className}`}
    >
      {children}
    </section>
  )
}

function Toolbar({ children }: { children: ReactNode }) {
  return <div className="flex h-9 shrink-0 items-center gap-1.5 px-1.5 text-xs">{children}</div>
}

export function GroupsControl({ font, onStats }: { font: FontModel; onStats: (text: string) => void }) {
  const dark = useDark()
  const theme = themeFor(dark)
  const [side, setSide] = useState<SideId>('kern1')
  const sideData = font.side(side)

  // Column 1 state
  const [searchMode, setSearchMode] = useState<SearchMode>('name')
  const [searchText, setSearchText] = useState('')
  const [sortMode, setSortMode] = useState<SortMode>('order')
  const [hideGrouped, setHideGrouped] = useState(true)
  const [kernFilter, setKernFilter] = useState<KernFilter>('all')
  const [fontSelection, setFontSelection] = useState<Set<string>>(new Set())
  const [fontAnchor, setFontAnchor] = useState<number | null>(null)

  // Column 2 state
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null)
  const [activeGroup, setActiveGroup] = useState<string | null>(null)
  const [contentSelection, setContentSelection] = useState<Set<string>>(new Set())
  const [contentAnchor, setContentAnchor] = useState<number | null>(null)
  const [groupScroll, setGroupScroll] = useState<{ index: number; key: number } | null>(null)

  // Column 3 state
  const [pairSelection, setPairSelection] = useState<Set<string>>(new Set())
  /** Focused column (accent frame). */
  const [source, setSourceState] = useState<Source>('groups')
  /** What the pairs list shows: the font selection or the selected group. */
  const [listSource, setListSource] = useState<'font' | 'groups'>('groups')
  const setSource = useCallback((s: Source) => {
    setSourceState(s)
    if (s !== 'pairs') setListSource(s)
  }, [])

  const [widths, setWidths] = useState([1 / 3, 1 / 3, 1 / 3])
  const [groupsFraction, setGroupsFraction] = useState(0.55)

  const selectGroup = useCallback(
    (group: string | null, scroll = true) => {
      setSelectedGroup(group)
      setActiveGroup(group)
      setContentSelection(new Set())
      setPairSelection(new Set())
      if (group && scroll) setGroupScroll({ index: font.side(side).groups.indexOf(group), key: Date.now() })
    },
    [font, side],
  )

  // Side switch: reload, select group 0 (W:2203, 1459-1471).
  useEffect(() => {
    setFontSelection(new Set())
    selectGroup(font.side(side).groups[0] ?? null)
    setSource('groups')
  }, [font, side, selectGroup, setSource])

  // Header stats (W:2078-2085).
  useEffect(() => {
    onStats(`${sideData.groups.length} groups | ${sideData.grouped.size}/${font.data.order.length} glyphs grouped`)
  }, [sideData, font, onStats])

  const fontNames = useMemo(() => {
    const ordered = sortMode === 'unicode' ? sortByUnicode(font.data.order, font.data.glyphs) : font.data.order
    const match = searchMatcher(searchMode, searchText)
    return ordered.filter(
      (n) => (!match || match(n, font.data.glyphs[n])) && visibleInFontGrid(n, sideData, kernFilter, hideGrouped),
    )
  }, [font, sortMode, searchMode, searchText, sideData, kernFilter, hideGrouped])

  const members = activeGroup ? font.data.groups[activeGroup] ?? [] : []
  const badges = useMemo(() => (activeGroup ? memberBadges(font, activeGroup, side) : []), [font, activeGroup, side])

  const pairRows = useMemo(() => {
    const first = [...fontSelection][0]
    const entries =
      listSource === 'font' && first !== undefined
        ? font.pairsWithKeys([first], side)
        : selectedGroup
          ? font.pairsOfGroup(selectedGroup, side)
          : []
    return buildPairRows(font, entries)
  }, [font, side, listSource, fontSelection, selectedGroup])

  // -- painters ---------------------------------------------------------------

  const drawFont = useCallback(
    (ctx: CanvasRenderingContext2D, i: number, r: { x: number; y: number; w: number; h: number }) => {
      const name = fontNames[i]
      const mark = sideData.grouped.has(name) ? 'grouped' : sideData.kerned.has(name) ? 'kerned' : null
      drawFontCell(ctx, font, name, r, { selected: fontSelection.has(name), mark }, theme)
    },
    [font, fontNames, sideData, fontSelection, theme],
  )

  const drawGroup = useCallback(
    (ctx: CanvasRenderingContext2D, i: number, r: { x: number; y: number; w: number; h: number }) => {
      const group = sideData.groups[i]
      drawGroupCell(ctx, font, group, r, side, font.validate(group, side), {
        selected: group === selectedGroup && source === 'groups',
        active: group === activeGroup,
      })
    },
    [font, sideData, side, selectedGroup, activeGroup, source],
  )

  const drawContent = useCallback(
    (ctx: CanvasRenderingContext2D, i: number, r: { x: number; y: number; w: number; h: number }) => {
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
    },
    [font, members, side, contentSelection, badges, theme],
  )

  // -- interactions -----------------------------------------------------------

  const onFontClick = (i: number, e: MouseEvent) => {
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
    selectGroup(sideData.groups[i], false)
    setSource('groups')
  }

  const onContentClick = (i: number, e: MouseEvent) => {
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

  return (
    <div className="flex min-h-0 flex-1 p-1.5">
      <div className="flex min-h-0 min-w-0 flex-col" style={{ width: `${widths[0] * 100}%` }}>
        <Column active={source === 'font'} className="flex-1">
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
              <input
                type="checkbox"
                checked={hideGrouped}
                disabled={kernFilter !== 'all'}
                onChange={(e) => setHideGrouped(e.target.checked)}
              />
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
            count={fontNames.length}
            cellWidth={FONT_CELL.w}
            cellHeight={FONT_CELL.h}
            version={drawFont}
            draw={drawFont}
            onCellClick={onFontClick}
          />
          <div className="px-2 py-1 text-xs text-zinc-500">
            {fontNames.length} of {font.data.order.length} glyphs
            {fontSelection.size ? ` | ${fontSelection.size} selected` : ''}
          </div>
        </Column>
      </div>
      <Splitter direction="horizontal" onDrag={(d) => resize(0, d)} />
      <div className="flex min-h-0 min-w-0 flex-col" style={{ width: `${widths[1] * 100}%` }}>
        <Column active={source === 'groups'} className="min-h-0" >
          <div className="flex min-h-0 flex-col" style={{ height: '100%' }}>
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
                count={sideData.groups.length}
                cellWidth={GROUP_CELL.w}
                cellHeight={GROUP_CELL.h}
                version={drawGroup}
                draw={drawGroup}
                onCellClick={onGroupClick}
                scrollTo={groupScroll}
              />
            </div>
            <Splitter
              direction="vertical"
              onDrag={(d) => setGroupsFraction((f) => Math.min(0.85, Math.max(0.15, f + d)))}
            />
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
                count={members.length}
                cellWidth={FONT_CELL.w}
                cellHeight={FONT_CELL.h}
                version={drawContent}
                draw={drawContent}
                onCellClick={onContentClick}
              />
            </div>
          </div>
        </Column>
      </div>
      <Splitter direction="horizontal" onDrag={(d) => resize(1, d)} />
      <div className="flex min-h-0 min-w-0 flex-col" style={{ width: `${widths[2] * 100}%` }}>
        <Column active={source === 'pairs'} className="flex-1">
          <Toolbar>
            <span className="font-medium">Pairs</span>
            <span className="truncate text-zinc-500">
              {listSource === 'font' && fontSelection.size
                ? [...fontSelection][0]
                : selectedGroup
                  ? `@.${displayGroupName(selectedGroup, side)} and its members`
                  : ''}
            </span>
          </Toolbar>
          <PairsList rows={pairRows} selected={pairSelection} onSelect={setPairSelection} onFocus={() => setSource('pairs')} />
        </Column>
      </div>
    </div>
  )
}
