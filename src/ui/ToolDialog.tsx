// One dialog for every tool: options → plan report → apply.
// (Font-Rover board scripts ask for options, then confirm with the plan.)
import { useEffect, useRef, useState } from 'react'
import type { ToolPlan, ToolSpec } from '../worker/protocol'

type Props = {
  tool: ToolSpec
  readOnly: boolean
  hasSelectedGroup: boolean
  onPlan: (options: Record<string, unknown>) => Promise<ToolPlan>
  onApply: () => Promise<boolean>
  onClose: () => void
}

const button = 'h-8 whitespace-nowrap rounded-lg px-3 text-[13px] font-medium'
const plain = `${button} border border-line hover:bg-raised`

export function ToolDialog({ tool, readOnly, hasSelectedGroup, onPlan, onApply, onClose }: Props) {
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const v: Record<string, unknown> = {}
    for (const o of tool.options) {
      v[o.id] = o.id === 'groups' && !hasSelectedGroup ? 'all' : o.default
    }
    return v
  })
  const [plan, setPlan] = useState<ToolPlan | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const first = useRef<HTMLButtonElement>(null)

  useEffect(() => first.current?.focus(), [plan])

  const set = (id: string, value: unknown) => {
    setValues((v) => ({ ...v, [id]: value }))
    setPlan(null)
  }

  const showPlan = async () => {
    setBusy(true)
    setError(null)
    try {
      setPlan(await onPlan(values))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const apply = async () => {
    setBusy(true)
    if (await onApply()) onClose()
    setBusy(false)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <div role="dialog" aria-modal="true" aria-label={tool.name} className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-line bg-surface p-5 shadow-2xl">
        <h2 className="text-base font-semibold">{tool.name}</h2>
        <p className="mt-1 text-sm text-muted">{tool.description}</p>
        <p className="mt-1 text-xs text-careful">
          You see the plan before anything changes. There is no undo: Revert to file goes back to the last save.
        </p>

        {tool.options.length > 0 && (
          <div className="mt-4 flex flex-col gap-3 text-sm">
            {tool.options.map((o) => (
              <div key={o.id}>
                {o.type === 'checkbox' ? (
                  <label className="flex items-start gap-2">
                    <input type="checkbox" className="mt-0.5 size-3.5 accent-[var(--c-accent)]" checked={!!values[o.id]} onChange={(e) => set(o.id, e.target.checked)} />
                    {o.label}
                  </label>
                ) : o.type === 'radio' ? (
                  <fieldset>
                    <legend className="mb-1 font-medium">{o.label}</legend>
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      {o.choices.map(([value, label]) => (
                        <label key={value} className={`flex items-center gap-1.5 ${o.id === 'groups' && value === 'selected' && !hasSelectedGroup ? 'opacity-40' : ''}`}>
                          <input
                            className="accent-[var(--c-accent)]"
                            type="radio"
                            name={o.id}
                            checked={values[o.id] === value}
                            disabled={o.id === 'groups' && value === 'selected' && !hasSelectedGroup}
                            onChange={() => set(o.id, value)}
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ) : (
                  <label className="flex items-center gap-2">
                    <span className="w-28 shrink-0 font-medium">{o.label}</span>
                    <input
                      className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2.5 h-8"
                      value={String(values[o.id] ?? '')}
                      placeholder={o.placeholder}
                      onChange={(e) => set(o.id, e.target.value)}
                    />
                  </label>
                )}
              </div>
            ))}
          </div>
        )}

        {error && <p role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950/50 dark:text-red-200">{error}</p>}

        {plan && (
          <pre className="mt-4 min-h-24 flex-1 overflow-auto rounded-md bg-raised p-3 font-mono text-xs leading-snug">
            {plan.lines.join('\n')}
          </pre>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className={plain} onClick={onClose}>
            {plan && !plan.changes ? 'Close' : 'Cancel'}
          </button>
          {!plan || !plan.changes ? (
            <button ref={first} type="button" disabled={busy} className={`${button} bg-accent text-accent-ink hover:brightness-110 disabled:opacity-50`} onClick={showPlan}>
              {plan ? 'Check again' : 'Show plan'}
            </button>
          ) : (
            <button ref={first} type="button" disabled={busy || readOnly} className={`${button} bg-red-600 text-white hover:bg-red-500 disabled:opacity-50`} onClick={apply}>
              Apply
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
