# CLAUDE.md

Guidance for Claude Code in this repository.

## Project

**groups-control-web** — browser port of Font-Rover's Groups Control (kerning
groups + kerning editor). Static site on GitHub Pages, no server: Python
(Pyodide, in a Web Worker) owns the data and every mutation; TypeScript +
canvas draws the UI. The plan, phases and decisions: [docs/PLAN.md](docs/PLAN.md)
(read it first), [docs/DECISIONS.md](docs/DECISIONS.md) once it exists.

The desktop original is `~/WORK/Font-Rover` — **read-only from here**.
Its `docs/CLAUDE_GROUPS_CONTROL.md` is the behavioural spec.

## Policies

- **Never commit on your own initiative.** The user commits after manual
  testing; wait to be asked.
- **Don't modify other projects** (Font-Rover, ufo-spacing-lib,
  typedev.github.io, …). Write an instruction doc in `docs/upstream/` for a
  session in that project instead.
- Code, comments, docs, commit messages: **English only**. Chat may be Russian.
- **Confidentiality**: never name real fonts or client projects in code, docs,
  tests or commits. Fixtures in the repo are open-source fonts only.
- Python tooling: **uv only** (`uv run pytest`), never pip. JS: npm.
- Keep `CHANGELOG.md` (Keep a Changelog) updated once code exists.

## Font rules carried over from Font-Rover

- Never test a glyph for truth (`if glyph:` is False for composites); use
  `is not None`.
- Glyph order may contain duplicates: dedupe, keeping the first occurrence.
- Kerning lookup order: glyph–glyph → glyph–group → group–glyph →
  group–group; glyph+group exception wins over group+glyph.
- A glyph is in at most one kerning group per side; key glyph = first member
  (UFO). Glyphs sources: groups are glyph attributes shared by all masters,
  kerning is per master — see PLAN §2.1.
- Saving must be minimal-diff: open → save without edits = zero diff.
