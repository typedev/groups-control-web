// Web Worker that owns Python (Pyodide) and every font mutation.
import type { OpenInput, Request, Response, SavedFile, WorkerEvent } from './protocol'

const PYODIDE_VERSION = '314.0.7'
const PYODIDE_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`
/** Packages from the Pyodide distribution; our pinned wheels come on top. */
const PYODIDE_PACKAGES = ['fonttools', 'attrs']

const pySources = import.meta.glob(['../../py/gcweb/**/*.py', '../../py/gcweb/vendor/*.json'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

// Pyodide ships its own types only through the npm package; the surface used
// here is small, so it is typed locally.
type PyProxy = { destroy(): void }
type PyCallable = PyProxy & ((...args: unknown[]) => string)
type Pyodide = {
  FS: {
    mkdirTree(path: string): void
    writeFile(path: string, data: string | Uint8Array): void
    readFile(path: string): Uint8Array
  }
  loadPackage(names: string[]): Promise<void>
  runPython(code: string): unknown
  pyimport(name: string): Record<string, PyCallable> & PyProxy
}

const post = (msg: Response | WorkerEvent) => self.postMessage(msg)
const progress = (stage: 'runtime' | 'packages' | 'python', fraction: number) =>
  post({ type: 'progress', stage, fraction })

let py: Pyodide
let api: Record<string, PyCallable>

async function boot(): Promise<void> {
  const t0 = performance.now()
  progress('runtime', 0)
  const { loadPyodide } = await import(/* @vite-ignore */ `${PYODIDE_URL}pyodide.mjs`)
  py = (await loadPyodide({ indexURL: PYODIDE_URL })) as Pyodide
  progress('packages', 0.5)

  const base = new URL(import.meta.env.BASE_URL, self.location.origin)
  const manifest = await (await fetch(new URL('wheels/manifest.json', base))).json()
  const wheels = (manifest.wheels as string[]).map((f) => new URL(`wheels/${f}`, base).href)
  await py.loadPackage([...PYODIDE_PACKAGES, ...wheels])
  progress('python', 0.85)

  for (const [path, source] of Object.entries(pySources)) {
    const target = `/app/gcweb/${path.split('/py/gcweb/')[1]}`
    py.FS.mkdirTree(target.slice(0, target.lastIndexOf('/')))
    py.FS.writeFile(target, source)
  }
  py.runPython("import sys; sys.path.insert(0, '/app')")
  api = py.pyimport('gcweb.api')
  const versions = JSON.parse(
    py.runPython(`
