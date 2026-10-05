# Decisions

Outcome of Phase 0 (spike, 2026-10-05). Spike code lives in `spike/` and is
throwaway; what survives is listed here.

## 1. Already decided (chat, before the spike)

| Topic | Decision |
|---|---|
| Scope of the prototype | one `.ufo` / `.ufoz`, one master; designspace and Glyphs → [LATER.md](LATER.md) |
| Undo | none in the prototype; confirmations + **Revert to file** |
| UI | React 19 + Tailwind v4 for the chrome (as `~/WORK/fea-proof`); grids and preview are imperative canvas inside components |
| Deploy | GitHub Actions → GitHub Pages of this repo |
| License | Apache-2.0 (same as Font-Rover) |

## 2. Runtime

- **Pyodide 314.0.7** (Python 3.14.2, fonttools 4.62.1 bundled). Pyodide moved
  from `0.2x` to Python-based version numbers (`314.x`); 0.28/0.29 are older.
  Pin the exact version.
- Worker deps: `fonttools` + `micropip` from the Pyodide distribution;
  `ufoLib2` 0.18.1 and `ufo-spacing-lib` 0.4.3 (both pure, `py3-none-any`).
  The spike used `micropip.install` from PyPI; Phase 1 serves pinned wheels
  from `public/wheels/` instead (no runtime dependency on PyPI).
- No `fs` (pyfilesystem2) needed: fontTools ≥4.57 reads `.ufoz` with its own
  `fontTools.misc.filesystem`.
- Download weight (compressed): `pyodide.asm.wasm` 3.4 MB, `python_stdlib.zip`
  2.5 MB, fonttools 1.1 MB, micropip 0.1 MB, ufoLib2 + ufo-spacing-lib +
  attrs ≈ 0.2 MB → **≈ 7.3 MB** on first visit, then HTTP cache.

## 3. Measurements

Chrome on the dev machine, module worker, Vite dev server. Python times are
measured inside the worker (`spike/py/bench.py`); the same script runs under
CPython for comparison.

Fonts:
- **stress** — synthetic, built by `spike/make_stress_ufo.py` from Spectral
  Regular (OFL): 3100 glyphs, 925 groups, 35 000 pairs, UFO 3.
- **local** — a large commercial UFO (local, not in the repo): 1046 glyphs,
  182 groups, 1606 pairs.
- **mutator** — MutatorSans Light Condensed: 50 glyphs, 3 groups, 3 pairs.

### Start-up

| | ms |
|---|---|
| Pyodide load (`loadPyodide`) — first visit / cached | 1151 / ~880 |
| `loadPackage(micropip, fonttools)` — cached | ~120 |
| `micropip.install(ufoLib2, ufo-spacing-lib)` — first / cached | 1050 / ~270 |
| import of our modules | ~360 |
| **page → worker ready — first / cached** | **2742 / ~1640** |

"First visit" is the first load in this browser profile on a fast connection;
a slow network adds the ~7.3 MB download on top.

### Opening and editing

| | stress `.ufoz` | stress folder | local `.ufoz` | CPython stress folder |
|---|---|---|---|---|
| open (ufoLib2, lazy) | 660 | 175 | 211 | 87 |
| copy folder into MEMFS | — | 171 | — | — |
| outline export, component refs (incl. lazy `.glif` parsing) | 1056 | 842 | 357 | 418 |
| outline export, decomposed (glyphs already parsed) | 354 | 360 | 97 | 206 |
| JSON of outlines (refs) | 14 ms / 767 KB | same | 5 ms / 207 KB | 9 |
| JSON of outlines (decomposed) | 1466 KB | same | 400 KB | — |
| groups + kerning → JSON | 16 | 16 | 1 | 11 |
| full open payload (outlines + groups + kerning) | 3.0 MB | 3.0 MB | 0.3 MB | — |
| payload transfer (transferable `ArrayBuffer`) + `JSON.parse` | 0 + 12 | 0 + 12 | 0 + 1 | — |
| `get_pairs_by_key` (full kerning scan) | 1.3 | 1.3 | 0.1 | 0.7 |
| add glyph to a 42-member group, incl. delta JSON | 4.3 | 4.3 | 0.6 | 2.4 |
| remove glyph (with exceptions) | 2.9 | 3.0 | 0.4 | 1.6 |
| rename group | 3.1 | 3.0 | 0.5 | 1.6 |
| `changed_files()` (diff + both plists, original style) | 181 | 181 | 13 | 88 |
| Revert to file | 8.3 | 8.1 | 0.6 | 5.2 |

**Against the budgets:** warm open to a fully populated mirror (open + export
+ JSON + parse) ≈ 1.8 s for the stress font as `.ufoz`, ≈ 1.2 s as a folder —
budget < 10 s. An edit round trip is ≈ 3–5 ms in Python plus a postMessage —
budget < 100 ms. Pyodide is ~2× slower than CPython here, which is fine.

