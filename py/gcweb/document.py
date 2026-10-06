"""FontDocument for one UFO (one master).

The rest of the worker talks to `UfoDocument`; ufoLib2 is used only to read
glyphs. Groups and kerning live in tracked mappings on a `MasterView`, which
is what ufo-spacing-lib's FontGroupsManager operates on.
"""

from __future__ import annotations

from typing import Any

import ufoLib2

from gcweb.margins import GlyphEdits
from gcweb.plist_style import PlistStyle
from gcweb.tracked import TrackedGroups, TrackedKerning

GROUPS_FILE = "groups.plist"
KERNING_FILE = "kerning.plist"


class MasterView:
    """What FontGroupsManager sees: tracked groups/kerning + glyph membership.

    ufoLib2's Font converts anything assigned to `font.kerning` back into its
    own `Kerning` class (attrs converter), which drops `remove()`; so the
    tracked mappings live here instead of on the ufoLib2 object.
    """

    def __init__(self, font: ufoLib2.Font) -> None:
        self._font = font
        self.groups = TrackedGroups(font.groups)
        self.kerning = TrackedKerning(font.kerning)

    def __contains__(self, glyph_name: str) -> bool:
        return glyph_name in self._font


def groups_bytes(groups, style: PlistStyle) -> bytes | None:
    """groups.plist content in the original file's style (None = no file)."""
    if not groups:
        return None
    return style.dumps({k: list(v) for k, v in groups.items()})


def kerning_bytes(kerning, style: PlistStyle) -> bytes | None:
    """kerning.plist content (nested as UFOWriter does), original style."""
    nested: dict[str, dict[str, Any]] = {}
    for (left, right), value in kerning.items():
        nested.setdefault(left, {})[right] = value
    if not nested:
        return None
    return style.dumps(nested)


def delta(master: int, groups_diff, kerning_diff) -> dict:
    """JSON-ready delta for the TS mirror."""
    g_changed, g_removed = groups_diff
    k_changed, k_removed = kerning_diff
    return {
        "master": master,
        "groups": {
            "changed": {k: list(v) for k, v in g_changed.items()},
            "removed": list(g_removed),
        },
        "kerning": {
            "changed": [[l, r, v] for (l, r), v in k_changed.items()],
            "removed": [[l, r] for (l, r) in k_removed],
        },
    }