import json, sys, fontTools, ufoLib2, ufo_spacing_lib
json.dumps({"python": sys.version.split()[0], "pyodide": "${PYODIDE_VERSION}",
            "fonttools": fontTools.version, "ufoLib2": ufoLib2.__version__,
            "ufo-spacing-lib": ufo_spacing_lib.__version__})`) as string,
  )
  post({ type: 'ready', versions, ms: Math.round(performance.now() - t0) })
}

const FONT_ROOT = '/fonts'

function open(input: OpenInput): unknown {
  py.runPython(`import shutil; shutil.rmtree('${FONT_ROOT}', ignore_errors=True)`)
  py.FS.mkdirTree(FONT_ROOT)
  for (const file of input.files) {
    const full = `${FONT_ROOT}/${file.path}`
    py.FS.mkdirTree(full.slice(0, full.lastIndexOf('/')))
    py.FS.writeFile(full, new Uint8Array(file.bytes))
  }
  return JSON.parse(api.open_font(`${FONT_ROOT}/${input.name}`))
}

const OUT_DIR = '/out'

function changedFiles(): { value: SavedFile[]; transfer: Transferable[] } {
  py.runPython(`import shutil; shutil.rmtree('${OUT_DIR}', ignore_errors=True)`)
  const listed = JSON.parse(api.changed_files(OUT_DIR)) as { name: string; path: string | null }[]
  const value = listed.map(({ name, path }) => ({
    name,
    bytes: path ? (py.FS.readFile(path).slice().buffer as ArrayBuffer) : null,
  }))
  return { value, transfer: value.flatMap((f) => (f.bytes ? [f.bytes] : [])) }
}

function buildUfoz(name: string): { value: ArrayBuffer; transfer: Transferable[] } {
  py.runPython(`import shutil; shutil.rmtree('${OUT_DIR}', ignore_errors=True)`)
  const { path } = JSON.parse(api.build_ufoz(`${OUT_DIR}/${name}`)) as { path: string }
  const value = py.FS.readFile(path).slice().buffer as ArrayBuffer
  return { value, transfer: [value] }
}

type Transferring = { value: unknown; transfer: Transferable[] }

const handlers: Record<string, (...params: never[]) => unknown> = {
  open,
  fontData: () => JSON.parse(api.font_data()),
  close: () => JSON.parse(api.close_font()),
  addGlyphs: (group: string, glyphs: string[], keep: boolean, index: number) =>
    JSON.parse(api.add_glyphs(group, JSON.stringify(glyphs), keep, index)),
  createGroup: (prefix: string, short: string, glyphs: string[], keep: boolean) =>
    JSON.parse(api.create_group(prefix, short, JSON.stringify(glyphs), keep)),
  removeGlyphs: (group: string, glyphs: string[], keep: boolean) =>
    JSON.parse(api.remove_glyphs(group, JSON.stringify(glyphs), keep)),
  deleteGroup: (group: string, keep: boolean) => JSON.parse(api.delete_group(group, keep)),
  renameGroup: (group: string, short: string) => JSON.parse(api.rename_group(group, short)),
  deletePairs: (pairs: [string, string][]) => JSON.parse(api.delete_pairs(JSON.stringify(pairs))),
  previewLine: (subject: unknown) => JSON.parse(api.preview_line(JSON.stringify(subject))),
  previewPairs: (pairs: unknown, expanded: boolean, perRow: number) =>
    JSON.parse(api.preview_pairs(JSON.stringify(pairs), expanded, perRow)),
  marginNudge: (g: string, side: string, delta: number) => JSON.parse(api.margin_nudge(g, side, delta)),
  kernNudge: (l: string, r: string, delta: number) => JSON.parse(api.kern_nudge(l, r, delta)),
  kernRemove: (l: string, r: string) => JSON.parse(api.kern_remove(l, r)),
  kernException: (l: string, r: string, side: string) => JSON.parse(api.kern_exception(l, r, side)),
  exportGroups: (scope: string) => JSON.parse(api.export_groups(scope)),
  importPreview: (text: string, scope: string) => JSON.parse(api.import_preview(text, scope)),
  importApply: () => JSON.parse(api.import_apply()),
  sessionState: () => api.session_state(),
  restoreState: (state: string) => JSON.parse(api.restore_state(state)),
  loadHistory: (text: string) => JSON.parse(api.load_history(text)),
  history: () => JSON.parse(api.history()),
  setHistoryRecording: (on: boolean) => JSON.parse(api.set_history_recording(on)),
  clearHistory: () => JSON.parse(api.clear_history()),
  move: (group: string, glyphs: string[], index: number) =>
    JSON.parse(api.move_in_group(group, JSON.stringify(glyphs), index)),
  revert: () => JSON.parse(api.revert()),
  changedFiles: (): Transferring => changedFiles(),
  buildUfoz: (name: string): Transferring => buildUfoz(name),
  markSaved: () => JSON.parse(api.mark_saved()),
}

const TRANSFERRING = new Set(['changedFiles', 'buildUfoz'])

/** Python errors carry a full traceback; the UI gets the last line. */
function describe(err: unknown): { error: string; detail?: string } {
  const text = err instanceof Error ? err.message : String(err)
  const lines = text.trim().split('\n')
  // "ValueError: Group 'O' already exists." → the message the user should read.
  const last = lines[lines.length - 1].replace(/^(ValueError|RuntimeError): /, '')
  return lines.length > 1 ? { error: last, detail: text } : { error: text }
}

const booted = boot().catch((err) => {
  post({ type: 'fatal', error: describe(err).error })
  throw err
})

self.onmessage = async (e: MessageEvent<Request>) => {
  const { id, method, params } = e.data
  try {
    await booted
    const handler = handlers[method]
    if (!handler) throw new Error(`unknown method ${method}`)
    const out = handler(...(params as never[]))
    if (TRANSFERRING.has(method)) {
      const { value, transfer } = out as Transferring
      self.postMessage({ id, ok: true, result: value } satisfies Response, { transfer })
    } else post({ id, ok: true, result: out })
  } catch (err) {
    post({ id, ok: false, ...describe(err) })
  }
}
