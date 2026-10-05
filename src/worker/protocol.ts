// Messages between the main thread and the Python worker.
import type { Delta, FontData } from '../model/types'
import type { PreviewSubject, PreviewToken } from '../model/preview'

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

export type OpResult<R = unknown> = { result: R; delta: Delta; dirty: boolean }

/** Glyphs refused because they are already in a group on this side: [glyph, group]. */
export type Refused = [glyph: string, group: string][]

export type HistoryState = { text: string; count: number; recording: boolean }

/** A file to write into the opened folder; bytes null = delete it. */
export type SavedFile = { name: string; bytes: ArrayBuffer | null }

/** RPC methods: params → result. */
export type Api = {
  open: (input: OpenInput) => FontSummary
  fontData: () => FontData
  close: () => null
  addGlyphs: (group: string, glyphs: string[], keepKerning: boolean, index: number) => OpResult<{ added: string[]; grouped: Refused }>
  createGroup: (prefix: string, shortName: string, glyphs: string[], keepKerning: boolean) => OpResult<{ group: string | null; added: string[]; grouped: Refused }>
  removeGlyphs: (group: string, glyphs: string[], keepKerning: boolean) => OpResult<{ removed: string[] }>
  deleteGroup: (group: string, keepKerning: boolean) => OpResult<null>
  renameGroup: (group: string, newShortName: string) => OpResult<{ group: string }>
  move: (group: string, glyphs: string[], index: number) => OpResult<null>
  deletePairs: (pairs: [string, string][]) => OpResult<{ removed: [string, string][] }>
  revert: () => Delta
  previewLine: (subject: PreviewSubject) => PreviewToken[]
  previewPairs: (pairs: [string, string][], expanded: boolean, perRow: number) => PreviewToken[][]
  kernNudge: (left: string, right: string, delta: number) => OpResult<{ key: [string, string] }>
  kernRemove: (left: string, right: string) => OpResult<{ key: [string, string] | null }>
  kernException: (left: string, right: string, side: 'left' | 'right' | 'both') => OpResult<{ key: [string, string] }>
  history: () => HistoryState
  setHistoryRecording: (on: boolean) => HistoryState
  clearHistory: () => HistoryState
  /** Changed plists for writing back into the folder; then call markSaved. */
  changedFiles: () => SavedFile[]
  /** The whole font as .ufoz bytes; then call markSaved. */
  buildUfoz: (name: string) => ArrayBuffer
  markSaved: () => null
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
