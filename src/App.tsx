import { useCallback, useState } from 'react'
import { InputError, type FontInput } from './files'
import { python, useRuntime } from './runtime'
import { WorkerError } from './worker/client'
import type { FontSummary } from './worker/protocol'
import { FontPanel } from './ui/FontPanel'
import { StartScreen } from './ui/StartScreen'

export type OpenFont = {
  name: string
  kind: 'folder' | 'ufoz'
  summary: FontSummary
  handle: FileSystemDirectoryHandle | null
}

export function App() {
  const runtime = useRuntime()
  const [font, setFont] = useState<OpenFont | null>(null)
  const [opening, setOpening] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const open = useCallback(async (pending: Promise<FontInput | null>) => {
    setError(null)
    try {
      const got = await pending
      if (!got) return
      const { input, handle } = got
      setOpening(input.name)
      const summary = await python.call('open', [input], input.files.map((f) => f.bytes))
      setFont({ name: input.name, kind: input.kind, summary, handle })
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
  }, [])

  return (
    <div className="min-h-screen flex flex-col">
      <header className="flex items-center gap-3 border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
        <h1 className="text-sm font-semibold tracking-tight">Groups Control</h1>
        <span className="text-xs text-zinc-500">kerning groups &amp; kerning for UFO</span>
        {font && (
          <span className="ml-auto truncate text-xs text-zinc-500" title={font.name}>
            {font.name}
          </span>
        )}
      </header>
      <main className="flex flex-1 flex-col">
        {font ? (
          <FontPanel font={font} onClose={close} />
        ) : (
          <StartScreen runtime={runtime} opening={opening} error={error} onOpen={open} />
        )}
      </main>
    </div>
  )
}
