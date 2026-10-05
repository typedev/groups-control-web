import { useCallback, useEffect, useRef, useState } from 'react'
import { InputError, type FontInput } from './files'
import { FontModel } from './model/font'
import { python, useRuntime } from './runtime'
import { download, ufozName, writeToFolder } from './save'
import { forgetSession, loadSession, rememberFiles, rememberState, type StoredSession } from './session'
import { WorkerError } from './worker/client'
import type { FontSummary, OpResult } from './worker/protocol'
import { useDialogs } from './ui/Dialog'
import { GroupsControl } from './ui/GroupsControl'
import { StartScreen } from './ui/StartScreen'

export type OpenFont = {
  name: string
  kind: 'folder' | 'ufoz'
  summary: FontSummary
  handle: FileSystemDirectoryHandle | null
  model: FontModel
  dirty: boolean
}

const headerButton =
  'rounded-md border border-zinc-300 px-2 py-0.5 text-xs hover:bg-zinc-100 disabled:opacity-40 disabled:hover:bg-transparent dark:border-zinc-700 dark:hover:bg-zinc-800'

export function App() {
  const runtime = useRuntime()
  const [font, setFont] = useState<OpenFont | null>(null)
  const [opening, setOpening] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [stats, setStats] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [stored, setStored] = useState<StoredSession | null>(null)
  const { ask, element: dialog } = useDialogs()

  // A session with unsaved edits from an earlier visit can be restored.
  useEffect(() => {
    void loadSession().then((s) => setStored(s?.state ? s : null))
  }, [])
  const fontRef = useRef(font)
  fontRef.current = font

  const open = useCallback(async (pending: Promise<FontInput | null>, restore: string | null = null) => {
    setError(null)
    try {
      const got = await pending
      if (!got) return
      const { input, handle } = got
      setOpening(input.name)
      // Copies the bytes synchronously, before they are transferred to the worker.
      const remembered = rememberFiles(input, handle)
      const summary = await python.call('open', [input], input.files.map((f) => f.bytes))
      let model = new FontModel(await python.call('fontData', []))
      let dirty = false
      if (restore) {
        const res = await python.call('restoreState', [restore])
        model = model.withDelta(res.delta)
        dirty = res.dirty
      }
      await remembered
      if (restore) await rememberState(dirty ? restore : null)
      setStored(null)
      setFont({ name: input.name, kind: input.kind, summary, handle, model, dirty })
    } catch (err) {
      if (err instanceof InputError || err instanceof WorkerError) setError(err.message)
      else {
        console.error(err)
        setError(String(err))
      }
    } finally {
      setOpening(null)
    }
  }, [])

  const showError = useCallback(
    async (title: string, err: unknown) => {
      if (!(err instanceof WorkerError)) console.error(err)
      await ask({ title, body: err instanceof Error ? err.message : String(err), buttons: [{ label: 'OK', value: 'ok', kind: 'suggested' }] })
    },
    [ask],
  )

  /** Run one worker edit and apply its delta to the mirror. */
  const run = useCallback(
    async <R,>(call: () => Promise<OpResult<R>>): Promise<OpResult<R> | null> => {
      try {
        const res = await call()
        setFont((f) => (f ? { ...f, model: f.model.withDelta(res.delta), dirty: res.dirty } : f))
        setStatus(null)
        return res
      } catch (err) {
        await showError('Edit failed', err)
        return null
      }
    },
    [showError],
  )

  const save = useCallback(async () => {
    const f = fontRef.current
    if (!f || f.summary.readOnlyReason) return
    try {
      if (f.handle) {
        const files = await python.call('changedFiles', [])
        await writeToFolder(f.handle, files)
        await python.call('markSaved', [])
        setStatus(files.length ? `Saved ${files.map((x) => x.name).join(', ')}` : 'Nothing to save')
      } else {
        const name = ufozName(f.name)
        download(name, await python.call('buildUfoz', [name]))
        await python.call('markSaved', [])
        setStatus(`Downloaded ${name}`)
      }
      setFont((cur) => (cur ? { ...cur, dirty: false } : cur))
    } catch (err) {
      await showError('Save failed', err)
    }
  }, [showError])

  const revert = useCallback(async () => {
    const answer = await ask({
      title: 'Revert to file?',
      body: 'All changes since the font was opened or last saved will be lost.',
      buttons: [
        { label: 'Cancel', value: 'cancel' },
        { label: 'Revert', value: 'revert', kind: 'destructive' },
      ],
    })
    if (answer.value !== 'revert') return
    try {
      const delta = await python.call('revert', [])
      setFont((f) => (f ? { ...f, model: f.model.withDelta(delta), dirty: false } : f))
      setStatus('Reverted to file')
    } catch (err) {
      await showError('Revert failed', err)
    }
  }, [ask, showError])

  const close = useCallback(async () => {
    if (fontRef.current?.dirty) {
      const answer = await ask({
        title: 'Close without saving?',
        body: 'The font has unsaved changes.',
        buttons: [
          { label: 'Cancel', value: 'cancel' },
          { label: 'Close without saving', value: 'close', kind: 'destructive' },
        ],
      })
      if (answer.value !== 'close') return
    }
    await python.call('close', [])
    await forgetSession()
    setFont(null)
    setStats('')
    setStatus(null)
  }, [ask])

  // Autosave: one second after the last edit, store the state (or drop it once clean).
  useEffect(() => {
    if (!font) return
    const id = setTimeout(async () => {
      if (font.dirty) await rememberState(await python.call('sessionState', []))
      else await rememberState(null)
    }, 1000)
    return () => clearTimeout(id)
  }, [font])

  const restoreSession = useCallback(async () => {
    const s = await loadSession()
    if (!s?.state) return
    await open(Promise.resolve({ input: { name: s.name, kind: s.kind, files: s.files }, handle: s.handle }), s.state)
  }, [open])

  const discardSession = useCallback(async () => {
    await forgetSession()
    setStored(null)
  }, [])

  // Cmd/Ctrl+S saves; leaving the page with unsaved edits asks first.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.code === 'KeyS') {
        e.preventDefault()
        void save()
      }
    }
    const onUnload = (e: BeforeUnloadEvent) => {
      if (fontRef.current?.dirty) e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('beforeunload', onUnload)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('beforeunload', onUnload)
    }
  }, [save])

  const title = font ? [font.summary.familyName, font.summary.styleName].filter(Boolean).join(' ') || font.name : null
  const readOnly = !!font?.summary.readOnlyReason

  return (
    <div className="flex h-screen flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
        <h1 className="text-sm font-semibold tracking-tight">Groups Control</h1>
        {font ? (
          <>
            <span className="truncate text-xs text-zinc-600 dark:text-zinc-400" title={font.name}>
              {font.dirty && <span className="mr-1 text-blue-500" title="Unsaved changes">●</span>}
              {title} <span className="text-zinc-400">· {font.name}</span>
            </span>
            {readOnly && (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900 dark:bg-amber-900/50 dark:text-amber-200" title={font.summary.readOnlyReason ?? ''}>
                read-only
              </span>
            )}
            {font.summary.hasMetricsRules && (
              <span
                className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                title="This font has linked-sidebearing rules (com.typedev.spacing.metricsRules). They are not applied here: margin edits do not update the glyphs that depend on them."
              >
                metrics rules ignored
              </span>
            )}
            {status && <span className="text-xs text-zinc-500">{status}</span>}
            <span className="ml-auto text-xs text-zinc-500 tabular-nums">{stats}</span>
            <button type="button" className={headerButton} disabled={readOnly || !font.dirty} onClick={revert}>
              Revert
            </button>
            <button
              type="button"
              className={headerButton}
              disabled={readOnly || (!font.dirty && !!font.handle)}
              onClick={save}
              title={font.handle ? 'Write groups.plist / kerning.plist back into the folder (Ctrl+S)' : 'Download the font as .ufoz (Ctrl+S)'}
            >
              {font.handle ? 'Save' : 'Download .ufoz'}
            </button>
            <button type="button" className={headerButton} onClick={close}>
              Close
            </button>
          </>
        ) : (
          <span className="text-xs text-zinc-500">kerning groups &amp; kerning for UFO</span>
        )}
      </header>
      <main className="flex min-h-0 flex-1 flex-col">
        {font ? (
          <GroupsControl font={font.model} fontName={font.name} readOnly={readOnly} run={run} ask={ask} onStats={setStats} />
        ) : (
          <StartScreen
            runtime={runtime}
            opening={opening}
            error={error}
            onOpen={(p) => open(p)}
            stored={stored}
            onRestore={restoreSession}
            onDiscard={discardSession}
          />
        )}
      </main>
      {dialog}
    </div>
  )
}
