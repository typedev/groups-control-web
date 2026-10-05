// State of the help drawer: open or not (kept per browser), the topic of the
// panel in use, and an optional topic the user picked (pinned until "Auto").
import { useSyncExternalStore } from 'react'

export type HelpTopic = 'overview' | 'font' | 'groups' | 'pairs' | 'preview' | 'keepKerning' | 'saving'

type State = { open: boolean; context: HelpTopic; pinned: HelpTopic | null }

const KEY = 'gc.help'
const listeners = new Set<() => void>()

function readOpen(): boolean {
  try {
    return localStorage.getItem(KEY) === 'open'
  } catch {
    return false
  }
}

let state: State = { open: readOpen(), context: 'overview', pinned: null }

function set(next: Partial<State>) {
  state = { ...state, ...next }
  try {
    localStorage.setItem(KEY, state.open ? 'open' : 'closed')
  } catch {
    // private mode
  }
  listeners.forEach((fn) => fn())
}

export const toggleHelp = () => set({ open: !state.open })
export const closeHelp = () => set({ open: false })
/** Open the drawer on one topic and keep it there. */
export const showHelp = (topic: HelpTopic) => set({ open: true, pinned: topic })
export const pinHelp = (topic: HelpTopic | null) => set({ pinned: topic })
/** The panel in use changed (followed unless a topic is pinned). */
export const setHelpContext = (context: HelpTopic) => {
  if (state.context !== context) set({ context })
}

const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export const useHelp = () => useSyncExternalStore(subscribe, () => state)
