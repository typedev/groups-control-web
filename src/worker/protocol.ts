// Messages between the main thread and the Python worker.

/** A file of the font being opened, path relative to the drop root. */
export type FontFile = { path: string; bytes: ArrayBuffer }

export type OpenInput = {
  /** Folder name (`X.ufo`) or archive name (`X.ufoz`). */
  name: string
  kind: 'folder' | 'ufoz'
  files: FontFile[]
}

export type FontSummary = {
  formatVersion: [number, number]
  familyName: string | null
  styleName: string | null
  unitsPerEm: number | null
  glyphs: number
  kern1Groups: number
  kern2Groups: number
  otherGroups: number
  pairs: number
  /** Set when the font can be viewed but not saved (e.g. UFO 2). */
  readOnlyReason: string | null
}

/** RPC methods: params → result. */
export type Api = {
  open: (input: OpenInput) => FontSummary
  close: () => null
}

export type Method = keyof Api
export type Params<M extends Method> = Parameters<Api[M]>
export type Result<M extends Method> = ReturnType<Api[M]>

export type Request<M extends Method = Method> = {
  id: number
  method: M
  params: Params<M>
}

export type Response =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string; detail?: string }

export type LoadStage = 'runtime' | 'packages' | 'python'

export type WorkerEvent =
  | { type: 'progress'; stage: LoadStage; fraction: number }
  | { type: 'ready'; versions: Record<string, string>; ms: number }
  | { type: 'fatal'; error: string }

export type WorkerMessage = Response | WorkerEvent
