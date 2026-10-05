// Virtualized grid drawn on one canvas: only visible rows are painted.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react'

export type CellRect = { x: number; y: number; w: number; h: number }

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
}: Props) {
  const scroller = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const frame = useRef(0)

  const columns = Math.max(1, Math.floor((size.w + gap) / (cellWidth + gap)))
  const rows = Math.ceil(count / columns)
  const rowStep = cellHeight + gap
  const totalHeight = Math.max(rows * rowStep - gap, 0)

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
    const top = el.scrollTop
    const first = Math.max(0, Math.floor(top / rowStep))
    const last = Math.min(rows - 1, Math.floor((top + size.h) / rowStep))
    for (let row = first; row <= last; row++) {
      for (let col = 0; col < columns; col++) {
        const index = row * columns + col
        if (index >= count) break
        const rect = { x: col * (cellWidth + gap), y: row * rowStep - top, w: cellWidth, h: cellHeight }
        ctx.save()
        ctx.beginPath()
        ctx.rect(rect.x, rect.y, rect.w, rect.h)
        ctx.clip()
        draw(ctx, index, rect)
        ctx.restore()
      }
    }
  }, [size, rows, columns, rowStep, count, cellWidth, cellHeight, gap, draw, background])

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
    const y = Math.floor(scrollTo.index / columns) * rowStep
    if (y < el.scrollTop) el.scrollTop = y
    else if (y + cellHeight > el.scrollTop + size.h) el.scrollTop = y + cellHeight - size.h
  }, [scrollTo, columns, rowStep, cellHeight, size.h])

  const hit = (e: MouseEvent): number => {
    const el = scroller.current!
    const box = el.getBoundingClientRect()
    const x = e.clientX - box.left
    const y = e.clientY - box.top + el.scrollTop
    const col = Math.floor(x / (cellWidth + gap))
    const row = Math.floor(y / rowStep)
    if (col >= columns || x - col * (cellWidth + gap) > cellWidth || y - row * rowStep > cellHeight) return -1
    const index = row * columns + col
    return index < count ? index : -1
  }

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
