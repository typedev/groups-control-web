# Later — inputs deferred from the prototype

The prototype handles a single UFO ([PLAN.md](PLAN.md)). This file keeps what
is already known about the next inputs so nothing has to be rediscovered.
Suggested order: designspace first (reuses the UFO loader), then Glyphs.

---

## 1. Designspace / multi-master UFO

- `.designspace` + its UFOs; one UFO = one master; groups are **per master**
  (as in the desktop tool).
- Master switcher in the header.
- Rename: "This UFO / All N UFOs".
- History: Apply to Masters (replay), one undoable step per master.
- Tools that need a second font (Phase 7 left them out): Diff Groups &
  Kerning (`diff_kerning.py`; could also diff against the file on disk),
  Copy Kerning of Glyphs (`copy_kerning.py`), Transfer Kerning by Script
  (`transfer_kerning.py`), Interpolate Kerning (`interpolate_kerning.py`).
- Tools that need it: Copy Groups (`groups_control/copy_groups.py`:
  `snapshot`, `process_font`, `FontProxy`, `describe_changes` — vendor, strip
  `ProcessPoolExecutor`), Interpolate Kerning.
- Saving: write each changed UFO (`groups.plist` / `kerning.plist` only); the
  `.designspace` itself is never modified.
- The protocol is ready: deltas (and later undo steps) are keyed by `master`.

## 2. Glyphs sources (`.glyphs` v2/v3, `.glyphspackage`)

Desktop reference: `docs/CLAUDE_GLYPHS_IMPORT.md` in Font-Rover. Note that the
desktop **converts** Glyphs → UFO with glyphsLib; the web version is meant to
edit the source in place.

### Data model
- Groups are **glyph attributes shared by all masters**
  (`leftKerningGroup` / `rightKerningGroup`); kerning is **per master**
  (`kerning` in format 2, `kerningLTR` in format 3, keys `@MMK_L_x` /
  `@MMK_R_x`).
- Expose groups as `public.kern1.X` / `public.kern2.X` and map back on write.
  Expected `rightKerningGroup` ↔ kern1 (`@MMK_L_`), `leftKerningGroup` ↔ kern2
  — verify against `glyphsLib/builder/kerning.py`, `groups.py`.
- Almost every Glyphs file is multi-master, so Glyphs brings the multi-master
  machinery with it: a master switcher for kerning, and every membership edit
  remaps kerning **in all masters** as one undo step.
- `kerningRTL` / vertical kerning: not edited, must survive the round trip.

### Known trap: one manager per master over shared groups
`FontGroupsManager.add_glyphs_to_group` mutates `font.groups` and remaps
kerning in the same call, and caches a reverse glyph→group mapping. Over a
shared groups object, the first master's manager changes the groups; the next
one sees the glyph already grouped and skips, so its kerning is never
remapped. Options:
- give each master's manager its **own copy** of the groups, run the operation
  in every master, assert the resulting groups are equal, write them once
  (no upstream change needed);
- or split "change groups" from "remap kerning given before/after groups" in
  `ufo-spacing-lib` (upstream doc).

### Key glyph
Glyphs groups are unordered. Proposed rule: key glyph = the member named like
the group, else the first member in glyph order. Persist nothing in `userData`
by default (it would break the zero-diff save); disable "drop at index 0" for
Glyphs documents, or persist an order only after an explicit user action.

### Reading and writing
- `openstep-plist` is Cython-only and not in Pyodide: try a wasm wheel via
  `pyodide build`; fallback = a pure-Python `openstep_plist` shim under the
  same name.
- glyphsLib may be heavier than needed (C-extension deps, e.g. possibly
  `unicodedata2`). Evaluate reading the raw plist directly and using glyphsLib
  only for what is hard (component decomposition, outlines). Lazy-load it only
  for Glyphs input.
- Write-back: **patch the raw plist** (load → change glyph group keys / master
  kerning → dump) unless glyphsLib's writer proves byte-identical. Acceptance:
  open → save → zero diff.
- Output: `.glyphs` download (same format version); `.glyphspackage` —
  Chromium writes back changed files, others download a zip.
- Format 4: only if Font-Rover's `glyphs_import/format4` approach transfers;
  otherwise refuse with a clear message.

### Margins in Glyphs
Metrics keys on glyphs and layers (`metricsLeft`, `metricsRight`,
`metricsWidth`, e.g. `=n`, `=|H`, `=H+10`, `=n*1.2`), auto-aligned composites,
per-master values. Editing a margin a key drives must either update the key or
be refused — decide when this lands.
