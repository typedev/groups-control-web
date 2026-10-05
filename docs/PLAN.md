# Groups Control Web — Plan

A browser version of Font-Rover's **Groups Control**: drop a `.ufo` or `.ufoz`
into the page and edit kerning groups and kerning with the full Groups Control
workflow. Static site on GitHub Pages
(`https://typedev.github.io/groups-control-web/`), **no server**: fonts never
leave the user's machine. That is a feature for NDA work — say it on the page.

**Prototype scope: a single UFO (`.ufo` folder or `.ufoz`), one master.**
`.designspace`, `.glyphs` and `.glyphspackage` are deferred; what we already
know about them is kept in [LATER.md](LATER.md). The architecture keeps a
`master` key in its protocol so adding them later does not change the RPC or
the change format (§2).

Out of scope: the script/plugin system, the glyph editor, Runway, HarfBuzz
shaping, layer-based masters (the desktop tool is not layer-aware either).

---

## 1. Ground truth: what we are porting

Desktop sources live in `~/WORK/Font-Rover` (read-only from this repo,
Apache-2.0). Read these before touching a phase:

| Doc | What |
|---|---|
| `docs/CLAUDE_GROUPS_CONTROL.md` | The authoritative description (layout, actions, rules) |
| `docs/CLAUDE_KERN_PAIRS_LIST.md` | Pairs list columns, exceptions, Lang column |
| `docs/CLAUDE_TRACKED_GROUPS.md` | Group change notifications |
| `font_rover/data/keymaps/default.json` | `glyph_line` namespace: preview keys |

### Feature inventory (desktop, as of 2026-10)

Items that only make sense with several masters (master switcher, Rename in
"All N UFOs", Apply History to Masters) are listed in [LATER.md](LATER.md).

**Layout**: header (Add / Delete / Rename / History / Import–Export menu;
stats "N groups | M/total glyphs grouped") ·
column 1 font grid (search/sort, *Hide grouped*, kerning filter All/Kerned/Not
kerned, corner marks grouped / kerned-as-single-glyph) · column 2 top groups
grid (Side 1 / Side 2, group dropdown, *Keep Kerning*, cells = stacked members
+ key margin + validation markers; selected = solid border, active = dashed) ·
column 2 bottom content grid (members, index 0 = key glyph, margin badges `!60`)
· column 3 kern pairs list (Left, Right, Value, Exc, Lang; Delete Pairs) ·
bottom dependency preview.

**Actions**:
- Drag & drop: font → content (insert at index), font → group cell, content →
  font (remove; exceptions created when Keep Kerning), content → content
  (reorder; drop at 0 changes the key glyph). A glyph already grouped on this
  side is refused and reported, never moved.
- Add (group named after the first free selected glyph; "Name Taken" dialog:
  Create `O_2` / Add to `O` / Cancel), Delete (Keep Kerning → group kerning
  becomes member exceptions), Rename (name check).
- Click a grouped glyph in the font grid → jump to its group.
- Pairs list: Backspace/Delete removes selected pairs.
- Preview keys: kerning ±10 / Shift ±5 / Alt ±1, Backspace removes the pair,
  E / Alt+E / Ctrl+E exceptions, Z/X move selection, Ctrl+wheel zoom;
  margin mode ∓/±1, Shift ×10, Alt = left margin.
- History: record switch, Clear, Save/Load (KernTool4 text `add K+ public.kern1.O O D Q`).
- Import/Export groups (KernTool4 `name=g1,g2`; scope Kerning/Other/All;
  import **replaces** and carries kerning; report dialog).
- Validation: empty group, missing glyphs, margin mismatch with the key glyph
  (right side for kern1, left for kern2; angled margins for italics; along the
  beam when the beam is on).

**Preview**: dependency line (members expanded to composite chains, modes
Members / All / Smart, each glyph framed by script/case control glyphs; red =
margin differs, blue = in chain but not in group, faded = control) and pairs
mode (selected pairs with kerning; Expand = all left × right members;
1–50 pairs per line).

**Rules**: a glyph is in at most one group per side; key glyph = first member;
kerning lookup order glyph–glyph → glyph–group → group–glyph → group–group
(glyph+group exception wins over group+glyph); Import always carries kerning.

