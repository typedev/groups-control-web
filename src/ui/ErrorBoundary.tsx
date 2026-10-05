// Last line of defence: a render error shows a message instead of a blank page.
import { Component, type ReactNode } from 'react'

type State = { error: Error | null }

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error(error)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="mx-auto mt-24 max-w-lg p-6 text-sm">
        <h1 className="text-base font-semibold">Something went wrong</h1>
        <p className="mt-2 text-muted">
          The page hit an error and stopped drawing. Your font file on disk is untouched; unsaved edits in this tab
          may be lost when you reload.
        </p>
        <pre className="mt-3 overflow-auto rounded bg-raised p-2 text-xs">{this.state.error.message}</pre>
        <button
          type="button"
          className="mt-4 rounded-md border border-line px-3 py-1.5 hover:bg-raised"
          onClick={() => location.reload()}
        >
          Reload
        </button>
      </div>
    )
  }
}
