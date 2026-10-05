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

/** `#rrggbb` or `rgb(...)` with an alpha, for translucent fills. */
export function withAlpha(color: string, alpha: number): string {
  if (color.startsWith('#') && color.length === 7) {
    const n = parseInt(color.slice(1), 16)
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${alpha})`
  }
  const m = color.match(/rgba?\(([^)]+)\)/)
  if (m) {
    const [r, g, b] = m[1].split(',').map((v) => v.trim())
    return `rgba(${r},${g},${b},${alpha})`
  }
  return color
}
