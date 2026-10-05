"""Everything the TS mirror needs to draw, sent once on open.

Outlines are compact command lists; components stay references so the mirror
can resolve them (and the dependency preview can follow composite chains).

Commands (numbers rounded to 2 decimals, integral values as ints):
    ["M", x, y]                     move
    ["L", x, y]                     line
    ["C", x1, y1, x2, y2, x, y]     cubic
    ["Q", x1, y1, x, y]             quadratic (implied points already split)
    ["Z"]                           close
    ["c", baseGlyph, [xx, xy, yx, yy, dx, dy]]   component

Margins (`l`, `r`) are measured along the italic angle when the font has one.
`lang` lists kerning pairs with a script/language problem (see gcweb.lang).
"""

from __future__ import annotations

import math

from fontTools.pens.basePen import BasePen
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.transformPen import TransformPen

from gcweb.document import UfoDocument
from gcweb.lang import LangChecker


def _num(v: float) -> float | int:
    r = round(v, 2)
    return int(r) if r == int(r) else r


class CommandPen(BasePen):
    def __init__(self) -> None:
        super().__init__(glyphSet=None)
        self.commands: list[list] = []

    def _moveTo(self, pt):
        self.commands.append(["M", _num(pt[0]), _num(pt[1])])

    def _lineTo(self, pt):
        self.commands.append(["L", _num(pt[0]), _num(pt[1])])

    def _curveToOne(self, p1, p2, p3):
        self.commands.append(["C", *(_num(c) for p in (p1, p2, p3) for c in p)])

    def _qCurveToOne(self, p1, p2):
        self.commands.append(["Q", *(_num(c) for p in (p1, p2) for c in p)])

    def _closePath(self):
        self.commands.append(["Z"])

    def _endPath(self):
        pass

    def addComponent(self, glyphName, transformation):
        self.commands.append(["c", glyphName, [_num(v) for v in transformation]])


def _exact(value: float | None) -> float | int | None:
    """Margins keep full precision: validation rounds them like Python does."""
    if value is None:
        return None
    return int(value) if value == int(value) else value


def margins(glyph, layer, italic_angle: float) -> tuple[float | None, float | None]:
    """(left, right) side bearings; along the italic angle when there is one.

    Same convention as Font-Rover's utils/angled_margins.py (RoboFont's):
    the outline is unskewed about the baseline, x' = x - y * slant with
    slant = -tan(italicAngle); left = xMin', right = width - xMax'.
    """
    if not italic_angle:
        return glyph.getLeftMargin(layer), glyph.getRightMargin(layer)
    slant = -math.tan(math.radians(italic_angle))
    bounds_pen = BoundsPen(layer)
    glyph.draw(TransformPen(bounds_pen, (1, 0, -slant, 1, 0, 0)))
    if bounds_pen.bounds is None:
        return None, None
    x_min, _y_min, x_max, _y_max = bounds_pen.bounds
    return x_min, glyph.width - x_max


def glyph_record(doc: UfoDocument, name: str) -> dict:
    layer = doc.ufo.layers.defaultLayer
    glyph = layer[name]
    pen = CommandPen()
    glyph.draw(pen)
    left, right = margins(glyph, layer, doc.ufo.info.italicAngle or 0)
    return {
        "u": list(glyph.unicodes),
        "w": _num(glyph.width),
        "l": _exact(left),
        "r": _exact(right),
        "p": pen.commands,
    }


def font_payload(doc: UfoDocument) -> dict:
    info = doc.ufo.info
    order = doc.glyph_order()
    view = doc.master
    return {
        "info": {
            "unitsPerEm": info.unitsPerEm or 1000,
            "ascender": info.ascender,
            "descender": info.descender,
            "capHeight": info.capHeight,
            "xHeight": info.xHeight,
            "italicAngle": info.italicAngle or 0,
        },
        "order": order,
        "glyphs": {name: glyph_record(doc, name) for name in order},
        "groups": {k: list(v) for k, v in view.groups.items()},
        "kerning": [[l, r, v] for (l, r), v in view.kerning.items()],
        "lang": LangChecker(doc).flagged(list(view.kerning.keys())),
    }
