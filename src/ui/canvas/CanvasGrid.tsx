// Virtualized grid drawn on one canvas: only visible rows are painted.
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type MouseEvent, type PointerEvent, type Ref } from 'react'

export type CellRect = { x: number; y: number; w: number; h: number }

/** For drag & drop: what lies under a viewport point. */
export type GridHandle = {
  /**
   * null when the point is outside the grid. `index` is the cell under the
   * point (-1 for empty space); `insert` is the drop position: before that
   * cell, or the end (glyph_grid/component.py:3676-3720 — no half-cell logic).
   */
  hit(clientX: number, clientY: number): { index: number; insert: number } | null
}

type Props = {
  count: number
  cellWidth: number
  cellHeight: number
  gap?: number
  /** Changes whenever cells must be repainted (data, selection, theme). */
  version: unknown
  draw: (ctx: CanvasRenderingContext2D, index: number, rect: CellRect) => void
  onCellClick?: (index: number, e: MouseEvent) => void
  onCellDoubleClick?: (index: number, e: MouseEvent) => void
  /** Scroll so this cell is visible; bump `scrollKey` to repeat for the same index. */
  scrollTo?: { index: number; key: number } | null
  background?: string
  label?: string
  onCellPointerDown?: (index: number, e: PointerEvent) => void
  handle?: Ref<GridHandle>
  /** Space between the cells and the panel edges, so selection outlines stay clear of the border. */
  padding?: number
}

export function CanvasGrid({
  count,
  cellWidth,
  cellHeight,
  gap = 1,
  version,
  draw,
  onCellClick,
  onCellDoubleClick,
  scrollTo,
  background = 'transparent',
  label,
  onCellPointerDown,
  handle,
  padding = 6,
}: Props) {
  const scroller = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const frame = useRef(0)

  const columns = Math.max(1, Math.floor((size.w - 2 * padding + gap) / (cellWidth + gap)))
  const rows = Math.ceil(count / columns)
  const rowStep = cellHeight + gap
  const totalHeight = rows ? rows * rowStep - gap + 2 * padding : 0

  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const observer = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    observer.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => observer.disconnect()
  }, [])

  const paint = useCallback(() => {
    const el = scroller.current
    const cv = canvas.current
    if (!el || !cv || !size.w || !size.h) return
    const dpr = window.devicePixelRatio || 1
    if (cv.width !== Math.round(size.w * dpr) || cv.height !== Math.round(size.h * dpr)) {
      cv.width = Math.round(size.w * dpr)
      cv.height = Math.round(size.h * dpr)
    }
    const ctx = cv.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size.w, size.h)
    if (background !== 'transparent') {
      ctx.fillStyle = background
      ctx.fillRect(0, 0, size.w, size.h)
    }
    const top = el.scrollTop - padding
    const first = Math.max(0, Math.floor(top / rowStep))
    const last = Math.min(rows - 1, Math.floor((top + size.h) / rowStep))
    for (let row = first; row <= last; row++) {
      for (let col = 0; col < columns; col++) {
        const index = row * columns + col
        if (index >= count) break
        const rect = { x: padding + col * (cellWidth + gap), y: row * rowStep - top, w: cellWidth, h: cellHeight }
        ctx.save()
        ctx.beginPath()
        ctx.rect(rect.x, rect.y, rect.w, rect.h)
        ctx.clip()
        draw(ctx, index, rect)
        ctx.restore()
      }
    }
  }, [size, rows, columns, rowStep, count, cellWidth, cellHeight, gap, draw, background, padding])

  const schedule = useCallback(() => {
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(paint)
  }, [paint])

  useEffect(() => {
    schedule()
  }, [schedule, version])

  useEffect(() => () => cancelAnimationFrame(frame.current), [])

  useEffect(() => {
    const el = scroller.current
    if (!el || !scrollTo || scrollTo.index < 0 || !size.h) return
    const y = padding + Math.floor(scrollTo.index / columns) * rowStep
    if (y - padding < el.scrollTop) el.scrollTop = y - padding
    else if (y + cellHeight + padding > el.scrollTop + size.h) el.scrollTop = y + cellHeight + padding - size.h
  }, [scrollTo, columns, rowStep, cellHeight, size.h, padding])

  const locate = (clientX: number, clientY: number) => {
    const el = scroller.current
    if (!el) return null
    const box = el.getBoundingClientRect()
    if (clientX < box.left || clientX > box.right || clientY < box.top || clientY > box.bottom) return null
    const x = clientX - box.left - padding
    const y = clientY - box.top + el.scrollTop - padding
    const col = Math.floor(x / (cellWidth + gap))
    const row = Math.floor(y / rowStep)
    const onCell =
      x >= 0 && y >= 0 && col < columns && x - col * (cellWidth + gap) <= cellWidth && y - row * rowStep <= cellHeight
    const raw = Math.max(0, row) * columns + Math.max(0, Math.min(col, columns - 1))
    const index = onCell && raw < count ? raw : -1
    return { index, insert: Math.max(0, Math.min(raw, count)) }
  }

  const hit = (e: MouseEvent): number => locate(e.clientX, e.clientY)?.index ?? -1

  useImperativeHandle(handle, () => ({ hit: locate }))

  return (
    <div
      ref={scroller}
      className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
      onScroll={schedule}
      aria-label={label}
      onClick={(e) => {
        const i = hit(e)
        if (i >= 0) onCellClick?.(i, e)
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        const i = hit(e)
        if (i >= 0) onCellPointerDown?.(i, e)
      }}
      onDoubleClick={(e) => {
        const i = hit(e)
        if (i >= 0) onCellDoubleClick?.(i, e)
      }}
    >
      <div style={{ height: Math.max(totalHeight, size.h) }}>
        <canvas
          ref={canvas}
          className="sticky top-0 block"
          style={{ width: size.w, height: size.h }}
        />
      </div>
    </div>
  )
}