**Known desktop gaps the web version may close**: no undo for membership
edits / Import; reorder, Import, Copy Groups not in History;
double-click on a group does nothing; Delete has no confirmation; import is
replace-only (no merge mode).

---

## 2. Architecture

```
Main thread (TypeScript)                         Web Worker
┌──────────────────────────────────┐   RPC     ┌──────────────────────────────────┐
│ UI: canvas grids, DnD, keymap,   │ ◄───────► │ Pyodide (Python 3.13)            │
│ dialogs, pairs list, preview     │  (JSON +  │  session.py — single entry point │
│                                  │  deltas)  │  FontDocument (UFO)              │
│ Read model (mirror, read-only):  │           │  tracked groups/kerning mappings │
│  outlines → Path2D cache,        │           │  ufo_spacing_lib.FontGroupsManager│
│  groups, kerning, margins        │           │  vendored GC engines             │
│  resolveKernPair (TS port)       │           │  change diffs (undo: later)      │
└──────────────────────────────────┘           └──────────────────────────────────┘
```

- **Python is the source of truth for every mutation.** The kerning remap on
  add/remove/delete/rename lives in `ufo_spacing_lib.groups_core`
  (`_handle_kerning_on_add` etc.) and is the subtle part — never re-implement
  it in TS.
- **TS keeps a read-only mirror** for drawing at 60 fps without a worker round
  trip: glyph outlines (sent once as path commands, cached as `Path2D`),
  groups, kerning, margins. `resolve_kern_pair` (~105 LOC in
  `ufo_spacing_lib/groups_core.py:1237`) is ported to TS for drawing only, with
  a parity test against the Python one.
- **Tracked mappings — one layer for deltas and save.** The document
  wraps `groups` and `kerning` in change-tracking mappings that remember the
  original value of every key touched during an RPC. At the end of the call
  the diff (before/after per key) becomes (a) the delta sent to the mirror,
  (b) the "differs from the file on disk" state used by saving (§2.2).
- **No undo in the prototype.** The per-RPC diff already holds before/after,
  so undo/redo is later a stack of these diffs plus UI, with no change to the
  operations. Until then, destructive actions (Delete group, Delete Pairs,
  Import) ask for confirmation, and **Revert to file** (§2.2) is the way back.
- **The same layer is the duck-typing adapter** `ufo-spacing-lib` expects.
  It is not pure dict access: e.g. `rename_group` calls
  `font.groups.remove(old_name)` (fontParts API, `groups_core.py:1132`), which
  a ufoLib2 dict lacks. Phase 0 lists every such call.
- **Deltas are keyed by `master`** even though the prototype
  has exactly one. Multi-master inputs ([LATER.md](LATER.md)) then add a
  loader, not a protocol change. No other multi-master abstraction is built
  now.
- **No fontParts.** UFO side uses `ufoLib2` / `fontTools.ufoLib`. Keep the
  Font-Rover rules: never test a glyph for truth (`if glyph is not None`),
  dedupe glyph order (`safe_glyph_order`).

### 2.1 FontDocument

The rest of the app talks to a thin `FontDocument`: `masters[]` (length 1),
each with tracked `groups`, `kerning`, `__contains__`, plus glyph list,
unicodes, outlines, side margins. One implementation for now (UFO). The UI
never touches ufoLib2 directly.

### 2.2 Saving — "what came in goes out"

| Input | Output |
|---|---|
| `.ufo` folder | Chromium: write back in place (File System Access API). Others: download `.ufoz` |
| `.ufoz` | download `.ufoz` |

- **Minimal diff is a hard requirement.** Rewrite only `groups.plist` and
  `kerning.plist` (and `.glif` files once margins are editable, Phase 6) —
  never re-save the whole font.
- **A file whose content equals the original is not written at all** —
  including after an edit is reverted by hand (compare with the original
  content, not a dirty flag). Open → save without edits = zero diff by
  construction; byte layout only matters for files that really changed.
  Acceptance test: open → save → zero diff; open → add glyph → remove it →
  save → zero diff.
- In-place write needs a directory handle: from a drop via
  `DataTransferItem.getAsFileSystemHandle()` or from `showDirectoryPicker()`
  (Chromium). `webkitGetAsEntry()` is read-only and is the path for other
  browsers.
