import { useRef, useState, type DragEvent } from 'react'
import { canPickFolder, fromDrop, fromFile, pickFolder, type FontInput } from '../files'
import type { RuntimeState } from '../runtime'

const STAGE_LABEL = {
  runtime: 'Loading Python…',
  packages: 'Loading font libraries…',
  python: 'Starting…',
} as const

type Props = {
  runtime: RuntimeState
  opening: string | null
  error: string | null
  onOpen: (pending: Promise<FontInput | null>) => void
}

export function StartScreen({ runtime, opening, error, onOpen }: Props) {
  const [over, setOver] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    // fromDrop must run synchronously inside the event.
    onOpen(fromDrop(e.dataTransfer))
  }

  return (
    <div
      className="flex flex-1 items-center justify-center p-6"
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setOver(false)
      }}
      onDrop={onDrop}
    >
      <div className="w-full max-w-xl">
        <div
          className={`rounded-xl border-2 border-dashed px-8 py-12 text-center transition-colors ${
            over
              ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40'
              : 'border-zinc-300 dark:border-zinc-700'
          }`}
        >
          {opening ? (
            <p className="text-sm">
              Opening <span className="font-medium">{opening}</span>
              {runtime.status === 'loading' ? ' — waiting for Python…' : '…'}
            </p>
          ) : (
            <>
              <p className="text-base font-medium">Drop a .ufo folder or a .ufoz file</p>
              <div className="mt-5 flex justify-center gap-3">
                {canPickFolder && (
                  <button
                    type="button"
                    className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                    onClick={() => onOpen(pickFolder())}
                  >
                    Open .ufo folder…
                  </button>
                )}
                <button
                  type="button"
                  className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                  onClick={() => fileInput.current?.click()}
                >
                  Open .ufoz…
                </button>
                <input
                  ref={fileInput}
                  type="file"
                  accept=".ufoz"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    e.target.value = ''
                    if (file) onOpen(fromFile(file))
                  }}
                />
              </div>
            </>
          )}
        </div>

        {error && (
          <p role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950/50 dark:text-red-200">
            {error}
          </p>
        )}

        <RuntimeStatus runtime={runtime} />

        <p className="mt-8 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
          <span className="font-medium text-zinc-900 dark:text-zinc-100">Your fonts never leave this computer.</span>{' '}
          Everything runs inside this browser tab: there is no server and nothing is uploaded, so it is safe
          for fonts under NDA. Saving writes back into the folder you opened (Chrome, Edge) or downloads a
          file.
        </p>
      </div>
    </div>
  )
}

function RuntimeStatus({ runtime }: { runtime: RuntimeState }) {
  if (runtime.status === 'failed') {
    return (
      <p role="alert" className="mt-4 text-sm text-red-700 dark:text-red-300">
        Python failed to start: {runtime.error}. Check the connection and reload the page.
      </p>
    )
  }
  if (runtime.status === 'ready') {
    return (
      <p className="mt-4 text-xs text-zinc-500" title={JSON.stringify(runtime.versions)}>
        Ready · Python {runtime.versions.python} · started in {(runtime.ms / 1000).toFixed(1)} s
      </p>
    )
  }
  return (
    <div className="mt-4" aria-live="polite">
      <div className="flex justify-between text-xs text-zinc-500">
        <span>{STAGE_LABEL[runtime.stage]}</span>
        <span>first visit downloads ≈ 7 MB</span>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded bg-zinc-200 dark:bg-zinc-800">
        <div
          className="h-full bg-blue-500 transition-[width] duration-500"
          style={{ width: `${Math.max(5, runtime.fraction * 100)}%` }}
        />
      </div>
    </div>
  )
}
