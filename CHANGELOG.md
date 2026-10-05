# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
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