- **Revert to file** drops all unsaved changes and returns to the state of
  the last open or save. The worker keeps that state (original bytes or the
  last saved `groups`/`kerning`) anyway, so revert is a reload from memory,
  with confirmation.
- Autosave the session (input bytes + current groups/kerning) to OPFS/IndexedDB so a
  reload does not lose work; offer "restore session" on start (Phase 5).

### 2.3 Stack

- Vite + TypeScript, npm. Check `~/WORK/fea-proof` (Vite + TS, deployed into
  typedev.github.io) for conventions; pick the UI approach in Phase 0
  (vanilla TS vs a light framework for the chrome — heavy views are canvas
  either way).
- Pyodide pinned (0.28.x has fonttools, lxml, brotli, attrs). Loaded from
  jsDelivr; our own wheels in `public/wheels/`, pinned: `ufo-spacing-lib`
  (pure, PyPI 0.4.3), `ufoLib2`.
- Python package of the worker: `py/gcweb/`, testable in normal CPython with
  `uv run pytest` (no browser needed for logic tests).
- Tests: pytest (worker logic, parity with desktop), Vitest (TS mirror,
  `resolveKernPair`), Playwright (E2E on fixture fonts).
- Deploy: GitHub Actions → GitHub Pages of this repo. Base path
  `/groups-control-web/`. Pages cannot set COOP/COEP headers → do not depend on
  `SharedArrayBuffer`. Add a link from `typedev.github.io/index.html` (that repo
  is changed by its own session).
- Browsers: Chromium = full; Firefox/Safari = everything except in-place write
  back (download instead).
- Keyboard: match on `KeyboardEvent.code`, not `key` (Option on macOS types
  characters); Cmd replaces Ctrl on macOS; check browser-reserved combos
  (Ctrl+E focuses the address bar in some browsers). Ctrl+wheel zoom needs a
  non-passive listener with `preventDefault()`.

---

## 3. Reuse map

| Desktop source | Web | How |
|---|---|---|
| `ufo-spacing-lib` (`FontGroupsManager`, `resolve_kern_pair`, kerning commands) | worker | dependency (wheel, pinned) |
| `groups_control/dependencies.py` | worker | vendor |
| `groups_control/{naming,key_glyphs,cross_pairs,rename_groups,groups_io,groups_history}.py` | worker | vendor |
| `languages/compat.py`, `languages/charsets.py`, `data/language_charsets.json` | worker | vendor (Lang column, Smart chains) |
| `utils/margin_edit.py`, `utils/angled_margins.py`, `utils/glyph_order.py` | worker | vendor, strip `GLib` |
| `groups_grid/_model.py` `GroupValidation` | worker | vendor the logic (GObject model stays behind) |
| `groups_grid/cell.py` drawing | TS canvas | rewrite |
| `glyph_grid/*` (~5.6k LOC) | TS canvas | rewrite — biggest UI piece; virtualized |
| `kern_pairs_list/*` | TS | rewrite (logic from `utils.py` stays in Python) |
| `glyph_line/multiline_widget`, `kerning_markers.py`, `NaiveSequencer` | TS canvas | rewrite (no HarfBuzz) |
| `groups_control/dependency_preview.py`, `history_panel.py`, `import_export.py`, `window.py` | TS | rewrite UI; logic calls into the worker |
| `glyphs_runway/kern_edit.py` `KernEditController` | worker | port the key → command mapping |

**Vendoring policy**: copied files go to `py/gcweb/vendor/`, each with the
Apache-2.0 header (this repo is Apache-2.0 too), the source path and the Font-Rover commit (plus a `NOTICE`
file); `scripts/vendor_sync.py` re-copies and rewrites imports. Fix bugs
**upstream first** (write an instruction doc for a Font-Rover session in
`docs/upstream/`), then re-sync. If vendoring churns too much, extract the
GTK-free engines into a shared package (likely inside `ufo-spacing-lib`) — a
later decision, not a blocker.

---

## 4. Phases

Each phase ends with a deployable build and the listed acceptance checks.

