"""Bottom preview data and kerning edits (Font-Rover dependency_preview.py,
glyphs_runway/kern_edit.py KernEditController, without the widget calls).
"""

from __future__ import annotations

from ufo_spacing_lib import (
    AdjustKerningCommand,
    CreateExceptionCommand,
    FontContext,
    KerningEditor,
    RemoveKerningCommand,
)
from ufo_spacing_lib.groups_core import FontGroupsManager, resolve_kern_pair

from gcweb.document import UfoDocument
from gcweb.fr_font import FRFont
from gcweb.vendor import dependencies as dep


def _token(t: dep.PreviewToken) -> dict:
    out: dict = {"n": t.name}
    if t.is_context:
        out["ctx"] = True
    if t.is_member:
        out["m"] = True
    if t.mismatch:
        out["x"] = True
    if t.margin is not None:
        out["g"] = t.margin
    if t.context is not None:
        out["c"] = t.context
    if t.pair_left:
        out["pl"] = True
    return out


def dependency_line(doc: UfoDocument, names, side, key, members, mode) -> list[dict]:
    """Glyph tokens (with their control glyph) for the dependency line."""
    tokens = dep.dependency_glyphs(FRFont(doc), names, side, key, members, mode)
    return [_token(t) for t in tokens]


def pair_rows(doc: UfoDocument, pairs, expanded: bool, per_row: int) -> list[list[dict]]:
    font = FRFont(doc)
    glyph_pairs = dep.glyph_pairs(font, [tuple(p) for p in pairs], expanded)
    return [[_token(t) for t in row] for row in dep.pair_rows(font, glyph_pairs, per_row)]


class KernEdit:
    """KernEditController.edit / create_exception on the master view."""

    def __init__(self, doc: UfoDocument, manager: FontGroupsManager) -> None:
        self._doc = doc
        self._manager = manager
        self._editor = KerningEditor()

    def _run(self, command) -> None:
        result = self._editor.execute(command, FontContext.from_single_font(self._doc.master))
        if not result.success:
            raise ValueError(result.message or "kerning edit failed")

    def nudge(self, left: str, right: str, delta: int) -> list:
        info = resolve_kern_pair(self._doc.master, self._manager, (left, right))
        key = (info.left, info.right)
        # An exception may sit at 0; a plain pair reaching 0 goes away.
        self._run(AdjustKerningCommand(pair=key, delta=delta, remove_zero=not info.is_exception))
        return list(key)

    def remove(self, left: str, right: str) -> list | None:
        info = resolve_kern_pair(self._doc.master, self._manager, (left, right))
        if info.value is None:
            return None
        key = (info.left, info.right)
        self._run(RemoveKerningCommand(pair=key))
        return list(key)

    def exception(self, left: str, right: str, side: str) -> list:
        """side: 'left' (left glyph vs right's key), 'right', or 'both' (glyph pair)."""
        info = resolve_kern_pair(self._doc.master, self._manager, (left, right))
        if side == "left":
            key = (left, info.right)
        elif side == "right":
            key = (info.left, right)
        else:
            key = (left, right)
        if key == (info.left, info.right):
            raise ValueError(f"{left} {right}: that exception already applies")
        self._run(CreateExceptionCommand(pair=key, value=int(info.value or 0), side=side))
        return list(key)
