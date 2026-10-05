// Typed RPC client for the Python worker.
import type {
  Method,
  Params,
  Request,
  Result,
  WorkerEvent,
  WorkerMessage,
} from './protocol'

export class WorkerError extends Error {
  constructor(message: string, readonly detail?: string) {
    super(message)
  }
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void }

export class PythonWorker {
  private worker = new Worker(new URL('./python.worker.ts', import.meta.url), {
    type: 'module',
  })
  private nextId = 1
  private pending = new Map<number, Pending>()
  private listeners = new Set<(e: WorkerEvent) => void>()

  constructor() {
    this.worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
      const msg = e.data
      if ('type' in msg) {
        this.listeners.forEach((fn) => fn(msg))
        return
      }
      const pending = this.pending.get(msg.id)
      if (!pending) return
      this.pending.delete(msg.id)
      if (msg.ok) pending.resolve(msg.result)
      else {
        if (msg.detail) console.error(msg.detail)
        pending.reject(new WorkerError(msg.error, msg.detail))
      }
    }
  }

  onEvent(fn: (e: WorkerEvent) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  call<M extends Method>(
    method: M,
    params: Params<M>,
    transfer: Transferable[] = [],
  ): Promise<Result<M>> {
    const id = this.nextId++
    const request: Request<M> = { id, method, params }
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
      this.worker.postMessage(request, transfer)
    })
  }
}
