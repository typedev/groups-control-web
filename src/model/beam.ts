// The beam: margins measured where a horizontal line at height y crosses the
// outline. A drawing-only port of Font-Rover utils/beam.py and
// utils/outline_intersections.py (same maths, same tolerances), so the web
// view and the desktop agree; parity-tested against the Python original.
import type { GlyphRecord } from './types'

const EPSILON = 1e-9
const CROSSING_MERGE_TOLERANCE = 1e-6
const TOUCH_NUDGE = 1e-3
const MAX_COMPONENT_DEPTH = 10

type Pt = [number, number]
export type Segment = { type: 'line' | 'curve' | 'qcurve'; points: Pt[] }
type Matrix = [number, number, number, number, number, number]

const apply = (m: Matrix, x: number, y: number): Pt => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
const multiply = (a: Matrix, b: Matrix): Matrix => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
]
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]

/** SegmentPen: the outline as segments, components decomposed, contours closed. */
export function outlineSegments(glyphs: Record<string, GlyphRecord>, name: string, m: Matrix = IDENTITY, depth = 0): Segment[] {
  const glyph = glyphs[name]
  if (!glyph) return []
  const out: Segment[] = []
  let start: Pt | null = null
  let current: Pt | null = null
  for (const cmd of glyph.p) {
    switch (cmd[0]) {
      case 'M':
        start = current = apply(m, cmd[1], cmd[2])
        break
      case 'L': {
        const p = apply(m, cmd[1], cmd[2])
        if (current) out.push({ type: 'line', points: [current, p] })
        current = p
        break
      }
      case 'C': {
        const p1 = apply(m, cmd[1], cmd[2])
        const p2 = apply(m, cmd[3], cmd[4])
        const p3 = apply(m, cmd[5], cmd[6])
        if (current) out.push({ type: 'curve', points: [current, p1, p2, p3] })
        current = p3
        break
      }
      case 'Q': {
        const p1 = apply(m, cmd[1], cmd[2])
        const p2 = apply(m, cmd[3], cmd[4])
        if (current) out.push({ type: 'qcurve', points: [current, p1, p2] })
        current = p2
        break
      }
      case 'Z':
        if (start && current && (current[0] !== start[0] || current[1] !== start[1])) {
          out.push({ type: 'line', points: [current, start] })
        }
        start = current = null
        break
      case 'c':
        if (depth < MAX_COMPONENT_DEPTH) out.push(...outlineSegments(glyphs, cmd[1], multiply(m, cmd[2]), depth + 1))
        break
    }
  }
  return out
}

function solveQuadratic(a: number, b: number, c: number): number[] {
  if (Math.abs(a) < EPSILON) {
    if (Math.abs(b) < EPSILON) return []
    return [-c / b]
  }
  const disc = b * b - 4 * a * c
  if (disc < -EPSILON) return []
  if (disc < EPSILON) return [-b / (2 * a)]
  const s = Math.sqrt(disc)
  return [(-b + s) / (2 * a), (-b - s) / (2 * a)]
}

const cbrt = (x: number) => (x >= 0 ? x ** (1 / 3) : -((-x) ** (1 / 3)))

/** Cardano, exactly as _solve_cubic. */
function solveCubic(a: number, b: number, c: number, d: number): number[] {
  if (Math.abs(a) < EPSILON) return solveQuadratic(b, c, d)
  const p = b / a
  const q = c / a
  const r = d / a
  const pn = q - (p * p) / 3
  const qn = (2 * p * p * p) / 27 - (p * q) / 3 + r
  const disc = (qn * qn) / 4 + (pn * pn * pn) / 27
  if (disc > EPSILON) {
    const s = Math.sqrt(disc)
    return [cbrt(-qn / 2 + s) + cbrt(-qn / 2 - s) - p / 3]
  }
  if (disc < -EPSILON) {
    const mm = 2 * Math.sqrt(-pn / 3)
    const theta = Math.acos((3 * qn) / (pn * mm)) / 3
    return [
      mm * Math.cos(theta) - p / 3,
      mm * Math.cos(theta - (2 * Math.PI) / 3) - p / 3,
      mm * Math.cos(theta - (4 * Math.PI) / 3) - p / 3,
    ]
  }
  if (Math.abs(qn) < EPSILON) return [-p / 3]
  const u = cbrt(-qn / 2)
  return [2 * u - p / 3, -u - p / 3]
}

const inRange = (t: number) => t >= -EPSILON && t <= 1 + EPSILON
const clamp01 = (t: number) => Math.max(0, Math.min(1, t))

function segmentCrossings(seg: Segment, y: number): number[] {
  const pts = seg.points
  if (seg.type === 'line') {
    const [[x0, y0], [x1, y1]] = pts
    if ((y0 - EPSILON <= y && y <= y1 + EPSILON) || (y1 - EPSILON <= y && y <= y0 + EPSILON)) {
      if (Math.abs(y1 - y0) < EPSILON) return []
      const t = (y - y0) / (y1 - y0)
      if (inRange(t)) return [x0 + t * (x1 - x0)]
    }
    return []
  }
  if (seg.type === 'qcurve') {
    const [[x0, y0], [x1, y1], [x2, y2]] = pts
    return solveQuadratic(y0 - 2 * y1 + y2, -2 * y0 + 2 * y1, y0 - y)
      .filter(inRange)
      .map((t) => {
        t = clamp01(t)
        const mt = 1 - t
        return mt * mt * x0 + 2 * mt * t * x1 + t * t * x2
      })
  }
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = pts
  return solveCubic(-y0 + 3 * y1 - 3 * y2 + y3, 3 * y0 - 6 * y1 + 3 * y2, -3 * y0 + 3 * y1, y0 - y)
    .filter(inRange)
    .map((t) => {
      t = clamp01(t)
      const mt = 1 - t
      return mt * mt * mt * x0 + 3 * mt * mt * t * x1 + 3 * mt * t * t * x2 + t * t * t * x3
    })
}

function mergeClose(values: number[]): number[] {
  const out: number[] = []
  for (const v of [...values].sort((a, b) => a - b)) {
    if (out.length && Math.abs(v - out[out.length - 1]) <= CROSSING_MERGE_TOLERANCE) continue
    out.push(v)
  }
  return out
}

/**
 * X where the outline crosses height y, sorted, even in number when possible:
 * a line that only touches the outline is nudged up, then down, and re-measured.
 */
export function crossings(segments: Segment[], y: number): number[] {
  let result: number[] = []
  for (const candidate of [y, y + TOUCH_NUDGE, y - TOUCH_NUDGE]) {
    result = mergeClose(segments.flatMap((s) => segmentCrossings(s, candidate)))
    if (result.length % 2 === 0) return result
  }
  return result
}

/** margins_from_crossings: (left, right) along the beam; null when it misses. */
export function marginsFromCrossings(xs: number[], y: number, width: number, slant: number): [number, number] | null {
  if (xs.length < 2) return null
  const shift = y * slant
  return [xs[0] - shift, width - (xs[xs.length - 1] - shift)]
}

/** slant_factor: horizontal shift per unit of height for an italic angle. */
export const slantFactor = (italicAngle: number) => (italicAngle ? -Math.tan((italicAngle * Math.PI) / 180) : 0)
