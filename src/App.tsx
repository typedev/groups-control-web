import { useCallback, useEffect, useRef, useState } from 'react'
import { changedOnDisk, fromFolderHandle, InputError, type FontInput } from './files'
import { FontModel } from './model/font'
import { python, useRuntime } from './runtime'
import { download, ensurePermission, sidecarName, ufozName, writeToFolder, WriteError } from './save'
import { forgetSession, loadSession, rememberFiles, rememberState, type StoredSession } from './session'
import { WorkerError } from './worker/client'
import type { DesignspaceChange, DesignspaceInfo, EditScope, FontSummary, OpenInput, OpResult } from './worker/protocol'
import { useDialogs } from './ui/Dialog'
import { AppearanceMenu, Button, HelpButton, ProgressBar, ScopeSelect, Select, type Progress } from './ui/controls'
import { HelpDrawer } from './ui/HelpDrawer'
import { setHelpContext, showHelp, toggleHelp, useHelp } from './help'
import { APP_VERSION, VERSION_TITLE } from './version'
import { GroupsControl } from './ui/GroupsControl'
import { StartScreen } from './ui/StartScreen'

export type OpenFont = {
  name: string
  kind: OpenInput['kind']
  summary: FontSummary
  handle: FileSystemDirectoryHandle | null
  model: FontModel
  dirty: boolean
}

