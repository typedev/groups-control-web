"""GLIF text patches match the object edit and keep the file's style."""

from __future__ import annotations

import difflib
import plistlib
from pathlib import Path

import pytest
import ufoLib2
from fontTools.pens.recordingPen import RecordingPointPen
from fontTools.ufoLib.glifLib import readGlyphFromString

from gcweb.glif_patch import fmt, patch_glif

MUTATOR = Path(__file__).resolve().parents[2] / "fixtures" / "MutatorSansLightCondensed.ufo"


class _G:
    pass


def parsed(text: str):
    g = _G()
    pen = RecordingPointPen()
    readGlyphFromString(text, g, pen)
    return getattr(g, "width", 0), pen.value, [
        (a["x"], a["y"]) for a in getattr(g, "anchors", [])
    ]


def drawn(glyph):
    pen = RecordingPointPen()
    glyph.drawPoints(pen)
    return glyph.width, pen.value, [(a.x, a.y) for a in glyph.anchors]


def files():
    contents = plistlib.loads((MUTATOR / "glyphs" / "contents.plist").read_bytes())
    return sorted(contents.items())


@pytest.mark.parametrize("name,file", files())
def test_left_shift_matches_ufolib2_move(name, file):
    text = (MUTATOR / "glyphs" / file).read_text()
    glyph = ufoLib2.Font.open(MUTATOR).layers.defaultLayer[name]
    glyph.move((7, 0))
    glyph.width += 7
    assert parsed(patch_glif(text, shift=7, width=glyph.width)) == drawn(glyph)


def test_only_numbers_change():
    text = (MUTATOR / "glyphs" / "A_.glif").read_text()
    new = patch_glif(text, shift=10, width=500)
    changed = [
        l for l in difflib.unified_diff(text.splitlines(), new.splitlines(), lineterm="", n=0)
        if l[:1] in "+-" and l[:3] not in ("+++", "---")
    ]
    # every changed line is the same element with other numbers
    minus = [l[1:] for l in changed if l[0] == "-"]
    plus = [l[1:] for l in changed if l[0] == "+"]
    assert len(minus) == len(plus) > 0
    strip = lambda s: "".join(c for c in s if not c.isdigit() and c not in ".-")
    assert [strip(l) for l in minus] == [strip(l) for l in plus]


def test_component_offsets_added_and_shifted():
    text = (
        '<?xml version="1.0" encoding="UTF-8"?>\n<glyph name="Aacute" format="2">\n'
        '\t<advance width="400"/>\n\t<outline>\n'
        '\t\t<component base="A"/>\n\t\t<component base="acute" xOffset="100" yOffset="200"/>\n'
        "\t</outline>\n</glyph>\n"
    )
    new = patch_glif(text, width=410, component_dx={1: 10})
    assert '<component base="A"/>' in new
    assert '<component base="acute" xOffset="110" yOffset="200"/>' in new
    assert '<advance width="410"/>' in new
    new = patch_glif(text, shift=5)
    assert '<component base="A" xOffset="5"/>' in new


def test_missing_advance_is_inserted_with_file_indent():
    text = "<?xml version='1.0' encoding='UTF-8'?>\n<glyph name='x' format='2'>\n  <outline/>\n</glyph>\n"
    assert patch_glif(text, width=250) == (
        "<?xml version='1.0' encoding='UTF-8'?>\n<glyph name='x' format='2'>\n"
        "  <advance width='250'/>\n  <outline/>\n</glyph>\n"
    )


def test_horizontal_guideline_is_left_alone():
    text = '<glyph name="g"><guideline y="500"/><guideline x="10" y="0" angle="90"/></glyph>'
    assert patch_glif(text, shift=4) == '<glyph name="g"><guideline y="500"/><guideline x="14" y="0" angle="90"/></glyph>'


def test_fmt_and_add_keep_precision():
    from gcweb.glif_patch import add

    assert [fmt(10.0), fmt(10.5), fmt(-3.0004)] == ["10", "10.5", "-3.0004"]
    assert add("549.716172201", -13.5) == "536.216172201"
    assert add("100", 0.1) == "100.1"
    assert add("1e2", 1) == "101"
