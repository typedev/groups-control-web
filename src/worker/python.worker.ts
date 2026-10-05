// Web Worker that owns Python (Pyodide) and every font mutation.
import type { OpenInput, Request, Response, WorkerEvent } from './protocol'

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

const handlers: Record<string, (...params: never[]) => unknown> = {
  open,
  fontData: () => JSON.parse(api.font_data()),
  close: () => JSON.parse(api.close_font()),
}

/** Python errors carry a full traceback; the UI gets the last line. */
function describe(err: unknown): { error: string; detail?: string } {
  const text = err instanceof Error ? err.message : String(err)
  const lines = text.trim().split('\n')
  return lines.length > 1 ? { error: lines[lines.length - 1], detail: text } : { error: text }
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
    post({ id, ok: true, result: handler(...(params as never[])) })
  } catch (err) {
    post({ id, ok: false, ...describe(err) })
  }
}
