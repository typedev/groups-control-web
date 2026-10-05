"""Worker entry point: the functions the TS worker calls.

Functions take and return JSON strings, so the worker does not depend on
Pyodide's object conversion rules. File contents never travel as JSON: save
functions write into the in-memory file system and return the paths.
One document is open at a time.
"""

from __future__ import annotations

import json
import os
import zipfile

from ufo_spacing_lib.groups_core import FontGroupsManager

from gcweb.document import GROUPS_FILE, KERNING_FILE, UfoDocument
from gcweb.export import font_payload
from gcweb.lang import LangChecker
from gcweb.preview import KernEdit, dependency_line, pair_rows
from gcweb.vendor.groups_history import history_to_text
from gcweb.vendor.naming import name_problem

KERN1 = "public.kern1."
KERN2 = "public.kern2."

MUTATING_OPS = {
    "add_glyphs_to_group",
    "remove_glyphs_from_group",
    "delete_group",
    "rename_group",
}

_doc: UfoDocument | None = None
_manager: FontGroupsManager | None = None
_lang: LangChecker | None = None
_kern: KernEdit | None = None
_pending_save: dict[str, bytes | None] = {}


def _require() -> UfoDocument:
    if _doc is None:
        raise RuntimeError("no font is open")
    return _doc


def open_font(path: str) -> str:
    global _doc, _manager, _lang, _kern
    _doc = UfoDocument(path)
    _manager = FontGroupsManager(_doc.master)
    _lang = LangChecker(_doc)
    _kern = KernEdit(_doc, _manager)
    return json.dumps(_doc.summary())


def font_data() -> str:
    """Outlines, metrics, groups and kerning for the TS mirror."""
    return json.dumps(font_payload(_require()), separators=(",", ":"))


def close_font() -> str:
    global _doc, _manager, _lang, _kern
    _doc = _manager = _lang = _kern = None
    return "null"


# -- editing --------------------------------------------------------------------


def _lang_update(delta: dict) -> dict:
    """Lang statuses of every kerning key the delta can have changed."""
    view = _require().master
    touched = set(delta["groups"]["changed"]) | set(delta["groups"]["removed"])
    keys = {(l, r) for l, r, _v in delta["kerning"]["changed"]}
    if touched:
        keys.update(k for k in view.kerning if k[0] in touched or k[1] in touched)
    flagged = _lang.flagged(sorted(keys))
    flagged_keys = {(l, r) for l, r, _s, _n in flagged}
    clear = [[l, r] for l, r in sorted(keys) if (l, r) not in flagged_keys]
    clear += [[l, r] for l, r in delta["kerning"]["removed"]]
    return {"set": flagged, "clear": clear}


def _finish(result) -> str:
    doc = _require()
    delta = doc.take_delta()
    delta["lang"] = _lang_update(delta)
    return json.dumps({"result": result, "delta": delta, "dirty": doc.is_dirty()})


def op(name: str, kwargs_json: str) -> str:
    """Run one FontGroupsManager operation; returns {result, delta}."""
    _require()
    if name not in MUTATING_OPS:
        raise ValueError(f"unknown op {name!r}")
    return _finish(getattr(_manager, name)(**json.loads(kwargs_json)))


def _prefix(group: str) -> str:
    if group.startswith(KERN1):
        return KERN1
    if group.startswith(KERN2):
        return KERN2
    raise ValueError(f"not a kerning group: {group}")


def _split_grouped(glyphs: list[str], prefix: str) -> tuple[list[str], list[list]]:
    """(free, [[glyph, its group], ...]) for one side, keeping the order (W:1025)."""
    owner: dict[str, str] = {}
    for name, members in _require().master.groups.items():
        if name.startswith(prefix):
            for m in members:
                owner.setdefault(m, name)
    free: list[str] = []
    grouped: list[list] = []
    for g in dict.fromkeys(glyphs):
        if g in owner:
            grouped.append([g, owner[g]])
        else:
            free.append(g)
    return free, grouped


def _place(group: str, added: list[str], index: int) -> None:
    """Put just-added members at `index` of the rest (W:1123-1147)."""
    view = _require().master
    body = [g for g in view.groups[group] if g not in added]
    at = max(0, min(index, len(body)))
    view.groups[group] = tuple(body[:at] + added + body[at:])
    _manager.makeReverseGroupsMapping()  # set_font() would also clear the history


