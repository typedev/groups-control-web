// Draggable divider between flex panes; sizes are fractions of the container.
import { useRef } from 'react'

type Props = {
  direction: 'horizontal' | 'vertical'
  onDrag: (deltaFraction: number) => void
}

export function Splitter({ direction, onDrag }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const horizontal = direction === 'horizontal'
  return (
    <div
      ref={ref}
      role="separator"
      aria-orientation={horizontal ? 'vertical' : 'horizontal'}
      className={`shrink-0 bg-transparent hover:bg-blue-400/40 ${horizontal ? 'w-1.5 cursor-col-resize' : 'h-1.5 cursor-row-resize'}`}
      onPointerDown={(e) => {
        const parent = ref.current?.parentElement
        if (!parent) return
        e.currentTarget.setPointerCapture(e.pointerId)
        const total = horizontal ? parent.clientWidth : parent.clientHeight
        let last = horizontal ? e.clientX : e.clientY
        const move = (ev: PointerEvent) => {
          const pos = horizontal ? ev.clientX : ev.clientY
          onDrag((pos - last) / total)
          last = pos
        }
        const up = () => {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', up)
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', up)
      }}
    />
  )
}
