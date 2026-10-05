// Light / dark / system theme. The choice is kept per browser; "system"
// follows prefers-color-scheme live. The effective theme is a `.dark` class
// on <html>, which Tailwind's dark variant and the canvas painters read.
import { useSyncExternalStore } from 'react'

export type ThemeChoice = 'system' | 'light' | 'dark'

/**
 * Accent colours, each tuned for both themes: the light value reaches AA
 * contrast on white, the dark one on the dark surface. Red, green and amber
 * are left out on purpose: they mean negative / positive kerning and caution.
 */
type Tone = { accent: string; ink: string; soft: string }
export const ACCENTS = {
  sky: { name: 'Sky', light: { accent: '#0369a1', ink: '#ffffff', soft: '#dff0fa' }, dark: { accent: '#38bdf8', ink: '#07161f', soft: '#133042' } },
  blue: { name: 'Blue', light: { accent: '#3348d6', ink: '#ffffff', soft: '#e4e8fd' }, dark: { accent: '#8794ff', ink: '#11131a', soft: '#272c4a' } },
  teal: { name: 'Teal', light: { accent: '#0f766e', ink: '#ffffff', soft: '#d9f2ef' }, dark: { accent: '#2dd4bf', ink: '#0b1a19', soft: '#133533' } },
  violet: { name: 'Violet', light: { accent: '#7c3aed', ink: '#ffffff', soft: '#ede5fd' }, dark: { accent: '#b39dff', ink: '#160f2a', soft: '#2e2648' } },
  plum: { name: 'Plum', light: { accent: '#a21caf', ink: '#ffffff', soft: '#f8e3fa' }, dark: { accent: '#e879f9', ink: '#200a24', soft: '#3d1e42' } },
  rose: { name: 'Rose', light: { accent: '#be185d', ink: '#ffffff', soft: '#fbe3ee' }, dark: { accent: '#f472b6', ink: '#230b16', soft: '#42202f' } },
  graphite: { name: 'Graphite', light: { accent: '#334155', ink: '#ffffff', soft: '#e3e7ed' }, dark: { accent: '#cbd5e1', ink: '#11131a', soft: '#2c3038' } },
} satisfies Record<string, { name: string; light: Tone; dark: Tone }>
export type AccentChoice = keyof typeof ACCENTS

const KEY = 'gc.theme'
const ACCENT_KEY = 'gc.accent'
const query = window.matchMedia('(prefers-color-scheme: dark)')
const listeners = new Set<() => void>()

function read(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

let choice: ThemeChoice = read()

function readAccent(): AccentChoice {
  try {
    const v = localStorage.getItem(ACCENT_KEY)
    return v && v in ACCENTS ? (v as AccentChoice) : 'blue'
  } catch {
    return 'blue'
  }
}

let accentChoice: AccentChoice = readAccent()

const isDark = () => choice === 'dark' || (choice === 'system' && query.matches)

export const accentTone = (): Tone => ACCENTS[accentChoice][isDark() ? 'dark' : 'light']

function apply() {
  const root = document.documentElement
  root.classList.toggle('dark', isDark())
  root.style.colorScheme = isDark() ? 'dark' : 'light'
  const tone = accentTone()
  root.style.setProperty('--c-accent', tone.accent)
  root.style.setProperty('--c-accent-ink', tone.ink)
  root.style.setProperty('--c-accent-soft', tone.soft)
  listeners.forEach((fn) => fn())
}

query.addEventListener('change', () => choice === 'system' && apply())
apply()

export function setTheme(next: ThemeChoice) {
  choice = next
  try {
    if (next === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, next)
  } catch {
    // private mode: the choice lasts for this page only
  }
  apply()
}

export function setAccent(next: AccentChoice) {
  accentChoice = next
  try {
    localStorage.setItem(ACCENT_KEY, next)
  } catch {
    // private mode
  }
  apply()
}

const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export const useThemeChoice = () => useSyncExternalStore(subscribe, () => choice)
export const useDark = () => useSyncExternalStore(subscribe, isDark)
export const useAccentChoice = () => useSyncExternalStore(subscribe, () => accentChoice)
/** The accent hex for the effective theme (for canvas painting). */
export const useAccentColor = () => useSyncExternalStore(subscribe, () => accentTone().accent)
