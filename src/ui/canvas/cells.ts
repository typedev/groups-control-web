// Cell painters for the font, groups and content grids. Geometry and colours
// follow Font-Rover's glyph_grid/cell.py and groups_grid/cell.py.
import type { FontModel, GroupValidation, SideId } from '../../model/font'
import { displayGroupName } from '../../model/font'
import { pyRound } from '../../model/pyround'
import type { CellRect } from './CanvasGrid'

export const FONT_CELL = { w: 85, h: 90 }
export const GROUP_CELL = { w: 94, h: 110 }

export const ACCENT = '#3380e6'
const ERROR = '#ff0000'
const MISSING_RED = '#e01b24'
export const DROP_GREEN = '#33bf59'
const GROUPED_MARK = '#8c8c8c'
const KERNED_MARK = '#3585e3'
const LABEL_FONT = '11px system-ui, sans-serif'
const LABEL_FONT_BOLD = 'bold 11px system-ui, sans-serif'

export type Theme = {
  cellBg: string
  glyph: string
  label: string
  badge: string
  /** Selection outline — the UI accent (src/index.css --c-accent). */
  accent: string
}

export const themeFor = (dark: boolean, accent: string): Theme =>
  dark
    ? { cellBg: '#262930', glyph: '#e7e8eb', label: 'rgba(231,232,235,0.72)', badge: '#c4c8d0', accent }
    : { cellBg: '#f0f1f3', glyph: '#000000', label: 'rgba(27,29,34,0.7)', badge: '#3a3f48', accent }

function roundedRect(ctx: CanvasRenderingContext2D, r: CellRect, radius: number, inset = 0) {
  ctx.beginPath()
  ctx.roundRect(r.x + inset, r.y + inset, r.w - 2 * inset, r.h - 2 * inset, Math.max(0, radius - inset))
}

/** Text clipped to `maxWidth` with an end ellipsis. */
export function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text
  let lo = 0
  let hi = text.length
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (ctx.measureText(text.slice(0, mid) + '…').width <= maxWidth) lo = mid
    else hi = mid - 1
  }
  return text.slice(0, lo) + '…'
}

function drawGlyphAt(ctx: CanvasRenderingContext2D, font: FontModel, name: string, x: number, baseline: number, scale: number) {
  ctx.save()
  ctx.translate(x, baseline)
  ctx.scale(scale, -scale)
  ctx.fill(font.outlines.get(name))
  ctx.restore()
}

/** Glyph centred by its advance, baseline at 65 % of the cell height. */
function drawCenteredGlyph(ctx: CanvasRenderingContext2D, font: FontModel, name: string, r: CellRect, fill: string) {
  const glyph = font.glyph(name)
  if (!glyph) return
  const scale = (0.5 * r.h) / font.info.unitsPerEm
  const x = r.x + (glyph.w ? (r.w - glyph.w * scale) / 2 : r.w / 2)
  ctx.fillStyle = fill
  drawGlyphAt(ctx, font, name, x, r.y + 0.65 * r.h, scale)
}

function nameLabel(ctx: CanvasRenderingContext2D, name: string, r: CellRect, color: string) {
  ctx.font = LABEL_FONT
  ctx.fillStyle = color
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'
  const text = name.length > 10 ? name.slice(0, 9) + '…' : name
  ctx.fillText(text, r.x + r.w / 2, r.y + r.h - 2)
}

function selectionBorder(ctx: CanvasRenderingContext2D, r: CellRect, dashed = false, color = ACCENT) {
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = 3
  if (dashed) ctx.setLineDash([4, 3])
  roundedRect(ctx, r, 8, 1.5)
  ctx.stroke()
  ctx.restore()
}

function crossInCircle(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number, color: string, filled: boolean) {
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, radius, 0, Math.PI * 2)
  if (filled) {
    ctx.fillStyle = color
    ctx.fill()
    ctx.strokeStyle = '#ffffff'
  } else {
    ctx.strokeStyle = color
    ctx.lineWidth = 1.5
    ctx.stroke()
  }
  const d = radius * 0.45
  ctx.lineWidth = filled ? 1.8 : 1.5
  ctx.beginPath()
  ctx.moveTo(cx - d, cy - d)
  ctx.lineTo(cx + d, cy + d)
  ctx.moveTo(cx + d, cy - d)
  ctx.lineTo(cx - d, cy + d)
  ctx.stroke()
  ctx.restore()
}

