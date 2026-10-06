import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { App } from './App'
import { ErrorBoundary } from './ui/ErrorBoundary'
import { PYODIDE_VERSION } from './worker/pyodide-version'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)

// Offline start after the first visit (public/sw.js). Not in dev: it would
// cache Vite's modules.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  const url = `${import.meta.env.BASE_URL}sw.js?pyodide=${PYODIDE_VERSION}`
  navigator.serviceWorker.register(url).catch((err) => console.warn('service worker not registered', err))
}
