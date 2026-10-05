// Shared controls: one height (32 px), one radius family, theme tokens.
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type InputHTMLAttributes } from 'react'
import { ACCENTS, setAccent, setTheme, useAccentChoice, useDark, useThemeChoice, type AccentChoice, type ThemeChoice } from '../theme'

type Variant = 'default' | 'primary' | 'danger' | 'ghost'

const VARIANT: Record<Variant, string> = {
  default: 'border border-line bg-surface text-ink hover:border-line-strong hover:bg-raised',
  primary: 'border border-transparent bg-accent text-accent-ink hover:brightness-110',
  danger: 'border border-transparent bg-red-600 text-white hover:bg-red-500',
  ghost: 'border border-transparent text-ink hover:bg-raised',
}

export function Button({
  variant = 'default',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      className={`inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-[13px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-40 ${VARIANT[variant]} ${className}`}
      {...props}
    />
  )
}

export function Select({ className = '', children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className={`relative inline-flex ${className}`}>
      <select
        className="h-8 w-full min-w-0 appearance-none rounded-lg border border-line bg-surface pl-2.5 pr-7 text-[13px] text-ink hover:border-line-strong"
        {...props}
      >
        {children}
      </select>
      <svg className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-muted" width="10" height="10" viewBox="0 0 10 10" aria-hidden>
        <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  )
}

export function TextInput({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`h-8 min-w-0 rounded-lg border border-line bg-surface px-2.5 text-[13px] text-ink placeholder:text-muted/70 hover:border-line-strong ${className}`}
      {...props}
    />
  )
}

export function Check({ label, className = '', ...props }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return (
    <label className={`inline-flex cursor-pointer select-none items-center gap-1.5 whitespace-nowrap text-[13px] ${props.disabled ? 'cursor-default opacity-40' : ''} ${className}`}>
      <input type="checkbox" className="size-3.5 accent-[var(--c-accent)]" {...props} />
      {label}
    </label>
  )
}

