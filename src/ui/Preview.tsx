// Bottom preview: the dependency line of a group/glyph, or kerning pairs with
// editing (Font-Rover groups_control/dependency_preview.py + glyph_line).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { FontModel, SideId } from '../model/font'
import { resolveKernPair } from '../model/kerning'
import { pairStops, wrapWithContext, type ChainMode, type PreviewSubject, type PreviewToken } from '../model/preview'
import { pyRound } from '../model/pyround'
import { python } from '../runtime'
import type { Run } from './GroupsControl'
import { useDark } from './useDark'

export type PreviewInput =
  | { kind: 'line'; subject: Omit<PreviewSubject, 'mode'>; title: string }
  | { kind: 'pairs'; pairs: [string, string][]; title: string }
  | null

/** Key handler the pairs list forwards editing keys to; true when handled. */
export type PreviewKeys = (e: KeyboardEvent | React.KeyboardEvent) => boolean

type Props = {
  font: FontModel
  side: SideId
  input: PreviewInput
  run: Run
  readOnly: boolean
  keysRef: RefObject<PreviewKeys | null>
}

const PAD = 16
const KERN_ROW = 30
const MARGIN_ROW = 16

const COLORS = {
  light: { text: '#000000', bg: '#ffffff', mismatch: 'rgb(115,10,26)', mismatchLabel: 'rgb(230,38,38)', label: 'rgba(0,0,0,0.55)' },
  dark: { text: '#ffffff', bg: 'rgb(38,38,38)', mismatch: 'rgb(199,46,51)', mismatchLabel: 'rgb(255,179,179)', label: 'rgba(255,255,255,0.55)' },
}
const NON_MEMBER = 'rgb(64,128,230)'
const KERN_NEG = 'rgba(230,51,51,0.9)'
const KERN_POS = 'rgba(51,179,51,0.9)'
const SELECT = 'rgba(51,128,230,0.18)'

/** Bolt in a unit box, y down (glyph_line/kerning_markers.py). */
function bolt(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const pts = [[0.5, 0], [0, 0.625], [0.5, 0.625], [0.5, 1], [1, 0.375], [0.5, 0.375]]
  ctx.beginPath()
  pts.forEach(([px, py], i) => (i ? ctx.lineTo(x + px * w, y + py * h) : ctx.moveTo(x + px * w, y + py * h)))
  ctx.closePath()
  ctx.fill()
}

function arrow(ctx: CanvasRenderingContext2D, x: number, cy: number, w: number, h: number, left: boolean) {
  ctx.beginPath()
  if (left) {
    ctx.moveTo(x, cy)
    ctx.lineTo(x + w, cy - h / 2)
    ctx.lineTo(x + w, cy + h / 2)
  } else {
    ctx.moveTo(x + w, cy)
    ctx.lineTo(x, cy - h / 2)
    ctx.lineTo(x, cy + h / 2)
  }
  ctx.closePath()
  ctx.fill()
}

/** Marker width for an exception type at height h. */
function markerWidth(type: number, h: number) {
  const b = h * 0.55
  const a = h * 0.5
  const gap = h * 0.15
  return type === 3 ? 2 * b + gap : type ? a + gap + b : 0
}

function drawMarker(ctx: CanvasRenderingContext2D, type: number, x: number, cy: number, h: number) {
  const b = h * 0.55
  const a = h * 0.5
  const gap = h * 0.15
  const top = cy - h / 2
  if (type === 1) {
    arrow(ctx, x, cy, a, h * 0.6, true)
    bolt(ctx, x + a + gap, top, b, h)
  } else if (type === 2) {
    bolt(ctx, x, top, b, h)
    arrow(ctx, x + b + gap, cy, a, h * 0.6, false)
  } else if (type === 3) {
    bolt(ctx, x, top, b, h)
    bolt(ctx, x + b + gap, top, b, h)
  }
}

type Layout = {
  rows: PreviewToken[][]
  /** x of every token, per row. */
  xs: number[][]
  /** kerning after each token (font units), pairs mode only. */
  kerns: number[][]
  rowHeight: number
  ascent: number
  width: number
  height: number
  scale: number
}

