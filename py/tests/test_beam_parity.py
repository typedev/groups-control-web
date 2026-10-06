"""Cases for the TS beam port (src/model/beam.test.ts).

Crossings from Font-Rover's outline_intersections.py (vendored) on every
MutatorSans glyph at several heights, plus the glyph records the TS side
draws from. Regenerate with:  GCWEB_UPDATE_PARITY=1 uv run pytest
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import ufoLib2

from gcweb import api
from gcweb.vendor.beam import beam_crossings

ROOT = Path(__file__).resolve().parents[2]
MUTATOR = ROOT / "fixtures" / "MutatorSans" / "MutatorSansLightCondensed.ufo"
OUT = ROOT / "fixtures" / "parity" / "beam.json"
HEIGHTS = [-10, 0, 100, 250, 350, 500, 520, 700, 712.5]


def cases() -> dict:
    font = ufoLib2.Font.open(MUTATOR)
    layer = font.layers.defaultLayer
    api.open_font(str(MUTATOR))
    glyphs = json.loads(api.font_data())["glyphs"]
    api.close_font()
    out = []
    for name in sorted(layer.keys()):
        for y in HEIGHTS:
            xs = beam_crossings(layer[name], y, layer)
            out.append({"glyph": name, "y": y, "xs": [round(x, 6) for x in xs]})
    return {"glyphs": glyphs, "cases": out}


def test_beam_fixture_is_current():
    text = json.dumps(cases(), indent=None, separators=(",", ":")) + "\n"
    if os.environ.get("GCWEB_UPDATE_PARITY") or not OUT.exists():
        OUT.write_text(text)
    assert OUT.read_text() == text
