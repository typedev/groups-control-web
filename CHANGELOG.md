# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.3.0] — 2026-10-06

### Added
- Tools → **Between masters** (designspace only):
  - **Copy Groups to Masters**: make the chosen masters' groups the same as
    the current master's (all, kerning or other groups). Only what differs
    is changed, kerning following membership in each master with Keep
    Kerning; masters already the same are left alone. Plan first, then
    Apply, as with the other tools.
  - **Diff Groups**: the kerning groups that are not the same in every
    master, each membership drawn as a row of glyph cells with the masters
    that have it — glyphs this master's group lacks outlined, glyphs missing
    there shown as missing cells, a different key glyph dashed. All masters
    or the current discrete subspace; order-only differences optional.
    Kerning is not compared. **Make like this master** fixes one group in
    every compared master (kerning follows; glyphs it takes leave their
    other group).
  - **Copy Kerning of Glyphs**: the pairs of the selected (or typed) glyphs,
    with their groups' pairs unless turned off, into the chosen masters;
    only missing pairs are added.
  - **Interpolate Kerning**: the kerning of masters A and B interpolated
    into this master; the position comes from the designspace locations
    (or is typed). Pairs a master lacks take its group pair's value.
  - **Transfer Kerning by Script**: the pairs of the chosen scripts (listed
    with their pair counts) into the chosen masters. Only scripts some glyph
    is written in are listed: pairs with marks or punctuation no longer
    bring in Syriac, Thaana… from those characters' script extensions.
- Font panel: a **Scripts** filter (Latin, Cyrillic, Greek, Common… with
  glyph counts) next to Glyph order / Unicode order. A glyph's script is its character's Unicode script, found through
  its own unicode, its base name (`a.sc`, `uni0628.fina`) or a ligature's
  parts; figures, punctuation and marks are Common.

### Changed
- The groups / glyphs-grouped counter moved from the header to the right
  end of the toolbar (Add group, Rename … Tools), saving header room.

## [0.2.1] — 2026-10-06

### Added
- Restore checks the folder first (Chrome, Edge): when a groups.plist,
  kerning.plist or the designspace changed on disk since the edits were
  stored (e.g. after a git pull), it lists them and offers Restore anyway,
  Open from disk (drop the stored edits) or Cancel.
- Designspace sessions are autosaved too: after a reload, Restore brings
  back the unsaved edits of every master and the edit scope.
- **Open folder…** (Chrome, Edge) opens a project folder with a
  `.designspace` as well as a `.ufo` folder; saving then writes into it
  without asking for the folder again.

## [0.2.0] — 2026-10-06

### Added
- Designspaces: drop a folder holding a `.designspace` (pick one when there
  are several); only the UFOs it references are read. The default master
  opens first; a header dropdown switches the current master and a badge
  reports kern-group compatibility across masters (within the current
  discrete subspace).
- All masters of a designspace stay open in the worker: switching back to a
  master already shown is instant.
- Designspace group edits reach every master with the same kern groups,
  upright and italic alike; a header selector narrows this to the current
  discrete subspace (e.g. italic=0) or to the current master. Its labels
  count the masters reached ("6 of 18"). Each master remaps its own
  kerning; a failure in any master changes nothing. Revert covers every
  master.
- Saving a designspace writes the changed files of every changed master
  into the dropped folder (Chrome, Edge); other browsers download a .zip of
  just the changed files to unzip into the designspace folder. Saving many
  files shows a progress bar; if writing stops part way, the dialog says how
  many files were written and the masters not written in full stay unsaved.
- The app is frozen while saving (no clicks or keys reach it). Edits that
  still slip in between preparing and writing the files are never counted
  as saved: what is marked saved is the state the files were made from.
- **Match order** (designspace header): when masters differ from the current
  one only in member order, one click copies its order (key glyphs
  included) to them, within the edit scope's reach. Kerning is untouched.
- The designspace edit scope is coloured like Keep Kerning (accent for all
  compatible masters, careful colours otherwise); with a designspace the
  header shows its file name and the master dropdown instead of the family
  and style.
- Progress bar while a font or designspace opens (reading files, opening
  each master, preparing outlines) and while switching to a new master.

### Changed
- Start screen: the −10 kerning marker sits closer under the title.

## [0.1.2] — 2026-10-05

### Changed
- Selection follows one subject across the panels. Selecting a group or a
  group member clears the font selection; selecting in the font clears the
  member and pair selections (the open group stays, dashed). A member click
  takes the focus back from the font and the pairs list.
