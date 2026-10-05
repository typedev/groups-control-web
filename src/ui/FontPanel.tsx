import type { OpenFont } from '../App'

export function FontPanel({ font, onClose }: { font: OpenFont; onClose: () => void }) {
  const s = font.summary
  const title = [s.familyName, s.styleName].filter(Boolean).join(' ') || font.name
  const rows: [string, string | number][] = [
    ['Glyphs', s.glyphs],
    ['Kerning groups, side 1', s.kern1Groups],
    ['Kerning groups, side 2', s.kern2Groups],
    ['Other groups', s.otherGroups],
    ['Kerning pairs', s.pairs],
    ['UFO version', s.formatVersion.join('.')],
    ['Units per em', s.unitsPerEm ?? '—'],
    [
      'Saving',
      s.readOnlyReason
        ? 'read-only'
        : font.handle
          ? 'writes back into the folder'
          : 'download (.ufoz)',
    ],
  ]
  return (
    <div className="mx-auto w-full max-w-xl p-6">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="text-sm text-zinc-500">{font.name}</p>
      {s.readOnlyReason && (
        <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
          {s.readOnlyReason}
        </p>
      )}
      <dl className="mt-5 divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between py-1.5">
            <dt className="text-zinc-600 dark:text-zinc-400">{k}</dt>
            <dd className="tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-5 text-xs text-zinc-500">The groups editor arrives in the next phase.</p>
      <button
        type="button"
        className="mt-4 rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        onClick={onClose}
      >
        Close font
      </button>
    </div>
  )
}
