// Phase 0 spike worker: Pyodide + ufoLib2 + ufo-spacing-lib, timings only.
import trackedPy from '../../py/tracked.py?raw'
import plistStylePy from '../../py/plist_style.py?raw'
import sessionPy from '../../py/session.py?raw'
import benchPy from '../../py/bench.py?raw'

const PYODIDE = 'https://cdn.jsdelivr.net/pyodide/v314.0.7/full/'

type FileIn = { path: string; bytes: ArrayBuffer }
type Req =
  | { type: 'init' }
  | { type: 'open'; root: string; files: FileIn[]; unzip?: boolean }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let py: any = null
let ready: Promise<void> | null = null

const post = (msg: unknown, transfer: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(msg, transfer)

async function init() {
  const t0 = performance.now()
  const { loadPyodide } = await import(/* @vite-ignore */ `${PYODIDE}pyodide.mjs`)
  py = await loadPyodide({ indexURL: PYODIDE })
  const tLoad = performance.now()
  await py.loadPackage(['micropip', 'fonttools'])
  const tPkgs = performance.now()
  const micropip = py.pyimport('micropip')
  await micropip.install(['ufoLib2', 'ufo-spacing-lib==0.4.3'])
  const tPip = performance.now()
  py.FS.mkdirTree('/app')
  py.FS.writeFile('/app/tracked.py', trackedPy)
  py.FS.writeFile('/app/plist_style.py', plistStylePy)
  py.FS.writeFile('/app/session.py', sessionPy)
  py.FS.writeFile('/app/bench.py', benchPy)
  py.runPython("import sys; sys.path.insert(0, '/app'); import bench")
  const tImport = performance.now()
  post({
    type: 'ready',
    timings: {
      pyodide_load_ms: Math.round(tLoad - t0),
      load_packages_ms: Math.round(tPkgs - tLoad),
      micropip_ms: Math.round(tPip - tPkgs),
      import_ms: Math.round(tImport - tPip),
      total_ms: Math.round(tImport - t0),
      python: py.runPython('import sys; sys.version.split()[0]'),
    },
  })
}

function openFont(root: string, files: FileIn[], unzip = false) {
  const t0 = performance.now()
  py.runPython(`import shutil, os; shutil.rmtree('/work', ignore_errors=True); os.makedirs('/work')`)
  for (const f of files) {
    const full = `/work/${f.path}`
    py.FS.mkdirTree(full.slice(0, full.lastIndexOf('/')))
    py.FS.writeFile(full, new Uint8Array(f.bytes))
  }
  if (unzip) {
    // .ufoz -> /work/<name>.ufo folder, to time folder opening.
    const folder = root.replace(/\.ufoz$/i, '.ufo')
    py.runPython(`
import zipfile, os
with zipfile.ZipFile('/work/${root}') as z:
    top = z.namelist()[0].split('/')[0]
    z.extractall('/work/_x')
os.rename('/work/_x/' + top, '/work/${folder}')
os.remove('/work/${root}')`)
    root = folder
  }
  const tFs = performance.now()
  const run = py.globals.get('bench').run
  const result = run(`/work/${root}`).toJs({ dict_converter: Object.fromEntries })
  run.destroy()
  const tBench = performance.now()
  const payload: string = py.globals.get('bench').glyphs_payload(`/work/${root}`)
  const tPayload = performance.now()
  const bytes = new TextEncoder().encode(payload)
  post(
    {
      type: 'opened',
      result,
      timings: {
        write_memfs_ms: Math.round(tFs - t0),
        bench_total_ms: Math.round(tBench - tFs),
        payload_build_ms: Math.round(tPayload - tBench),
        payload_kb: Math.round(bytes.byteLength / 1024),
      },
      sentAt: performance.timeOrigin + performance.now(),
      payload: bytes.buffer,
    },
    [bytes.buffer],
  )
}

self.onmessage = async (e: MessageEvent<Req>) => {
  try {
    if (e.data.type === 'init') await (ready = init())
    else if (e.data.type === 'open') {
      await ready
      openFont(e.data.root, e.data.files, e.data.unzip)
    }
  } catch (err) {
    post({ type: 'error', message: String(err) })
  }
}
