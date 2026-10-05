// History popover: the manager's journal (Font-Rover history_panel.py).
import { useEffect, useRef } from 'react'
import type { HistoryState } from '../worker/protocol'

type Props = {
  history: HistoryState
  onRecording: (on: boolean) => void
  onClear: () => void
  onSave: () => void
  onLoad: () => void
  onClose: () => void
}

const small =
  'rounded-md border border-line h-7 px-2.5 hover:bg-raised disabled:opacity-40'

export function HistoryPanel({ history, onRecording, onClear, onSave, onLoad, onClose }: Props) {
  const text = useRef<HTMLPreElement>(null)
  useEffect(() => {
    if (text.current) text.current.scrollTop = text.current.scrollHeight
  }, [history.text])
  return (
    <div
      className="absolute left-0 top-full z-30 mt-1 w-[28rem] rounded-lg border border-line bg-surface p-3 shadow-lg"
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={history.recording} onChange={(e) => onRecording(e.target.checked)} />
          Record
        </label>
        <span className="text-muted">
          {history.count} command{history.count === 1 ? '' : 's'}
        </span>
        <button type="button" className={`${small} ml-auto`} disabled={!history.count} onClick={onClear}>
          Clear
        </button>
        <button type="button" className={small} disabled={!history.count} onClick={onSave}>
          Save…
        </button>
        <button type="button" className={small} onClick={onLoad}>
          Load…
        </button>
        <button type="button" className="rounded-md px-1.5 py-0.5 hover:bg-raised" onClick={onClose} aria-label="Close history">
          ✕
        </button>
      </div>
      <pre ref={text} className="mt-2 max-h-64 min-h-24 overflow-auto rounded bg-raised p-2 font-mono text-[11px] leading-snug">
        {history.text || 'No group edits recorded yet.'}
      </pre>
      <p className="mt-1 text-[11px] text-muted">Reordering is not recorded (as on desktop). Load replaces the journal and applies nothing.</p>
    </div>
  )
}