/** Segmented control (Side 1 | Side 2, theme). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  tone = 'plain',
}: {
  value: T
  options: { value: T; label: ReactNode; title?: string }[]
  onChange: (v: T) => void
  label: string
  /** "accent": a key mode switch (Side 1 / Side 2), filled with the accent. */
  tone?: 'plain' | 'accent'
}) {
  const accent = tone === 'accent'
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={`inline-flex h-8 items-center rounded-lg border p-0.5 ${accent ? 'border-accent/40 bg-accent-soft' : 'border-line bg-raised'}`}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          className={`inline-flex h-full items-center rounded-md px-2.5 text-[13px] font-medium transition-colors ${
            value === o.value
              ? accent
                ? 'bg-accent font-semibold text-accent-ink shadow-sm'
                : 'bg-surface text-ink shadow-sm ring-1 ring-line'
              : accent
                ? 'text-accent hover:bg-accent/10'
                : 'text-muted hover:text-ink'
          }`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** A button with a popover; closes on outside click and Escape. */
export function Menu({ label, children, width = 'w-60' }: { label: ReactNode; children: (close: () => void) => ReactNode; width?: string }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])
  return (
    <div ref={root} className="relative">
      <Button aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {label}
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden className="text-muted">
          <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </Button>
      {open && (
        <div className={`absolute left-0 top-full z-30 mt-1.5 flex ${width} flex-col rounded-xl border border-line bg-surface p-1 shadow-lg`}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

export function MenuItem({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className="rounded-lg px-2.5 py-1.5 text-left text-[13px] text-ink hover:bg-raised disabled:opacity-40 disabled:hover:bg-transparent"
      {...props}
    >
      {children}
    </button>
  )
}

export const MenuSeparator = () => <div className="mx-1 my-1 border-t border-line" />

// -- Keep Kerning: the one control that must never be missed -------------------------

function KeepKerningHelp({ onClose }: { onClose: () => void }) {
  return (
    <div
      role="dialog"
      aria-label="About Keep Kerning"
      className="absolute left-0 top-full z-40 mt-1.5 w-[26rem] rounded-xl border border-line bg-surface p-4 text-[13px] leading-relaxed shadow-xl"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-semibold">Keep Kerning</h3>
        <button type="button" aria-label="Close" className="-mr-1 -mt-1 rounded-md px-1.5 text-muted hover:bg-raised hover:text-ink" onClick={onClose}>
          ✕
        </button>
      </div>
      <p className="mt-1 text-muted">
        Decides what happens to kerning when glyphs change groups. It does not affect reordering, renaming (kerning
        always follows the new name) or editing kerning values.
      </p>
      <h4 className="mt-3 font-semibold text-accent">On — text keeps the same spacing</h4>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">
        <li>
          <b>Adding</b> a glyph to a group: its own pairs that equal the group's are dropped, different ones stay as
          exceptions. A new group takes over the first glyph's pairs.
        </li>
        <li>
          <b>Removing</b> a glyph from a group: it gets the group's pairs as exceptions, so its kerning does not change.
        </li>
        <li>
          <b>Deleting</b> a group: its pairs become exceptions of every member.
        </li>
      </ul>
      <h4 className="mt-3 font-semibold text-careful">Off — groups change, kerning is left as it is</h4>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">
        <li>An added glyph keeps all its own pairs; they override the group's.</li>
        <li>A removed glyph loses the group's kerning.</li>
        <li>A deleted group's pairs are removed.</li>
      </ul>
      <p className="mt-3 text-xs text-muted">Leave it on unless you are rebuilding kerning from scratch.</p>
    </div>
  )
}

export function KeepKerningSwitch({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  const [help, setHelp] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!help) return
    const onDown = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setHelp(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setHelp(false)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [help])
  return (
    <div ref={root} className="relative inline-flex items-center gap-1">
    <button
      type="button"
      role="switch"
      aria-checked={on}
      title={
        on
          ? 'On: glyphs that change groups keep their spacing (exceptions are made where needed). Click to turn off.'
          : 'Off: glyphs that change groups lose or keep pairs as they are. Click to turn on.'
      }
      onClick={() => onChange(!on)}
      className={`group inline-flex h-8 items-center gap-2 rounded-lg border pl-1.5 pr-3 text-[13px] font-semibold transition-colors ${
        on
          ? 'border-accent/40 bg-accent-soft text-accent'
          : 'border-careful/50 bg-careful-soft text-careful'
      }`}
    >
      <span
        className={`relative inline-block h-5 w-9 rounded-full transition-colors ${on ? 'bg-accent' : 'bg-careful/70'}`}
        aria-hidden
      >
        <span
          className={`absolute left-0.5 top-0.5 size-4 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-4' : 'translate-x-0'}`}
        />
      </span>
      Keep Kerning
      <span className="font-normal opacity-80">{on ? 'on' : 'off — kerning is dropped'}</span>
    </button>
      <button
        type="button"
        aria-label="About Keep Kerning"
        aria-expanded={help}
        className="inline-flex size-6 items-center justify-center rounded-full border border-line text-xs font-semibold text-muted hover:border-line-strong hover:text-ink"
        onClick={() => setHelp((h) => !h)}
      >
        ?
      </button>
      {help && <KeepKerningHelp onClose={() => setHelp(false)} />}
    </div>
  )
}

// -- theme ------------------------------------------------------------------------------

const ICON = {
  system: (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <rect x="1.5" y="2.5" width="13" height="9" rx="1.5" />
      <path d="M5.5 14h5M8 11.5V14" strokeLinecap="round" />
    </svg>
  ),
  light: (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden>
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1" />
    </svg>
  ),
  dark: (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden>
      <path d="M13.5 9.6A5.7 5.7 0 0 1 6.4 2.5a5.7 5.7 0 1 0 7.1 7.1Z" />
    </svg>
  ),
}

/** Header menu: theme (system / light / dark) and accent colour. */
export function AppearanceMenu() {
  const choice = useThemeChoice()
  const accent = useAccentChoice()
  const dark = useDark()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])
  return (
    <div ref={root} className="relative">
      <Button variant="ghost" aria-expanded={open} aria-label="Appearance" title="Theme and accent colour" onClick={() => setOpen((o) => !o)}>
        {ICON[choice]}
        <span aria-hidden className="size-3 rounded-full bg-accent ring-2 ring-accent-soft" />
      </Button>
      {open && (
        <div role="dialog" aria-label="Appearance" className="absolute right-0 top-full z-40 mt-1.5 w-64 rounded-xl border border-line bg-surface p-3 shadow-xl">
          <div className="mb-1.5 text-xs font-medium text-muted">Theme</div>
          <Segmented<ThemeChoice>
            label="Theme"
            value={choice}
            onChange={setTheme}
            options={[
              { value: 'system', label: <span className="inline-flex items-center gap-1.5">{ICON.system}System</span> },
              { value: 'light', label: <span className="inline-flex items-center gap-1.5">{ICON.light}Light</span> },
              { value: 'dark', label: <span className="inline-flex items-center gap-1.5">{ICON.dark}Dark</span> },
            ]}
          />
          <div className="mb-1.5 mt-3 text-xs font-medium text-muted">Accent</div>
          <div role="radiogroup" aria-label="Accent colour" className="flex gap-2">
            {(Object.keys(ACCENTS) as AccentChoice[]).map((key) => {
              const tone = ACCENTS[key][dark ? 'dark' : 'light']
              return (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={accent === key}
                  aria-label={ACCENTS[key].name}
                  title={ACCENTS[key].name}
                  onClick={() => setAccent(key)}
                  className={`size-8 rounded-full transition-transform hover:scale-110 ${accent === key ? 'ring-2 ring-ink ring-offset-2 ring-offset-surface' : ''}`}
                  style={{ background: tone.accent }}
                />
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