def add_glyphs(group: str, glyphs_json: str, check_kerning: bool, index: int = -1) -> str:
    """Add free glyphs to an existing group; index >= 0 places them there.

    Glyphs already in a group on this side are refused and reported in
    result["grouped"] — never moved.
    """
    free, grouped = _split_grouped(json.loads(glyphs_json), _prefix(group))
    added: list[str] = []
    if free:
        before = set(_require().master.groups.get(group, ()))
        _manager.add_glyphs_to_group(group, free, check_kerning=check_kerning)
        added = [g for g in _require().master.groups.get(group, ()) if g not in before]
        if index >= 0 and added:
            _place(group, added, index)
    return _finish({"added": added, "grouped": grouped})


def create_group(prefix: str, short_name: str, glyphs_json: str, check_kerning: bool) -> str:
    """New group from the free glyphs; refuses a bad name or no free glyphs."""
    if prefix not in (KERN1, KERN2):
        raise ValueError(f"bad side prefix {prefix!r}")
    problem = name_problem(short_name, prefix, _require().master.groups)
    if problem:
        raise ValueError(problem)
    free, grouped = _split_grouped(json.loads(glyphs_json), prefix)
    group = None
    if free:
        group = prefix + short_name
        _manager.add_glyphs_to_group(group, free, check_kerning=check_kerning)
    return _finish({"group": group, "added": free, "grouped": grouped})


def remove_glyphs(group: str, glyphs_json: str, check_kerning: bool) -> str:
    glyphs = [g for g in json.loads(glyphs_json) if g in _require().master.groups.get(group, ())]
    if glyphs:
        _manager.remove_glyphs_from_group(group, glyphs, check_kerning=check_kerning)
    return _finish({"removed": glyphs})


def delete_group(group: str, check_kerning: bool) -> str:
    """With Keep Kerning the group's pairs become member exceptions; its own pairs always go."""
    _manager.delete_group(group, check_kerning=check_kerning)
    return _finish(None)


def rename_group(old: str, new_short: str) -> str:
    """Rename within the same side. Kerning always follows the group: renaming
    without it (desktop with Keep Kerning off) leaves pairs on a missing group."""
    prefix = _prefix(old)
    new_short = new_short.strip()
    if prefix + new_short == old:
        return _finish({"group": old})
    problem = name_problem(new_short, prefix, _require().master.groups)
    if problem:
        raise ValueError(problem)
    _manager.rename_group(old, prefix + new_short, check_kerning=True)
    return _finish({"group": prefix + new_short})


def delete_pairs(pairs_json: str) -> str:
    """Remove kerning keys (pairs list: Delete Pairs / Backspace), one step."""
    kerning = _require().master.kerning
    removed = []
    for left, right in json.loads(pairs_json):
        if (left, right) in kerning:
            del kerning[(left, right)]
            removed.append([left, right])
    return _finish({"removed": removed})


# -- preview & kerning edits -------------------------------------------------------


def preview_line(subject_json: str) -> str:
    """{names, side, key, members, mode} → glyph tokens of the dependency line."""
    s = json.loads(subject_json)
    return json.dumps(
        dependency_line(_require(), s["names"], s["side"], s.get("key"), s.get("members"), s["mode"])
    )


def preview_pairs(pairs_json: str, expanded: bool, per_row: int) -> str:
    return json.dumps(pair_rows(_require(), json.loads(pairs_json), expanded, per_row))


def kern_nudge(left: str, right: str, delta: int) -> str:
    _require()
    return _finish({"key": _kern.nudge(left, right, delta)})


def kern_remove(left: str, right: str) -> str:
    _require()
    return _finish({"key": _kern.remove(left, right)})


def kern_exception(left: str, right: str, side: str) -> str:
    _require()
    return _finish({"key": _kern.exception(left, right, side)})


# -- history journal (manager.history, Font-Rover groups_history.py format) --------


def history() -> str:
    return json.dumps(
        {
            "text": history_to_text(_manager.history) if _manager else "",
            "count": len(_manager.history) if _manager else 0,
            "recording": bool(_manager and _manager.trackHistory),
        }
    )