export function App() {
  const runtime = useRuntime()
  const help = useHelp()
  const [font, setFont] = useState<OpenFont | null>(null)
  const [opening, setOpening] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [stored, setStored] = useState<StoredSession | null>(null)
  const { ask, element: dialog } = useDialogs()
  const [progress, setProgress] = useState<Progress | null>(null)
  // Saving in progress: the UI is frozen until the files are on disk.
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  // Designspace: mirrors of masters already shown (read-only for now, so they stay valid).
  const models = useRef(new Map<number, FontModel>())

  useEffect(
    () =>
      python.onEvent((e) => {
        if (e.type === 'openProgress') setProgress({ label: e.label, done: e.done, total: e.total })
      }),
    [],
  )

  useEffect(() => {
    if (!font) setHelpContext('overview')
  }, [font])

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
      models.current.clear()
      // Copies the bytes synchronously, before they are transferred to the worker.
      const remembered = rememberFiles(input, handle)
      const t0 = performance.now()
      const summary = await python.call('open', [input], input.files.map((f) => f.bytes))
      if (summary.designspace) logDesignspace(summary.designspace, performance.now() - t0)
      let model = new FontModel(await python.call('fontData', []))
      let dirty = false
      let restored = summary
      if (restore) {
        const res = await python.call('restoreState', [restore])
        model = model.withDelta(res.delta)
        dirty = res.dirty
        restored = withDesignspace(summary, res)
      }
      await remembered
      if (restore) await rememberState(dirty ? restore : null)
      setStored(null)
      setFont({ name: input.name, kind: input.kind, summary: restored, handle, model, dirty })
    } catch (err) {
      if (err instanceof InputError || err instanceof WorkerError) setError(err.message)
      else {
        console.error(err)
        setError(String(err))
      }
    } finally {
      setOpening(null)
      setProgress(null)
    }
  }, [])

  const showError = useCallback(
    async (title: string, err: unknown) => {
      if (!(err instanceof WorkerError)) console.error(err)
      await ask({ title, body: err instanceof Error ? err.message : String(err), buttons: [{ label: 'OK', value: 'ok', kind: 'suggested' }] })
    },
    [ask],
  )

  const chooseDesignspace = useCallback(
    async (names: string[]) => {
      const answer = await ask({
        title: 'Open which designspace?',
        body: 'This folder has more than one.',
        buttons: [{ label: 'Cancel', value: '' }, ...names.map((n) => ({ label: n, value: n }))],
      })
      return answer.value || null
    },
    [ask],
  )

  /** An edit changed other masters: their cached mirrors are rebuilt on the next switch. */
  const dropStale = (change: DesignspaceChange) => change.others?.forEach((i) => models.current.delete(i))

  const setEditScope = useCallback(async (scope: EditScope) => {
    const info = await python.call('setEditScope', [scope])
    if (info) setFont((f) => (f ? { ...f, summary: { ...f.summary, designspace: info } } : f))
  }, [])

  /** Designspace: make another master current; its mirror is built once, then cached. */
  const switchMaster = useCallback(
    async (index: number) => {
      const f = fontRef.current
      if (!f?.summary.designspace) return
      try {
        const t0 = performance.now()
        models.current.set(f.summary.designspace.current, f.model)
        const summary = await python.call('switchMaster', [index])
        const model = models.current.get(index) ?? new FontModel(await python.call('fontData', []))
        models.current.set(index, model)
        logDesignspace(summary.designspace!, performance.now() - t0)
        setFont((cur) => (cur ? { ...cur, summary, model } : cur))
      } catch (err) {
        await showError('Switching master failed', err)
      } finally {
        setProgress(null)
      }
    },
    [showError],
  )

  // Dev only: lets a browser-automation session open an input without a drop.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const w = window as unknown as { __gcOpen?: (input: OpenInput) => Promise<void> }
    w.__gcOpen = (input) => open(Promise.resolve({ input, handle: null }))
    return () => void delete w.__gcOpen
  }, [open])

  /** Run one worker edit and apply its delta to the mirror. */
  const run = useCallback(
    async <R,>(call: () => Promise<OpResult<R>>): Promise<OpResult<R> | null> => {
      try {
        const res = await call()
        dropStale(res)
        setFont((f) =>
          f ? { ...f, model: f.model.withDelta(res.delta), dirty: res.dirty, summary: withDesignspace(f.summary, res) } : f,
        )
        setStatus(null)
        return res
      } catch (err) {
        await showError('Edit failed', err)
        return null
      }
    },
    [showError],
  )

  const matchOrder = useCallback(async () => {
    const res = await run(() => python.call('matchOrder', []))
    if (res) {
      const { masters, groups } = res.result
      setStatus(`Order matched: ${groups} group${groups === 1 ? '' : 's'} in ${masters} master${masters === 1 ? '' : 's'}`)
    }
  }, [run])

  const save = useCallback(async () => {
    const f = fontRef.current
    if (!f || f.summary.readOnlyReason || savingRef.current) return
    savingRef.current = true
    setSaving(true)
    // Dialogs need the keyboard: unfreeze before showing one.
    const unfreeze = () => {
      setProgress(null)
      savingRef.current = false
      setSaving(false)
    }
    try {
      if (f.handle) {
        const files = await python.call('changedFiles', [])
        try {
          await writeToFolder(f.handle, files, (done, total) => total > 3 && setProgress({ label: 'Saving', done, total }))
        } catch (err) {
          if (!(err instanceof WriteError)) throw err
          // Masters written in full count as saved; the rest stay dirty for the next Save.
          const res = await python.call('markSaved', [err.written])
          setFont((cur) => (cur ? { ...cur, dirty: res.dirty } : cur))
          setStatus(`Save stopped: ${err.written.length} of ${files.length} files written`)
          unfreeze()
          await showError(
            'Save stopped part way',
            `${err.message}\n\n${err.written.length} of ${files.length} files were written. ` +
              'The masters not written in full still have unsaved changes: Save again to write them.',
          )
          return
        }
        await python.call('markSaved', [])
        setStatus(savedStatus(files.map((x) => x.name)))
      } else if (f.summary.designspace) {
        if (!f.dirty) {
          setStatus('Nothing to save')
          return
        }
        const name = sidecarName(f.name.replace(/\.designspace$/i, ''), '_changes.zip')
        const zip = await python.call('buildChangesZip', [name])
        download(name, zip.bytes)
        await python.call('markSaved', [])
        setStatus(
          `Downloaded ${name}: unzip it into the designspace folder` +
            (zip.deleted.length ? `, then delete ${zip.deleted.join(', ')}` : ''),
        )
      } else {
        const name = ufozName(f.name)
        download(name, await python.call('buildUfoz', [name]))
        await python.call('markSaved', [])
        setStatus(`Downloaded ${name}`)
      }
      setFont((cur) => (cur ? { ...cur, dirty: false } : cur))
    } catch (err) {
      unfreeze()
      await showError('Save failed', err)
    } finally {
      unfreeze()
    }
  }, [showError])

  // While saving, no key reaches the app (capture phase on window runs first).
  useEffect(() => {
    if (!saving) return
    const block = (e: KeyboardEvent) => {
      e.stopPropagation()
      e.preventDefault()
    }
    window.addEventListener('keydown', block, true)
    window.addEventListener('keyup', block, true)
    ;(document.activeElement as HTMLElement | null)?.blur()
    return () => {
      window.removeEventListener('keydown', block, true)
      window.removeEventListener('keyup', block, true)
    }
  }, [saving])

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
      dropStale(delta)
      setFont((f) => (f ? { ...f, model: f.model.withDelta(delta), dirty: false, summary: withDesignspace(f.summary, delta) } : f))
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

  /**
   * Restore re-opens the copies stored at open time. When the folder is at
   * hand (Chromium), first check that what Save would overwrite has not
   * changed on disk since (e.g. a git pull), and let the user choose.
   */
  const restoreSession = useCallback(async () => {
    const s = await loadSession()
    if (!s?.state) return
    const handle = s.handle
    let allowed = false
    try {
      allowed = !!handle && (await ensurePermission(handle))
    } catch {
      allowed = false
    }
    if (handle && allowed) {
      let changed: string[] = []
      try {
        changed = await changedOnDisk(handle, s.files)
      } catch (err) {
        console.warn('could not compare with the folder', err)
      }
      if (changed.length) {
        const shown = changed.slice(0, 12).join('\n') + (changed.length > 12 ? `\n… and ${changed.length - 12} more` : '')
        const answer = await ask({
          title: 'Files changed on disk',
          body:
            `Since these edits were stored, ${changed.length === 1 ? 'this file has' : 'these files have'} changed in ${handle.name}:\n\n${shown}\n\n` +
            'Restore anyway: your edits come back on top of the copies stored back then; saving writes them over the changes on disk.\n' +
            'Open from disk: the unsaved edits are dropped and the font opens as it is now.',
          buttons: [
            { label: 'Cancel', value: 'cancel' },
            { label: 'Open from disk', value: 'disk' },
            { label: 'Restore anyway', value: 'restore', kind: 'destructive' },
          ],
        })
        if (answer.value === 'disk') {
          await forgetSession()
          setStored(null)
          const main = s.main?.split('/').pop()
          await open(
            fromFolderHandle(handle, async (names) => (main && names.includes(main) ? main : chooseDesignspace(names)), (label, done, total) =>
              setProgress({ label, done, total }),
            ),
          )
          return
        }
        if (answer.value !== 'restore') return
      }
    }
    await open(Promise.resolve({ input: { name: s.name, kind: s.kind, files: s.files, main: s.main }, handle }), s.state)
  }, [open, ask, chooseDesignspace])

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
        return
      }
      // ? or F1 toggles the help, unless typing in a field.
      const t = e.target as HTMLElement | null
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
      if (e.key === 'F1' || (e.key === '?' && !typing && !e.metaKey && !e.ctrlKey)) {
        e.preventDefault()
        toggleHelp()
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
    <div className="relative flex h-screen flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-surface px-4">
        <h1 className="flex items-baseline gap-1.5 text-[15px] font-semibold tracking-tight">
          Groups Control
          <span className="text-xs font-normal tabular-nums text-muted" title={VERSION_TITLE}>
            v{APP_VERSION}
          </span>
        </h1>
        {font ? (
          <>
            <span className="min-w-0 truncate text-[13px] text-muted" title={font.name}>
              {font.dirty && (
                <span className="mr-1.5 inline-block size-2 rounded-full bg-accent align-middle" title="Unsaved changes" />
              )}
              {/* A designspace: its name here, the master in the dropdown (saves header room). */}
              {!font.summary.designspace && <span className="mr-1.5 text-ink">{title}</span>}
              <span className={font.summary.designspace ? 'text-ink' : ''}>{font.name}</span>
            </span>
            {readOnly && (
              <span
                className="rounded-md bg-careful-soft px-2 py-0.5 text-xs font-medium text-careful"
                title={font.summary.readOnlyReason ?? ''}
              >
                Read-only
              </span>
            )}
            {font.summary.hasMetricsRules && (
              <span
                className="rounded-md bg-raised px-2 py-0.5 text-xs text-muted"
                title="This font has linked-sidebearing rules (com.typedev.spacing.metricsRules). They are not applied here: margin edits do not update the glyphs that depend on them."
              >
                Metrics rules ignored
              </span>
            )}
            {font.summary.designspace && (
              <MasterPicker info={font.summary.designspace} onSwitch={switchMaster} onScope={setEditScope} onMatchOrder={matchOrder} />
            )}
            {status && <span className="truncate text-xs text-muted">{status}</span>}
            <Button className="ml-auto" disabled={readOnly || !font.dirty} onClick={revert}>
              Revert
            </Button>
            <Button
              variant="primary"
              disabled={readOnly || (!font.dirty && (!!font.handle || !!font.summary.designspace))}
              onClick={save}
              title={saveTitle(font)}
            >
              {font.handle ? 'Save' : font.summary.designspace ? 'Download changes' : 'Download .ufoz'}
            </Button>
            <Button variant="ghost" onClick={close}>
              Close
            </Button>
            <Button variant="ghost" aria-pressed={help.open} title="Help (?)" onClick={toggleHelp} className={help.open ? 'bg-accent-soft text-accent' : ''}>
              Help
            </Button>
            <AppearanceMenu />
          </>
        ) : (
          <>
            <span className="text-[13px] text-muted">Kerning groups and kerning for UFO fonts</span>
            <span className="ml-auto flex items-center gap-1">
              <Button variant="ghost" aria-pressed={help.open} title="Help (?)" onClick={toggleHelp} className={help.open ? 'bg-accent-soft text-accent' : ''}>
                Help
              </Button>
              <AppearanceMenu />
            </span>
          </>
        )}
      </header>
      {font && progress && !saving && (
        <ProgressBar progress={progress} className="absolute inset-x-0 top-12 z-20 border-b border-line bg-surface/95 px-4 py-1.5" />
      )}
      {saving && (
        <div className="absolute inset-0 z-40 flex cursor-wait items-center justify-center bg-surface/50" aria-busy="true" aria-live="polite">
          <div className="w-80 rounded-xl border border-line bg-surface px-4 py-3 shadow-lg">
            <ProgressBar progress={progress ?? { label: 'Saving', done: 0, total: 0 }} />
          </div>
        </div>
      )}
      <div className="flex min-h-0 flex-1">
      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        {font ? (
          <GroupsControl
            font={font.model}
            fontName={font.name}
            readOnly={readOnly}
            run={run}
            ask={ask}
            designspace={font.summary.designspace}
          />
        ) : (
          <StartScreen
            runtime={runtime}
            opening={opening}
            error={error}
            onOpen={(p) => open(p)}
            chooseDesignspace={chooseDesignspace}
            progress={progress}
            onProgress={(label, done, total) => setProgress({ label, done, total })}
            stored={stored}
            onRestore={restoreSession}
            onDiscard={discardSession}
          />
        )}
      </main>
      {help.open && <HelpDrawer />}
      </div>
      {dialog}
    </div>
  )
}

