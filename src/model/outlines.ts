// Glyph outlines as cached Path2D, components resolved recursively.
import type { GlyphRecord } from './types'

export class OutlineCache {
  private cache = new Map<string, Path2D>()
  private resolving = new Set<string>()

  constructor(private glyphs: Record<string, GlyphRecord>) {}

  /** Path in font units (y up); empty path for unknown or cyclic glyphs. */
  get(name: string): Path2D {
    const hit = this.cache.get(name)
    if (hit) return hit
    const path = new Path2D()
    const glyph = this.glyphs[name]
    if (glyph && !this.resolving.has(name)) {
      this.resolving.add(name)
      for (const cmd of glyph.p) {
        switch (cmd[0]) {
          case 'M': path.moveTo(cmd[1], cmd[2]); break
          case 'L': path.lineTo(cmd[1], cmd[2]); break
          case 'C': path.bezierCurveTo(cmd[1], cmd[2], cmd[3], cmd[4], cmd[5], cmd[6]); break
          case 'Q': path.quadraticCurveTo(cmd[1], cmd[2], cmd[3], cmd[4]); break
          case 'Z': path.closePath(); break
          case 'c': {
            const [a, b, c, d, e, f] = cmd[2]
            path.addPath(this.get(cmd[1]), new DOMMatrix([a, b, c, d, e, f]))
            break
          }
        }
      }
      this.resolving.delete(name)
    }
    this.cache.set(name, path)
    return path
  }

  invalidate(): void {
    this.cache.clear()
  }
}