def set_history_recording(on: bool) -> str:
    if on:
        _manager.resume_history()
    else:
        _manager.pause_history()
    return history()


def clear_history() -> str:
    _manager.clear_history()
    return history()


def move_in_group(group: str, glyphs_json: str, index: int) -> str:
    """Move members to `index` (in the current order); index 0 = key glyph.

    Like FontGroupsManager.reposition_glyph_in_group (insert before the
    member now at `index`), but `index == len(group)` moves to the end and
    a target that is itself moved falls through to the next kept member.
    Reordering never touches kerning.
    """
    view = _require().master
    members = list(view.groups[group])
    moving = [g for g in json.loads(glyphs_json) if g in members]
    kept = [g for g in members if g not in moving]
    anchor = next((g for g in members[index:] if g not in moving), None)
    at = kept.index(anchor) if anchor is not None else len(kept)
    view.groups[group] = tuple(kept[:at] + moving + kept[at:])
    _manager.makeReverseGroupsMapping()  # set_font() would also clear the history
    return _finish(None)


def revert() -> str:
    doc = _require()
    delta = doc.revert()
    _manager.makeReverseGroupsMapping()
    delta["lang"] = _lang_update(delta)
    return json.dumps(delta)


# -- saving ---------------------------------------------------------------------


def _check_writable(doc: UfoDocument) -> None:
    if doc.read_only_reason:
        raise RuntimeError(doc.read_only_reason)


def changed_files(out_dir: str) -> str:
    """Write the plists that differ from disk into out_dir.

    Returns [{"name", "path" | null}] — path null means delete the file.
    Call mark_saved() once the files are on disk.
    """
    global _pending_save
    doc = _require()
    _check_writable(doc)
    _pending_save = doc.changed_files()
    os.makedirs(out_dir, exist_ok=True)
    out = []
    for name, data in _pending_save.items():
        path = None
        if data is not None:
            path = os.path.join(out_dir, name)
            with open(path, "wb") as f:
                f.write(data)
        out.append({"name": name, "path": path})
    return json.dumps(out)


def build_ufoz(out_path: str) -> str:
    """Write a .ufoz of the current state to out_path.

    Every entry except groups.plist / kerning.plist is copied unchanged from
    the source (.ufoz archive or .ufo folder). Call mark_saved() afterwards.
    """
    global _pending_save
    doc = _require()
    _check_writable(doc)
    _pending_save = doc.changed_files()
    current = {name: doc.current_bytes(name) for name in (GROUPS_FILE, KERNING_FILE)}
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as out:
        if zipfile.is_zipfile(doc.path):
            with zipfile.ZipFile(doc.path) as src:
                top = _zip_root(src)
                seen = set()
                for info in src.infolist():
                    rel = info.filename[len(top) + 1 :] if top else info.filename
                    if rel in current:
                        seen.add(rel)
                        if current[rel] is not None:
                            out.writestr(info, current[rel])
                    else:
                        out.writestr(info, src.read(info))
                for rel, data in current.items():
                    if rel not in seen and data is not None:
                        out.writestr(f"{top}/{rel}" if top else rel, data)
        else:
            top = os.path.basename(doc.path.rstrip("/"))
            for root, _dirs, files in os.walk(doc.path):
                for file in sorted(files):
                    full = os.path.join(root, file)
                    rel = os.path.relpath(full, doc.path).replace(os.sep, "/")
                    if rel in current:
                        continue
                    out.write(full, f"{top}/{rel}")
            for rel, data in current.items():
                if data is not None:
                    out.writestr(f"{top}/{rel}", data)
    return json.dumps({"path": out_path})


def _zip_root(src: zipfile.ZipFile) -> str:
    """The top folder inside a .ufoz ('' when files sit at the root)."""
    names = src.namelist()
    if any(n == "metainfo.plist" for n in names):
        return ""
    return names[0].split("/")[0]


def mark_saved() -> str:
    """The files from the last changed_files()/build_ufoz() are on disk."""
    global _pending_save
    _require().mark_saved(_pending_save)
    _pending_save = {}
    return "null"


def has_changes() -> str:
    return json.dumps(_require().is_dirty())
