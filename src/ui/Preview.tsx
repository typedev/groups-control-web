// Bottom preview: the dependency line of a group/glyph, or kerning pairs with
// editing (Font-Rover groups_control/dependency_preview.py + glyph_line).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { FontModel, SideId } from '../model/font'
import { resolveKernPair } from '../model/kerning'
import { staggerLabels } from '../model/labels'
import { pairStops, wrapWithContext, type ChainMode, type PreviewSubject, type PreviewToken } from '../model/preview'
import { pyRound } from '../model/pyround'
import { sameMargin } from '../model/font'
import { python } from '../runtime'
import type { Run } from './GroupsControl'
import { useDark } from './useDark'
import { usePalette, withAlpha } from './palette'
import { Check, HelpButton, Segmented, TextInput } from './controls'

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
  /** Beam height in font units, null when the beam is off. */
  beamY: number | null
  onToggleBeam: () => void
  onMoveBeam: (y: number) => void
  onHelp: () => void
}

const PAD = 16
/** Room left of the text for the beam's handle and height (glyph_line/view.py). */
const BEAM_GUTTER = 38
const FAMILY = '"IBM Plex Sans Variable", system-ui, sans-serif'

/** Height of one line of glyph names, and the space kept between two names. */
const NAME_ROW = 14
const NAME_GAP = 6

let labelCtx: CanvasRenderingContext2D | null = null
/** Width of a name label as drawn (11 px), for laying the names out. */
function measureLabel(text: string): number {
  labelCtx ??= document.createElement('canvas').getContext('2d')
  if (!labelCtx) return text.length * 6
  labelCtx.font = `11px ${FAMILY}`
  return labelCtx.measureText(text).width
}
const KERN_ROW = 30
/** Two label lines: right margin, then left margin. */
const MARGIN_ROW = 26

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
  /** Name label line (0 upper, 1 lower) of every token, per row; -1 = no label. */
  nameLines: number[][]
  ascent: number
  width: number
  height: number
  scale: number
}

