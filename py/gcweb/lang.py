"""Lang column: script / language compatibility of kerning pairs.

Uses Font-Rover's ScriptCompat (vendored) through a duck-typed font: it needs
`getCharacterMapping()` and `groups`.
"""

from __future__ import annotations

from gcweb.document import UfoDocument
from gcweb.vendor.compat import PAIR_OK, ScriptCompat


class _CompatFont:
    def __init__(self, doc: UfoDocument) -> None:
        self._doc = doc

    @property
    def groups(self):
        return self._doc.master.groups

    def getCharacterMapping(self) -> dict[int, list[str]]:
        cmap: dict[int, list[str]] = {}
        layer = self._doc.ufo.layers.defaultLayer
        for name in self._doc.glyph_order():
            for cp in layer[name].unicodes:
                cmap.setdefault(cp, []).append(name)
        return cmap


class LangChecker:
    def __init__(self, doc: UfoDocument) -> None:
        self._compat = ScriptCompat(_CompatFont(doc))

    def invalidate(self) -> None:
        self._compat.invalidate()

    def flagged(self, pairs) -> list[list]:
        """[[left, right, status, note], ...] for pairs that are not OK."""
        statuses = self._compat.pair_statuses(pairs)
        return [
            [l, r, status, self._compat.pair_status_note((l, r))]
            for (l, r), status in statuses.items()
            if status != PAIR_OK
        ]