- Several glyphs selected in the font: the pairs list shows the pairs of all
  of them and the preview lines them up against the first (in grid order).
  Several members selected: the preview shows just those, checked against the
  key glyph.
- Members selected in the open group are outlined dashed in the font grid
  (with Hide grouped off), like the open group in the groups grid.
- Light theme: the shaded side half of the group cells is a little darker.

### Fixed
- Add group could create a group from a font selection left over after a
  group was picked.
- Glyphs hidden by the search or the filters (e.g. dragged into a group with
  Hide grouped on) no longer stay selected and drive the pairs and preview.
- Shift-click ranges no longer start from a stale anchor of another group or
  another pairs list.

## [0.1.1] — 2026-10-05

### Added
- Start screen: the name set large above the drop area, its "Co" pair kerned
  and marked like a kerning value in the preview; credits at the bottom
  (author, developed with Claude Code, source, licence).
- The version is shown next to the title (hover: build commit and date) and at
  the end of the help overview. `scripts/bump_version.py` raises it in
  package.json, pyproject.toml and the CHANGELOG together.

### Fixed
- Light theme: the faint members behind a group's key glyph were drawn as dark
  as the key glyph (the build shortens colour tokens like #000000 to #000,
  which the alpha helper did not read). Any CSS colour is now accepted.

## [0.1.0] — 2026-10-05

First release: the Groups Control prototype for one UFO.

### Added
- Help drawer at the right (Help in the header, ? or F1): topics for the
  overview, each panel, Keep Kerning and saving, with every key of the
  preview (dependency line, pairs, beam). It follows the panel in use; a tab
  keeps one topic until Auto. The workspace narrows instead of being covered.
  Every panel has a "?" that opens its topic; the Keep Kerning popover moved
  here.
- The beam (Font-Rover utils/beam.py): margins measured where a horizontal
  line crosses the outline. B toggles it, Alt+Up/Down moves it by 1 (Shift
  100), drag its handle or type the height; Alt+B (Stems) marks the
  crossings and the stem / counter widths. With the beam on, the preview
  shows margins along it ("–" where it misses), and the dependency line,
  group validation and member badges check margins along it; a glyph the
  beam misses is never a mismatch. TS port of the crossing maths, parity
  tested against the vendored Python on every MutatorSans glyph.
- Appearance menu in the header: theme (system, light, dark) and one of seven
  accent colours (sky, blue, teal, violet, plum, rose, graphite), each tuned for both
  themes; kept per browser; canvases follow it too.

### Changed
- Every colour now comes from the theme: CSS tokens for light and dark
  (including kerning value, error, drop and cell colours) and the accent;
  canvases read them through one palette. Group cells follow the theme (dark
  cells in the dark theme, white cells on grey panels in the light theme)
  and mark the side half with even, wide diagonal hatching. The kerned mark, non-member glyphs in the dependency line and the
  `@.` markers use the accent.
- Refreshed UI: IBM Plex Sans (bundled, no font requests), one set of theme
  tokens, 32 px controls with segmented switches and menus, panels as cards,
  thin scrollbars. Keep Kerning moved to the front of the toolbar as a large
  switch; when off it turns amber and says that kerning is dropped. A help
  popover explains what on and off do to each kind of edit. Side 1 / Side 2
  is an accent-coloured switch.
- Tools menu (Phase 7), Font-Rover's Groups Control board scripts for one
  UFO: Clean Groups & Kerning, Fix Key Glyph Position, Flatten Kerning, Merge
  Script Groups, Place Composites into Groups, Place Ligatures into Groups,
  Remove Cross-Language Pairs, Rename Groups, Round Kerning, Split Groups by
  Script. One dialog: options → plan report (nothing changes) → Apply, run on
  a working copy and taken in one step. Engines vendored from
  `font_rover/groups_control/`.
- Margin editing (Phase 6, see docs/RESEARCH_MARGINS.md): click a glyph in
  the dependency line; arrows change the right margin, Alt+arrows the left,
  Shift ×10 (desktop keys). Composites follow their base glyph (recursively);
  an edited accent keeps its place in composites. Edited glyphs are saved by
  patching the GLIF text in place, so only the changed numbers differ
  (verified against ufoLib2 on 2.5k open-source glyphs). Revert to file
  restores glyphs too. Fonts with metrics rules show "metrics rules ignored".
