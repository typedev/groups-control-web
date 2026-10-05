# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
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
- Phase 0 spike and measurements (`spike/`, `docs/DECISIONS.md`).
