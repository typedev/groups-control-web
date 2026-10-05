"""Worker entry point: the functions the TS worker calls.

Every function takes and returns JSON strings, so the worker does not depend
on Pyodide's object conversion rules. One document is open at a time.
"""

from __future__ import annotations

import json

from ufo_spacing_lib.groups_core import FontGroupsManager

from gcweb.document import UfoDocument

MUTATING_OPS = {
    "add_glyphs_to_group",
    "remove_glyphs_from_group",
    "delete_group",
    "rename_group",
    "reposition_glyph_in_group",
}

_doc: UfoDocument | None = None
_manager: FontGroupsManager | None = None


def _require() -> UfoDocument:
    if _doc is None:
        raise RuntimeError("no font is open")
    return _doc


def open_font(path: str) -> str:
    global _doc, _manager
    _doc = UfoDocument(path)
    _manager = FontGroupsManager(_doc.master)
    return json.dumps(_doc.summary())


def close_font() -> str:
    global _doc, _manager
    _doc = None
    _manager = None
    return "null"


def op(name: str, kwargs_json: str) -> str:
    """Run one FontGroupsManager operation; returns {result, delta}."""
    doc = _require()
    if name not in MUTATING_OPS:
        raise ValueError(f"unknown op {name!r}")
    result = getattr(_manager, name)(**json.loads(kwargs_json))
    return json.dumps({"result": result, "delta": doc.take_delta()})


def revert() -> str:
    doc = _require()
    out = doc.revert()
    _manager.set_font(doc.master)
    return json.dumps(out)
