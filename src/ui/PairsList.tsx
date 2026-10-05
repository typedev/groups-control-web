// Column 3: kerning keys of the active group or glyph (virtualized rows).
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ExceptionType } from '../model/font'
import { shortGroupName } from '../model/kerning'
import { sortPairRows, type PairRow, type PairSort, type PairSortColumn } from '../model/pairs'

const ROW = 26

const valueClass = (v: number) =>
  v < 0 ? 'text-red-600 dark:text-[#ff6b6b]' : v > 0 ? 'text-green-700 dark:text-[#69db7c]' : 'text-orange-600 dark:text-[#ffd43b]'

function Bolt({ x }: { x: number }) {
  return <path d={`M${x + 4} 1 L${x} 8 H${x + 3} L${x + 2} 13 L${x + 7} 5 H${x + 4} L${x + 5} 1 Z`} fill="currentColor" />
}

/** ◀+bolt (left exception), bolt+▶ (right), two bolts (orphan glyph pair). */
function ExcMarker({ type }: { type: ExceptionType }) {
  if (!type) return null
  const label = type === 1 ? 'left exception' : type === 2 ? 'right exception' : 'glyph pair of two grouped glyphs'
  return (
    <svg width="22" height="14" viewBox="0 0 22 14" role="img" aria-label={label}>
      <title>{label}</title>
      {type === 1 && (
        <>
          <path d="M1 7 L7 3 V11 Z" fill="currentColor" />
          <Bolt x={10} />
        </>
      )}
      {type === 2 && (
        <>
          <Bolt x={4} />
          <path d="M21 7 L15 3 V11 Z" fill="currentColor" />
        </>
      )}
      {type === 3 && (
        <>
          <Bolt x={3} />
          <Bolt x={12} />
        </>
      )}
    </svg>
  )
}

const LANG_MARK = { 1: '✕', 2: '◐', 3: '✕' } as const

function SideName({ name, isGroup }: { name: string; isGroup: boolean }) {
  if (!isGroup) return <span className="pl-5">{name}</span>
  return (
    <span>
      <span className="font-bold text-accent">@.</span>
      {shortGroupName(name)}
    </span>
  )
}

const COLUMNS: { id: PairSortColumn; label: string; className: string }[] = [
  { id: 'left', label: 'Left', className: 'flex-1 min-w-0' },
  { id: 'right', label: 'Right', className: 'flex-1 min-w-0' },
  { id: 'value', label: 'Value', className: 'w-14 text-right' },
  { id: 'exc', label: 'Exc', className: 'w-12 text-center' },
  { id: 'lang', label: 'Lang', className: 'w-12 text-center' },
]

type Props = {
  rows: PairRow[]
  selected: Set<string>
  onSelect: (keys: Set<string>) => void
  onFocus: () => void
  /** Backspace / Delete on the list. */
  onDelete?: () => void
  /** Editing keys (arrows, E, Z/X) go to the preview; true when handled. */
  onEditKey?: (e: React.KeyboardEvent) => boolean
}

export const rowKey = (r: PairRow) => `${r.left}\u0000${r.right}`

export function PairsList({ rows, selected, onSelect, onFocus, onDelete, onEditKey }: Props) {
  const [sort, setSort] = useState<PairSort>({ column: 'left', descending: false })
  const sorted = useMemo(() => sortPairRows(rows, sort), [rows, sort])
  const selectedHere = useMemo(() => sorted.filter((r) => selected.has(rowKey(r))).length, [sorted, selected])
  const scroller = useRef<HTMLDivElement>(null)
  const [view, setView] = useState({ top: 0, height: 0 })
  const anchor = useRef<number | null>(null)

  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const update = () => setView({ top: el.scrollTop, height: el.clientHeight })
    const observer = new ResizeObserver(update)
    observer.observe(el)
    update()
    return () => observer.disconnect()
  }, [])

  const first = Math.max(0, Math.floor(view.top / ROW) - 5)
  const last = Math.min(sorted.length, Math.ceil((view.top + view.height) / ROW) + 5)

  const click = (index: number, e: React.MouseEvent) => {
    onFocus()
    const key = rowKey(sorted[index])
    if (e.shiftKey && anchor.current !== null) {
      const [a, b] = [anchor.current, index].sort((x, y) => x - y)
      onSelect(new Set(sorted.slice(a, b + 1).map(rowKey)))
      return
    }
    anchor.current = index
    if (e.metaKey || e.ctrlKey) {
      const next = new Set(selected)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      onSelect(next)
    } else onSelect(new Set([key]))
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col text-[12.5px]">
      <div className="flex border-b border-line bg-raised text-xs font-medium text-muted">
        {COLUMNS.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`${c.className} truncate px-2 py-1 text-left hover:bg-raised ${c.className.includes('text-right') ? 'text-right' : ''}`}
            onClick={() =>
              setSort((s) => ({ column: c.id, descending: s.column === c.id ? !s.descending : false }))
            }
          >
            {c.label}
            {sort.column === c.id ? (sort.descending ? ' ▾' : ' ▴') : ''}
          </button>
        ))}
      </div>
      <div
        ref={scroller}
        tabIndex={0}
        aria-label="Kerning pairs"
        onKeyDown={(e) => {
          if (e.key !== 'Backspace' && e.key !== 'Delete' && onEditKey?.(e)) {
            e.preventDefault()
            return
          }
          if ((e.key === 'Backspace' || e.key === 'Delete') && selectedHere) {
            e.preventDefault()
            onDelete?.()
          }
        }}
        className="relative min-h-0 flex-1 overflow-y-auto outline-none"
        onScroll={(e) => {
          // Read now: React clears currentTarget before a state updater runs.
          const top = e.currentTarget.scrollTop
          setView((v) => ({ ...v, top }))
        }}
      >
        <div style={{ height: sorted.length * ROW }}>
          {sorted.slice(first, last).map((r, i) => {
            const index = first + i
            const isSelected = selected.has(rowKey(r))
            return (
              <div
                key={rowKey(r)}
                className={`absolute left-0 right-0 flex cursor-default items-center border-b border-line/60 ${
                  isSelected ? 'bg-accent-soft' : ''
                }`}
                style={{ top: index * ROW, height: ROW }}
                onClick={(e) => click(index, e)}
              >
                <div className="min-w-0 flex-1 truncate px-2" title={r.left}>
                  <SideName name={r.left} isGroup={r.leftIsGroup} />
                </div>
                <div className="min-w-0 flex-1 truncate px-2" title={r.right}>
                  <SideName name={r.right} isGroup={r.rightIsGroup} />
                </div>
                <div className={`w-14 px-2 text-right tabular-nums ${valueClass(r.value)}`}>{Math.trunc(r.value)}</div>
                <div className={`flex w-12 justify-center ${valueClass(r.value)}`}>
                  <ExcMarker type={r.exception} />
                </div>
                <div
                  className={`w-12 text-center font-bold ${r.lang?.status === 1 ? 'text-orange-600 dark:text-[#ffd43b]' : 'text-red-600 dark:text-[#ff6b6b]'}`}
                  title={r.lang?.note}
                >
                  {r.lang ? LANG_MARK[r.lang.status] : ''}
                </div>
              </div>
            )
          })}
        </div>
      </div>
      <div className="border-t border-line px-3 py-1.5 text-muted">
        {sorted.length} pairs | {selectedHere} selected
      </div>
    </div>
  )
}
