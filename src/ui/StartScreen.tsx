import { useRef, useState, type DragEvent } from 'react'
import { canPickFolder, fromDrop, fromFile, pickFolder, type ChooseDesignspace, type FontInput, type ReadProgress } from '../files'
import { ProgressBar, type Progress } from './controls'
import type { RuntimeState } from '../runtime'
import type { StoredSession } from '../session'

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
  chooseDesignspace: ChooseDesignspace
  /** Opening progress (reading files, then the worker); null when idle. */
  progress: Progress | null
  onProgress: ReadProgress
  stored: StoredSession | null
  onRestore: () => void
  onDiscard: () => void
}

export function StartScreen({ runtime, opening, error, onOpen, chooseDesignspace, progress, onProgress, stored, onRestore, onDiscard }: Props) {
  const [over, setOver] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    // fromDrop must run synchronously inside the event.
    onOpen(fromDrop(e.dataTransfer, chooseDesignspace, onProgress))
  }

  return (
    <div
      className="flex flex-1 flex-col items-center p-6"
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setOver(false)
      }}
      onDrop={onDrop}
    >
      <div className="my-auto w-full max-w-xl pt-6">
        <Title />
        <div
          className={`rounded-2xl border-2 border-dashed px-8 py-10 text-center transition-colors ${
            over ? 'border-accent bg-accent-soft' : 'border-line-strong bg-surface/60'
          }`}
        >
          {opening || progress ? (
            <>
              <p className="text-sm">
                Opening{opening && <span className="font-medium"> {opening}</span>}
                {opening && runtime.status === 'loading' ? ' — waiting for Python…' : '…'}
              </p>
              {progress && <ProgressBar progress={progress} className="mx-auto mt-3 max-w-sm text-left" />}
            </>
          ) : (
            <>
              <p className="text-[15px] font-medium">Drop a .ufo folder, a .ufoz file or a designspace folder here</p>
              <p className="mt-1 text-[13px] text-muted">or open one</p>
              <div className="mt-4 flex justify-center gap-3">
                {canPickFolder && (
                  <button
                    type="button"
                    className="h-9 rounded-lg bg-accent px-4 text-[13px] font-medium text-accent-ink hover:brightness-110"
                    onClick={() => onOpen(pickFolder(chooseDesignspace, onProgress))}
                    title="A .ufo folder, or a folder with a .designspace and its masters"
                  >
                    Open folder…
                  </button>
                )}
                <button
                  type="button"
                  className="h-9 rounded-lg border border-line bg-surface px-4 text-[13px] font-medium hover:bg-raised"
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

        {stored && !opening && (
          <div className="mt-4 flex items-center gap-3 rounded-md border border-accent/40 bg-accent-soft px-3 py-2 text-[13px]">
            <span className="min-w-0 flex-1">
              Unsaved edits to <span className="font-medium">{stored.name}</span>
              {stored.savedAt ? ` from ${new Date(stored.savedAt).toLocaleString()}` : ''}
            </span>
            <button type="button" className="h-8 rounded-lg bg-accent px-3 font-medium text-accent-ink hover:brightness-110" onClick={onRestore}>
              Restore
            </button>
            <button type="button" className="rounded-lg h-8 px-3 hover:bg-surface/60" onClick={onDiscard}>
              Discard
            </button>
          </div>
        )}

        {error && (
          <p role="alert" className="mt-4 rounded-lg bg-error-soft px-3 py-2 text-[13px] text-error">
            {error}
          </p>
        )}

        <RuntimeStatus runtime={runtime} />

        <p className="mt-8 text-sm leading-relaxed text-muted">
          <span className="font-medium text-ink">Your fonts never leave this computer.</span>{' '}
          Everything runs inside this browser tab: there is no server and nothing is uploaded, so it is safe
          for fonts under NDA. Saving writes back into the folder you opened (Chrome, Edge) or downloads a
          file.
        </p>
      </div>
      <Credits />
    </div>
  )
}

function RuntimeStatus({ runtime }: { runtime: RuntimeState }) {
  if (runtime.status === 'failed') {
    return (
      <p role="alert" className="mt-4 text-[13px] text-error">
        Python failed to start: {runtime.error}. Check the connection and reload the page.
      </p>
    )
  }
  if (runtime.status === 'ready') {
    return (
      <p className="mt-4 text-xs text-muted" title={JSON.stringify(runtime.versions)}>
        Ready · Python {runtime.versions.python} · started in {(runtime.ms / 1000).toFixed(1)} s
      </p>
    )
  }
  return (
    <div className="mt-4" aria-live="polite">
      <div className="flex justify-between text-xs text-muted">
        <span>{STAGE_LABEL[runtime.stage]}</span>
        <span>first visit downloads ≈ 7 MB</span>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded bg-raised">
        <div
          className="h-full bg-accent transition-[width] duration-500"
          style={{ width: `${Math.max(5, runtime.fraction * 100)}%` }}
        />
      </div>
    </div>
  )
}

/**
 * The name, set large, with one of its pairs kerned: "C o" closed up and
 * marked the way the preview marks a kerning value. IBM Plex Sans has no
 * kerning for C–o, so the −10 is ours: −0.01 em is −10 units of a 1000 em.
 */
function Title() {
  return (
    <div className="mb-10 text-center">
      <h2 className="text-[clamp(2.75rem,8vw,4.25rem)] font-semibold leading-none tracking-[-0.035em] text-ink">
        Groups{' '}
        <span className="relative inline-block">
          C
          <span
            aria-hidden
            className="absolute left-[calc(100%-0.01em)] top-full mt-1.5 flex -translate-x-1/2 flex-col items-center gap-1 text-[11px] font-medium tracking-normal text-accent"
          >
            <span className="h-[3px] w-5 rounded-full bg-accent" />
            −10
          </span>
        </span>
        <span className="-ml-[0.01em]">ontrol</span>
      </h2>
      <p className="mx-auto mt-14 max-w-md text-[15px] leading-relaxed text-muted">
        Kerning groups and kerning for UFO fonts — sorted, checked and spaced in your browser.
      </p>
    </div>
  )
}

function Credits() {
  return (
    <footer className="mt-10 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-muted">
      <span>
        Made by{' '}
        <a className="text-ink hover:text-accent" href="https://github.com/typedev" target="_blank" rel="noreferrer">
          Alexander Lubovenko
        </a>
      </span>
      <span aria-hidden>·</span>
      <span>
        developed with{' '}
        <a className="text-ink hover:text-accent" href="https://claude.com/claude-code" target="_blank" rel="noreferrer">
          Claude Code
        </a>{' '}
        by Anthropic
      </span>
      <span aria-hidden>·</span>
      <a className="hover:text-accent" href="https://github.com/typedev/groups-control-web" target="_blank" rel="noreferrer">
        source
      </a>
      <span aria-hidden>·</span>
      <span>Apache-2.0</span>
    </footer>
  )
}
