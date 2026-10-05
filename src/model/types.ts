// Font data as sent by the worker (py/gcweb/export.py).

export type Command =
  | ['M' | 'L', number, number]
  | ['C', number, number, number, number, number, number]
  | ['Q', number, number, number, number]
  | ['Z']
  | ['c', string, [number, number, number, number, number, number]]

export type GlyphRecord = {
  /** Unicode code points. */
  u: number[]
  /** Advance width. */
  w: number
  /** Left / right side bearing; null for glyphs without outlines. */
  l: number | null
  r: number | null
  p: Command[]
}

export type FontInfo = {
  unitsPerEm: number
  ascender: number | null
  descender: number | null
  capHeight: number | null
  xHeight: number | null
  italicAngle: number
}

export type Groups = Record<string, string[]>
export type KerningEntry = [left: string, right: string, value: number]

/** 1 = no shared language, 2 = some member never meets the other side, 3 = no shared script. */
export type LangStatus = 1 | 2 | 3
export type LangEntry = [left: string, right: string, status: LangStatus, note: string]

export type FontData = {
  info: FontInfo
  order: string[]
  glyphs: Record<string, GlyphRecord>
  groups: Groups
  kerning: KerningEntry[]
  /** Kerning keys with a script/language problem; all others are fine. */
  lang: LangEntry[]
}

/** What one worker operation changed (py/gcweb/api.py _finish). */
export type Delta = {
  master: number
  groups: { changed: Record<string, string[]>; removed: string[] }
  kerning: { changed: KerningEntry[]; removed: [string, string][] }
  lang: { set: LangEntry[]; clear: [string, string][] }
}
