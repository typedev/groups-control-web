"""Timings shared by CPython and Pyodide runs (spike, throwaway)."""

from __future__ import annotations

import json
import time

from session import Session


def _t(fn):
    t0 = time.perf_counter()
    value = fn()
    return value, round((time.perf_counter() - t0) * 1000, 1)


def run(path: str) -> dict:
    out: dict = {}
    s = Session()
    info, out["open_ms"] = _t(lambda: s.open(path))
    out.update(info)

    glyphs, out["export_refs_ms"] = _t(lambda: s.export_glyphs(decompose=False))
    payload, out["json_refs_ms"] = _t(lambda: json.dumps(glyphs, separators=(",", ":")))
    out["json_refs_kb"] = len(payload) // 1024
    glyphs_d, out["export_decomposed_ms"] = _t(lambda: s.export_glyphs(decompose=True))
    out["json_decomposed_kb"] = len(json.dumps(glyphs_d, separators=(",", ":"))) // 1024
    _, out["groups_kerning_json_ms"] = _t(
        lambda: json.dumps([s.groups_json(), s.kerning_json()])
    )

    # The largest kern1 group, and a free glyph to add to it.
    kern1 = [g for g in s.font.groups if g.startswith("public.kern1.")]
    big = max(kern1, key=lambda g: len(s.font.groups[g]))
    grouped = {m for g in kern1 for m in s.font.groups[g]}
    kerned_left = {l for (l, _r) in s.font.kerning}
    free = next(
        (n for n in s.glyph_order() if n not in grouped and n in kerned_left),
        next(n for n in s.glyph_order() if n not in grouped),
    )
    out["big_group_size"] = len(s.font.groups[big])

    pairs, out["get_pairs_by_key_ms"] = _t(lambda: s.manager.get_pairs_by_key(big, "L"))
    out["big_group_pairs"] = len(pairs)
    res, out["op_add_ms"] = _t(
        lambda: json.dumps(s.op("add_glyphs_to_group", group_name=big, glyph_list=[free]))
    )
    _, out["op_remove_ms"] = _t(
        lambda: json.dumps(s.op("remove_glyphs_from_group", group_name=big, glyph_list=[free]))
    )
    _, out["op_rename_ms"] = _t(
        lambda: json.dumps(s.op("rename_group", old_name=big, new_name=big + "_renamed"))
    )
    files, out["changed_files_ms"] = _t(s.changed_files)
    out["changed_files"] = sorted(files)
    _, out["revert_ms"] = _t(s.revert)
    return out


def glyphs_payload(path: str) -> str:
    """The JSON the worker would send to the mirror on open."""
    s = Session()
    s.open(path)
    return json.dumps(
        {"glyphs": s.export_glyphs(), "groups": s.groups_json(), "kerning": s.kerning_json()},
        separators=(",", ":"),
    )


if __name__ == "__main__":
    import sys

    print(json.dumps(run(sys.argv[1]), indent=1))
