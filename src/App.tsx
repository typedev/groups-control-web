import { useCallback, useState } from 'react'
import { InputError, type FontInput } from './files'
import { FontModel } from './model/font'
import { python, useRuntime } from './runtime'
import { WorkerError } from './worker/client'
import type { FontSummary } from './worker/protocol'
import { GroupsControl } from './ui/GroupsControl'
import { StartScreen } from './ui/StartScreen'

export type OpenFont = {
  name: string
  kind: 'folder' | 'ufoz'
  summary: FontSummary
  handle: FileSystemDirectoryHandle | null
  model: FontModel
}

export function App() {
  const runtime = useRuntime()
  const [font, setFont] = useState<OpenFont | null>(null)
  const [opening, setOpening] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [stats, setStats] = useState('')

  const open = useCallback(async (pending: Promise<FontInput | null>) => {
    setError(null)
    try {
      const got = await pending
      if (!got) return
      const { input, handle } = got
      setOpening(input.name)
      const summary = await python.call('open', [input], input.files.map((f) => f.bytes))
      const model = new FontModel(await python.call('fontData', []))
      setFont({ name: input.name, kind: input.kind, summary, handle, model })
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

  const close = useCallback(async () => {
    await python.call('close', [])
    setFont(null)
    setStats('')
  }, [])

  const title = font
    ? [font.summary.familyName, font.summary.styleName].filter(Boolean).join(' ') || font.name
    : null

  return (
    <div className="flex h-screen flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
        <h1 className="text-sm font-semibold tracking-tight">Groups Control</h1>
        {font ? (
          <>
            <span className="truncate text-xs text-zinc-600 dark:text-zinc-400" title={font.name}>
              {title} <span className="text-zinc-400">· {font.name}</span>
            </span>
            {font.summary.readOnlyReason && (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900 dark:bg-amber-900/50 dark:text-amber-200" title={font.summary.readOnlyReason}>
                read-only
              </span>
            )}
            <span className="ml-auto text-xs text-zinc-500 tabular-nums">{stats}</span>
            <button
              type="button"
              className="rounded-md border border-zinc-300 px-2 py-0.5 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
              onClick={close}
            >
              Close
            </button>
          </>
        ) : (
          <span className="text-xs text-zinc-500">kerning groups &amp; kerning for UFO</span>
        )}
      </header>
      <main className="flex min-h-0 flex-1 flex-col">
        {font ? (
          <GroupsControl font={font.model} onStats={setStats} />
        ) : (
          <StartScreen runtime={runtime} opening={opening} error={error} onOpen={open} />
        )}
      </main>
    </div>
  )
}
