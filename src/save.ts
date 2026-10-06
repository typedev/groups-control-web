// Writing the font back: into the opened folder (Chromium) or as a download.
import type { SavedFile } from './worker/protocol'

type PermissionHandle = FileSystemDirectoryHandle & {
  queryPermission(o: { mode: 'readwrite' }): Promise<PermissionState>
  requestPermission(o: { mode: 'readwrite' }): Promise<PermissionState>
}

/** Writing stopped part way: what reached the disk, and the file that failed. */
export class WriteError extends Error {
  constructor(
    readonly written: string[],
    readonly failed: string,
    cause: unknown,
  ) {
    super(`Could not write ${failed}: ${cause instanceof Error ? cause.message : String(cause)}`)
  }
}

/**
 * Must run from a user gesture (Save click / Cmd+S) for the permission prompt.
 * Throws WriteError when a file fails, naming what was already written.
 */
export async function writeToFolder(
  handle: FileSystemDirectoryHandle,
  files: SavedFile[],
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const h = handle as PermissionHandle
  if ((await h.queryPermission({ mode: 'readwrite' })) !== 'granted') {
    if ((await h.requestPermission({ mode: 'readwrite' })) !== 'granted') {
      throw new Error('Writing to the folder was not allowed.')
    }
  }
  // Paths are UFO-relative ("groups.plist", "glyphs/A_.glif") or, for a
  // designspace, relative to its folder ("Bold.ufo/groups.plist").
  const dirs = new Map<string, FileSystemDirectoryHandle>([['', handle]])
  const dirOf = async (path: string[]): Promise<FileSystemDirectoryHandle> => {
    const key = path.join('/')
    let dir = dirs.get(key)
    if (!dir) {
      dir = await (await dirOf(path.slice(0, -1))).getDirectoryHandle(path[path.length - 1])
      dirs.set(key, dir)
    }
    return dir
  }
  const written: string[] = []
  for (const [i, file] of files.entries()) {
    onProgress?.(i, files.length)
    try {
      const parts = file.name.split('/')
      const leaf = parts.pop()!
      const dir = await dirOf(parts)
      if (file.bytes) {
        const fh = await dir.getFileHandle(leaf, { create: true })
        const writable = await fh.createWritable()
        await writable.write(file.bytes)
        await writable.close()
      } else {
        await dir.removeEntry(leaf).catch((e: DOMException) => {
          if (e.name !== 'NotFoundError') throw e
        })
      }
    } catch (err) {
      throw new WriteError(written, file.name, err)
    }
    written.push(file.name)
  }
  onProgress?.(files.length, files.length)
}

export function ufozName(fontName: string): string {
  return fontName.replace(/\.ufo$/i, '').replace(/\.ufoz$/i, '') + '.ufoz'
}

export function download(name: string, data: ArrayBuffer | string): void {
  const type = typeof data === 'string' ? 'text/plain;charset=utf-8' : 'application/zip'
  const url = URL.createObjectURL(new Blob([data], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** `Font.ufo` / `Font.ufoz` → `Font_groups.txt` style names. */
export function sidecarName(fontName: string, suffix: string): string {
  return fontName.replace(/\.ufoz?$/i, '') + suffix
}
