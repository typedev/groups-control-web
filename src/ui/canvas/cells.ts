// Cell painters for the font, groups and content grids. Geometry follows
// Font-Rover's glyph_grid/cell.py and groups_grid/cell.py; every colour comes
// from the theme palette (src/ui/palette.ts), so cells follow light / dark and
// the accent.
import type { FontModel, GroupValidation, SideId } from '../../model/font'
import { displayGroupName } from '../../model/font'
import { pyRound } from '../../model/pyround'
import type { Palette } from '../palette'
import { withAlpha } from '../palette'
import type { CellRect } from './CanvasGrid'

export const FONT_CELL = { w: 85, h: 90 }
export const GROUP_CELL = { w: 94, h: 110 }

const FAMILY = '"IBM Plex Sans Variable", system-ui, sans-serif'
const LABEL_FONT = `11px ${FAMILY}`
const LABEL_FONT_BOLD = `600 11px ${FAMILY}`

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

function outline(ctx: CanvasRenderingContext2D, r: CellRect, color: string, dashed = false) {
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = 3
  if (dashed) ctx.setLineDash([4, 3])
  roundedRect(ctx, r, 8, 1.5)
  ctx.stroke()
  ctx.restore()
}

function crossInCircle(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number, color: string, filled: boolean, knockout = '#ffffff') {
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, radius, 0, Math.PI * 2)
  if (filled) {
    ctx.fillStyle = color
    ctx.fill()
    ctx.strokeStyle = knockout
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

function groupedMark(ctx: CanvasRenderingContext2D, x: number, y: number, color: string) {
  ctx.fillStyle = color
  for (const [dx, dy] of [[0, 0], [7, 0], [0, 7], [7, 7]]) {
    ctx.beginPath()
    ctx.roundRect(x + 1 + dx, y + 1 + dy, 5, 5, 1)
    ctx.fill()
  }
}

function kernedMark(ctx: CanvasRenderingContext2D, x: number, y: number, color: string) {
  ctx.save()
  ctx.strokeStyle = color
  ctx.fillStyle = color
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

export type FontCellState = {
  selected: boolean
  /** Selected as a member of the open group: dashed, like the active group. */
  active?: boolean
  mark: 'grouped' | 'kerned' | null
}

export function drawFontCell(
  ctx: CanvasRenderingContext2D,
  font: FontModel,
  name: string,
  r: CellRect,
  state: FontCellState,
  p: Palette,
) {
  ctx.fillStyle = p.cell
  roundedRect(ctx, r, 8)
  ctx.fill()
  drawCenteredGlyph(ctx, font, name, r, p.glyph)
  nameLabel(ctx, name, r, p.glyphLabel)
  if (state.mark === 'grouped') groupedMark(ctx, r.x + 3, r.y + 3, p.groupedMark)
  else if (state.mark === 'kerned') kernedMark(ctx, r.x + 3, r.y + 3, p.accent)
  if (state.selected) outline(ctx, r, p.accent)
  else if (state.active) outline(ctx, r, p.accent, true)
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
  p: Palette,
) {
  if (state.missing) {
    ctx.fillStyle = p.cell
    roundedRect(ctx, r, 8)
    ctx.fill()
    ctx.fillStyle = withAlpha(p.error, 0.18)
    roundedRect(ctx, r, 8)
    ctx.fill()
    crossInCircle(ctx, r.x + r.w / 2, r.y + 0.45 * r.h, Math.min(r.w, r.h) / 6, p.error, false)
    nameLabel(ctx, name, r, p.error)
  } else {
    drawFontCell(ctx, font, name, r, { selected: false, mark: null }, p)
  }
  if (state.badge) {
    ctx.font = state.badge.error ? LABEL_FONT_BOLD : LABEL_FONT
    ctx.fillStyle = state.badge.error ? p.error : p.badge
    ctx.textBaseline = 'top'
    if (side === 'kern1') {
      ctx.textAlign = 'right'
      ctx.fillText(state.badge.text, r.x + r.w - 4, r.y + 2)
    } else {
      ctx.textAlign = 'left'
      ctx.fillText(state.badge.text, r.x + 4, r.y + 2)
    }
  }
  if (state.selected) outline(ctx, r, p.accent)
}

/** W:1650-1703 _compute_margin_labels — badges for one group's members. */
export function memberBadges(font: FontModel, group: string, side: SideId, beamY: number | null = null): (ContentCellState['badge'])[] {
  const members = font.data.groups[group] ?? []
  const key = members[0]
  const keyMargin = key !== undefined && font.glyphSet.has(key) ? font.sideMargin(key, side, beamY) : null
  return members.map((name, i) => {
    if (keyMargin === null) return null
    if (i === 0) return { text: String(pyRound(keyMargin)), error: false }
    if (!font.glyphSet.has(name)) return null
    const m = font.sideMargin(name, side, beamY)
    if (m === null || pyRound(m) === pyRound(keyMargin)) return null
    return { text: `!${pyRound(m)}`, error: true }
  })
}

// -- groups grid -------------------------------------------------------------------

export type GroupCellState = { selected: boolean; active: boolean; dropHover?: boolean }

const HATCH = 18 // pattern tile: one stripe and one gap, each 9 px across
const hatchCache = new Map<string, CanvasPattern>()

/** A tiling pattern of 45° stripes, so every stripe has the same width. */
function hatchPattern(ctx: CanvasRenderingContext2D, color: string): CanvasPattern {
  const dpr = Math.round(window.devicePixelRatio || 1)
  const key = `${color}@${dpr}`
  const hit = hatchCache.get(key)
  if (hit) return hit
  const size = HATCH * dpr
  const tile = document.createElement('canvas')
  tile.width = tile.height = size
  const t = tile.getContext('2d')!
  t.fillStyle = color
  // One band from the bottom-left to the top-right corner, plus the two
  // corner pieces that continue it on the neighbouring tiles.
  const band = (dx: number) => {
    t.beginPath()
    t.moveTo(dx, size)
    t.lineTo(dx + size / 2, size)
    t.lineTo(dx + size, 0)
    t.lineTo(dx + size / 2, 0)
    t.closePath()
    t.fill()
  }
  band(-size)
  band(0)
  band(size)
  const pattern = ctx.createPattern(tile, 'repeat')!
  hatchCache.set(key, pattern)
  return pattern
}

/** The side half: a lighter tone with wide diagonal hatching. */
function sideHalf(ctx: CanvasRenderingContext2D, r: CellRect, side: SideId, italicAngle: number, p: Palette) {
  const { x, y, w, h } = r
  const cx = x + w / 2
  const shift = Math.tan((italicAngle * Math.PI) / 180) * (h / 2)
  ctx.save()
  roundedRect(ctx, r, 8)
  ctx.clip()
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
  ctx.fillStyle = p.cellSide
  ctx.fill()
  ctx.clip()
  // Even 45° stripes: as wide as the gaps between them, laid on whole pixels.
  const pattern = hatchPattern(ctx, p.cellHatch)
  // Anchored to the cell, so stripes do not slide when the grid scrolls.
  pattern.setTransform(new DOMMatrix().translate(Math.round(x), Math.round(y)).scale(1 / Math.round(window.devicePixelRatio || 1)))
  ctx.fillStyle = pattern
  ctx.fillRect(x, y, w, h)
  ctx.restore()
}

export function drawGroupCell(
  ctx: CanvasRenderingContext2D,
  font: FontModel,
  group: string,
  r: CellRect,
  side: SideId,
  validation: GroupValidation,
  state: GroupCellState,
  p: Palette,
) {
  const { x, y, w, h } = r
  ctx.fillStyle = p.groupCell
  roundedRect(ctx, r, 8)
  ctx.fill()
  sideHalf(ctx, r, side, font.info.italicAngle, p)

  const cx = x + w / 2
  const members = font.data.groups[group] ?? []
  if (validation.empty) {
    const s = Math.min(w, h) / 3
    ctx.save()
    ctx.strokeStyle = withAlpha(p.error, 0.75)
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
      // Members under the key glyph, faint; the key on top, solid.
      for (let i = shown.length - 1; i >= 0; i--) {
        const g = font.glyph(shown[i])
        if (!g) continue
        ctx.fillStyle = i === 0 ? p.glyph : withAlpha(p.glyph, 0.22)
        drawGlyphAt(ctx, font, shown[i], side === 'kern1' ? xR - g.w * scale : xL, baseline, scale)
      }
    }
  }

  if (validation.missing.length) {
    crossInCircle(ctx, side === 'kern1' ? x + w - 22 + 8 : x + 6 + 8, y + h - 40 + 8, 8, p.error, true, p.groupCell)
  }

  // Labels: right-aligned on side 1, left-aligned on side 2.
  const alignRight = side === 'kern1'
  ctx.textAlign = alignRight ? 'right' : 'left'
  const tx = alignRight ? x + w - 6 : x + 6
  ctx.font = LABEL_FONT
  ctx.fillStyle = p.glyphLabel
  ctx.textBaseline = 'top'
  ctx.fillText(fitText(ctx, `@.${displayGroupName(group, side)}`, 82), tx, y + 5)
  if (validation.keyMargin !== null) {
    const text = String(pyRound(validation.keyMargin))
    ctx.textBaseline = 'bottom'
    if (validation.marginMismatch) {
      ctx.font = LABEL_FONT_BOLD
      ctx.fillStyle = p.error
      ctx.fillText(`!${text}`, tx, y + h - 5)
    } else {
      ctx.fillStyle = p.glyphLabel
      ctx.fillText(text, tx, y + h - 5)
    }
  }

  if (state.dropHover) outline(ctx, r, p.drop)
  else if (state.selected) outline(ctx, r, p.accent)
  else if (state.active) outline(ctx, r, p.accent, true)
}

/** Drop position marker: a bar at the left edge of a cell (or right edge of the last). */
export function drawInsertBar(ctx: CanvasRenderingContext2D, r: CellRect, atEnd: boolean, color: string) {
  ctx.fillStyle = color
  const x = atEnd ? r.x + r.w - 2 : r.x
  ctx.fillRect(x, r.y + 4, 3, r.h - 8)
}
