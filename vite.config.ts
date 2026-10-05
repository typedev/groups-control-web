/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// GitHub Pages serves the site under /groups-control-web/. The worker loads
// wheels by absolute path, so the base must be absolute (not './').
export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/groups-control-web/' : '/',
  plugins: [react(), tailwindcss()],
  worker: { format: 'es' },
  test: { include: ['src/**/*.test.ts'] },
}))
