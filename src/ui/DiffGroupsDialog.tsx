// Diff Groups: the kern groups that are not the same in every master, each
// membership variant drawn as a row of glyph cells. Kerning is not compared.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { displayGroupName, type FontModel, type SideId } from '../model/font'
import { python } from '../runtime'
import type { DesignspaceInfo, GroupsDiffEntry } from '../worker/protocol'
import { drawContentCell, drawFontCell, FONT_CELL } from './canvas/cells'
import { Check, Segmented } from './controls'
import { usePalette, type Palette } from './palette'
import type { Run } from './GroupsControl'

type Props = {
  font: FontModel
  info: DesignspaceInfo
  readOnly: boolean
  keepKerning: boolean
  run: Run
  onClose: () => void
}

type Reach = 'all' | 'subspace'

const GAP = 2

export function DiffGroupsDialog({ font, info, readOnly, keepKerning, run, onClose }: Props) {
  const p = usePalette()
  const discrete = info.axes.some((a) => a.discrete)
  const [reach, setReach] = useState<Reach>('all')
  const [withOrder, setWithOrder] = useState(true)
  const [entries, setEntries] = useState<GroupsDiffEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)
  const [busy, setBusy] = useState(false)

  const here = JSON.stringify(info.masters[info.current].discrete)
  const masters = useMemo(
    () =>
      info.masters
        .map((m, i) => ({ m, i }))
        .filter(({ m, i }) => i !== info.current && (reach === 'all' || JSON.stringify(m.discrete) === here))
        .map(({ i }) => i),
    [info, reach, here],
  )

  useEffect(() => {
    setEntries(null)
    python
      .call('groupsDiff', [masters])
      .then(setEntries)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [masters, refresh])

  /** One group in every compared master made the same as in this master. */
  const matchGroup = async (group: string) => {
    setBusy(true)
    const res = await run(() => python.call('matchGroup', [group, masters, keepKerning]))
    setBusy(false)
    if (!res) return
    const n = res.result.masters
    setDone(`${group.replace(/^public\.kern[12]\./, '@')}: ${n} master${n === 1 ? '' : 's'} changed.` + (res.result.lines.length ? `\n${res.result.lines.join('\n')}` : ''))
    setRefresh((r) => r + 1)
  }

  const shown = entries?.filter((e) => withOrder || e.level === 'different') ?? []
  const current = info.masters[info.current].name

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Diff Groups"
        className="flex h-[88vh] w-full max-w-6xl flex-col rounded-2xl border border-line bg-surface p-5 shadow-2xl"
      >
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
          <h2 className="text-base font-semibold">Diff Groups</h2>
          <p className="text-sm text-muted">
            Kerning groups that are not the same as in <span className="text-ink">{current}</span>
            {entries && ` — ${shown.length} group${shown.length === 1 ? '' : 's'}`}. Kerning is not compared.
          </p>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
          {discrete && info.subspace && (
            <Segmented
              label="Masters compared"
              value={reach}
              onChange={setReach}
              options={[
                { value: 'all', label: `All ${info.masters.length} masters` },
                { value: 'subspace', label: `${info.subspace} masters` },
              ]}
            />
          )}
          <Check label="Include order-only differences (key glyph)" checked={withOrder} onChange={(e) => setWithOrder(e.target.checked)} />
          <Legend p={p} />
        </div>

        {error && <p role="alert" className="mt-3 rounded-lg bg-error-soft px-3 py-2 text-[13px] text-error">{error}</p>}
        {done && (
          <pre className="mt-3 max-h-24 overflow-auto whitespace-pre-wrap rounded-lg bg-accent-soft px-3 py-2 font-sans text-[13px]">{done}</pre>
        )}

        <div className="mt-3 min-h-0 flex-1 overflow-auto rounded-md border border-line">
          {!entries ? (
            <p className="p-4 text-sm text-muted">Comparing…</p>
          ) : shown.length === 0 ? (
            <p className="p-4 text-sm text-muted">The kerning groups are the same in all compared masters.</p>
          ) : (
            shown.map((e) => (
              <Entry
                key={e.group}
                entry={e}
                font={font}
                info={info}
                p={p}
                action={
                  <button
                    type="button"
                    disabled={readOnly || busy}
                    className="ml-auto h-7 whitespace-nowrap rounded-lg border border-line px-2.5 text-xs font-medium hover:bg-raised disabled:opacity-40"
                    title={`Make this group the same as in ${current} in every compared master. Kerning follows membership (Keep Kerning ${keepKerning ? 'on' : 'off'}); glyphs it takes leave their other group.`}
                    onClick={() => void matchGroup(e.group)}
                  >
                    Make like this master
                  </button>
                }
              />
            ))
          )}
        </div>

        <div className="mt-4 flex justify-end">
          <button type="button" className="h-8 rounded-lg border border-line px-3 text-[13px] font-medium hover:bg-raised" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

function Legend({ p }: { p: Palette }) {
  return (
    <span className="ml-auto flex items-center gap-3 text-xs text-muted">
      <span className="flex items-center gap-1">
        <span className="inline-block size-3 rounded-sm border-2" style={{ borderColor: p.accent }} /> not in this master's group
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block size-3 rounded-sm" style={{ background: p.error, opacity: 0.5 }} /> missing here
      </span>
    </span>
  )
}

function Entry({
  entry,
  font,
  info,
  p,
  action,
}: {
  entry: GroupsDiffEntry
  font: FontModel
  info: DesignspaceInfo
  p: Palette
  action: ReactNode
}) {
  const side: SideId = entry.group.startsWith('public.kern1.') ? 'kern1' : 'kern2'
  const reference = entry.variants[0].members
  return (
    <section className="border-b border-line px-3 py-2 last:border-b-0">
      <h3 className="flex items-baseline gap-2 text-sm">
        <span className="font-semibold">@{displayGroupName(entry.group, side)}</span>
        <span className="text-xs text-muted">{side === 'kern1' ? 'side 1' : 'side 2'}</span>
        <span className={`text-xs ${entry.level === 'different' ? 'text-careful' : 'text-muted'}`}>
          {entry.level === 'different' ? 'members differ' : 'order differs'}
        </span>
        {action}
      </h3>
      {entry.variants.map((v, k) => (
        <div key={k} className="mt-1.5 flex gap-3">
          <div className="w-56 shrink-0 pt-1 text-xs leading-snug">
            {v.masters.map((i) => (
              <div key={i} className={`truncate ${i === info.current ? 'font-semibold text-ink' : 'text-muted'}`} title={info.masters[i].name}>
                {info.masters[i].name}
                {i === info.current && ' (this master)'}
              </div>
            ))}
          </div>
          <div className="min-w-0 flex-1">
            {v.members === null ? (
              <p className="py-2 text-xs text-muted">No such group in {v.masters.length === 1 ? 'this master' : 'these masters'}.</p>
            ) : (
              <GlyphStrip font={font} members={v.members} reference={k === 0 ? null : reference} side={side} p={p} />
            )}
          </div>
        </div>
      ))}
    </section>
  )
}

type Cell = { name: string; kind: 'same' | 'extra' | 'missing' | 'key' }

/**
 * One variant's members as glyph cells (outlines from the current master),
 * then the reference members it lacks. Wraps to the available width.
 */
function GlyphStrip({
  font,
  members,
  reference,
  side,
  p,
}: {
  font: FontModel
  members: string[]
  reference: string[] | null
  side: SideId
  p: Palette
}) {
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [width, setWidth] = useState(0)

  const cells: Cell[] = useMemo(() => {
    if (!reference) return members.map((name) => ({ name, kind: 'same' }))
    const ref = new Set(reference)
    const mine = new Set(members)
    return [
      ...members.map((name, i): Cell => ({
        name,
        // A different first member is a different key glyph.
        kind: !ref.has(name) ? 'extra' : i === 0 && reference[0] !== name ? 'key' : 'same',
      })),
      ...reference.filter((name) => !mine.has(name)).map((name): Cell => ({ name, kind: 'missing' })),
    ]
  }, [members, reference])

  useLayoutEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const { w, h } = FONT_CELL
  const columns = Math.max(1, Math.floor((width + GAP) / (w + GAP)))
  const rows = Math.ceil(cells.length / columns)
  const height = rows * (h + GAP) - GAP

  useEffect(() => {
    const c = canvas.current
    if (!c || !width) return
    const dpr = window.devicePixelRatio || 1
    c.width = Math.round(width * dpr)
    c.height = Math.round(height * dpr)
    const ctx = c.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)
    cells.forEach((cell, i) => {
      const r = { x: (i % columns) * (w + GAP), y: Math.floor(i / columns) * (h + GAP), w, h }
      if (cell.kind === 'missing') {
        drawContentCell(ctx, font, cell.name, r, side, { selected: false, badge: null, missing: true }, p)
      } else {
        drawFontCell(ctx, font, cell.name, r, { selected: cell.kind === 'extra', active: cell.kind === 'key', mark: null }, p)
      }
    })
  }, [cells, columns, font, height, p, side, w, h, width])

  return (
    <div ref={wrap} className="w-full">
      <canvas ref={canvas} style={{ width: width || '100%', height }} aria-label={members.join(' ')} />
    </div>
  )
}