- Session and exchange (Phase 5): autosave of unsaved edits in this browser
  (IndexedDB: the opened files, groups, kerning, history and the folder
  handle) with Restore / Discard on the start screen; Import groups from a
  KernTool4 text file (scope: kerning / other / all; replaces and carries
  kerning, with a report to confirm before anything changes) and Export
  groups (Font-Rover `groups_io.py`, vendored); History Save / Load
  (Load replaces the journal and applies nothing).
- Preview and kerning editing (Phase 4): bottom preview with the dependency
  line of the selected group or glyph (Members / All / Smart chains, control
  glyphs per script and case, mismatch / non-member colours, checked-side
  margins) via Font-Rover's `dependencies.py` (vendored); pairs mode for the
  selected pairs with kerning applied, bars, values and exception markers,
  Expand (all left × right glyphs), pairs per line; kerning keys (arrows ±10,
  Shift ±5, Alt ±1), Backspace removes the resolved pair, E / Ctrl+E / Alt+E
  create exceptions (expanded only), Z / X move the selection; the pairs list
  forwards these keys; Ctrl/Cmd+wheel zoom; size, margins and names options;
  resizable preview pane.
- Delete Pairs in the pairs list (button, Backspace / Delete, confirmation).
- Error boundary: a render error shows a message with Reload instead of a
  blank page.

### Changed
- Preview margin labels follow the desktop glyph line: "72 ▶" at the right
  edge, "◀ 33" one line lower at the left edge.

### Fixed
- Scrolling the pairs list crashed the page (event read after React cleared
  it).
- Group editing (Phase 3): drag glyphs from the font grid into the group
  (at the drop position; position 0 makes a new key glyph) or onto a group
  cell, drag members back to the font grid to remove them, drag members to
  reorder; glyphs already grouped on the side are refused with a report.
  Add (with the Group Name Taken dialog), Delete (with confirmation), Rename,
  Keep Kerning switch, History journal (record / clear, desktop line format).
- Saving: Save writes only `groups.plist` / `kerning.plist` back into the
  opened folder (Chromium), otherwise Download .ufoz rebuilds the archive with
  every other file unchanged; unchanged plists are never written; Ctrl/Cmd+S;
  Revert to file; unsaved-changes marker and leave-page warning. UFO 2 fonts
  stay read-only.
- Folders are read completely (images, data) so a downloaded .ufoz is whole.

### Changed
- Rename always moves the group's kerning to the new name; renaming with
  Keep Kerning off on desktop leaves pairs pointing at a missing group.
- Reordering members computes the new order itself, so a member can also be
  moved to the end (ufo-spacing-lib's reposition cannot).
- Read-only Groups Control (Phase 2): font grid (virtualized canvas, name /
  Unicode search with wildcards, glyph order / Unicode sort, Hide grouped,
  kerning filter, grouped / kerned corner marks, click a grouped glyph to jump
  to its group); groups grid with Side 1 / Side 2, group dropdown, stacked
  members, key margin and validation markers (empty, missing glyphs, margin
  mismatch, italic angle aware); content grid with margin badges; kern pairs
  list with Left / Right / Value / Exc / Lang columns, sorting and selection;
  header stats; resizable columns.
- Worker payload with outlines (component references), angled margins for
  italics, groups, kerning, and script/language problems of every pair
  (Font-Rover's `languages/compat.py`, vendored by `scripts/vendor_sync.py`).
- TS port of `resolve_kern_pair` for drawing, with a parity fixture generated
  from ufo-spacing-lib.
- App skeleton: Vite + React + Tailwind, Python (Pyodide 314.0.7) in a Web
  Worker with a typed RPC, loader with progress and version info.
- Open a `.ufo` folder (drop or folder picker) or a `.ufoz` file (drop or
  file picker); a writable folder handle is kept in Chromium for saving later.
  The font summary shows glyph, group and pair counts.
- Worker package `py/gcweb`: tracked groups/kerning mappings for
  ufo-spacing-lib, minimal-diff plist writer that keeps the original file
  style, Revert to file. UFO 2 sources open read-only.
- Pinned wheels in `public/wheels/` (`scripts/fetch_wheels.py`).
- GitHub Actions: tests (pytest, Vitest), build, deploy to GitHub Pages.
- Phase 0 measurements and decisions (`docs/DECISIONS.md`; the spike code was removed after Phase 1).
