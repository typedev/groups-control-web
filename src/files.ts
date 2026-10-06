// Turning a drop / picker selection into the files the worker opens.
import type { FontFile, OpenInput } from './worker/protocol'

export type FontInput = {
  input: OpenInput
  /** Writable folder handle (Chromium only); null → save by download. */
  handle: FileSystemDirectoryHandle | null
}

export class InputError extends Error {}

export function classifyName(name: string): OpenInput['kind'] | null {
  const lower = name.toLowerCase()
  if (lower.endsWith('.ufo')) return 'folder'
  if (lower.endsWith('.ufoz')) return 'ufoz'
  return null
}

/**
 * Hidden files (.DS_Store, .git…) are not part of the font. Everything else
 * is read: a folder saved as a download must come back complete.
 */
export function shouldSkip(relPath: string): boolean {
  return relPath.split('/').some((p) => p.startsWith('.'))
}

export function checkFolder(name: string, relPaths: string[]): void {
  if (!relPaths.includes('metainfo.plist')) {
    throw new InputError(`${name} is not a UFO: metainfo.plist is missing.`)
  }
}

function unsupported(name: string): InputError {
  return new InputError(`${name}: drop a .ufo folder, a .ufoz file or a folder with a .designspace.`)
}

// -- designspace ------------------------------------------------------------

/** Asks which designspace of a dropped folder to open; null = cancel. */
export type ChooseDesignspace = (names: string[]) => Promise<string | null>

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

/**
 * UFO paths of the masters a designspace references, in order, deduped.
 * Sources with a `layer` attribute point into a UFO that is listed anyway.
 * A regex instead of DOMParser: the worker-free tests run without a DOM.
 */
export function designspaceSources(xml: string): string[] {
  const out: string[] = []
  for (const [tag] of xml.matchAll(/<source\b[^>]*>/g)) {
    const m = /\bfilename\s*=\s*("([^"]*)"|'([^']*)')/.exec(tag)
    if (!m) continue
    const name = (m[2] ?? m[3]).replace(/&(\w+);/g, (all, e: string) => XML_ENTITIES[e] ?? all)
    if (!out.includes(name)) out.push(name)
  }
  return out
}

/** `a/./b/../c` → `a/c`; null when the path leaves the root or is absolute. */
export function normalizeRelative(path: string): string | null {
  if (path.startsWith('/') || /^[a-z]:/i.test(path)) return null
  const parts: string[] = []
  for (const p of path.replace(/\\/g, '/').split('/')) {
    if (!p || p === '.') continue
    if (p === '..') {
      if (!parts.length) return null
      parts.pop()
    } else parts.push(p)
  }
  return parts.length ? parts.join('/') : null
}

function children(dir: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = dir.createReader()
  const all: FileSystemEntry[] = []
  return (async () => {
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej))
      if (!batch.length) return all
      all.push(...batch)
    }
  })()
}

function subdirectory(dir: FileSystemDirectoryEntry, path: string): Promise<FileSystemDirectoryEntry> {
  return new Promise((res, rej) => dir.getDirectory(path, {}, (e) => res(e as FileSystemDirectoryEntry), rej))
}

/**
 * A dropped project folder: pick one of the .designspace files at its top
 * level, then read only that file and the UFOs it references (project
 * folders may hold hundreds of MB of builds and logs).
 */
async function fromProjectFolder(
  dir: FileSystemDirectoryEntry,
  choose: ChooseDesignspace,
  handlePromise: Promise<FileSystemHandle | null>,
  onProgress?: ReadProgress,
): Promise<FontInput | null> {
  const t0 = performance.now()
  const found = (await children(dir))
    .filter((e) => e.isFile && e.name.toLowerCase().endsWith('.designspace'))
    .sort((a, b) => a.name.localeCompare(b.name))
  if (!found.length) {
    throw new InputError(`${dir.name}: no .designspace at the top of this folder. Drop a .ufo folder, a .ufoz file or a folder with a .designspace.`)
  }
  const chosenName = found.length === 1 ? found[0].name : await choose(found.map((e) => e.name))
  if (!chosenName) return null
  const chosen = found.find((e) => e.name === chosenName)!
  const file = await new Promise<File>((res, rej) => (chosen as FileSystemFileEntry).file(res, rej))
  const bytes = await file.arrayBuffer()
  const sources = designspaceSources(new TextDecoder().decode(bytes))
  if (!sources.length) throw new InputError(`${chosen.name} lists no sources.`)
  const pending: PendingFile[] = []
  for (const [i, source] of sources.entries()) {
    onProgress?.('Listing the masters', i, sources.length)
    const rel = normalizeRelative(source)
    if (!rel) throw new InputError(`${chosen.name}: the source ${source} is outside the dropped folder. Drop the folder that contains every master.`)
    let ufo: FileSystemDirectoryEntry
    try {
      ufo = await subdirectory(dir, rel)
    } catch {
      throw new InputError(`${chosen.name}: the source ${source} was not found in ${dir.name}.`)
    }
    const root = `${dir.name}/${rel}`
    const start = pending.length
    await collectEntry(ufo, '', pending, root)
    checkFolder(source, pending.slice(start).map((f) => f.path.slice(root.length + 1)))
  }
  const files = [{ path: `${dir.name}/${chosen.name}`, bytes }, ...(await readPending(pending, onProgress))]
  const mb = files.reduce((n, f) => n + f.bytes.byteLength, 0) / 1e6
  console.info(`[designspace] read ${sources.length} UFOs, ${files.length} files, ${mb.toFixed(1)} MB in ${Math.round(performance.now() - t0)} ms`)
  // Chromium: the dropped folder's handle lets saving write into the masters.
  const handle = await handlePromise
  return {
    input: { name: chosen.name, kind: 'designspace', files, main: `${dir.name}/${chosen.name}` },
    handle: handle?.kind === 'directory' ? (handle as FileSystemDirectoryHandle) : null,
  }
}

