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

/** Parts of a UFO the editor never reads: images, data, hidden files. */
export function shouldSkip(relPath: string): boolean {
  const parts = relPath.split('/')
  return parts[0] === 'images' || parts[0] === 'data' || parts.some((p) => p.startsWith('.'))
}

export function checkFolder(name: string, relPaths: string[]): void {
  if (!relPaths.includes('metainfo.plist')) {
    throw new InputError(`${name} is not a UFO: metainfo.plist is missing.`)
  }
}

function unsupported(name: string): InputError {
  return new InputError(`${name}: drop a .ufo folder or a .ufoz file.`)
}

// -- drop -------------------------------------------------------------------

async function readEntry(entry: FileSystemEntry, rel: string, out: FontFile[], root: string) {
  if (rel && shouldSkip(rel)) return
  if (entry.isFile) {
    const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej))
    out.push({ path: `${root}/${rel}`, bytes: await file.arrayBuffer() })
  } else if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader()
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej))
      if (!batch.length) break
      for (const child of batch) {
        await readEntry(child, rel ? `${rel}/${child.name}` : child.name, out, root)
      }
    }
  }
}

/**
 * Must be called synchronously from the `drop` handler: the DataTransfer is
 * emptied after the first `await`, and Chromium hands out the writable handle
 * only during the event.
 */
export function fromDrop(dt: DataTransfer): Promise<FontInput> {
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
    if (kind !== 'folder' || !entry.isDirectory) throw unsupported(entry.name)
    const files: FontFile[] = []
    await readEntry(entry, '', files, entry.name)
    checkFolder(entry.name, files.map((f) => f.path.slice(entry.name.length + 1)))
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
