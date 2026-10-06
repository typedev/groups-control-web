// Messages between the main thread and the Python worker.
import type { Delta, FontData } from '../model/types'
import type { PreviewSubject, PreviewToken } from '../model/preview'

/** A file of the font being opened, path relative to the drop root. */
export type FontFile = { path: string; bytes: ArrayBuffer }

export type OpenInput = {
  /** Folder name (`X.ufo`), archive name (`X.ufoz`) or `X.designspace`. */
  name: string
  kind: 'folder' | 'ufoz' | 'designspace'
  files: FontFile[]
  /** designspace: its path relative to the drop root (`Project/X.designspace`). */
  main?: string
}

export type DesignspaceMaster = {
  name: string
  filename: string
  location: Record<string, number>
  discrete: Record<string, number>
  isDefault: boolean
  pairs: number
  /** Masters with identical kern groups share a set index. */
  set: number
  groups: number
  vsCurrent: {
    level: 'identical' | 'order' | 'different'
    onlyHere: number
    onlyThere: number
    members: number
    order: number
    sample: string[]
  }
}

/** Which masters a membership edit reaches (py/gcweb/api.py EDIT_SCOPES); compatibleAll is the default. */
export type EditScope = 'compatible' | 'compatibleAll' | 'master'

export type DesignspaceInfo = {
  scope: EditScope
  /** Masters each scope reaches now (the current one included). */
  reach: Record<EditScope, number>
  /** The current master's discrete location, e.g. "italic=0" ("" without discrete axes). */
  subspace: string
  file: string
  axes: { name: string; discrete: boolean }[]
  masters: DesignspaceMaster[]
  current: number
  sets: number
  compatibleInSubspace: number
  subspaceSize: number
  layerSources: string[]
  timings: Record<string, number>
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
  /** The font carries com.typedev.spacing.metricsRules (ignored). */
  hasMetricsRules: boolean
  /** Set when the font is a master of an open designspace. */
  designspace?: DesignspaceInfo
}

/** Designspace part of an edit's answer. */
export type DesignspaceChange = {
  /** Masters changed besides the current one (their cached mirrors are stale). */
  others?: number[]
  designspace?: DesignspaceInfo
}

export type OpResult<R = unknown> = { result: R; delta: Delta; dirty: boolean } & DesignspaceChange

/** Glyphs refused because they are already in a group on this side: [glyph, group]. */
export type Refused = [glyph: string, group: string][]

export type HistoryState = { text: string; count: number; recording: boolean }

/** groups_io.py scopes: kerning groups, other groups, or both. */
/** A Tools menu entry (py/gcweb/tools.py). */
export type ToolOption =
  | { id: string; type: 'radio'; label: string; default: string; choices: [string, string][] }
  | { id: string; type: 'checkbox'; label: string; default: boolean }
  | { id: string; type: 'entry'; label: string; default: string; placeholder?: string }
  /** Master indices of the open designspace (every master but the current one is offered). */
  | { id: string; type: 'masters'; label: string }
  /** One master index of the open designspace, not the current one. */
  | { id: string; type: 'master'; label: string }
  /** Values chosen among choices the worker computes (toolChoices). */
  | { id: string; type: 'checklist'; label: string }
export type ToolSpec = {
  id: string
  name: string
  description: string
  options: ToolOption[]
  /** Works between the masters of a designspace (py/gcweb/master_tools.py). */
  needsDesignspace?: boolean
}
export type ToolPlan = { lines: string[]; changes: boolean }

/** Diff Groups: a kern group whose membership is not the same in every compared master. */
export type GroupsDiffEntry = {
  group: string
  level: 'order' | 'different'
  /** Distinct memberships, the current master's first; members null = no such group there. */
  variants: { members: string[] | null; masters: number[] }[]
}

export type GroupScope = 'kern' | 'other' | 'all'
export type ImportPreview = { lines: string[]; ok: boolean; changes: boolean; imported: number }

/** A file to write into the opened folder; bytes null = delete it. */
export type SavedFile = { name: string; bytes: ArrayBuffer | null }

/** RPC methods: params → result. */
export type Api = {
  open: (input: OpenInput) => FontSummary
  fontData: () => FontData
  switchMaster: (index: number) => FontSummary
  close: () => null
  addGlyphs: (group: string, glyphs: string[], keepKerning: boolean, index: number) => OpResult<{ added: string[]; grouped: Refused }>
  createGroup: (prefix: string, shortName: string, glyphs: string[], keepKerning: boolean) => OpResult<{ group: string | null; added: string[]; grouped: Refused }>
  removeGlyphs: (group: string, glyphs: string[], keepKerning: boolean) => OpResult<{ removed: string[] }>
  deleteGroup: (group: string, keepKerning: boolean) => OpResult<null>
  renameGroup: (group: string, newShortName: string) => OpResult<{ group: string }>
  move: (group: string, glyphs: string[], index: number) => OpResult<null>
  deletePairs: (pairs: [string, string][]) => OpResult<{ removed: [string, string][] }>
  revert: () => Delta & DesignspaceChange
  setEditScope: (scope: EditScope) => DesignspaceInfo | null
  /** Copy the current master's member order to masters differing only in order. */
  matchOrder: () => OpResult<{ masters: number; groups: number }>
  previewLine: (subject: PreviewSubject) => PreviewToken[]
  previewPairs: (pairs: [string, string][], expanded: boolean, perRow: number) => PreviewToken[][]
  marginNudge: (glyph: string, side: 'left' | 'right', delta: number) => OpResult<{ changed: string[] }>
  kernNudge: (left: string, right: string, delta: number) => OpResult<{ key: [string, string] }>
  kernRemove: (left: string, right: string) => OpResult<{ key: [string, string] | null }>
  kernException: (left: string, right: string, side: 'left' | 'right' | 'both') => OpResult<{ key: [string, string] }>
  exportGroups: (scope: GroupScope) => { text: string }
  importPreview: (text: string, scope: GroupScope) => ImportPreview
  importApply: () => OpResult<{ imported: number }>
  sessionState: () => string
  restoreState: (state: string) => OpResult<null>
  loadHistory: (text: string) => HistoryState & { notes: string[] }
  toolList: () => ToolSpec[]
  groupsDiff: (masters: number[]) => GroupsDiffEntry[]
  toolChoices: (toolId: string, optionId: string) => [string, string][]
  /** Diff Groups action: the group in these masters made the same as in the current one. */
  matchGroup: (group: string, masters: number[], keepKerning: boolean) => OpResult<{ masters: number; lines: string[] }>
  toolPlan: (id: string, options: Record<string, unknown>) => ToolPlan
  toolApply: () => OpResult<null>
  history: () => HistoryState
  setHistoryRecording: (on: boolean) => HistoryState
  clearHistory: () => HistoryState
  /** Changed plists for writing back into the folder; then call markSaved. */
  changedFiles: () => SavedFile[]
  /** The whole font as .ufoz bytes; then call markSaved. */
  buildUfoz: (name: string) => ArrayBuffer
  /** Designspace without a writable folder: the changed files as a zip; then markSaved. */
  buildChangesZip: (name: string) => { bytes: ArrayBuffer; written: string[]; deleted: string[] }
  /** written: names actually written when a save stopped part way (null = all). */
  markSaved: (written?: string[] | null) => { unsaved: number[]; dirty: boolean }
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
  /** Opening a font: what is being done; total 0 = unknown length. */
  | { type: 'openProgress'; label: string; done: number; total: number }

export type WorkerMessage = Response | WorkerEvent