// -- drop -------------------------------------------------------------------

/** Reports reading progress; total 0 = unknown length. */
export type ReadProgress = (label: string, done: number, total: number) => void

type PendingFile = { entry: FileSystemFileEntry; path: string }

/** Walk a dropped folder (names only, nothing read yet), so progress has a total. */
async function collectEntry(entry: FileSystemEntry, rel: string, out: PendingFile[], root: string) {
  if (rel && shouldSkip(rel)) return
  if (entry.isFile) {
    out.push({ entry: entry as FileSystemFileEntry, path: `${root}/${rel}` })
  } else if (entry.isDirectory) {
    for (const child of await children(entry as FileSystemDirectoryEntry)) {
      await collectEntry(child, rel ? `${rel}/${child.name}` : child.name, out, root)
    }
  }
}

const READ_BATCH = 64

async function readPending(pending: PendingFile[], onProgress?: ReadProgress): Promise<FontFile[]> {
  const out: FontFile[] = []
  for (let i = 0; i < pending.length; i += READ_BATCH) {
    onProgress?.('Reading files', i, pending.length)
    const batch = pending.slice(i, i + READ_BATCH)
    out.push(
      ...(await Promise.all(
        batch.map(async ({ entry, path }) => {
          const file = await new Promise<File>((res, rej) => entry.file(res, rej))
          return { path, bytes: await file.arrayBuffer() }
        }),
      )),
    )
  }
  onProgress?.('Reading files', pending.length, pending.length)
  return out
}

/**
 * Must be called synchronously from the `drop` handler: the DataTransfer is
 * emptied after the first `await`, and Chromium hands out the writable handle
 * only during the event.
 */
export function fromDrop(dt: DataTransfer, choose: ChooseDesignspace, onProgress?: ReadProgress): Promise<FontInput | null> {
  const items = [...dt.items].filter((i) => i.kind === 'file')
  if (items.length !== 1) return Promise.reject(new InputError('Drop one font at a time.'))
  const item = items[0]
  const entry = item.webkitGetAsEntry()
  const handlePromise: Promise<FileSystemHandle | null> =
    'getAsFileSystemHandle' in item
      ? (item as DataTransferItem & { getAsFileSystemHandle(): Promise<FileSystemHandle | null> })
          .getAsFileSystemHandle()
          .catch(() => null)
      : Promise.resolve(null)
  const file = item.getAsFile()
  return (async () => {
    if (!entry) throw new InputError('This browser cannot read the dropped item.')
    const kind = classifyName(entry.name)
    if (kind === 'ufoz' && file) return fromFile(file)
    if (kind === null && entry.isDirectory) return fromProjectFolder(entry as FileSystemDirectoryEntry, choose, handlePromise, onProgress)
    if (kind !== 'folder' || !entry.isDirectory) throw unsupported(entry.name)
    const pending: PendingFile[] = []
    await collectEntry(entry, '', pending, entry.name)
    checkFolder(entry.name, pending.map((f) => f.path.slice(entry.name.length + 1)))
    const files = await readPending(pending, onProgress)
    const handle = await handlePromise
    return {
      input: { name: entry.name, kind, files },
      handle: handle?.kind === 'directory' ? (handle as FileSystemDirectoryHandle) : null,
    }
  })()
}

// -- pickers ----------------------------------------------------------------

export async function fromFile(file: File): Promise<FontInput> {
  if (classifyName(file.name) !== 'ufoz') throw unsupported(file.name)
  return {
    input: { name: file.name, kind: 'ufoz', files: [{ path: file.name, bytes: await file.arrayBuffer() }] },
    handle: null,
  }
}

async function readHandle(dir: FileSystemDirectoryHandle, rel: string, out: FontFile[], root: string) {
  // `values()` is in Chromium's FileSystemDirectoryHandle but not in TS's DOM lib yet.
  const entries = (dir as unknown as { values(): AsyncIterable<FileSystemHandle> }).values()
  for await (const child of entries) {
    const path = rel ? `${rel}/${child.name}` : child.name
    if (shouldSkip(path)) continue
    if (child.kind === 'file') {
      const file = await (child as FileSystemFileHandle).getFile()
      out.push({ path: `${root}/${path}`, bytes: await file.arrayBuffer() })
    } else {
      await readHandle(child as FileSystemDirectoryHandle, path, out, root)
    }
  }
}

export const canPickFolder = typeof window !== 'undefined' && 'showDirectoryPicker' in window

export async function pickFolder(): Promise<FontInput | null> {
  let handle: FileSystemDirectoryHandle
  try {
    handle = await (window as unknown as {
      showDirectoryPicker(o: { mode: 'readwrite' }): Promise<FileSystemDirectoryHandle>
    }).showDirectoryPicker({ mode: 'readwrite' })
  } catch {
    return null // cancelled
  }
  if (classifyName(handle.name) !== 'folder') throw unsupported(handle.name)
  const files: FontFile[] = []
  await readHandle(handle, '', files, handle.name)
  checkFolder(handle.name, files.map((f) => f.path.slice(handle.name.length + 1)))
  return { input: { name: handle.name, kind: 'folder', files }, handle }
}