class UfoDocument:
    def __init__(self, path: str) -> None:
        font = ufoLib2.Font.open(path, lazy=True)
        reader = font._reader
        self.path = path
        self.ufo = font
        self.format_version: tuple[int, int] = tuple(reader.formatVersionTuple)
        self._baseline_bytes: dict[str, bytes | None] = {
            name: (reader.fs.readbytes(name) if reader.fs.exists(name) else None)
            for name in (GROUPS_FILE, KERNING_FILE)
        }
        self.masters = [MasterView(font)]
        # Set by the opener when the document must not be saved (designspace preview).
        self.read_only_note: str | None = None
        # Master index in an open designspace; deltas carry it.
        self.index = 0
        # (groups, kerning, glyph texts) the last changed_files() was made from.
        self._pending_state: tuple | None = None
        self.glyph_edits = GlyphEdits(font)
        self._snapshot_baseline()

    @property
    def master(self) -> MasterView:
        return self.masters[0]

    @property
    def read_only_reason(self) -> str | None:
        if self.read_only_note:
            return self.read_only_note
        if self.format_version[0] < 3:
            return (
                f"UFO {self.format_version[0]} sources open read-only: saving "
                "kerning groups back to UFO 2 is not supported yet."
            )
        return None

    def _snapshot_baseline(self) -> None:
        self._baseline_groups = dict(self.master.groups)
        self._baseline_kerning = dict(self.master.kerning)

    # -- reading --------------------------------------------------------------

    def glyph_order(self) -> list[str]:
        """Font glyph order, deduped (first occurrence wins), then the rest."""
        seen: set[str] = set()
        order: list[str] = []
        for name in self.ufo.glyphOrder:
            if name not in seen and name in self.ufo:
                seen.add(name)
                order.append(name)
        for name in self.ufo.keys():
            if name not in seen:
                seen.add(name)
                order.append(name)
        return order

    def summary(self) -> dict:
        groups = self.master.groups
        return {
            "formatVersion": list(self.format_version),
            "familyName": self.ufo.info.familyName,
            "styleName": self.ufo.info.styleName,
            "unitsPerEm": self.ufo.info.unitsPerEm,
            "glyphs": len(self.ufo),
            "kern1Groups": sum(1 for g in groups if g.startswith("public.kern1.")),
            "kern2Groups": sum(1 for g in groups if g.startswith("public.kern2.")),
            "otherGroups": sum(
                1 for g in groups if not g.startswith(("public.kern1.", "public.kern2."))
            ),
            "pairs": len(self.master.kerning),
            "readOnlyReason": self.read_only_reason,
            # Font-Rover ignores them too (docs/RESEARCH_MARGINS.md decision 2).
            "hasMetricsRules": "com.typedev.spacing.metricsRules" in self.ufo.lib,
        }

    # -- changes --------------------------------------------------------------

    def take_delta(self) -> dict:
        view = self.master
        return delta(self.index, view.groups.take_diff(), view.kerning.take_diff())

    def revert(self) -> dict:
        """Revert to file: back to the state of the last open/save."""
        view = self.master
        return delta(
            self.index,
            view.groups.reset_to(self._baseline_groups),
            view.kerning.reset_to(self._baseline_kerning),
        )

    def changed_files(self) -> dict[str, bytes | None]:
        """Plist files to write (None = delete). Unchanged content is skipped.

        Remembers the state they were made from: mark_saved() takes that as
        saved, not whatever was edited while the files were being written.
        """
        view = self.master
        self._pending_state = (dict(view.groups), dict(view.kerning), self.glyph_edits.texts())
        files: dict[str, bytes | None] = {}
        if dict(view.groups) != self._baseline_groups:
            style = PlistStyle.from_bytes(self._baseline_bytes[GROUPS_FILE])
            files[GROUPS_FILE] = groups_bytes(view.groups, style)
        if dict(view.kerning) != self._baseline_kerning:
            style = PlistStyle.from_bytes(self._baseline_bytes[KERNING_FILE])
            files[KERNING_FILE] = kerning_bytes(view.kerning, style)
        plists = {
            name: data
            for name, data in files.items()
            if data != self._baseline_bytes[name]
        }
        return {**plists, **self.glyph_edits.changed()}

    def is_dirty(self) -> bool:
        """Groups or kerning differ from the last open/save (cheap: no plist dump)."""
        view = self.master
        return (
            dict(view.groups) != self._baseline_groups
            or dict(view.kerning) != self._baseline_kerning
            or self.glyph_edits.dirty()
        )

    def current_bytes(self, name: str) -> bytes | None:
        """Content of groups.plist / kerning.plist for the current state."""
        changed = self.changed_files()
        return changed[name] if name in changed else self._baseline_bytes[name]

    def current_files(self) -> dict[str, bytes | None]:
        """Every file whose content is ours: the two plists and edited glyphs."""
        return {
            GROUPS_FILE: self.current_bytes(GROUPS_FILE),
            KERNING_FILE: self.current_bytes(KERNING_FILE),
            **self.glyph_edits.changed(),
        }

    def mark_saved(self, files: dict[str, bytes | None]) -> None:
        self._baseline_bytes.update({k: v for k, v in files.items() if k in (GROUPS_FILE, KERNING_FILE)})
        state = getattr(self, "_pending_state", None)
        if state is None:
            self._snapshot_baseline()
            self.glyph_edits.mark_saved()
        else:
            self._baseline_groups, self._baseline_kerning, texts = state
            self.glyph_edits.mark_saved(texts)
        self._pending_state = None
