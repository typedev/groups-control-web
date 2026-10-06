"""Payload for the TS mirror."""

from __future__ import annotations

import json
import math
from pathlib import Path

import pytest
import ufoLib2

from gcweb import api
from gcweb.export import CommandPen, margins

MUTATOR = Path(__file__).resolve().parents[2] / "fixtures" / "MutatorSansLightCondensed.ufo"


@pytest.fixture(scope="module")
def payload() -> dict:
    api.open_font(str(MUTATOR))
    data = json.loads(api.font_data())
    api.close_font()
    return data


def test_shape(payload):
    assert set(payload) == {"info", "order", "glyphs", "groups", "kerning", "lang", "scripts", "scriptLabels"}
    assert payload["info"]["unitsPerEm"] == 1000
    assert len(payload["order"]) == len(set(payload["order"])) == len(payload["glyphs"]) == 50
    assert payload["groups"]["public.kern1.@MMK_L_A"] == ["A"]
    assert ["public.kern1.@MMK_L_A", "V", -15] in payload["kerning"]


def test_glyph_record(payload):
    a = payload["glyphs"]["A"]
    assert a["u"] == [65]
    assert isinstance(a["w"], (int, float)) and a["w"] > 0
    assert a["l"] is not None and a["r"] is not None
    ops = {c[0] for c in a["p"]}
    assert "M" in ops and "Z" in ops
    space = payload["glyphs"]["space"]
    assert space["p"] == [] and space["l"] is None and space["r"] is None


def test_components_stay_refs(payload):
    aacute = payload["glyphs"]["Aacute"]
    comps = [c for c in aacute["p"] if c[0] == "c"]
    assert {c[1] for c in comps} == {"A", "acute"}
    assert all(len(c[2]) == 6 for c in comps)


def test_quadratic_all_offcurve_contour_is_split():
    pen = CommandPen()
    # TrueType contour without on-curve points: implied points are inserted.
    pen.qCurveTo((0, 0), (100, 0), (100, 100), (0, 100), None)
    pen.closePath()
    assert [c[0] for c in pen.commands] == ["M", "Q", "Q", "Q", "Q", "Z"]


def test_numbers_are_compact():
    pen = CommandPen()
    pen.moveTo((1.0, 2.456))
    pen.lineTo((3, 4))
    assert pen.commands[:2] == [["M", 1, 2.46], ["L", 3, 4]]


def test_matches_ufolib2_margins(payload):
    font = ufoLib2.Font.open(MUTATOR)
    layer = font.layers.defaultLayer
    for name in ("A", "Aacute", "O"):
        assert payload["glyphs"][name]["l"] == layer[name].getLeftMargin(layer)


def test_angled_margins_follow_italic_angle():
    font = ufoLib2.Font()
    glyph = font.newGlyph("l")
    glyph.width = 300
    pen = glyph.getPen()
    # A stem slanted by 10 units per 100 of height: x' = x - y*slant.
    pen.moveTo((100, 0))
    pen.lineTo((200, 0))
    pen.lineTo((300, 1000))
    pen.lineTo((200, 1000))
    pen.closePath()
    layer = font.layers.defaultLayer
    angle = -math.degrees(math.atan(0.1))
    left, right = margins(glyph, layer, angle)
    # Unskewed the stem spans x' 100..200 at every height.
    assert left == pytest.approx(100)
    assert right == pytest.approx(100)
    assert margins(glyph, layer, 0) == (100, 0)


def test_scripts(payload):
    # MutatorSans: Latin capitals; marks / punctuation have no script (Common).
    assert payload["scripts"]["A"] == "Latn"
    assert payload["scriptLabels"] == {"Latn": "Latin", "Zyyy": "Common"}
    assert all(code == "Latn" for code in payload["scripts"].values())


def test_glyph_scripts_ignore_script_extensions():
    from gcweb.scripts import glyph_scripts

    cps = {"a": [0x61], "acutecmb": [0x301], "periodcentered": [0xB7], "be-cy": [0x431], "x.alt": []}
    got = glyph_scripts(["a.sc", "acutecmb", "periodcentered", "be-cy", "uni0628.fina", "x.alt"], cps.get)
    assert got == {"a.sc": "Latn", "be-cy": "Cyrl", "uni0628.fina": "Arab"}