function groupedMark(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.fillStyle = GROUPED_MARK
  const s = 5
  for (const [dx, dy] of [[0, 0], [7, 0], [0, 7], [7, 7]]) {
    ctx.beginPath()
    ctx.roundRect(x + 1 + dx, y + 1 + dy, s, s, 1)
    ctx.fill()
  }
}

function kernedMark(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.save()
  ctx.strokeStyle = KERNED_MARK
  ctx.fillStyle = KERNED_MARK
  ctx.lineWidth = 1.6
  const cy = y + 7
  ctx.beginPath()
  ctx.moveTo(x + 3, cy)
  ctx.lineTo(x + 11, cy)
  ctx.stroke()
  for (const [tip, dir] of [[x, 1], [x + 14, -1]] as const) {
    ctx.beginPath()
    ctx.moveTo(tip, cy)
    ctx.lineTo(tip + 5 * dir, cy - 4)
    ctx.lineTo(tip + 5 * dir, cy + 4)
    ctx.closePath()
    ctx.fill()
  }
  ctx.restore()
}

// -- font grid ------------------------------------------------------------------

export type FontCellState = { selected: boolean; mark: 'grouped' | 'kerned' | null }

export function drawFontCell(
  ctx: CanvasRenderingContext2D,
  font: FontModel,
  name: string,
  r: CellRect,
  state: FontCellState,
  theme: Theme,
) {
  ctx.fillStyle = theme.cellBg
  roundedRect(ctx, r, 8)
  ctx.fill()
  drawCenteredGlyph(ctx, font, name, r, theme.glyph)
  nameLabel(ctx, name, r, theme.label)
  if (state.mark === 'grouped') groupedMark(ctx, r.x + 3, r.y + 3)
  else if (state.mark === 'kerned') kernedMark(ctx, r.x + 3, r.y + 3)
  if (state.selected) selectionBorder(ctx, r, false, theme.accent)
}

// -- content grid (members of the active group) --------------------------------------

export type ContentCellState = { selected: boolean; badge: { text: string; error: boolean } | null; missing: boolean }

export function drawContentCell(
  ctx: CanvasRenderingContext2D,
  font: FontModel,
  name: string,
  r: CellRect,
  side: SideId,
  state: ContentCellState,
  theme: Theme,
) {
  if (state.missing) {
    ctx.fillStyle = theme.cellBg
    roundedRect(ctx, r, 8)
    ctx.fill()
    ctx.fillStyle = 'rgba(224,27,36,0.2)'
    roundedRect(ctx, r, 8)
    ctx.fill()
    crossInCircle(ctx, r.x + r.w / 2, r.y + 0.45 * r.h, Math.min(r.w, r.h) / 6, 'rgba(230,51,51,0.8)', false)
    nameLabel(ctx, name, r, ERROR)
  } else {
    drawFontCell(ctx, font, name, r, { selected: false, mark: null }, theme)
  }
  if (state.badge) {
    ctx.font = state.badge.error ? LABEL_FONT_BOLD : LABEL_FONT
    ctx.fillStyle = state.badge.error ? ERROR : theme.badge
    ctx.textBaseline = 'top'
    if (side === 'kern1') {
      ctx.textAlign = 'right'
      ctx.fillText(state.badge.text, r.x + r.w - 4, r.y + 2)
    } else {
      ctx.textAlign = 'left'
      ctx.fillText(state.badge.text, r.x + 4, r.y + 2)
    }
  }
  if (state.selected) selectionBorder(ctx, r, false, theme.accent)
}

/** W:1650-1703 _compute_margin_labels — badges for one group's members. */
export function memberBadges(font: FontModel, group: string, side: SideId): (ContentCellState['badge'])[] {
  const members = font.data.groups[group] ?? []
  const key = members[0]
  const keyMargin = key !== undefined && font.glyphSet.has(key) ? font.sideMargin(key, side) : null
  return members.map((name, i) => {
    if (keyMargin === null) return null
    if (i === 0) return { text: String(pyRound(keyMargin)), error: false }
    if (!font.glyphSet.has(name)) return null
    const m = font.sideMargin(name, side)
    if (m === null || pyRound(m) === pyRound(keyMargin)) return null
    return { text: `!${pyRound(m)}`, error: true }
  })
}

// -- groups grid -------------------------------------------------------------------

export type GroupCellState = { selected: boolean; active: boolean; dropHover?: boolean }

