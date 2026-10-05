"""Cases for the TS port of resolve_kern_pair (src/model/kerning.test.ts).

The JSON in fixtures/parity/ is what ufo-spacing-lib answers; this test
fails if it drifts. Regenerate with:  GCWEB_UPDATE_PARITY=1 uv run pytest
"""

from __future__ import annotations

import json
import os
from pathlib import Path

from ufo_spacing_lib.groups_core import FontGroupsManager, resolve_kern_pair

OUT = Path(__file__).resolve().parents[2] / "fixtures" / "parity" / "resolve_kern_pair.json"

GLYPHS = ["A", "Aacute", "V", "W", "T", "o", "e", "period", "comma", "x"]
GROUPS = {
    "public.kern1.A": ["A", "Aacute"],
    "public.kern2.V": ["V", "W"],
    "public.kern1.T": ["T"],
    "public.kern2.o": ["o", "e"],
    "public.kern2.dup": ["W"],  # W is already in kern2.V: first group wins
    "public.kern1.empty": [],
    "other": ["x"],
}
KERNING = {
    ("public.kern1.A", "public.kern2.V"): -80,
    ("Aacute", "public.kern2.V"): -60,  # glyph-group exception
    ("public.kern1.A", "W"): -70,  # group-glyph exception
    ("Aacute", "W"): -50,  # glyph-glyph exception
    ("public.kern1.T", "public.kern2.o"): -90,
    ("T", "e"): 0,  # zero is a value
    ("period", "comma"): 20,  # ungrouped pair
    ("A", "period"): -10,  # exception against an ungrouped glyph
}


class _Font:
    def __init__(self):
        self.groups = dict(GROUPS)
        self.kerning = dict(KERNING)

    def __contains__(self, name):
        return name in GLYPHS


def cases() -> dict:
    font = _Font()
    manager = FontGroupsManager(font)
    names = GLYPHS + ["A.uuid123", "Q"]
    out = []
    for left in names:
        for right in names:
            info = resolve_kern_pair(font, manager, (left, right))
            out.append(
                {
                    "pair": [left, right],
                    "left": info.left,
                    "right": info.right,
                    "value": info.value,
                    "isException": info.is_exception,
                    "leftGroup": info.left_group,
                    "rightGroup": info.right_group,
                }
            )
    return {
        "groups": GROUPS,
        "kerning": [[l, r, v] for (l, r), v in KERNING.items()],
        "cases": out,
    }


def test_parity_fixture_is_current():
    text = json.dumps(cases(), indent=1) + "\n"
    if os.environ.get("GCWEB_UPDATE_PARITY") or not OUT.exists():
        OUT.write_text(text)
    assert OUT.read_text() == text
