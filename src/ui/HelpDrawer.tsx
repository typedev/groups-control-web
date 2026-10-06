// Contextual help: a drawer at the right that follows the panel in use.
import type { ReactNode } from 'react'
import { closeHelp, pinHelp, useHelp, type HelpTopic } from '../help'
import { VERSION_TITLE } from '../version'

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const MOD = isMac ? '⌘' : 'Ctrl'
const ALT = isMac ? '⌥' : 'Alt'

function K({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex min-w-5 items-center justify-center rounded-md border border-line border-b-2 bg-surface px-1.5 font-sans text-[11.5px] font-medium leading-5 text-ink">
      {children}
    </kbd>
  )
}

/** One line of a key table: keys on the left, what they do on the right. */
function Keys({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return (
    <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
      {rows.map(([keys, what], i) => (
        <div key={i} className="contents">
          <dt className="flex flex-wrap items-center gap-1">{keys}</dt>
          <dd className="text-ink/85">{what}</dd>
        </div>
      ))}
    </dl>
  )
}

function H({ children }: { children: ReactNode }) {
  return <h3 className="mt-5 text-[13px] font-semibold text-ink first:mt-0">{children}</h3>
}

function P({ children }: { children: ReactNode }) {
  return <p className="mt-1.5 text-ink/85">{children}</p>
}

function L({ items }: { items: ReactNode[] }) {
  return (
    <ul className="mt-1.5 list-disc space-y-1 pl-4 text-ink/85">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  )
}

const plus = <span className="text-muted">+</span>

const TOPICS: { id: HelpTopic; label: string; body: ReactNode }[] = [
  {
    id: 'overview',
    label: 'Overview',
    body: (
      <>
        <P>
          Groups Control edits the kerning groups and the kerning of a UFO. Everything runs in this tab; the font never
          leaves your computer.
        </P>
        <H>The workspace</H>
        <L
          items={[
            <><b>Font</b> (left): every glyph, with search and filters. Drag glyphs from here into groups.</>,
            <><b>Groups</b> (middle): the kerning groups of Side 1 or Side 2, and below them the glyphs of the selected group.</>,
            <><b>Pairs</b> (right): the kerning of the selected group and its members, or of the selected glyph.</>,
            <><b>Preview</b> (bottom): the glyphs a group affects, or the selected pairs set with their kerning.</>,
          ]}
        />
        <P>This help follows the panel you click in. Pick a tab to keep one topic open; Auto goes back to following.</P>
        <H>Everywhere</H>
        <Keys
          rows={[
            [<><K>{MOD}</K>{plus}<K>S</K></>, 'Save, or download the .ufoz'],
            [<K>?</K>, 'Show or hide this help'],
          ]}
        />
        <p className="mt-6 text-xs text-muted">
          {VERSION_TITLE} · <a className="text-accent hover:underline" href="https://github.com/typedev/groups-control-web/blob/main/CHANGELOG.md" target="_blank" rel="noreferrer">what changed</a>
        </p>
      </>
    ),
  },
  {
    id: 'font',
    label: 'Font',
    body: (
      <>
        <H>Search</H>
        <L
          items={[
            <>By <b>name</b>: exact, or with <code>*</code> as a wildcard — <code>A*</code>, <code>*.sc</code>, <code>*acute*</code>.</>,
            <>By <b>Unicode</b>: hex code points — <code>0041</code>, <code>U+00C1</code>, <code>04*</code>.</>,
            'Several terms, separated by spaces or commas, find glyphs that match any of them.',
          ]}
        />
        <H>Filters</H>
        <L
          items={[
            <><b>Hide grouped</b> hides glyphs already in a group of the current side (only with All glyphs).</>,
            <><b>Kerned</b> / <b>Not kerned</b>: glyphs that are, or are not, a kerning key on this side by themselves.</>,
            <>Marks: grey squares — in a group; arrows in the accent colour — kerned as a single glyph.</>,
          ]}
        />
        <H>Mouse</H>
        <Keys
          rows={[
            ['Click', 'Select a glyph; its pairs show in Pairs. A grouped glyph jumps to its group.'],
            [<><K>Shift</K>{plus}click</>, 'Select a range'],
            [<><K>{MOD}</K>{plus}click</>, 'Add or remove one glyph'],
            ['Drag', 'Into the group below to add (at the drop position), or onto a group cell'],
          ]}
        />
        <P>
          <b>+ Add group</b> makes a group from the selected glyphs, named after the first one that is not grouped yet.
        </P>
      </>
    ),
  },
  {
    id: 'groups',
    label: 'Groups',
    body: (
      <>
        <P>
          <b>Side 1</b> groups (<code>public.kern1</code>) are the left glyph of a pair, <b>Side 2</b> groups
          (<code>public.kern2</code>) the right one. A glyph is in at most one group per side.
        </P>
        <H>A group cell</H>
        <L
          items={[
            'The key glyph (the first member) on top, up to four more members faintly behind it.',
            'The hatched half is the side being checked: the right margin on Side 1, the left on Side 2.',
            <>The number is the key glyph's margin; <b className="text-error">!40</b> means a member's margin differs.</>,
            <>A red cross: the group is empty. A red circle: a member is missing from the font.</>,
          ]}
        />
        <H>The group's glyphs (below)</H>
        <L
          items={[
            'The first glyph is the key glyph; its margin is shown, members that differ show their own in red.',
            'Drag to reorder; dropping a glyph first makes it the key glyph.',
            'Drag a glyph out to the Font panel to remove it from the group (see Keep Kerning).',
          ]}
        />
        <P>A glyph that is already in a group on this side is refused, never moved. Rename and Delete act on the selected group.</P>
      </>
    ),
  },
  {
    id: 'pairs',
    label: 'Pairs',
    body: (
      <>
        <P>The kerning keys of the selected group and its members, or of the glyph selected in the Font panel.</P>
        <H>Columns</H>
        <L
          items={[
            <><b className="text-accent">@.</b> marks a group; glyphs are indented.</>,
            <>Value: <span className="text-negative">negative</span>, <span className="text-positive">positive</span>, <span className="text-zero">zero</span>.</>,
            <>Exc: ◀⚡ the left glyph is an exception to its group, ⚡▶ the right one, ⚡⚡ a pair of two grouped glyphs.</>,
            <>Lang: <span className="text-error">✕</span> the sides share no script, <span className="text-error">◐</span> some member never meets the other side, <span className="text-careful">✕</span> no language uses both.</>,
          ]}
        />
        <H>Keys</H>
        <Keys
          rows={[
            ['Click a header', 'Sort; click again to reverse'],
            [<><K>Shift</K> / <K>{MOD}</K>{plus}click</>, 'Select several pairs; they show in the preview'],
            [<><K>⌫</K> <K>Delete</K></>, 'Delete the selected keys exactly as listed (asks first)'],
            [<><K>←</K> <K>→</K> <K>E</K> <K>Z</K> <K>X</K></>, 'Passed on to the preview (see Preview)'],
          ]}
        />
      </>
    ),
  },
  {
    id: 'preview',
    label: 'Preview',
    body: (
      <>
        <P>Click the preview first: its keys work while it has the focus.</P>
        <H>Dependency line</H>
        <P>
          Shown when a group or a glyph is selected. Each glyph sits between control glyphs of its script and case
          (H, n, zero…), the way a spacer looks at it.
        </P>
        <L
          items={[
            <><b>Members</b>: the group only. <b>All</b>: also base glyphs and every composite. <b>Smart</b>: the composites that take this side from these glyphs.</>,
            <>Colours: <span className="text-error">red</span> — margin differs from the key glyph; <span className="text-accent">accent</span> — not in the group; faint — control glyphs.</>,
            <>Margins: <code>72 ▶</code> right, <code>◀ 33</code> left; only the side being checked.</>,
          ]}
        />
        <Keys
          rows={[
            ['Click a glyph', 'Select it for margin editing'],
            [<><K>←</K> <K>→</K></>, 'Right margin −1 / +1'],
            [<><K>Shift</K>{plus}<K>←</K> <K>→</K></>, 'Right margin −10 / +10'],
            [<><K>{ALT}</K>{plus}<K>←</K> <K>→</K></>, 'Left margin −1 / +1 (with Shift ±10)'],
            [<K>Esc</K>, 'Deselect'],
          ]}
        />
        <P>Composites follow their base glyph: editing A moves Aacute's margins too.</P>
        <H>Pairs</H>
        <P>
          Shown when pairs are selected in the Pairs panel: kerning applied, with a bar and the value under each pair.
          <b> Expand</b> (one pair selected) shows every left glyph against every right glyph.
        </P>
        <Keys
          rows={[
            [<><K>←</K> <K>→</K></>, 'Kerning −10 / +10'],
            [<><K>Shift</K>{plus}<K>←</K> <K>→</K></>, 'Kerning −5 / +5'],
            [<><K>{ALT}</K>{plus}<K>←</K> <K>→</K></>, 'Kerning −1 / +1'],
            [<><K>⌫</K> <K>Delete</K></>, 'Remove the pair that applies'],
            [<K>E</K>, 'Exception for this side’s glyph (Expand on)'],
            [<><K>Ctrl</K>{plus}<K>E</K></>, 'Exception for the other side'],
            [<><K>{ALT}</K>{plus}<K>E</K></>, 'Exception for the glyph pair'],
            [<><K>Z</K> <K>X</K></>, 'Previous / next pair'],
          ]}
        />
        <H>Beam</H>
        <P>Measures margins where a horizontal line crosses the outline. Checks in the Groups panel then use it too.</P>
        <Keys
          rows={[
            [<K>B</K>, 'Beam on / off'],
            [<><K>{ALT}</K>{plus}<K>↑</K> <K>↓</K></>, 'Move it 1 unit (with Shift 100); or drag its handle'],
            [<><K>{ALT}</K>{plus}<K>B</K></>, 'Show stems and counters along the beam'],
          ]}
        />
        <H>View</H>
        <Keys rows={[[<><K>{MOD}</K>{plus}wheel</>, 'Zoom']]} />
      </>
    ),
  },
  {
    id: 'keepKerning',
    label: 'Keep Kerning',
    body: (
      <>
        <P>
          Decides what happens to kerning when glyphs change groups. It does not affect reordering, renaming (kerning
          always follows the new name) or editing kerning values.
        </P>
        <H><span className="text-accent">On</span> — text keeps the same spacing</H>
        <L
          items={[
            <><b>Adding</b> a glyph: its pairs that equal the group's are dropped, different ones stay as exceptions. A new group takes over the first glyph's pairs.</>,
            <><b>Removing</b> a glyph: it gets the group's pairs as exceptions, so its kerning does not change.</>,
            <><b>Deleting</b> a group: its pairs become exceptions of every member.</>,
          ]}
        />
        <H><span className="text-careful">Off</span> — groups change, kerning is left as it is</H>
        <L
          items={[
            'An added glyph keeps all its own pairs; they override the group’s.',
            'A removed glyph loses the group’s kerning.',
            'A deleted group’s pairs are removed.',
          ]}
        />
        <P>Leave it on unless you are rebuilding kerning from scratch.</P>
      </>
    ),
  },
  {
    id: 'saving',
    label: 'Saving',
    body: (
      <>
        <L
          items={[
            <><b>Save</b> writes the changed files back into the folder you opened (Chrome, Edge): only groups.plist, kerning.plist and edited glyphs, keeping their formatting.</>,
            <><b>Download .ufoz</b> when the font came as a .ufoz or the browser cannot write into folders.</>,
            <><b>Revert</b> goes back to the last save. There is no undo yet.</>,
            'Unsaved edits are kept in this browser: after a reload, Restore brings them back.',
            <>Groups → <b>Import / Export</b> exchanges groups as text (KernTool4 format). Tools runs Font-Rover's group scripts; each shows its plan first.</>,
          ]}
        />
      </>
    ),
  },
]

export function HelpDrawer() {
  const { context, pinned } = useHelp()
  const topic = pinned ?? context
  const current = TOPICS.find((t) => t.id === topic) ?? TOPICS[0]
  return (
    <aside aria-label="Help" className="flex w-[360px] shrink-0 flex-col border-l border-line bg-surface">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-4">
        <h2 className="text-[15px] font-semibold">Help</h2>
        <button
          type="button"
          aria-pressed={pinned === null}
          title="Follow the panel in use"
          className={`ml-auto rounded-md px-2 py-0.5 text-xs font-medium ${pinned === null ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-raised hover:text-ink'}`}
          onClick={() => pinHelp(null)}
        >
          Auto
        </button>
        <button type="button" aria-label="Close help" className="rounded-md px-1.5 text-muted hover:bg-raised hover:text-ink" onClick={closeHelp}>
          ✕
        </button>
      </div>
      <nav aria-label="Help topics" className="flex shrink-0 flex-wrap gap-1 border-b border-line px-3 py-2">
        {TOPICS.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-current={t.id === topic ? 'page' : undefined}
            className={`rounded-md px-2 py-1 text-xs font-medium ${
              t.id === topic ? 'bg-accent text-accent-ink' : 'text-muted hover:bg-raised hover:text-ink'
            }`}
            onClick={() => pinHelp(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 text-[13px] leading-relaxed">
        <h3 className="mb-2 text-base font-semibold">{current.label}</h3>
        {current.body}
      </div>
    </aside>
  )
}
