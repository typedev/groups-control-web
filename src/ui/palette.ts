// Colours for canvas painting, read from the CSS tokens (src/index.css) and
// the chosen accent (src/theme.ts) — the one source for every colour in the UI.
import { useMemo } from 'react'
import { useAccentColor, useDark } from '../theme'

export type Palette = {
  accent: string
  surface: string
  cell: string
  groupCell: string
  cellSide: string
  cellHatch: string
  glyph: string
  glyphLabel: string
  badge: string
  label: string
  groupedMark: string
  negative: string
  positive: string
  zero: string
  error: string
  errorSoft: string
  errorGlyph: string
  drop: string
  beam: string
}

const VARS: Record<keyof Palette, string> = {
  accent: '--c-accent',
  surface: '--c-surface',
  cell: '--c-cell',
  groupCell: '--c-group-cell',
  cellSide: '--c-cell-side',
  cellHatch: '--c-cell-hatch',
  glyph: '--c-glyph',
  glyphLabel: '--c-glyph-label',
  badge: '--c-badge',
  label: '--c-label',
  groupedMark: '--c-grouped-mark',
  negative: '--c-negative',
  positive: '--c-positive',
  zero: '--c-zero',
  error: '--c-error',
  errorSoft: '--c-error-soft',
  errorGlyph: '--c-error-glyph',
  drop: '--c-drop',
  beam: '--c-beam',
}

export function readPalette(): Palette {
  const style = getComputedStyle(document.documentElement)
  const out = {} as Palette
  for (const [key, name] of Object.entries(VARS)) out[key as keyof Palette] = style.getPropertyValue(name).trim()
  return out
}

/** Re-read whenever the theme or the accent changes. */
export function usePalette(): Palette {
  const dark = useDark()
  const accent = useAccentColor()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(readPalette, [dark, accent])
}

let probe: CanvasRenderingContext2D | null = null
const rgbCache = new Map<string, [number, number, number] | null>()

/** Any CSS colour as [r, g, b] — the canvas normalises #rgb, names, rgb(), … */
function toRgb(color: string): [number, number, number] | null {
  const hit = rgbCache.get(color)
  if (hit !== undefined) return hit
  probe ??= document.createElement('canvas').getContext('2d')
  let out: [number, number, number] | null = null
  if (probe) {
    probe.fillStyle = '#000000'
    probe.fillStyle = color // ignored when invalid
    const v = String(probe.fillStyle)
    if (v.startsWith('#') && v.length === 7) {
      const n = parseInt(v.slice(1), 16)
      out = [n >> 16, (n >> 8) & 255, n & 255]
    } else {
      const m = v.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/)
      if (m) out = [Number(m[1]), Number(m[2]), Number(m[3])]
    }
  }
  rgbCache.set(color, out)
  return out
}

/**
 * A colour with an alpha, for translucent fills. Works for any CSS colour:
 * the build minifies tokens (#000000 → #000), so no format can be assumed.
 */
export function withAlpha(color: string, alpha: number): string {
  const rgb = toRgb(color)
  return rgb ? `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})` : color
}
