# Groups Control Web

Edit the kerning groups and the kerning of a UFO in the browser: a web port of
Groups Control from [Font Rover](https://github.com/typedev/font-rover).

**https://typedev.github.io/groups-control-web/**

Everything runs locally in the tab (Python in WebAssembly via Pyodide): your
font files are never uploaded anywhere.

Status: 0.1.0, one `.ufo` folder or `.ufoz` at a time. Designspace and Glyphs
sources come later — see [docs/LATER.md](docs/LATER.md).

## What it does

- Font grid, kerning groups of both sides with margin checks, the glyphs of a
  group, and the kerning pairs of a group or glyph (exceptions, script /
  language problems).
- Drag glyphs into and out of groups, add / rename / delete groups, with
  **Keep Kerning** turning group kerning into exceptions where needed.
- Preview: the dependency line of a group (members, composites, control
  glyphs) or the selected pairs with their kerning; kerning keys and
  exceptions; margin editing with composites following their base; the beam.
- Tools: Clean, Fix Key Glyph Position, Flatten, Merge / Split Script Groups,
  Place Composites / Ligatures, Remove Cross-Language Pairs, Rename, Round.
- Saving writes only the changed `groups.plist`, `kerning.plist` and glyphs back
  into the folder (Chrome, Edge), keeping their formatting; otherwise it
  downloads a `.ufoz`. Unsaved edits survive a reload.
- Light / dark theme, accent colours, contextual help (press `?`).

## Development

```sh
npm install
npm run dev          # http://localhost:5173/
npm test             # Vitest
npm run build        # dist/, base path /groups-control-web/
uv run pytest        # worker Python (py/gcweb) in CPython
uv run python scripts/fetch_wheels.py   # refresh public/wheels/ after changing pins in pyproject.toml
uv run python scripts/vendor_sync.py    # re-copy the vendored Font-Rover modules
```

Docs: [PLAN](docs/PLAN.md) · [DECISIONS](docs/DECISIONS.md) ·
[RESEARCH_MARGINS](docs/RESEARCH_MARGINS.md) · [LATER](docs/LATER.md) ·
[CHANGELOG](CHANGELOG.md)

Deploy: pushing to `main` runs `.github/workflows/deploy.yml` (tests → build →
GitHub Pages; the repository's Pages source is "GitHub Actions").

## License

Apache-2.0, see [LICENSE](LICENSE). Vendored Font-Rover modules keep their
Apache-2.0 headers.
