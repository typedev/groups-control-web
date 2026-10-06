// One Python worker per page, started as soon as the module loads so Pyodide
// downloads while the user looks for a font.
import { useEffect, useState } from 'react'
import { PythonWorker } from './worker/client'
import type { LoadStage } from './worker/protocol'

export const python = new PythonWorker()

export type RuntimeState =
  | { status: 'loading'; stage: LoadStage; fraction: number }
  | { status: 'ready'; versions: Record<string, string>; ms: number }
  | { status: 'failed'; error: string }

let current: RuntimeState = { status: 'loading', stage: 'runtime', fraction: 0 }
const subscribers = new Set<(s: RuntimeState) => void>()

python.onEvent((e) => {
  if (e.type === 'openProgress') return
  if (e.type === 'progress') current = { status: 'loading', stage: e.stage, fraction: e.fraction }
  else if (e.type === 'ready') current = { status: 'ready', versions: e.versions, ms: e.ms }
  else current = { status: 'failed', error: e.error }
  subscribers.forEach((fn) => fn(current))
})

export function useRuntime(): RuntimeState {
  const [state, setState] = useState(current)
  useEffect(() => {
    subscribers.add(setState)
    setState(current)
    return () => {
      subscribers.delete(setState)
    }
  }, [])
  return state
}
