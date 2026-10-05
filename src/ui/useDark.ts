import { useSyncExternalStore } from 'react'

const query = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null

export function useDark(): boolean {
  return useSyncExternalStore(
    (cb) => {
      query?.addEventListener('change', cb)
      return () => query?.removeEventListener('change', cb)
    },
    () => query?.matches ?? false,
  )
}
