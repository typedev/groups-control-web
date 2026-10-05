// In-page modal dialogs (no window.confirm/prompt: they block the page).
import { useEffect, useRef, useState, type ReactNode } from 'react'

export type DialogButton = {
  label: string
  value: string
  kind?: 'default' | 'suggested' | 'destructive'
}

export type DialogSpec = {
  title: string
  body?: ReactNode
  /** Text entry; its value is passed to onClose. */
  input?: { value: string; label: string }
  buttons: DialogButton[]
  /** value of the button, or null for Escape / backdrop. */
  onClose: (value: string | null, input: string) => void
}

const BUTTON = {
  default: 'border border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800',
  suggested: 'bg-blue-600 text-white hover:bg-blue-500',
  destructive: 'bg-red-600 text-white hover:bg-red-500',
}

export function Dialog({ spec }: { spec: DialogSpec }) {
  const [text, setText] = useState(spec.input?.value ?? '')
  const input = useRef<HTMLInputElement>(null)
  const first = useRef<HTMLButtonElement>(null)
  const suggested = spec.buttons.find((b) => b.kind === 'suggested') ?? spec.buttons[spec.buttons.length - 1]

  useEffect(() => {
    if (input.current) {
      input.current.focus()
      input.current.select()
    } else first.current?.focus()
  }, [])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) spec.onClose(null, text)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') spec.onClose(null, text)
      }}
    >
      <div role="dialog" aria-modal="true" aria-label={spec.title} className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl dark:bg-zinc-900">
        <h2 className="text-base font-semibold">{spec.title}</h2>
        {spec.body && <div className="mt-2 whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">{spec.body}</div>}
        {spec.input && (
          <input
            ref={input}
            aria-label={spec.input.label}
            className="mt-3 w-full rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') spec.onClose(suggested.value, text)
            }}
          />
        )}
        <div className="mt-5 flex justify-end gap-2">
          {spec.buttons.map((b, i) => (
            <button
              key={b.value}
              ref={i === spec.buttons.length - 1 ? first : undefined}
              type="button"
              className={`rounded-md px-3 py-1.5 text-sm ${BUTTON[b.kind ?? 'default']}`}
              onClick={() => spec.onClose(b.value, text)}
            >
              {b.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

/** Promise-style helper: `const v = await ask({...})`. */
export function useDialogs() {
  const [spec, setSpec] = useState<DialogSpec | null>(null)
  const ask = (s: Omit<DialogSpec, 'onClose'>) =>
    new Promise<{ value: string | null; input: string }>((resolve) => {
      setSpec({
        ...s,
        onClose: (value, input) => {
          setSpec(null)
          resolve({ value, input })
        },
      })
    })
  const element = spec ? <Dialog key={spec.title + String(spec.body)} spec={spec} /> : null
  return { ask, element }
}
