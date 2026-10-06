# Groups Control Web

Edit the kerning groups and the kerning of a UFO or a designspace in the
browser: a web port of Groups Control from
[Font Rover](https://github.com/typedev/font-rover).

**https://typedev.github.io/groups-control-web/**

Everything runs locally in the tab (Python in WebAssembly via Pyodide): your
font files are never uploaded anywhere. After the first visit it also starts
without a network.

Opens a `.ufo` folder, a `.ufoz`, or a folder with a `.designspace` and its
master UFOs. Glyphs sources are parked — see
[docs/GLYPHS_PLAN.md](docs/GLYPHS_PLAN.md).

## What it does

- Font grid (search by name, Unicode or component; Scripts filter), kerning
  groups of both sides with margin checks, the glyphs of a group, and the
  kerning pairs of a group or glyph (exceptions, script / language problems).
- Drag glyphs into and out of groups, add / rename / delete groups, with
  **Keep Kerning** turning group kerning into exceptions where needed.
- Preview: the dependency line of a group (members, composites, control
  glyphs) or the selected pairs with their kerning; kerning keys and
  exceptions; margin editing with composites following their base; the beam.
- Tools: Clean, Fix Key Glyph Position, Flatten, Merge / Split Script Groups,
  Place Composites / Ligatures, Remove Cross-Language Pairs, Rename, Round.
- Designspace: a master switcher; group edits reach every master with the
  same kern groups (or one discrete subspace, or one master), each master
  remapping its own kerning; a compatibility badge with Match order. Tools
  between masters: Copy Groups, Copy Kerning of Glyphs, Interpolate Kerning,
  Transfer Kerning by Script, Replay History, and Diff Groups — the groups
  that differ, drawn as glyph cells, with "Make like this master".
- Groups import / export as text (Merge or Replace) and the edit history.
- Saving writes only the changed `groups.plist`, `kerning.plist` and glyphs back
  into the folder (Chrome, Edge), keeping their formatting — for a
  designspace, into every changed master; otherwise it downloads a `.ufoz`
  (a `.zip` of the changed files for a designspace). Unsaved edits survive a
  reload; Restore warns when the files changed on disk meanwhile.
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
uv run python scripts/bump_version.py patch   # release: package.json, pyproject.toml, CHANGELOG
```

Docs: [PLAN](docs/PLAN.md) · [DECISIONS](docs/DECISIONS.md) ·
[RESEARCH_MARGINS](docs/RESEARCH_MARGINS.md) ·
[DESIGNSPACE_PLAN](docs/DESIGNSPACE_PLAN.md) ·
[GLYPHS_PLAN](docs/GLYPHS_PLAN.md) · [LATER](docs/LATER.md) ·
[CHANGELOG](CHANGELOG.md)

Deploy: pushing to `main` runs `.github/workflows/deploy.yml` (tests → build →
GitHub Pages; the repository's Pages source is "GitHub Actions").

## License

Apache-2.0, see [LICENSE](LICENSE). Vendored Font-Rover modules keep their
Apache-2.0 headers.