### Phase 0 — Spike (~1 day)
In `spike/`, throwaway code:
1. Pyodide worker: load `ufoLib2` + `ufo-spacing-lib` via micropip, open a
   `.ufoz` from bytes in MEMFS, run add / remove / reorder / delete / rename
   through `FontGroupsManager` on a ufoLib2 font. List every non-dict call the
   manager makes on `groups` / `kerning` (`.remove`, tuple vs list values,
   tuple keys in `kerning`, …) → spec for the tracked-mapping adapter.
2. Timing on a large UFO (≥3000 glyphs, ≥30k pairs): Pyodide cold and warm
   start, open, outline export, one membership edit round trip.
3. Decide: UI approach (§2.3).

Output: `docs/DECISIONS.md` with measurements. Budgets to aim for: warm open
< 10 s, edit round trip < 100 ms.

### Phase 1 — Skeleton & deploy
Vite + TS app, worker + typed RPC, Pyodide loader with progress, drop zone
(`.ufo` folder and `.ufoz`; keep the directory handle when Chromium gives
one), Pages workflow live. Privacy note on the start screen.

### Phase 2 — Read-only Groups Control
Font grid (virtualized canvas, search/sort, Hide grouped, kerning filter,
corner marks), groups grid (Side 1/2, stacked cells, validation markers),
content grid with margin badges, kern pairs list (Value/Exc/Lang), stats.
Accept: a real UFO shows the same groups, markers and pairs as the desktop.

### Phase 3 — Group editing + minimal saving
All DnD variants, Add (+ Name Taken dialog), Delete (with confirmation),
Rename, Keep Kerning, key glyph by reorder, refusal messages, History journal (record/clear). Parity tests: the same scenario
run through desktop engines and the web worker yields identical
`groups`/`kerning`.
Minimal saving lands here so the tool is usable on real work: UFO folder
write-back (Chromium), `.ufoz` download, zero-diff tests, Revert to file
(§2.2).

### Phase 4 — Preview & kerning editing
Dependency line (Members/All/Smart, control glyphs, colours), pairs mode
(Expand, pairs per line), kerning keys, exceptions E/Alt+E/Ctrl+E, Backspace,
Delete Pairs, zoom, dark mode, view options. Beam measurement may slip to
Phase 6.

### Phase 5 — Session & exchange
OPFS autosave/restore, Import/Export groups (consider a Merge mode), History
Save/Load.

### Phase 6 — Margins (research first)
Write `docs/RESEARCH_MARGINS.md` before code:
- plain outline shift + advance; optional metrics rules in
  `font.lib["com.typedev.spacing.metricsRules"]`
  (`ufo_spacing_lib/rules_*.py`, ~1.6k LOC: parser, cycles, generator);
- italic angled margins (`utils/angled_margins.py`), beam margins.
Then: margin mode in the preview, writing `.glif`.

### Phase 7 — Optional: tools (former board scripts)
As a Tools menu (not a script system): Split by Script, Merge Script Groups,
Place Composites, Place Ligatures, Fix Key Glyph Position, Rename Groups,
Clean, Round, Flatten Kerning, Remove Cross-Language Pairs, Diff, Copy Kerning
of Glyphs, Transfer Kerning by Script. Engines are already GTK-free in
`font_rover/groups_control/`. Tools that need several fonts or masters (Copy
Groups, Interpolate Kerning) wait for [LATER.md](LATER.md).

### After the prototype
- Undo/redo over the recorded diffs (everything: membership, reorder, delete,
  rename, import, kerning).
- `.designspace` / multi-master, then Glyphs sources — see [LATER.md](LATER.md).

---

## 5. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | `ufo-spacing-lib` assumes fontParts beyond duck typing | Phase 0 inventory; tracked-mapping adapter; upstream fix if cleaner |
| R2 | Startup weight (Pyodide ~10–15 MB) | loader with progress, cache via service worker |
| R3 | Big fonts: outline transfer, grid speed | send outlines lazily per visible cell, `Path2D` cache, virtualized canvas |
| R4 | Vendored code drifts from desktop | `vendor_sync.py` + parity tests; upstream-first fixes |
| R5 | Folder write-back only in Chromium | documented; download fallback everywhere |

---

## 6. Fixtures

Only open-source fonts in the repo (MutatorSans masters as single UFOs, etc.).
Real client fonts are tested locally from outside the repo and never named in
code, docs or commits.
