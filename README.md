# Groups Control Web

Edit kerning groups and kerning of UFO sources in the browser (Glyphs and designspace later).
Everything runs locally — your font files are never uploaded anywhere.

Status: Phase 1 (skeleton). See [docs/PLAN.md](docs/PLAN.md) and
[docs/DECISIONS.md](docs/DECISIONS.md).

A web port of Groups Control from [Font Rover](https://github.com/typedev/font-rover).

## Development

```sh
npm install
npm run dev          # http://localhost:5173/
npm test             # Vitest
npm run build        # dist/, base path /groups-control-web/
uv run pytest        # worker Python (py/gcweb) in CPython
uv run python scripts/fetch_wheels.py   # refresh public/wheels/ after changing pins in pyproject.toml
```

Deploy: pushing to `main` runs `.github/workflows/deploy.yml` (tests → build →
GitHub Pages). The repository's Pages source must be set to "GitHub Actions".

## License

Apache-2.0, see [LICENSE](LICENSE).