function saveTitle(font: OpenFont): string {
  if (font.summary.designspace) {
    return font.handle
      ? 'Write the changed masters back into the designspace folder (Ctrl+S)'
      : 'Download the changed files as a .zip to unzip into the designspace folder (Ctrl+S)'
  }
  return font.handle ? 'Write the changed files back into the folder (Ctrl+S)' : 'Download the font as .ufoz (Ctrl+S)'
}

/** "Saved groups.plist, kerning.plist"; many files (a designspace) are counted instead. */
function savedStatus(names: string[]): string {
  if (!names.length) return 'Nothing to save'
  if (names.length <= 3) return `Saved ${names.join(', ')}`
  const ufos = new Set(names.flatMap((n) => n.split('/').slice(0, -1).filter((p) => /\.ufo$/i.test(p))))
  if (!ufos.size) return `Saved ${names.length} files`
  return `Saved ${names.length} files in ${ufos.size} ${ufos.size === 1 ? 'master' : 'masters'}`
}

function withDesignspace(summary: FontSummary, change: DesignspaceChange): FontSummary {
  return change.designspace ? { ...summary, designspace: change.designspace } : summary
}

/** Selector labels say how many masters an edit reaches, so no master is left out by surprise. */
function scopeLabel(scope: EditScope, info: DesignspaceInfo): string {
  const n = info.reach[scope]
  const all = info.masters.length
  const count = n === all ? `${n}` : `${n} of ${all}`
  if (scope === 'compatibleAll') return `Edit all compatible masters (${count})`
  if (scope === 'compatible') return `Edit compatible ${info.subspace} masters (${count})`
  return 'Edit this master only'
}

