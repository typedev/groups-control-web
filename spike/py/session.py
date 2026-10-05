"""Worker entry point sketch (Phase 0 spike, throwaway).

One UFO, one master. Every mutating call returns a delta keyed by master;
saving produces only the plist files whose content differs from the file as
it was opened (or last saved).
"""

from __future__ import annotations

import time
from typing import Any

import ufoLib2
from fontTools.pens.recordingPen import DecomposingRecordingPen, RecordingPen
from ufo_spacing_lib.groups_core import FontGroupsManager

from plist_style import PlistStyle
from tracked import TrackedGroups, TrackedKerning

MASTER = 0
GROUPS_FILE = "groups.plist"
KERNING_FILE = "kerning.plist"

MUTATING_OPS = {
    "add_glyphs_to_group",
    "remove_glyphs_from_group",
    "delete_group",
    "rename_group",
    "reposition_glyph_in_group",
}


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


def _kerning_delta(changed: dict, removed: list) -> dict:
    return {
        "changed": [[l, r, v] for (l, r), v in changed.items()],
        "removed": [[l, r] for (l, r) in removed],
    }


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


class Session:
    def __init__(self) -> None:
        self.ufo: ufoLib2.Font | None = None
        self.font: MasterView | None = None
        self.manager: FontGroupsManager | None = None
        self._baseline_groups: dict = {}
        self._baseline_kerning: dict = {}
        self._baseline_bytes: dict[str, bytes | None] = {}
        self.timings: dict[str, float] = {}

    # -- open ---------------------------------------------------------------

    def open(self, path: str) -> dict:
        t0 = time.perf_counter()
        font = ufoLib2.Font.open(path, lazy=True)
        version = font._reader.formatVersionTuple if font._reader else None
        reader = font._reader
        self._baseline_bytes = {
            name: (reader.fs.readbytes(name) if reader.fs.exists(name) else None)
            for name in (GROUPS_FILE, KERNING_FILE)
        }
        self.ufo = font
        self.font = MasterView(font)
        self._snapshot_baseline()
        self.manager = FontGroupsManager(self.font)
        self.timings["open"] = time.perf_counter() - t0
        return {
            "formatVersion": list(version) if version else None,
            "glyphs": len(font),  # default layer
            "groups": len(font.groups),
            "pairs": len(font.kerning),
        }

    def _snapshot_baseline(self) -> None:
        self._baseline_groups = dict(self.font.groups)
        self._baseline_kerning = dict(self.font.kerning)

    # -- reading ------------------------------------------------------------

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

    def export_glyphs(self, decompose: bool = False) -> list[dict]:
        """Outlines as compact command lists, plus advance and margins."""
        layer = self.ufo.layers.defaultLayer
        out = []
        for name in self.glyph_order():
            glyph = layer[name]
            pen = DecomposingRecordingPen(layer) if decompose else RecordingPen()
            glyph.draw(pen)
            cmds = []
            for op, pts in pen.value:
                if op == "addComponent":
                    cmds.append(["c", pts[0], list(pts[1])])
                else:
                    flat = [round(c, 2) for p in pts for c in p]
                    cmds.append([_OPS[op], *flat])
            out.append(
                {
                    "n": name,
                    "u": glyph.unicodes,
                    "w": glyph.width,
                    "l": glyph.getLeftMargin(layer),
                    "r": glyph.getRightMargin(layer),
                    "p": cmds,
                }
            )
        return out

    def groups_json(self) -> dict:
        return {k: list(v) for k, v in self.font.groups.items()}

    def kerning_json(self) -> list:
        return [[l, r, v] for (l, r), v in self.font.kerning.items()]

    # -- mutation -----------------------------------------------------------

    def op(self, name: str, **kwargs) -> dict:
        if name not in MUTATING_OPS:
            raise ValueError(f"unknown op {name!r}")
        t0 = time.perf_counter()
        result = getattr(self.manager, name)(**kwargs)
        delta = self._take_delta()
        self.timings[name] = time.perf_counter() - t0
        return {"result": result, "delta": delta}

    def _take_delta(self) -> dict:
        g_changed, g_removed = self.font.groups.take_diff()
        k_changed, k_removed = self.font.kerning.take_diff()
        return {
            "master": MASTER,
            "groups": {
                "changed": {k: list(v) for k, v in g_changed.items()},
                "removed": g_removed,
            },
            "kerning": _kerning_delta(k_changed, k_removed),
        }

    def revert(self) -> dict:
        """Revert to file: back to the state of the last open/save."""
        g_changed, g_removed = self.font.groups.reset_to(self._baseline_groups)
        k_changed, k_removed = self.font.kerning.reset_to(self._baseline_kerning)
        self.manager.set_font(self.font)
        return {
            "master": MASTER,
            "groups": {
                "changed": {k: list(v) for k, v in g_changed.items()},
                "removed": g_removed,
            },
            "kerning": _kerning_delta(k_changed, k_removed),
        }

    # -- saving -------------------------------------------------------------

    def changed_files(self) -> dict[str, bytes | None]:
        """Plist files to write (None = delete). Unchanged content is skipped."""
        files: dict[str, bytes | None] = {}
        if dict(self.font.groups) != self._baseline_groups:
            style = PlistStyle.from_bytes(self._baseline_bytes[GROUPS_FILE])
            files[GROUPS_FILE] = groups_bytes(self.font.groups, style)
        if dict(self.font.kerning) != self._baseline_kerning:
            style = PlistStyle.from_bytes(self._baseline_bytes[KERNING_FILE])
            files[KERNING_FILE] = kerning_bytes(self.font.kerning, style)
        return {
            name: data
            for name, data in files.items()
            if data != self._baseline_bytes[name]
        }

    def mark_saved(self, files: dict[str, bytes | None]) -> None:
        self._baseline_bytes.update(files)
        self._snapshot_baseline()


_OPS = {
    "moveTo": "M",
    "lineTo": "L",
    "curveTo": "C",
    "qCurveTo": "Q",
    "closePath": "Z",
    "endPath": "E",
}
