// One dialog for every tool: options → plan report → apply.
// (Font-Rover board scripts ask for options, then confirm with the plan.)
import { useEffect, useRef, useState } from 'react'
import { python } from '../runtime'
import type { DesignspaceInfo, ToolPlan, ToolSpec } from '../worker/protocol'

type Props = {
  tool: ToolSpec
  readOnly: boolean
  hasSelectedGroup: boolean
  /** For "masters" options: the open designspace. */
  designspace?: DesignspaceInfo
  onPlan: (options: Record<string, unknown>) => Promise<ToolPlan>
  onApply: () => Promise<boolean>
  onClose: () => void
}

const button = 'h-8 whitespace-nowrap rounded-lg px-3 text-[13px] font-medium'
const plain = `${button} border border-line hover:bg-raised`

export function ToolDialog({ tool, readOnly, hasSelectedGroup, designspace, onPlan, onApply, onClose }: Props) {
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const v: Record<string, unknown> = {}
    const others = otherMasters(designspace)
    let nextMaster = 0
    for (const o of tool.options) {
      if (o.type === 'masters') v[o.id] = others
      // A, B…: distinct masters by default (the first, then the last other one).
      else if (o.type === 'master') v[o.id] = nextMaster++ === 0 ? others[0] : others[others.length - 1]
      else if (o.type === 'checklist') v[o.id] = []
      else v[o.id] = o.id === 'groups' && !hasSelectedGroup ? 'all' : o.default
    }
    return v
  })
  const [plan, setPlan] = useState<ToolPlan | null>(null)
  // Choices of "checklist" options, from the worker.
  const [choices, setChoices] = useState<Record<string, [string, string][]>>({})
  useEffect(() => {
    for (const o of tool.options) {
      if (o.type !== 'checklist') continue
      void python
        .call('toolChoices', [tool.id, o.id])
        .then((c) => setChoices((cur) => ({ ...cur, [o.id]: c })))
        .catch((err) => setError(err instanceof Error ? err.message : String(err)))
    }
  }, [tool])
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
                {o.type === 'master' ? (
                  designspace && (
                    <label className="flex items-center gap-2">
                      <span className="w-28 shrink-0 font-medium">{o.label}</span>
                      <select
                        className="h-8 min-w-0 flex-1 rounded-md border border-line bg-surface px-2"
                        value={String(values[o.id] ?? '')}
                        onChange={(e) => set(o.id, Number(e.target.value))}
                      >
                        {otherMasters(designspace).map((i) => (
                          <option key={i} value={i}>
                            {designspace.masters[i].name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )
                ) : o.type === 'checklist' ? (
                  <fieldset>
                    <legend className="mb-1 font-medium">{o.label}</legend>
                    {!choices[o.id] ? (
                      <p className="text-xs text-muted">Reading…</p>
                    ) : choices[o.id].length === 0 ? (
                      <p className="text-xs text-muted">Nothing to choose.</p>
                    ) : (
                      <div className="grid max-h-40 grid-cols-2 gap-x-4 gap-y-0.5 overflow-auto rounded-md border border-line p-2">
                        {choices[o.id].map(([value, label]) => {
                          const chosen = (values[o.id] as string[]) ?? []
                          return (
                            <label key={value} className="flex min-w-0 items-center gap-1.5">
                              <input
                                type="checkbox"
                                className="size-3.5 shrink-0 accent-[var(--c-accent)]"
                                checked={chosen.includes(value)}
                                onChange={(e) => set(o.id, e.target.checked ? [...chosen, value] : chosen.filter((x) => x !== value))}
                              />
                              <span className="truncate">{label}</span>
                            </label>
                          )
                        })}
                      </div>
                    )}
                  </fieldset>
                ) : o.type === 'masters' ? (
                  designspace && (
                    <MastersField
                      label={o.label}
                      info={designspace}
                      value={(values[o.id] as number[]) ?? []}
                      onChange={(v) => set(o.id, v)}
                    />
                  )
                ) : o.type === 'checkbox' ? (
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

        {error && <p role="alert" className="mt-3 rounded-lg bg-error-soft px-3 py-2 text-[13px] text-error">{error}</p>}

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
            <button ref={first} type="button" disabled={busy || readOnly} className={`${button} bg-danger text-white hover:brightness-110 disabled:opacity-50`} onClick={apply}>
              Apply
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/** Every master but the current one: what a "masters" option starts with. */
function otherMasters(info?: DesignspaceInfo): number[] {
  return info ? info.masters.map((_m, i) => i).filter((i) => i !== info.current) : []
}

const LEVEL_NOTE = { identical: 'same groups', order: 'order differs', different: 'groups differ' } as const

/** A checklist of the other masters, with All / this subspace / None. */
function MastersField({
  label,
  info,
  value,
  onChange,
}: {
  label: string
  info: DesignspaceInfo
  value: number[]
  onChange: (v: number[]) => void
}) {
  const others = otherMasters(info)
  const here = JSON.stringify(info.masters[info.current].discrete)
  const subspace = others.filter((i) => JSON.stringify(info.masters[i].discrete) === here)
  const chosen = new Set(value)
  const toggle = (i: number, on: boolean) => onChange(others.filter((j) => (j === i ? on : chosen.has(j))))
  const link = 'text-xs text-accent hover:underline'
  return (
    <fieldset>
      <legend className="mb-1 flex w-full items-baseline gap-3 font-medium">
        {label}
        <span className="text-xs font-normal text-muted">
          {chosen.size} of {others.length} masters
        </span>
        <span className="ml-auto flex gap-3 font-normal">
          <button type="button" className={link} onClick={() => onChange(others)}>
            All
          </button>
          {subspace.length < others.length && info.subspace && (
            <button type="button" className={link} onClick={() => onChange(subspace)}>
              {info.subspace}
            </button>
          )}
          <button type="button" className={link} onClick={() => onChange([])}>
            None
          </button>
        </span>
      </legend>
      <div className="grid max-h-40 grid-cols-2 gap-x-4 gap-y-0.5 overflow-auto rounded-md border border-line p-2">
        {others.map((i) => {
          const m = info.masters[i]
          return (
            <label key={i} className="flex min-w-0 items-center gap-1.5" title={LEVEL_NOTE[m.vsCurrent.level]}>
              <input
                type="checkbox"
                className="size-3.5 shrink-0 accent-[var(--c-accent)]"
                checked={chosen.has(i)}
                onChange={(e) => toggle(i, e.target.checked)}
              />
              <span className="truncate">{m.name}</span>
              {m.vsCurrent.level !== 'identical' && (
                <span className={`shrink-0 text-xs ${m.vsCurrent.level === 'different' ? 'text-careful' : 'text-muted'}`}>
                  {LEVEL_NOTE[m.vsCurrent.level]}
                </span>
              )}
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}
