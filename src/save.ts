// Writing the font back: into the opened folder (Chromium) or as a download.
import type { SavedFile } from './worker/protocol'

type PermissionHandle = FileSystemDirectoryHandle & {
  queryPermission(o: { mode: 'readwrite' }): Promise<PermissionState>
  requestPermission(o: { mode: 'readwrite' }): Promise<PermissionState>
}

/** Must run from a user gesture (Save click / Cmd+S) for the permission prompt. */
export async function writeToFolder(handle: FileSystemDirectoryHandle, files: SavedFile[]): Promise<void> {
  const h = handle as PermissionHandle
  if ((await h.queryPermission({ mode: 'readwrite' })) !== 'granted') {
    if ((await h.requestPermission({ mode: 'readwrite' })) !== 'granted') {
      throw new Error('Writing to the folder was not allowed.')
    }
  }
  for (const file of files) {
    // Paths are UFO-relative ("groups.plist", "glyphs/A_.glif").
    const parts = file.name.split('/')
    const leaf = parts.pop()!
    let dir = handle
    for (const part of parts) dir = await dir.getDirectoryHandle(part)
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
  }
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