export function drawGroupCell(
  ctx: CanvasRenderingContext2D,
  font: FontModel,
  group: string,
  r: CellRect,
  side: SideId,
  validation: GroupValidation,
  state: GroupCellState,
  accent = ACCENT,
) {
  const { x, y, w, h } = r
  ctx.fillStyle = '#f0f0f0'
  roundedRect(ctx, r, 8)
  ctx.fill()

  // Side half, slanted along the italic angle, inside the cell's rounded corners.
  const cx = x + w / 2
  const shift = Math.tan((font.info.italicAngle * Math.PI) / 180) * (h / 2)
  ctx.save()
  roundedRect(ctx, r, 8)
  ctx.clip()
  ctx.fillStyle = 'rgba(128,128,128,0.6)'
  ctx.beginPath()
  if (side === 'kern1') {
    ctx.moveTo(x, y)
    ctx.lineTo(x, y + h)
    ctx.lineTo(cx + shift, y + h)
    ctx.lineTo(cx - shift, y)
  } else {
    ctx.moveTo(x + w, y)
    ctx.lineTo(x + w, y + h)
    ctx.lineTo(cx + shift, y + h)
    ctx.lineTo(cx - shift, y)
  }
  ctx.closePath()
  ctx.fill()
  ctx.restore()

  const members = font.data.groups[group] ?? []
  if (validation.empty) {
    const s = Math.min(w, h) / 3
    ctx.save()
    ctx.strokeStyle = 'rgba(230,51,51,0.7)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(cx - s / 2, y + h / 2 - s / 2)
    ctx.lineTo(cx + s / 2, y + h / 2 + s / 2)
    ctx.moveTo(cx + s / 2, y + h / 2 - s / 2)
    ctx.lineTo(cx - s / 2, y + h / 2 + s / 2)
    ctx.stroke()
    ctx.restore()
  } else {
    const key = font.glyph(members[0])
    if (key) {
      const scale = (0.5 * h) / font.info.unitsPerEm
      const baseline = y + 0.65 * h
      const xL = cx - (key.w * scale) / 2
      const xR = xL + key.w * scale
      const shown = members.slice(0, 5)
      for (let i = shown.length - 1; i >= 0; i--) {
        const g = font.glyph(shown[i])
        if (!g) continue
        ctx.fillStyle = i === 0 ? 'rgba(0,0,0,1)' : 'rgba(0,0,0,0.2)'
        drawGlyphAt(ctx, font, shown[i], side === 'kern1' ? xR - g.w * scale : xL, baseline, scale)
      }
    }
  }

  if (validation.missing.length) {
    crossInCircle(ctx, side === 'kern1' ? x + w - 22 + 8 : x + 6 + 8, y + h - 40 + 8, 8, MISSING_RED, true)
  }

  // Labels: right-aligned on side 1, left-aligned on side 2.
  const alignRight = side === 'kern1'
  ctx.textAlign = alignRight ? 'right' : 'left'
  const tx = alignRight ? x + w - 6 : x + 6
  ctx.font = LABEL_FONT
  ctx.fillStyle = 'rgba(0,0,0,0.8)'
  ctx.textBaseline = 'top'
  ctx.fillText(fitText(ctx, `@.${displayGroupName(group, side)}`, 82), tx, y + 5)
  if (validation.keyMargin !== null) {
    const text = String(pyRound(validation.keyMargin))
    ctx.textBaseline = 'bottom'
    if (validation.marginMismatch) {
      ctx.font = LABEL_FONT_BOLD
      ctx.fillStyle = ERROR
      ctx.fillText(`!${text}`, tx, y + h - 5)
    } else {
      ctx.fillStyle = 'rgba(0,0,0,0.7)'
      ctx.fillText(text, tx, y + h - 5)
    }
  }

  if (state.dropHover) {
    ctx.save()
    ctx.strokeStyle = DROP_GREEN
    ctx.lineWidth = 3
    roundedRect(ctx, r, 8, 1.5)
    ctx.stroke()
    ctx.restore()
  } else if (state.selected) selectionBorder(ctx, r, false, accent)
  else if (state.active) selectionBorder(ctx, r, true, accent)
}

/** Drop position marker: a bar at the left edge of a cell (or right edge of the last). */
export function drawInsertBar(ctx: CanvasRenderingContext2D, r: CellRect, atEnd: boolean, color = ACCENT) {
  ctx.fillStyle = color
  const x = atEnd ? r.x + r.w - 2 : r.x
  ctx.fillRect(x, r.y + 4, 3, r.h - 8)
}
