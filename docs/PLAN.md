# Groups Control Web — Plan

A browser version of Font-Rover's **Groups Control**: drop a `.ufo`, `.ufoz`,
`.designspace` or Glyphs source into the page and edit kerning groups and
kerning with the full Groups Control workflow. Static site on GitHub Pages
(`https://typedev.github.io/groups-control-web/`), **no server**: fonts never
leave the user's machine. That is a feature for NDA work — say it on the page.

Out of scope: the script/plugin system, the glyph editor, Runway, HarfBuzz
shaping, layer-based masters (the desktop tool is not layer-aware either).

---

## 1. Ground truth: what we are porting

Desktop sources live in `~/WORK/Font-Rover` (read-only from this repo).
Read these before touching a phase:

| Doc | What |
|---|---|
| `docs/CLAUDE_GROUPS_CONTROL.md` | The authoritative description (layout, actions, rules) |
| `docs/CLAUDE_KERN_PAIRS_LIST.md` | Pairs list columns, exceptions, Lang column |
| `docs/CLAUDE_TRACKED_GROUPS.md` | Group change notifications |
| `docs/CLAUDE_GLYPHS_IMPORT.md` | How Font-Rover reads Glyphs sources (incl. format 4) |
| `font_rover/data/keymaps/default.json` | `glyph_line` namespace: preview keys |

### Feature inventory (desktop, as of 2026-10)