export function Preview({ font, side, input, run, readOnly, keysRef, beamY, onToggleBeam, onMoveBeam, onHelp }: Props) {
  const dark = useDark()
  const p = usePalette()
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
  /** Dependency line: the selected glyph (margin editing). */
  const [glyphSel, setGlyphSel] = useState<{ row: number; index: number; name: string } | null>(null)
  /** Alt+B: mark the beam's crossings and the stem / counter widths between them. */
  const [beamInner, setBeamInner] = useState(false)
  const beamDrag = useRef<{ clientY: number; y: number; moved: boolean } | null>(null)
  const margins = showMargins || beamY !== null

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
    setGlyphSel(null)
    setHint(null)
  }, [subjectKey])

  // With the beam on, the dependency line measures along it (dependencies.py
  // dependency_glyphs with beam_y): a glyph the beam misses is never a mismatch.
  const lineTokens = useMemo(() => {
    if (beamY === null || input?.kind !== 'line') return tokens
    const key = input.subject.key
    const keyMargin = key ? font.sideMargin(key, side, beamY) : null
    return tokens.map((t) => {
      const g = font.sideMargin(t.n, side, beamY)
      const x = keyMargin !== null && g !== null && !sameMargin(g, keyMargin)
      return { ...t, g: g ?? undefined, x: x ? (true as const) : undefined }
    })
  }, [tokens, beamY, input, font, side])

  // -- layout -------------------------------------------------------------------------
  const layout = useMemo<Layout>(() => {
    const px = sizePt * 1.33
    const scale = px / font.info.unitsPerEm
    const left = PAD + (beamY !== null ? BEAM_GUTTER : 0)
    const adv = (name: string) => (font.glyph(name)?.w ?? 0) * scale
    const rows = pairsMode
      ? pairRows
      : wrapWithContext(lineTokens, adv, Math.max(50, view.w - 2 * PAD - 16 - left))
    const xs: number[][] = []
    const kerns: number[][] = []
    let width = 0
    for (const row of rows) {
      let x = left
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
    // Names: a label goes on the upper line unless it would run into the
    // previous one there, then on the lower; a second line only when needed.
    const nameLines = rows.map((row, r) => {
      if (!showNames) return row.map(() => -1)
      return staggerLabels(
        row.map((t, i) => {
          const g = font.glyph(t.n)
          return t.ctx || !g ? null : { center: xs[r][i] + (g.w * scale) / 2, width: measureLabel(t.n) }
        }),
        NAME_GAP,
      )
    })
    const nameRows = !showNames ? 0 : nameLines.some((row) => row.includes(1)) ? 2 : 1
    const lineBox = px * 1.6
    const rowHeight = lineBox + (pairsMode ? KERN_ROW : 0) + (margins ? MARGIN_ROW : 0) + nameRows * NAME_ROW
    return { rows, xs, kerns, rowHeight, nameLines, ascent: lineBox * 0.7, width, height: rows.length * rowHeight + PAD, scale }
  }, [font, lineTokens, pairRows, pairsMode, sizePt, view.w, margins, showNames, beamY])

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

  // The selected glyph survives edits and re-wrapping (found again by name).
  useEffect(() => {
    if (!glyphSel || pairsMode) return
    if (layout.rows[glyphSel.row]?.[glyphSel.index]?.n === glyphSel.name) return
    for (let r = 0; r < layout.rows.length; r++) {
      const i = layout.rows[r].findIndex((t) => t.n === glyphSel.name)
      if (i >= 0) return setGlyphSel({ row: r, index: i, name: glyphSel.name })
    }
    setGlyphSel(null)
  }, [layout.rows, glyphSel, pairsMode])

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
    ctx.fillStyle = p.surface
    ctx.fillRect(0, 0, view.w, view.h)
    ctx.translate(-view.left, -view.top)
    const { rows, xs, kerns, rowHeight, ascent, scale } = layout
    const firstRow = Math.max(0, Math.floor((view.top - PAD) / rowHeight))
    const lastRow = Math.min(rows.length - 1, Math.ceil((view.top + view.h) / rowHeight))
    ctx.font = `11px ${FAMILY}`
    for (let r = firstRow; r <= lastRow; r++) {
      const row = rows[r]
      const top = PAD / 2 + r * rowHeight
      const baseline = top + ascent

      if (selection && selection[0] === r) {
        const i = selection[1]
        const x0 = xs[r][i]
        const x1 = xs[r][i + 1] + (font.glyph(row[i + 1].n)?.w ?? 0) * scale
        ctx.fillStyle = withAlpha(p.accent, dark ? 0.2 : 0.13)
        ctx.fillRect(x0, top, x1 - x0, rowHeight - 4)
      }

      if (!pairsMode && glyphSel && glyphSel.row === r) {
        const g = font.glyph(row[glyphSel.index]?.n)
        if (g) {
          ctx.fillStyle = withAlpha(p.accent, dark ? 0.2 : 0.13)
          ctx.fillRect(xs[r][glyphSel.index], top, g.w * scale, rowHeight - 4)
        }
      }

      row.forEach((t, i) => {
        const g = font.glyph(t.n)
        if (!g) return
        const x = xs[r][i]
        ctx.save()
        ctx.globalAlpha = t.ctx ? 0.3 : 1
        ctx.fillStyle = t.ctx ? p.glyph : t.x ? p.errorGlyph : !pairsMode && !t.m ? p.accent : p.glyph
        ctx.translate(x, baseline)
        ctx.scale(scale, -scale)
        ctx.fill(font.outlines.get(t.n))
        ctx.restore()
      })

      if (beamY !== null) {
        const lineY = baseline - beamY * scale
        if (beamInner) {
          // Crossings and the spans between them, labels alternating above / below.
          ctx.fillStyle = p.beam
          ctx.font = `9px ${FAMILY}`
          ctx.textAlign = 'center'
          row.forEach((t, i) => {
            if (t.ctx) return
            const xsBeam = font.beamCrossings(t.n, beamY)
            const gx = xs[r][i]
            for (const cx of xsBeam) {
              ctx.beginPath()
              ctx.arc(gx + cx * scale, lineY, 2.5, 0, Math.PI * 2)
              ctx.fill()
            }
            for (let k = 0; k + 1 < xsBeam.length; k++) {
              const len = xsBeam[k + 1] - xsBeam[k]
              const text = Number.isInteger(Math.round(len * 10) / 10) ? String(Math.round(len)) : (Math.round(len * 10) / 10).toString()
              ctx.textBaseline = k % 2 === 0 ? 'bottom' : 'top'
              ctx.fillText(text, gx + ((xsBeam[k] + xsBeam[k + 1]) / 2) * scale, k % 2 === 0 ? lineY - 3 : lineY + 3)
            }
          })
        }
        // A dashed line across the row, a drag handle and the height at the left.
        ctx.save()
        ctx.strokeStyle = p.beam
        ctx.lineWidth = 1
        ctx.setLineDash([3, 3])
        ctx.beginPath()
        ctx.moveTo(0, Math.round(lineY) + 0.5)
        ctx.lineTo(Math.max(layout.width, view.w + view.left), Math.round(lineY) + 0.5)
        ctx.stroke()
        ctx.setLineDash([])
        const hx = 2 + view.left
        const hy = lineY - 9
        ctx.fillStyle = p.beam
        ctx.beginPath()
        ctx.roundRect(hx, hy, 12, 18, 3)
        ctx.fill()
        ctx.fillStyle = p.surface
        for (const [tip, base] of [[hy + 3, hy + 7], [hy + 15, hy + 11]]) {
          ctx.beginPath()
          ctx.moveTo(hx + 6, tip)
          ctx.lineTo(hx + 9.5, base)
          ctx.lineTo(hx + 2.5, base)
          ctx.closePath()
          ctx.fill()
        }
        ctx.fillStyle = p.beam
        ctx.font = `9px ${FAMILY}`
        ctx.textAlign = 'left'
        ctx.textBaseline = 'alphabetic'
        ctx.fillText(String(beamY), hx + 15, lineY - 3)
        ctx.restore()
      }

      let y = top + ascent / 0.7 + 11
      if (margins) {
        // glyph_line/view.py _draw_margins: right margin "72 ▶" at the right
        // edge, left margin "◀ 33" one line lower at the left edge (9 px).
        const size = 9
        const tri = 3
        const gap = 2
        ctx.font = `${size}px ${FAMILY}`
        ctx.textBaseline = 'alphabetic'
        const triangle = (x: number, cy: number, right: boolean) => {
          ctx.beginPath()
          ctx.moveTo(x, cy - tri)
          ctx.lineTo(right ? x + tri * 1.5 : x - tri * 1.5, cy)
          ctx.lineTo(x, cy + tri)
          ctx.closePath()
          ctx.fill()
        }
        row.forEach((t, i) => {
          const selected = !pairsMode && glyphSel?.row === r && glyphSel.index === i
          if (t.ctx && !selected) return
          const g = font.glyph(t.n)
          if (!g) return
          const x = xs[r][i]
          const right = x + g.w * scale
          const both = pairsMode || selected
          // Along the beam when it is on, in its colour; "–" where it misses.
          const onBeam = beamY !== null
          const beamM = onBeam && both ? font.beamMargins(t.n, beamY) : null
          const leftM = both ? (onBeam ? beamM?.[0] ?? null : g.l) : t.g ?? null
          const rightM = both ? (onBeam ? beamM?.[1] ?? null : g.r) : t.g ?? null
          ctx.fillStyle = !pairsMode && t.x ? p.error : onBeam ? p.beam : p.label
          const text = (m: number | null) => (m === null ? '–' : String(pyRound(m)))
          if (both || side === 'kern1') {
            if (rightM !== null || onBeam) {
              triangle(right - tri, y - size / 3, true)
              ctx.textAlign = 'right'
              ctx.fillText(text(rightM), right - tri * 1.5 - gap, y)
            }
          }
          if (both || side === 'kern2') {
            if (leftM !== null || onBeam) {
              const ly = y + size + 3
              triangle(x + tri, ly - size / 3, false)
              ctx.textAlign = 'left'
              ctx.fillText(text(leftM), x + tri * 1.5 + gap, ly)
            }
          }
        })
        ctx.font = `11px ${FAMILY}`
        y += MARGIN_ROW
      }
      if (showNames) {
        ctx.fillStyle = p.label
        ctx.textAlign = 'center'
        const lines = layout.nameLines[r]
        row.forEach((t, i) => {
          const g = font.glyph(t.n)
          if (lines[i] < 0 || !g) return
          ctx.fillText(t.n, xs[r][i] + (g.w * scale) / 2, y + lines[i] * NAME_ROW)
        })
        y += (layout.nameLines.some((l) => l.includes(1)) ? 2 : 1) * NAME_ROW
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
          const color = k < 0 ? p.negative : p.positive
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
          ctx.font = `11px ${FAMILY}`
        })
      }
    }
  }, [view, layout, p, font, pairsMode, selection, glyphSel, margins, showNames, side, dark, beamY, beamInner])

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
    // Beam (glyph_line keymap): B toggles, Alt+B marks stems, Alt+Up/Down move ±1 (Shift ±100).
    if (e.code === 'KeyB' && !e.ctrlKey && !e.metaKey) {
      if (e.altKey) setBeamInner((v) => !v)
      else onToggleBeam()
      return true
    }
    if (e.altKey && (e.code === 'ArrowUp' || e.code === 'ArrowDown') && beamY !== null) {
      const step = e.shiftKey ? 100 : 1
      onMoveBeam(beamY + (e.code === 'ArrowUp' ? step : -step))
      return true
    }
    if (!pairsMode) {
      // glyph_line/keys.py MARGIN_ACTIONS: arrows = right margin, Alt = left, Shift ×10.
      if (e.code === 'Escape') return setGlyphSel(null), true
      if (!glyphSel || readOnly || (e.code !== 'ArrowLeft' && e.code !== 'ArrowRight')) return false
      const step = e.shiftKey ? 10 : 1
      const delta = e.code === 'ArrowLeft' ? -step : step
      void run(() => python.call('marginNudge', [glyphSel.name, e.altKey ? 'left' : 'right', delta]))
      return true
    }
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
    if (glyphSel) {
      const g = font.glyph(glyphSel.name)
      return `${glyphSel.name} · L ${g?.l === null || !g ? '–' : pyRound(g.l)} R ${g?.r === null || !g ? '–' : pyRound(g.r)} W ${g ? pyRound(g.w) : '–'} · arrows: right margin, Alt: left margin, Shift: ×10 · Esc: deselect`
    }
    const extra = lineTokens.filter((t) => !t.m).length
    const differ = lineTokens.filter((t) => t.x).length
    const angled =
      (font.info.italicAngle ? ' (angled' : '') +
      (beamY !== null ? `${font.info.italicAngle ? ', ' : ' ('}along the beam at ${beamY})` : font.info.italicAngle ? ')' : '')
    return (
      `${input.title} · ${lineTokens.length - extra} glyph${lineTokens.length - extra === 1 ? '' : 's'}` +
      (extra ? ` (+${extra} composites/parents)` : '') +
      ` · checking the ${side === 'kern1' ? 'right' : 'left'} side${angled}` +
      (differ ? ` · ${differ} differ${differ === 1 ? 's' : ''} from the key glyph` : '')
    )
  }, [input, lineTokens, stops, isExpanded, side, font, glyphSel, beamY])

  const onClick = (e: React.MouseEvent) => {
    if (beamDrag.current?.moved) {
      beamDrag.current = null
      return
    }
    beamDrag.current = null
    const el = scroller.current!
    const box = el.getBoundingClientRect()
    const x = e.clientX - box.left + el.scrollLeft
    const y = e.clientY - box.top + el.scrollTop
    const r = Math.max(0, Math.min(layout.rows.length - 1, Math.floor((y - PAD / 2) / layout.rowHeight)))
    if (!pairsMode) {
      const row = layout.rows[r]
      if (!row) return
      const i = row.findIndex((t, k) => {
        const w = (font.glyph(t.n)?.w ?? 0) * layout.scale
        return x >= layout.xs[r][k] && x < layout.xs[r][k] + w
      })
      setGlyphSel(i >= 0 ? { row: r, index: i, name: row[i].n } : null)
      el.focus()
      return
    }
    if (!stops.length) return
    const inRow = stops.filter(([sr]) => sr === r)
    if (!inRow.length) return
    const best = inRow.reduce((a, b) => (Math.abs(layout.xs[r][b[1] + 1] - x) < Math.abs(layout.xs[r][a[1] + 1] - x) ? b : a))
    setSelection(best)
    setSelectedNames([layout.rows[r][best[1]].n, layout.rows[r][best[1] + 1].n])
    el.focus()
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-2.5 py-2">
        <span className="text-[13px] font-semibold">Preview</span>
        {pairsMode ? (
          <>
            <Check
              label="Expand"
              title="All left glyphs × all right glyphs of one pair"
              checked={expanded}
              disabled={input.pairs.length !== 1}
              onChange={(e) => setExpanded(e.target.checked)}
            />
            <label className="inline-flex items-center gap-1.5 text-[13px]">
              Pairs per line
              <TextInput
                type="number"
                min={1}
                max={50}
                className="w-16"
                value={perRow}
                onChange={(e) => setPerRow(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
              />
            </label>
          </>
        ) : (
          <Segmented<ChainMode>
            label="Chain"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'members', label: 'Members', title: 'Only the group members' },
              { value: 'all', label: 'All', title: 'Members, their base glyphs and every composite' },
              { value: 'smart', label: 'Smart', title: 'Composites that take their side from these glyphs' },
            ]}
          />
        )}
        <label className="inline-flex items-center gap-1.5 text-[13px]">
          Size
          <TextInput
            type="number"
            min={12}
            max={300}
            step={4}
            className="w-16"
            value={sizePt}
            onChange={(e) => setSizePt(Math.max(12, Math.min(300, Number(e.target.value) || 40)))}
          />
        </label>
        <Check label="Margins" checked={margins} disabled={beamY !== null} onChange={(e) => setShowMargins(e.target.checked)} />
        <Check
          label="Beam"
          title="Measure margins along a horizontal line (B; Alt+↑/↓ moves it, Shift ×100; drag the handle)"
          checked={beamY !== null}
          onChange={onToggleBeam}
        />
        {beamY !== null && (
          <>
            <TextInput
              type="number"
              aria-label="Beam height"
              className="w-20"
              value={beamY}
              onChange={(e) => e.target.value !== '' && onMoveBeam(Number(e.target.value))}
            />
            <Check label="Stems" title="Mark the crossings and the stem / counter widths (Alt+B)" checked={beamInner} onChange={(e) => setBeamInner(e.target.checked)} />
          </>
        )}
        <Check label="Names" checked={showNames} onChange={(e) => setShowNames(e.target.checked)} />
        <span className="min-w-0 flex-1 truncate text-right text-xs text-muted" title={hint ?? info}>
          {hint ? <span className="font-medium text-careful">{hint}</span> : info}
        </span>
        <HelpButton label="Help: Preview, keys" onClick={onHelp} />
      </div>
      <div className="relative min-h-0 flex-1">
      <canvas ref={canvas} className="pointer-events-none absolute left-0 top-0 block" style={{ width: view.w, height: view.h }} />
      <div
        ref={scroller}
        tabIndex={0}
        aria-label="Preview"
        className="absolute inset-0 overflow-auto outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/50"
        onScroll={(e) => {
          const el = e.currentTarget
          setView((v) => ({ ...v, left: el.scrollLeft, top: el.scrollTop }))
        }}
        onClick={onClick}
        onPointerDown={(e) => {
          if (beamY === null || e.button !== 0) return
          const el = scroller.current!
          const box = el.getBoundingClientRect()
          const x = e.clientX - box.left + el.scrollLeft
          const y = e.clientY - box.top + el.scrollTop
          const r = Math.max(0, Math.floor((y - PAD / 2) / layout.rowHeight))
          const lineY = PAD / 2 + r * layout.rowHeight + layout.ascent - beamY * layout.scale
          const onHandle = x - el.scrollLeft < 2 + 12 + 4 && Math.abs(y - lineY) <= 12
          if (!onHandle && Math.abs(y - lineY) > 4) return
          e.currentTarget.setPointerCapture(e.pointerId)
          beamDrag.current = { clientY: e.clientY, y: beamY, moved: false }
        }}
        onPointerMove={(e) => {
          const drag = beamDrag.current
          if (!drag || !e.currentTarget.hasPointerCapture(e.pointerId)) return
          const dy = drag.clientY - e.clientY
          if (Math.abs(dy) > 1) drag.moved = true
          if (drag.moved) onMoveBeam(drag.y + dy / layout.scale)
        }}
        onPointerUp={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
        }}
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
