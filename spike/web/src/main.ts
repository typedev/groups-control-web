// Phase 0 spike page: drop a UFO, print timings.
const log = document.getElementById('log')!
const drop = document.getElementById('drop')!
const fileInput = document.getElementById('file') as HTMLInputElement

const results: Record<string, unknown> = {}
function show(key: string, value: unknown) {
  results[key] = value
  log.textContent = JSON.stringify(results, null, 1)
  console.log('[spike]', key, JSON.stringify(value))
}

const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
const tStart = performance.now()
worker.postMessage({ type: 'init' })

worker.onmessage = (e) => {
  const msg = e.data
  if (msg.type === 'ready') {
    show('init', { ...msg.timings, page_to_ready_ms: Math.round(performance.now() - tStart) })
  } else if (msg.type === 'opened') {
    const received = performance.timeOrigin + performance.now()
    const t0 = performance.now()
    const text = new TextDecoder().decode(msg.payload)
    const data = JSON.parse(text)
    const parseMs = Math.round(performance.now() - t0)
    show(`open #${Object.keys(results).length}`, {
      ...msg.result,
      ...msg.timings,
      transfer_ms: Math.round(received - msg.sentAt),
      decode_parse_ms: parseMs,
      glyphs_in_payload: data.glyphs.length,
      round_trip_ms: Math.round(performance.now() - openStarted),
    })
  } else if (msg.type === 'error') {
    show('error', msg.message)
  }
}

let openStarted = 0
type FileIn = { path: string; bytes: ArrayBuffer }

async function readEntry(entry: FileSystemEntry, prefix: string, out: FileIn[]) {
  const path = prefix ? `${prefix}/${entry.name}` : entry.name
  if (entry.isFile) {
    const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej))
    out.push({ path, bytes: await file.arrayBuffer() })
  } else if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader()
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej))
      if (!batch.length) break
      for (const child of batch) await readEntry(child, path, out)
    }
  }
}

function send(root: string, files: FileIn[], readMs: number) {
  show('read', { root_is_folder: !root.toLowerCase().endsWith('.ufoz'), files: files.length, read_ms: readMs })
  openStarted = performance.now()
  worker.postMessage({ type: 'open', root, files }, files.map((f) => f.bytes))
}

drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over') })
drop.addEventListener('dragleave', () => drop.classList.remove('over'))
drop.addEventListener('drop', async (e) => {
  e.preventDefault()
  drop.classList.remove('over')
  const item = e.dataTransfer?.items[0]
  if (!item) return
  // Must be requested synchronously inside the drop event.
  const handleApi = 'getAsFileSystemHandle' in item
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handlePromise = handleApi ? (item as any).getAsFileSystemHandle() : null
  const entry = item.webkitGetAsEntry()
  if (!entry) return
  const t0 = performance.now()
  const files: FileIn[] = []
  await readEntry(entry, '', files)
  const handle = handlePromise ? await handlePromise : null
  show('fs_access', { getAsFileSystemHandle: handleApi, handle_kind: handle?.kind ?? null })
  send(entry.name, files, Math.round(performance.now() - t0))
})

fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0]
  if (!file) return
  const t0 = performance.now()
  const bytes = await file.arrayBuffer()
  send(file.name, [{ path: file.name, bytes }], Math.round(performance.now() - t0))
})

// Dev only: ?url=<.ufoz served by Vite>[&as=folder] (folder = unzip in the worker).
const params = new URLSearchParams(location.search)
const url = params.get('url')
if (url) {
  ;(async () => {
    const t0 = performance.now()
    const bytes = await (await fetch(url)).arrayBuffer()
    const name = url.split('/').pop()!
    const asFolder = params.get('as') === 'folder'
    show('read', { url: name, as_folder: asFolder, read_ms: Math.round(performance.now() - t0) })
    openStarted = performance.now()
    worker.postMessage({ type: 'open', root: name, files: [{ path: name, bytes }], unzip: asFolder }, [bytes])
  })()
}