### Decisions from the numbers

- **Outlines: eager, with component refs.** Send all outlines once on open as
  path commands with components as `[name, transform]` refs; the TS mirror
  resolves components into `Path2D`. Refs are half the size of decomposed
  outlines and the dependency preview needs composite chains anyway. Lazy
  per-visible-cell transfer (old risk R3/R5) is not needed at this size;
  revisit only if a real font is ≥ 3× the stress font.
- **No worker round trip for drawing.** The full payload is ≤ 3 MB and parses
  in ~12 ms; the mirror keeps everything.
- `changed_files()` at 180 ms runs only on save, not per edit.

## 4. Adapter between ufo-spacing-lib and ufoLib2

`FontGroupsManager` touches only `font.groups`, `font.kerning` and
`glyph_name in font`. It needs two things a plain dict lacks:

- **`remove(key)`** on both groups (`rename_group`) and kerning (add, delete,
  rename). Missing keys are ignored.
- **Values are rebuilt as tuples** (`groups[name] = ()`, `+= tuple(...)`).
  ufoLib2 loads lists; a list `+=` would extend in place behind
  `__setitem__`. The adapter stores members as tuples and converts to lists
  on output.

**ufoLib2 cannot hold the adapter**: assigning to `font.kerning` runs an attrs
converter that wraps the value back into ufoLib2's `Kerning` (no `remove`).
So the manager gets a separate **master view** object (`groups`, `kerning`,
`__contains__` delegating to the ufoLib2 font). This is the `FontDocument`
master from PLAN §2.1. The ufoLib2 `Font` is used only for reading glyphs.

Tracked mappings (`spike/py/tracked.py`): dict subclasses that record the
original value of each key on first touch; `take_diff()` returns
`(changed, removed)` and drops keys that are back at their original value.
One RPC = one diff = the delta to the mirror, keyed by `master` (always 0).
Unsupported mutators (`clear`, `popitem`) raise.

Parity: the same scenario (add, remove with exceptions, rename, delete) on
ufo-spacing-lib's own `MockFont` and on the adapter gives identical groups and
kerning (`spike/py/tests/test_session.py`).

## 5. Saving: minimal diff

- Files are written only when their content differs from the file as opened /
  last saved (dict comparison, then byte comparison). Open → save, and
  edit → manual revert → save, write nothing.
- **fontTools' plist writer is not enough.** It writes a single-quoted XML
  declaration, an unindented root dict and sorted keys. UFOs saved by other
  editors use different styles, so one edit would rewrite the whole
  `kerning.plist` (on one OSS font: 29 614 diff lines for an unchanged file).
- **Style-preserving writer** (`spike/py/plist_style.py`): copies the header
  and trailer verbatim, the root indent and indent unit, the newline sequence,
  the empty-container form, and the original key order at every level (new
  keys go to their sorted position if that level was sorted, else to the
  end). Re-serializing unchanged `groups.plist` / `kerning.plist` is
  **byte-identical on every UFO tried**: 6 OSS UFOs and 40 local commercial
  UFOs. Adding one glyph to a group gives a one-line diff.
- The worker returns `{filename: bytes | None}`; JS writes the files (File
  System Access API) or rebuilds the `.ufoz`.
- Only UFO 3 seen so far. UFO 2 writing needs kerning-group name
  down-conversion (ufoLib's `groupRenameMap`); the prototype **refuses to
  save UFO 2** with a clear message (open/read is fine) until needed.

## 6. Browser facts confirmed

- Drop of a `.ufo` folder: `webkitGetAsEntry()` walks it (all browsers);
  `getAsFileSystemHandle()` must be called synchronously inside the `drop`
  event, before any `await`, to get a writable directory handle (Chromium).
  The spike logs whether the handle is present; writing is Phase 1/3.
- `.ufoz` opens directly from bytes in MEMFS; a folder is copied file by file
  into MEMFS (~170 ms for 3100 glyphs).

## 7. Issues found in ufo-spacing-lib 0.4.3

Reported in [upstream/ufo-spacing-lib-groups-core.md](upstream/ufo-spacing-lib-groups-core.md):
1. `groups_with_errors` is never cleared on rebuild — duplicates pile up after
   every operation.
2. `print()` to stdout for a glyph in two groups on one side.
3. `reposition_glyph_in_group(..., target_index=len(group))` does nothing —
   "move to the end" is impossible.
4. fontParts-only `.remove()` on groups/kerning (worked around by the
   adapter; a `del`-based fallback upstream would remove the need).

## 8. Open for Phase 1

- Wheels in `public/wheels/` + a small loader that installs them without
  micropip's PyPI lookups.
- Worker RPC shape: typed request/response, deltas as in §4.
- Service worker for caching Pyodide (old risk R2) — optional, the HTTP cache
  already gives the ~1.6 s warm start.
