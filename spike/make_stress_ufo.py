"""Build a synthetic stress UFO for Phase 0 timings (spike, throwaway).

Source: Spectral Regular (OFL). Every glyph gets an `.alt1` copy (plus some `.alt2` to pass TARGET_GLYPHS) (with its
own kerning groups mirroring the originals), kerning is replicated onto the
copies and topped up with group-group pairs to TARGET_PAIRS.
Output goes to fonts-local/ (gitignored): stress.ufo and stress.ufoz.

    uv run --project py python make_stress_ufo.py [SOURCE.ufo]
"""

from __future__ import annotations

import random
import shutil
import sys
from pathlib import Path

import ufoLib2

SOURCE = Path.home() / "WORK/original/sources/spectral-regular.ufo"
OUT = Path(__file__).resolve().parent.parent / "fonts-local"
SUFFIX = ".alt1"
TARGET_PAIRS = 35_000
TARGET_GLYPHS = 3_100


def main() -> None:
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else SOURCE
    font = ufoLib2.Font.open(src)
    layer = font.layers.defaultLayer
    names = list(layer.keys())
    alt = {n: n + SUFFIX for n in names}

    for name in names:
        copy = layer[name].copy(name=alt[name])
        copy.unicodes = []
        for comp in copy.components:
            comp.baseGlyph = alt.get(comp.baseGlyph, comp.baseGlyph)
        layer.insertGlyph(copy, name=alt[name])
    # A few ungrouped, unkerned copies to pass TARGET_GLYPHS.
    extra = [n + ".alt2" for n in names[: max(0, TARGET_GLYPHS - 2 * len(names))]]
    for name in extra:
        copy = layer[name[: -len(".alt2")]].copy(name=name)
        copy.unicodes = []
        layer.insertGlyph(copy, name=name)
    font.glyphOrder = list(font.glyphOrder) + [alt[n] for n in names] + extra

    galt = {}
    for gname, members in list(font.groups.items()):
        if gname.startswith(("public.kern1.", "public.kern2.")):
            galt[gname] = gname + SUFFIX
            font.groups[galt[gname]] = [alt.get(m, m) for m in members]

    def mirror(n: str) -> str:
        return galt.get(n) or alt.get(n, n)

    kerning = dict(font.kerning)
    for (l, r), v in list(kerning.items()):
        kerning[(mirror(l), r)] = v
        kerning[(l, mirror(r))] = v
        kerning[(mirror(l), mirror(r))] = v

    rng = random.Random(1)
    lefts = [g for g in font.groups if g.startswith("public.kern1.")]
    rights = [g for g in font.groups if g.startswith("public.kern2.")]
    while len(kerning) < TARGET_PAIRS:
        kerning[(rng.choice(lefts), rng.choice(rights))] = rng.randrange(-120, 60, 5)
    font.kerning.clear()
    font.kerning.update(kerning)

    OUT.mkdir(exist_ok=True)
    folder = OUT / "stress.ufo"
    zipped = OUT / "stress.ufoz"
    shutil.rmtree(folder, ignore_errors=True)
    zipped.unlink(missing_ok=True)
    font.save(folder)
    font.save(zipped, structure="zip")
    print(f"{len(layer)} glyphs, {len(font.groups)} groups, {len(font.kerning)} pairs")
    print(f"-> {folder}\n-> {zipped} ({zipped.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