export function Preview({ font, side, input, run, readOnly, keysRef }: Props) {
  const dark = useDark()
  const colors = dark ? COLORS.dark : COLORS.light
  const [mode, setMode] = useState<ChainMode>('smart')
  const [expanded, setExpanded] = useState(false)
  const [perRow, setPerRow] = useState(8)
  const [sizePt, setSizePt] = useState(40)
  const [showMargins, setShowMargins] = useState(true)
  const [showNames, setShowNames] = useState(false)
  const [tokens, setTokens] = useState<PreviewToken[]>([])
  const [pairRows, setPairRows] = useState<PreviewToken[][]>([])
  const [selection, setSelection] = useState<[number, number] | null>(null)
  const [selectedNames, setSelectedNames] = useState<[string, string] | null>(null)
  const [hint, setHint] = useState<string | null>(null)

  const scroller = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [view, setView] = useState({ w: 0, h: 0, left: 0, top: 0 })

  const pairsMode = input?.kind === 'pairs'
  const isExpanded = pairsMode && expanded && input.pairs.length === 1

  // -- data from the worker -------------------------------------------------------
  useEffect(() => {
    let stale = false
    if (!input) {
      setTokens([])
      setPairRows([])
      return
    }
    if (input.kind === 'line') {
      void python.call('previewLine', [{ ...input.subject, mode }]).then((t) => !stale && setTokens(t))
    } else {
      void python
        .call('previewPairs', [input.pairs, input.pairs.length === 1 && expanded, perRow])
        .then((r) => !stale && setPairRows(r))
    }
    return () => {
      stale = true
    }
  }, [font, input, mode, expanded, perRow])

  // A new subject drops the selection and the hint.
  const subjectKey = input ? JSON.stringify(input.kind === 'line' ? input.subject : input.pairs) : ''
  useEffect(() => {
    setSelection(null)
    setSelectedNames(null)
    setHint(null)
  }, [subjectKey])

  // -- layout -------------------------------------------------------------------------
  const layout = useMemo<Layout>(() => {
    const px = sizePt * 1.33
    const scale = px / font.info.unitsPerEm
    const adv = (name: string) => (font.glyph(name)?.w ?? 0) * scale
    const rows = pairsMode
      ? pairRows
      : wrapWithContext(tokens, adv, Math.max(50, view.w - 2 * PAD - 16))
    const xs: number[][] = []
    const kerns: number[][] = []
    let width = 0
    for (const row of rows) {
      let x = PAD
      const rx: number[] = []
      const rk: number[] = []
      row.forEach((t, i) => {
        rx.push(x)
        const next = row[i + 1]
        const k = pairsMode && next ? resolveKernPair(font.kerning, font.index, [t.n, next.n]).value ?? 0 : 0
        rk.push(k)
        x += adv(t.n) + k * scale
      })
      xs.push(rx)
      kerns.push(rk)
      width = Math.max(width, x + PAD)
    }
    const lineBox = px * 1.6
    const rowHeight = lineBox + (pairsMode ? KERN_ROW : 0) + (showMargins ? MARGIN_ROW + (pairsMode ? 11 : 0) : 0) + (showNames ? 14 : 0)
    return { rows, xs, kerns, rowHeight, ascent: lineBox * 0.7, width, height: rows.length * rowHeight + PAD, scale }
  }, [font, tokens, pairRows, pairsMode, sizePt, view.w, showMargins, showNames])

  const stops = useMemo(() => (pairsMode ? pairStops(layout.rows) : []), [layout.rows, pairsMode])

  // Keep the selected pair across edits (by glyph names), else take the first.
  useEffect(() => {
    if (!pairsMode || !stops.length) {
      if (selection) setSelection(null)
      return
    }
    const byName = selectedNames
      ? stops.find(([r, i]) => layout.rows[r][i].n === selectedNames[0] && layout.rows[r][i + 1].n === selectedNames[1])
      : undefined
    const next = byName ?? (selection && stops.some(([r, i]) => r === selection[0] && i === selection[1]) ? selection : stops[0])
    if (!selection || next[0] !== selection[0] || next[1] !== selection[1]) setSelection(next)
    const names: [string, string] = [layout.rows[next[0]][next[1]].n, layout.rows[next[0]][next[1] + 1].n]
    if (!selectedNames || names[0] !== selectedNames[0] || names[1] !== selectedNames[1]) setSelectedNames(names)
  }, [stops, layout.rows, pairsMode, selection, selectedNames])

  // -- painting -----------------------------------------------------------------------
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const update = () => setView({ w: el.clientWidth, h: el.clientHeight, left: el.scrollLeft, top: el.scrollTop })
    const observer = new ResizeObserver(update)
    observer.observe(el)
    update()
    return () => observer.disconnect()
  }, [])

  const paint = useCallback(() => {
    const cv = canvas.current
    if (!cv || !view.w || !view.h) return
    const dpr = window.devicePixelRatio || 1
    cv.width = Math.round(view.w * dpr)
    cv.height = Math.round(view.h * dpr)
    const ctx = cv.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = colors.bg
    ctx.fillRect(0, 0, view.w, view.h)
    ctx.translate(-view.left, -view.top)
    const { rows, xs, kerns, rowHeight, ascent, scale } = layout
    const firstRow = Math.max(0, Math.floor((view.top - PAD) / rowHeight))
    const lastRow = Math.min(rows.length - 1, Math.ceil((view.top + view.h) / rowHeight))
    ctx.font = '11px system-ui, sans-serif'
    for (let r = firstRow; r <= lastRow; r++) {
      const row = rows[r]
      const top = PAD / 2 + r * rowHeight
      const baseline = top + ascent

      if (selection && selection[0] === r) {
        const i = selection[1]
        const x0 = xs[r][i]
        const x1 = xs[r][i + 1] + (font.glyph(row[i + 1].n)?.w ?? 0) * scale
        ctx.fillStyle = SELECT
        ctx.fillRect(x0, top, x1 - x0, rowHeight - 4)
      }

      row.forEach((t, i) => {
        const g = font.glyph(t.n)
        if (!g) return
        const x = xs[r][i]
        ctx.save()
        ctx.globalAlpha = t.ctx ? 0.3 : 1
        ctx.fillStyle = t.ctx ? colors.text : t.x ? colors.mismatch : !pairsMode && !t.m ? NON_MEMBER : colors.text
        ctx.translate(x, baseline)
        ctx.scale(scale, -scale)
        ctx.fill(font.outlines.get(t.n))
        ctx.restore()
      })

      let y = top + ascent / 0.7 + 12
      if (showMargins) {
        ctx.textBaseline = 'alphabetic'
        // Labels of tightly kerned neighbours would run together ("7233"):
        // one that overlaps the previous label drops to a second line.
        let lastEnd = -Infinity
        const label = (text: string, x: number, align: 'left' | 'right') => {
          const w = ctx.measureText(text).width
          const start = align === 'left' ? x : x - w
          const dy = start < lastEnd + 3 ? 11 : 0
          ctx.textAlign = align
          ctx.fillText(text, x, y + dy)
          if (!dy) lastEnd = start + w
        }
        row.forEach((t, i) => {
          if (t.ctx) return
          const g = font.glyph(t.n)
          if (!g) return
          const x = xs[r][i]
          const right = x + g.w * scale
          const showLeft = pairsMode || side === 'kern2'
          const showRight = pairsMode || side === 'kern1'
          if (showLeft) {
            const m = pairsMode ? g.l : t.g ?? null
            if (m !== null) {
              ctx.fillStyle = !pairsMode && t.x ? colors.mismatchLabel : colors.label
              label(String(pyRound(m)), x + 1, 'left')
            }
          }
          if (showRight) {
            const m = pairsMode ? g.r : t.g ?? null
            if (m !== null) {
              ctx.fillStyle = !pairsMode && t.x ? colors.mismatchLabel : colors.label
              label(String(pyRound(m)), right - 1, 'right')
            }
          }
        })
        y += MARGIN_ROW + (pairsMode ? 11 : 0)
      }
      if (showNames) {
        ctx.fillStyle = colors.label
        ctx.textAlign = 'center'
        row.forEach((t, i) => {
          if (t.ctx) return
          const g = font.glyph(t.n)
          if (g) ctx.fillText(t.n, xs[r][i] + (g.w * scale) / 2, y)
        })
        y += 14
      }
      if (pairsMode) {
        // Kerning bars, values and exception markers (glyph_line/view.py).
        const barBottom = y + 2
        row.forEach((t, i) => {
          const k = kerns[r][i]
          if (!k || i + 1 >= row.length) return
          const g = font.glyph(t.n)
          if (!g) return
          const end = xs[r][i] + g.w * scale
          const w = Math.max(4, Math.abs(k) * scale)
          const bx = k < 0 ? end - w : end
          const color = k < 0 ? KERN_NEG : KERN_POS
          ctx.fillStyle = color
          ctx.fillRect(bx, barBottom - 4, w, 4)
          const info = resolveKernPair(font.kerning, font.index, [t.n, row[i + 1].n])
          const type = info.isException ? font.exceptionType(info.left, info.right).type : 0
          const text = Number.isInteger(k) ? String(k) : k.toFixed(1)
          ctx.font = '9px system-ui, sans-serif'
          const tw = ctx.measureText(text).width
          const mw = markerWidth(type, 10)
          const total = mw + (mw ? 3 : 0) + tw
          const cx = bx + w / 2
          const ty = barBottom + 12
          if (type) drawMarker(ctx, type, cx - total / 2, ty - 9 * 0.45, 10)
          ctx.textAlign = 'left'
          ctx.fillText(text, cx - total / 2 + mw + (mw ? 3 : 0), ty)
          ctx.font = '11px system-ui, sans-serif'
        })
      }
    }
  }, [view, layout, colors, font, pairsMode, selection, showMargins, showNames, side])

  useEffect(() => {
    const id = requestAnimationFrame(paint)
    return () => cancelAnimationFrame(id)
  }, [paint])

  // -- editing --------------------------------------------------------------------------
  const selectedPair = (): [string, string] | null => {
    if (!selection) return null
    const row = layout.rows[selection[0]]
    return row ? [row[selection[1]].n, row[selection[1] + 1].n] : null
  }

  const moveSelection = (dir: 1 | -1) => {
    if (!stops.length) return
    const at = selection ? stops.findIndex(([r, i]) => r === selection[0] && i === selection[1]) : -1
    const next = stops[Math.max(0, Math.min(stops.length - 1, at + dir))]
    setSelection(next)
    setSelectedNames([layout.rows[next[0]][next[1]].n, layout.rows[next[0]][next[1] + 1].n])
  }

  const keys: PreviewKeys = (e) => {
    if (!pairsMode) return false
    const pair = selectedPair()
    const code = e.code
    if (code === 'KeyZ' && !e.ctrlKey && !e.metaKey) return moveSelection(-1), true
    if (code === 'KeyX' && !e.ctrlKey && !e.metaKey) return moveSelection(1), true
    if (code === 'Escape') return setSelection(null), true
    if (!pair || readOnly) return false
    if (code === 'ArrowLeft' || code === 'ArrowRight') {
      const step = e.altKey ? 1 : e.shiftKey ? 5 : 10
      const delta = code === 'ArrowLeft' ? -step : step
      setHint(null)
      void run(() => python.call('kernNudge', [pair[0], pair[1], delta]))
      return true
    }
    if (code === 'Backspace' || code === 'Delete') {
      void run(() => python.call('kernRemove', [pair[0], pair[1]]))
      return true
    }
    if (code === 'KeyE' && !e.metaKey) {
      setHint('Exceptions: switch Expand on and select a glyph pair')
      return true
    }
    return false
  }

  // Exceptions report "already applies" as a hint instead of an error dialog.
  const exception = async (pair: [string, string], which: 'left' | 'right' | 'both') => {
    try {
      const res = await python.call('kernException', [pair[0], pair[1], which])
      await run(async () => res)
      setHint(null)
    } catch (err) {
      setHint(err instanceof Error ? err.message : String(err))
    }
  }
  const keysWithException: PreviewKeys = (e) => {
    if (pairsMode && e.code === 'KeyE' && !e.metaKey && isExpanded && !readOnly) {
      const pair = selectedPair()
      if (!pair) return false
      const own = side === 'kern1' ? 'left' : 'right'
      const other = side === 'kern1' ? 'right' : 'left'
      void exception(pair, e.altKey ? 'both' : e.ctrlKey ? other : own)
      return true
    }
    return keys(e)
  }
  keysRef.current = keysWithException

  // Ctrl/Cmd+wheel zoom ×1.1 per step, 24–300 (MW:622-666). A native,
  // non-passive listener: React's wheel handler cannot preventDefault.
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      setSizePt((s) => {
        const next = e.deltaY < 0 ? Math.max(s + 1, Math.round(s * 1.1)) : Math.min(s - 1, Math.round(s / 1.1))
        return Math.max(24, Math.min(300, next))
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // -- info line ----------------------------------------------------------------------
  const info = useMemo(() => {
    if (!input) return 'Select a group, a glyph or kerning pairs'
    if (input.kind === 'pairs') {
      const n = stops.length
      return (
        `${input.title ? input.title + ' · ' : ''}${n} ${isExpanded ? 'glyph pairs' : `pair${n === 1 ? '' : 's'}`}` +
        ' · arrows: kerning, Backspace: remove' +
        (isExpanded ? ' · E: exception (Alt: glyph–glyph, Ctrl: other side)' : '')
      )
    }
    const extra = tokens.filter((t) => !t.m).length
    const differ = tokens.filter((t) => t.x).length
    const angled = font.info.italicAngle ? ' (angled)' : ''
    return (
      `${input.title} · ${tokens.length - extra} glyph${tokens.length - extra === 1 ? '' : 's'}` +
      (extra ? ` (+${extra} composites/parents)` : '') +
      ` · checking the ${side === 'kern1' ? 'right' : 'left'} side${angled}` +
      (differ ? ` · ${differ} differ${differ === 1 ? 's' : ''} from the key glyph` : '')
    )
  }, [input, tokens, stops, isExpanded, side, font])

  const onClick = (e: React.MouseEvent) => {
    if (!pairsMode || !stops.length) return
    const el = scroller.current!
    const box = el.getBoundingClientRect()
    const x = e.clientX - box.left + el.scrollLeft
    const y = e.clientY - box.top + el.scrollTop
    const r = Math.max(0, Math.min(layout.rows.length - 1, Math.floor((y - PAD / 2) / layout.rowHeight)))
    const inRow = stops.filter(([sr]) => sr === r)
    if (!inRow.length) return
    const best = inRow.reduce((a, b) => (Math.abs(layout.xs[r][b[1] + 1] - x) < Math.abs(layout.xs[r][a[1] + 1] - x) ? b : a))
    setSelection(best)
    setSelectedNames([layout.rows[r][best[1]].n, layout.rows[r][best[1] + 1].n])
    el.focus()
  }

  const control = 'rounded-md border border-zinc-300 bg-white px-1.5 py-0.5 text-xs dark:border-zinc-700 dark:bg-zinc-900'

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-2 px-2 text-xs">
        {pairsMode ? (
          <>
            <label className={`flex items-center gap-1 ${input.pairs.length === 1 ? '' : 'opacity-40'}`}>
              <input type="checkbox" checked={expanded} disabled={input.pairs.length !== 1} onChange={(e) => setExpanded(e.target.checked)} />
              Expand
            </label>
            <label className="flex items-center gap-1">
              Pairs per line
              <input
                type="number"
                min={1}
                max={50}
                className={`${control} w-14`}
                value={perRow}
                onChange={(e) => setPerRow(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
              />
            </label>
          </>
        ) : (
          <select className={control} value={mode} onChange={(e) => setMode(e.target.value as ChainMode)} aria-label="Chain">
            <option value="members">Members</option>
            <option value="all">All</option>
            <option value="smart">Smart</option>
          </select>
        )}
        <label className="flex items-center gap-1">
          Size
          <input
            type="number"
            min={12}
            max={300}
            step={4}
            className={`${control} w-16`}
            value={sizePt}
            onChange={(e) => setSizePt(Math.max(12, Math.min(300, Number(e.target.value) || 40)))}
          />
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={showMargins} onChange={(e) => setShowMargins(e.target.checked)} />
          Margins
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={showNames} onChange={(e) => setShowNames(e.target.checked)} />
          Names
        </label>
        <span className="min-w-0 flex-1 truncate text-right text-zinc-500" title={info}>
          {hint ? <span className="text-amber-600 dark:text-amber-400">{hint}</span> : info}
        </span>
      </div>
      <div className="relative min-h-0 flex-1">
      <canvas ref={canvas} className="pointer-events-none absolute left-0 top-0 block" style={{ width: view.w, height: view.h }} />
      <div
        ref={scroller}
        tabIndex={0}
        aria-label="Preview"
        className="absolute inset-0 overflow-auto outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500/50"
        onScroll={(e) => {
          const el = e.currentTarget
          setView((v) => ({ ...v, left: el.scrollLeft, top: el.scrollTop }))
        }}
        onClick={onClick}
        onKeyDown={(e) => {
          if (keysWithException(e)) e.preventDefault()
        }}
      >
        <div style={{ width: layout.width, height: layout.height }} />
      </div>
      </div>
    </div>
  )
}