**Layout**: header (Add / Delete / Rename / History / Import–Export menu;
master switcher in a designspace; stats "N groups | M/total glyphs grouped") ·
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
  becomes member exceptions), Rename (name check; in a designspace "This UFO /
  All N UFOs").
- Click a grouped glyph in the font grid → jump to its group.
- Pairs list: Backspace/Delete removes selected pairs (one undo step).
- Preview keys: kerning ±10 / Shift ±5 / Alt ±1, Backspace removes the pair,
  E / Alt+E / Ctrl+E exceptions, Z/X move selection, Ctrl+wheel zoom;
  margin mode ∓/±1, Shift ×10, Alt = left margin.
- History: record switch, Clear, Save/Load (KernTool4 text `add K+ public.kern1.O O D Q`),
  Apply to Masters (replay).
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
edits / Import / replay; reorder, Import, Copy Groups not in History;
double-click on a group does nothing; Delete has no confirmation; import is
replace-only (no merge mode).

---

## 2. Architecture

```
Main thread (TypeScript)                         Web Worker
┌──────────────────────────────────┐   RPC     ┌──────────────────────────────────┐
│ UI: canvas grids, DnD, keymap,   │ ◄───────► │ Pyodide (Python 3.13)            │
│ dialogs, pairs list, preview     │  (JSON +  │  session.py — single entry point │
│                                  │  deltas)  │  FontDocument (Ufo | Glyphs)     │
│ Read model (mirror, read-only):  │           │  ufo_spacing_lib.FontGroupsManager│
│  outlines → Path2D cache,        │           │    per master                    │
│  groups, kerning, margins        │           │  vendored GC engines             │
│  resolveKernPair (TS port)       │           │  undo stack (diffs)              │
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
- **Every mutating RPC returns a delta** (`groups` changed/removed keys,
  `kerning` changed/removed keys, per master). The mirror applies deltas; it
  never re-pulls the whole font.
- **Undo = diff stack in Python.** Each operation records before/after of the
  keys it touched in groups and kerning (all affected masters). Everything is
  undoable — membership, delete, rename, import, replay — unlike the desktop.
- **No fontParts.** `ufo-spacing-lib` needs only duck typing (`font.groups`,
  `font.kerning`, `glyph in font`). UFO side uses `ufoLib2` / `fontTools.ufoLib`.
  Keep the Font-Rover rules that still apply: never test a glyph for truth
  (`if glyph is not None`), dedupe glyph order (`safe_glyph_order`).

### 2.1 FontDocument — the UFO / Glyphs split

The rest of the app talks to a `FontDocument`: `masters[]`, each with duck-typed
`groups`, `kerning`, `__contains__`, plus glyph list, unicodes, outlines,
side margins. Two implementations:

**UfoDocument** — one UFO = one master; a designspace = N UFOs. Groups are
**per master** (as in the desktop tool).

**GlyphsDocument** — groups are **glyph attributes shared by all masters**
(`leftKerningGroup` / `rightKerningGroup`); kerning is **per master**
(`kerning` in format 2, `kerningLTR` in format 3, keys `@MMK_L_x` / `@MMK_R_x`).
Consequences:
- Expose groups as `public.kern1.X` / `public.kern2.X` to the manager and map
  back on write. **Verify the side mapping** against glyphsLib's builder
  (`glyphsLib/builder/kerning.py`, `groups.py`): expected
  `rightKerningGroup` ↔ kern1 (`@MMK_L_`), `leftKerningGroup` ↔ kern2.
- One membership edit = one groups change + a kerning remap **in every
  master**. Run a manager per master over a shared groups view; record all of
  it as one undo step.
- Glyphs groups are **unordered** — there is no key glyph by position.
  **Open decision**: key glyph = member named like the group, else first in
  glyph order; or persist an order in font `userData`. Decide in Phase 0.
- `kerningRTL` / vertical kerning: not edited, must survive the round trip.

### 2.2 Saving — "what came in goes out"

| Input | Output |
|---|---|
| `.ufo` folder | Chromium: write back in place (File System Access API). Others: download `.ufoz`/zip |
| `.ufoz` | download `.ufoz` |
| `.designspace` + UFOs | as `.ufo` (all masters); the `.designspace` itself is not modified |
| `.glyphs` | download `.glyphs` (same format version) |
| `.glyphspackage` | Chromium: write back changed files; others: download zip |

**Minimal-diff writes are a hard requirement.** UFO: rewrite only
`groups.plist`, `kerning.plist` (and `.glif` files once margins are editable,
Phase 8) — never re-save the whole font. Glyphs: prefer **patching the raw
plist** (`openstep_plist` load → change glyph group keys / master kerning →
dump) over `GSFont.save()`, unless Phase 0 proves the glyphsLib writer
round-trips byte-identically. Acceptance test for every format: open → save
without edits → **zero diff**.

Autosave the session (input bytes + undo stack) to OPFS/IndexedDB so a reload
does not lose work; offer "restore session" on start.

### 2.3 Stack

- Vite + TypeScript, npm. Check `~/WORK/fea-proof` (Vite + TS, deployed into
  typedev.github.io) for conventions; pick the UI approach in Phase 1
  (vanilla TS vs a light framework for the chrome — heavy views are canvas
  either way).
- Pyodide pinned (0.28.x has fonttools 4.56, lxml, brotli, attrs). Loaded from
  jsDelivr; our own wheels in `public/wheels/`, pinned: `ufo-spacing-lib`
  (pure, PyPI 0.4.3), `ufoLib2`, `glyphsLib`, `openstep-plist` (see risk R1).
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

---

## 3. Reuse map

| Desktop source | Web | How |
|---|---|---|
| `ufo-spacing-lib` (`FontGroupsManager`, `resolve_kern_pair`, kerning commands) | worker | dependency (wheel, pinned) |
| `groups_control/dependencies.py` | worker | vendor |
| `groups_control/{naming,key_glyphs,cross_pairs,rename_groups,groups_io,groups_history}.py` | worker | vendor |
| `groups_control/copy_groups.py` (`snapshot`, `process_font`, `FontProxy`, `describe_changes`) | worker | vendor, strip `ProcessPoolExecutor` |
| `languages/compat.py`, `languages/charsets.py`, `data/language_charsets.json` | worker | vendor (Lang column, Smart chains) |
| `utils/margin_edit.py`, `utils/angled_margins.py`, `utils/glyph_order.py` | worker | vendor, strip `GLib` |
| `groups_grid/_model.py` `GroupValidation` | worker | vendor the logic (GObject model stays behind) |
| `groups_grid/cell.py` drawing | TS canvas | rewrite |
| `glyph_grid/*` (~5.6k LOC) | TS canvas | rewrite — biggest UI piece; virtualized |
| `kern_pairs_list/*` | TS | rewrite (logic from `utils.py` stays in Python) |
| `glyph_line/multiline_widget`, `kerning_markers.py`, `NaiveSequencer` | TS canvas | rewrite (no HarfBuzz) |
| `groups_control/dependency_preview.py`, `history_panel.py`, `import_export.py`, `window.py` | TS | rewrite UI; logic calls into the worker |
| `glyphs_runway/kern_edit.py` `KernEditController` | worker | port the key → command mapping |

**Vendoring policy**: copied files go to `py/gcweb/vendor/`, each with a header
naming the source path and the Font-Rover commit; `scripts/vendor_sync.py`
re-copies and rewrites imports. Fix bugs **upstream first** (write an
instruction doc for a Font-Rover session in `docs/upstream/`), then re-sync.
If vendoring churns too much, extract the GTK-free engines into a shared
package (likely inside `ufo-spacing-lib`) — a later decision, not a blocker.

---

## 4. Phases

Each phase ends with a deployable build and the listed acceptance checks.

### Phase 0 — Spike (decides the risky parts; ~2 days)
In `spike/`, throwaway code:
1. Pyodide worker: load `ufoLib2` + `ufo-spacing-lib` via micropip, open a
   `.ufoz` from bytes in MEMFS, run `FontGroupsManager.add_glyphs_to_group`
   on a ufoLib2 font (confirm duck typing: tuple keys in `kerning`, etc.).
2. `openstep-plist` in Pyodide (R1): try a wasm wheel built with
   `pyodide build` (the sdist ships `.pyx`); fallback = pure-Python
   `openstep_plist` shim (loads/dumps) installed under the same name.
   Then `glyphsLib` loads a `.glyphs` (format 2 and 3) and a `.glyphspackage`.
3. Glyphs write-back: no-edit round trip via `GSFont.save()` vs raw plist
   patch; measure the diff; choose.
4. Timing on a large font (≥3000 glyphs, ≥4 masters, ≥30k pairs per master):
   Pyodide cold start, open, outline export, one membership edit.
5. Decide: Glyphs key glyph rule (§2.1), UI approach (§2.3), license.

Output: `docs/DECISIONS.md` with measurements. Budgets to aim for: warm open
< 10 s, edit round trip < 100 ms.

### Phase 1 — Skeleton & deploy
Vite + TS app, worker + typed RPC, Pyodide loader with progress, drop zone
(files and folders; `.ufoz` first), Pages workflow live. Privacy note on the
start screen.

### Phase 2 — Read-only Groups Control (UFO)
Font grid (virtualized canvas, search/sort, Hide grouped, kerning filter,
corner marks), groups grid (Side 1/2, stacked cells, validation markers),
content grid with margin badges, kern pairs list (Value/Exc/Lang), stats.
Accept: a real UFO shows the same groups, markers and pairs as the desktop.

### Phase 3 — Group editing
All DnD variants, Add (+ Name Taken dialog), Delete (with confirmation),
Rename, Keep Kerning, key glyph by reorder, refusal messages, undo/redo for
everything, History journal (record/clear). Parity tests: the same scenario
run through desktop engines and the web worker yields identical
`groups`/`kerning`.

### Phase 4 — Preview & kerning editing
Dependency line (Members/All/Smart, control glyphs, colours), pairs mode
(Expand, pairs per line), kerning keys, exceptions E/Alt+E/Ctrl+E, Backspace,
Delete Pairs, zoom, dark mode, view options. Beam measurement may slip to
Phase 8.

### Phase 5 — Saving
UFO folder write-back (Chromium), `.ufoz` download, zero-diff tests, OPFS
autosave/restore, Import/Export groups (consider a Merge mode), History
Save/Load.

### Phase 6 — Multi-master (UFO)
`.designspace` + folder of UFOs, master switcher, Rename in all masters,
Apply History to masters (as one undoable step per master).

### Phase 7 — Glyphs sources
`GlyphsDocument` (§2.1), `.glyphs` v2/v3 and `.glyphspackage`, write-back by
the Phase 0 choice, zero-diff tests. Format 4: only if Font-Rover's
`glyphs_import/format4` approach transfers; otherwise refuse with a clear
message.

### Phase 8 — Margins (research first)
Write `docs/RESEARCH_MARGINS.md` before code. UFO and Glyphs differ:
- UFO: plain outline shift + advance; optional metrics rules in
  `font.lib["com.typedev.spacing.metricsRules"]`
  (`ufo_spacing_lib/rules_*.py`, ~1.6k LOC: parser, cycles, generator).
- Glyphs: metrics keys on glyphs and layers (`metricsLeft`, `metricsRight`,
  `metricsWidth`, e.g. `=n`, `=|H`, `=H+10`, `=n*1.2`), auto-aligned
  composites, per-master values. Editing a margin that a key drives must
  either update the key or be refused — decide.
- Italic angled margins (`utils/angled_margins.py`), beam margins.
Then: margin mode in the preview, writing `.glif` / layer data, undo.

### Phase 9 — Optional: tools (former board scripts)
As a Tools menu (not a script system): Copy Groups, Split by Script, Merge
Script Groups, Place Composites, Place Ligatures, Fix Key Glyph Position,
Rename Groups, Clean, Round, Flatten Kerning, Remove Cross-Language Pairs,
Diff, Copy Kerning of Glyphs, Transfer Kerning by Script, Interpolate Kerning.
Engines are already GTK-free in `font_rover/groups_control/`.

---

## 5. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | `openstep-plist` is Cython-only and not in Pyodide | wasm wheel via `pyodide build`; else pure-Python shim |
| R2 | Glyphs write-back not byte-faithful | raw-plist patching; zero-diff test gates Phase 7 |
| R3 | Glyphs shared-groups model vs per-master manager | `GlyphsDocument` adapter, one manager per master over a shared groups view, one undo step |
| R4 | Startup weight (Pyodide ~10–15 MB) | loader with progress, cache via service worker, lazy-load glyphsLib only for Glyphs input |
| R5 | Big fonts: outline transfer, grid speed | send outlines lazily per visible cell, `Path2D` cache, virtualized canvas |
| R6 | Vendored code drifts from desktop | `vendor_sync.py` + parity tests; upstream-first fixes |
| R7 | Folder write-back only in Chromium | documented; download fallback everywhere |

---

## 6. Fixtures

Only open-source fonts in the repo (MutatorSans, etc.). Real client fonts are
tested locally from outside the repo and never named in code, docs or commits.