const SCOPE_TITLE: Record<EditScope, string> = {
  compatibleAll:
    'Group edits reach every master whose kern groups are the same as this one (upright and italic alike). Each master remaps its own kerning. Masters with different groups are left out: see the badge.',
  compatible:
    'Group edits reach the masters with the same kern groups in this discrete subspace only (e.g. upright, not italic).',
  master: 'Group edits change this master only — for bringing masters with different groups in line.',
}

function logDesignspace(info: DesignspaceInfo, ms: number) {
  const t = info.timings
  console.info(
    `[designspace] ${info.file}: ${info.masters.length} masters, ${info.sets} group set(s); ` +
      `parse ${t.parseMs} ms, open masters ${t.mastersMs} ms, activate ${t.activateMs} ms; ` +
      `round trip ${Math.round(ms)} ms`,
  )
}

/** Header: master dropdown plus the kern-group compatibility of the current master. */
function MasterPicker({
  info,
  onSwitch,
  onScope,
  onMatchOrder,
}: {
  info: DesignspaceInfo
  onSwitch: (index: number) => void
  onScope: (scope: EditScope) => void
  onMatchOrder: () => void
}) {
  // Masters that differ only in member order, within the scope's reach (api._order_only_targets).
  const here = JSON.stringify(info.masters[info.current].discrete)
  const orderOnly =
    info.scope === 'master'
      ? []
      : info.masters.filter(
          (m, i) =>
            i !== info.current &&
            m.vsCurrent.level === 'order' &&
            (info.scope === 'compatibleAll' || JSON.stringify(m.discrete) === here),
        )
  const discrete = info.axes.some((a) => a.discrete)
  const scopes: EditScope[] = discrete ? ['compatibleAll', 'compatible', 'master'] : ['compatibleAll', 'master']
  const describe = (i: number) => {
    const m = info.masters[i]
    const d = m.vsCurrent
    const vs =
      i === info.current
        ? ''
        : d.level === 'identical'
          ? ''
          : d.level === 'order'
            ? ` · order differs in ${d.order}`
            : ` · groups differ (${d.onlyHere} only here, ${d.onlyThere} only there, ${d.members} members)`
    return `${m.name}${m.isDefault ? ' (default)' : ''}${vs}`
  }
  const all = info.masters.length
  const allSame = info.sets === 1
  const okHere = info.compatibleInSubspace === info.subspaceSize
  const badge = allSame
    ? `Groups identical in all ${all}`
    : `${info.compatibleInSubspace}/${info.subspaceSize} compatible${info.subspaceSize < all ? ' in subspace' : ''} · ${info.sets} group sets`
  const title = info.masters
    .map((m, i) => {
      const sample = i !== info.current && m.vsCurrent.sample.length ? ` — ${m.vsCurrent.sample.join(', ')}` : ''
      return `${i === info.current ? '▸ ' : '  '}${describe(i)}${sample}`
    })
    .join('\n')
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Select
        className="max-w-72"
        value={info.current}
        onChange={(e) => onSwitch(Number(e.target.value))}
        title={`${info.file}: ${all} masters`}
      >
        {info.masters.map((_m, i) => (
          <option key={i} value={i}>
            {describe(i)}
          </option>
        ))}
      </Select>
      <ScopeSelect
        className="max-w-72 shrink-0"
        careful={info.scope !== 'compatibleAll'}
        value={info.scope}
        onChange={(e) => onScope(e.target.value as EditScope)}
        title={SCOPE_TITLE[info.scope]}
        aria-label="Which masters group edits reach"
      >
        {scopes.map((s) => (
          <option key={s} value={s} className="bg-surface font-normal text-ink">
            {scopeLabel(s, info)}
          </option>
        ))}
      </ScopeSelect>
      <HelpButton onClick={() => showHelp('designspace')} label="About designspaces and the edit scope" />
      <span
        className={`whitespace-nowrap rounded-md px-2 py-0.5 text-xs ${allSame || okHere ? 'bg-raised text-muted' : 'bg-careful-soft font-medium text-careful'}`}
        title={title}
      >
        {badge}
      </span>
      {orderOnly.length > 0 && (
        <Button
          className="h-7 px-2 text-xs"
          onClick={onMatchOrder}
          title={`Copy this master's member order (key glyphs included) to ${orderOnly.length} master${
            orderOnly.length === 1 ? '' : 's'
          } whose kern groups differ only in order: ${orderOnly.map((m) => m.name).join(', ')}. Kerning is not changed.`}
        >
          Match order ({orderOnly.length})
        </Button>
      )}
    </span>
  )
}
