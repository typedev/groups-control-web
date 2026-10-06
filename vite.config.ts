/// <reference types="vitest/config" />
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The version lives in package.json (scripts/bump_version.py keeps
// pyproject.toml in step); the commit and date say which build this is.
const version: string = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')).version
function commit(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return 'dev'
  }
}

// GitHub Pages serves the site under /groups-control-web/. The worker loads
// wheels by absolute path, so the base must be absolute (not './').
export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/groups-control-web/' : '/',
  plugins: [react(), tailwindcss()],
  worker: { format: 'es' },
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __BUILD_COMMIT__: JSON.stringify(commit()),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
  test: { include: ['src/**/*.test.ts'] },
}))
