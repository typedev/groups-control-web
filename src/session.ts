// Autosave: the opened files plus the edited state, kept in IndexedDB so a
// reload or a crash does not lose work. Only this browser profile sees it.
import type { FontFile, OpenInput } from './worker/protocol'

const DB = 'groups-control'
const STORE = 'session'
const KEY = 'current'

export type StoredSession = {
  name: string
  kind: OpenInput['kind']
  files: FontFile[]
  /** designspace: its path among the files (OpenInput.main). */
  main?: string
  /** Writable folder handle (Chromium); permission is asked again on save. */
  handle: FileSystemDirectoryHandle | null
  /** api.session_state() JSON; null until there are unsaved edits. */
  state: string | null
  savedAt: number | null
}

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const conn = await db()
  return new Promise((resolve, reject) => {
    const req = run(conn.transaction(STORE, mode).objectStore(STORE))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  }).finally(() => conn.close()) as Promise<T>
}

export async function loadSession(): Promise<StoredSession | null> {
  try {
    return ((await tx('readonly', (s) => s.get(KEY))) as StoredSession | undefined) ?? null
  } catch {
    return null
  }
}

/** On open: remember the input (copies — the originals go to the worker). */
export async function rememberFiles(input: OpenInput, handle: FileSystemDirectoryHandle | null): Promise<void> {
  const record: StoredSession = {
    name: input.name,
    kind: input.kind,
    files: input.files.map((f) => ({ path: f.path, bytes: f.bytes.slice(0) })),
    main: input.main,
    handle,
    state: null,
    savedAt: null,
  }
  await tx('readwrite', (s) => s.put(record, KEY)).catch((e) => console.warn('autosave unavailable', e))
}

export async function rememberState(state: string | null): Promise<void> {
  const record = await loadSession()
  if (!record) return
  record.state = state
  record.savedAt = state ? Date.now() : null
  await tx('readwrite', (s) => s.put(record, KEY)).catch((e) => console.warn('autosave failed', e))
}

export async function forgetSession(): Promise<void> {
  await tx('readwrite', (s) => s.delete(KEY)).catch(() => undefined)
}
