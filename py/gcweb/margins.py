"""Margin edits (Phase 6, docs/RESEARCH_MARGINS.md).

The desktop's arrow-key edit (Font-Rover utils/margin_edit.py): the upright
margin of one glyph changes by a delta — left: the drawing moves and the
advance grows by the same amount; right: only the advance changes. Composites
follow their base (decision 1): when the edited glyph is a composite's first
component, the composite takes the same change (recursively); when it is a
later component, that component is moved back so the composite looks the same.

The ufoLib2 glyphs are edited for drawing and margins; the GLIF text of every
touched glyph is patched in parallel (gcweb.glif_patch) and that text is what
gets saved, so files keep their formatting.
"""

from __future__ import annotations

from fontTools.ufoLib.glifLib import readGlyphFromString

from gcweb.glif_patch import patch_glif


class GlyphEdits:
    """Original and current GLIF text of glyphs touched by margin edits."""

    def __init__(self, font) -> None:
        self._font = font
        self._layer = font.layers.defaultLayer
        glyph_set = font._reader.getGlyphSet()
        self._contents: dict[str, str] = dict(glyph_set.contents)
        self._dir = "glyphs"
        self._fs = font._reader.fs
        self._base: dict[str, str] = {}
        self._text: dict[str, str] = {}
        self._reverse: dict[str, list[str]] | None = None

    # -- text ------------------------------------------------------------------------

    def path_of(self, name: str) -> str:
        return f"{self._dir}/{self._contents[name]}"

    def _current(self, name: str) -> str:
        if name not in self._text:
            text = self._fs.readbytes(self.path_of(name)).decode("utf-8")
            self._base[name] = self._text[name] = text
        return self._text[name]

    def patch(self, name: str, **kwargs) -> None:
        self._text[name] = patch_glif(self._current(name), **kwargs)

    def changed(self) -> dict[str, bytes]:
        """{ufo-relative path: GLIF bytes} of glyphs that differ from disk."""
        return {
            self.path_of(n): t.encode("utf-8") for n, t in self._text.items() if t != self._base[n]
        }

    def dirty(self) -> bool:
        return any(t != self._base[n] for n, t in self._text.items())

    def mark_saved(self) -> None:
        self._base.update(self._text)

    def revert(self) -> list[str]:
        """Put touched glyphs back to their last saved text; returns their names."""
        names = [n for n, t in self._text.items() if t != self._base[n]]
        for name in names:
            glyph = self._layer[name]
            glyph.clearContours()
            glyph.clearComponents()
            glyph.clearAnchors()
            glyph.clearGuidelines()
            readGlyphFromString(self._base[name], glyph, glyph.getPointPen())
            self._text[name] = self._base[name]
        return names

    # -- edits -------------------------------------------------------------------------

    def composites_of(self, base: str) -> list[str]:
        if self._reverse is None:
            reverse: dict[str, list[str]] = {}
            for name in self._layer.keys():
                for c in self._layer[name].components:
                    reverse.setdefault(c.baseGlyph, []).append(name)
            self._reverse = reverse
        return self._reverse.get(base, [])

    def _move_drawing(self, name: str, dx: float) -> None:
        glyph = self._layer[name]
        glyph.move((dx, 0))
        for guideline in glyph.guidelines:
            if guideline.x is not None:
                guideline.x += dx

    def nudge(self, name: str, side: str, delta: float) -> list[str]:
        """Change the left/right margin of `name` by `delta`; returns every
        glyph whose outline, metrics or text changed (empty: nothing to do)."""
        glyph = self._layer[name]
        margin = glyph.getLeftMargin(self._layer) if side == "left" else glyph.getRightMargin(self._layer)
        if margin is None or not delta:
            return []  # empty glyph: the desktop leaves it alone
        changed = [name]
        if side == "left":
            self._move_drawing(name, delta)
        glyph.width += delta
        self.patch(name, shift=delta if side == "left" else 0, width=glyph.width)

        queue, seen = [name], {name}
        while queue:
            base = queue.pop(0)
            for comp_name in self.composites_of(base):
                composite = self._layer[comp_name]
                comps = composite.components
                follows = comps and comps[0].baseGlyph == base
                if follows and comp_name not in seen:
                    composite.width += delta
                    dx = {}
                    if side == "left":
                        for i, c in enumerate(comps[1:], start=1):
                            c.move((delta, 0))
                            dx[i] = delta
                    self.patch(comp_name, width=composite.width, component_dx=dx)
                    seen.add(comp_name)
                    queue.append(comp_name)
                    changed.append(comp_name)
                elif side == "left":
                    # The edited glyph is an accent here: keep it where it was.
                    dx = {}
                    for i, c in enumerate(comps):
                        if i > 0 and c.baseGlyph == base:
                            c.move((-delta, 0))
                            dx[i] = -delta
                    if dx:
                        self.patch(comp_name, component_dx=dx)
                        if comp_name not in changed:
                            changed.append(comp_name)
        return changed
