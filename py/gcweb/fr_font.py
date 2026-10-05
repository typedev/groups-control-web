"""A fontParts-like view of the open UFO for vendored Font-Rover code.

Font-Rover's dependencies.py expects ``font[name]`` glyphs with
``components`` / ``bounds`` / ``unicodes`` / ``width``, plus
``getCharacterMapping()`` and ``getReverseComponentMapping()``. This wraps
ufoLib2 (read-only) and the tracked groups. It also provides the three
helpers dependencies.py imports from Font-Rover's GTK-bound utils.
"""

from __future__ import annotations

from typing import Any, Optional

from gcweb.document import UfoDocument
from gcweb.export import margins


class _Component:
    def __init__(self, component, layer) -> None:
        self._c = component
        self._layer = layer
        self.baseGlyph = component.baseGlyph

    @property
    def bounds(self):
        try:
            return self._c.getBounds(self._layer)
        except KeyError:  # base glyph missing
            return None


class _Glyph:
    def __init__(self, font: "FRFont", name: str) -> None:
        self.font = font
        self.name = name
        self._g = font._layer[name]

    @property
    def width(self) -> float:
        return self._g.width

    @property
    def unicodes(self) -> list[int]:
        return list(self._g.unicodes)

    @property
    def components(self) -> list[_Component]:
        return [_Component(c, self.font._layer) for c in self._g.components]

    @property
    def bounds(self):
        return self._g.getBounds(self.font._layer)


class FRFont:
    def __init__(self, doc: UfoDocument) -> None:
        self._doc = doc
        self._layer = doc.ufo.layers.defaultLayer
        self.info = doc.ufo.info
        self._cmap: Optional[dict] = None
        self._reverse: Optional[dict] = None
        self._glyphs: dict[str, _Glyph] = {}

    @property
    def groups(self):
        return self._doc.master.groups

    @property
    def glyphOrder(self) -> list[str]:
        return self._doc.glyph_order()

    def __contains__(self, name: str) -> bool:
        return name in self._layer

    def __getitem__(self, name: str) -> _Glyph:
        glyph = self._glyphs.get(name)
        if glyph is None:
            glyph = self._glyphs[name] = _Glyph(self, name)
        return glyph

    def keys(self):
        return self._layer.keys()

    def getCharacterMapping(self) -> dict[int, list[str]]:
        if self._cmap is None:
            cmap: dict[int, list[str]] = {}
            for name in self._doc.glyph_order():
                for cp in self._layer[name].unicodes:
                    cmap.setdefault(cp, []).append(name)
            self._cmap = cmap
        return self._cmap

    def getReverseComponentMapping(self) -> dict[str, tuple[str, ...]]:
        if self._reverse is None:
            reverse: dict[str, list[str]] = {}
            for name in self._doc.glyph_order():
                for c in self._layer[name].components:
                    reverse.setdefault(c.baseGlyph, []).append(name)
            self._reverse = {k: tuple(v) for k, v in reverse.items()}
        return self._reverse


# -- the helpers dependencies.py imports from Font-Rover utils --------------------


def safe_glyph_order(font: Any) -> list[str]:
    """Glyph order without duplicates (first occurrence kept)."""
    return list(dict.fromkeys(font.glyphOrder))


def same_margin(a: Optional[float], b: Optional[float]) -> bool:
    """utils/margin_edit.py: None equals only None, else rounded equality."""
    if a is None or b is None:
        return a is b
    return round(a) == round(b)


def side_margin(glyph: Any, side: str, beam_y: Optional[float] = None) -> Optional[float]:
    """kern1 → right margin, kern2 → left; angled in italics (no beam yet)."""
    if glyph is None:
        return None
    font = glyph.font
    left, right = margins(glyph._g, font._layer, font.info.italicAngle or 0)
    return right if side == "kern1" else left
