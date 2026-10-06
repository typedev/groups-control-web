"""Worker entry point: the functions the TS worker calls.

Functions take and return JSON strings, so the worker does not depend on
Pyodide's object conversion rules. File contents never travel as JSON: save
functions write into the in-memory file system and return the paths.
One document is open at a time.
"""

from __future__ import annotations

import json
import os
import time
import zipfile

from ufo_spacing_lib.groups_core import FontGroupsManager

from gcweb.designspace import Designspace, compare, kern_groups
from gcweb.document import UfoDocument
from gcweb.document import delta as delta_of
from gcweb.export import font_payload, glyph_record
from gcweb.lang import LangChecker
from gcweb.preview import KernEdit, dependency_line, pair_rows
from gcweb.tools import TOOLS, WorkFont, plan_tool
from gcweb.fr_font import FRFont
from gcweb.vendor import groups_io
from gcweb.vendor.groups_history import history_to_text, parse_history
from gcweb.vendor.naming import name_problem

KERN1 = "public.kern1."
KERN2 = "public.kern2."

MUTATING_OPS = {
    "add_glyphs_to_group",
    "remove_glyphs_from_group",
    "delete_group",
    "rename_group",
}

class MasterSession:
    """One master: its document plus the helpers built on it (lazily, on first use)."""

    def __init__(self, doc: UfoDocument) -> None:
        self.doc = doc
        self.manager: FontGroupsManager | None = None
        self.lang: LangChecker | None = None
        self.kern: KernEdit | None = None

    def ensure(self) -> None:
        if self.manager is None:
            self.manager = FontGroupsManager(self.doc.master)
            self.lang = LangChecker(self.doc)
            self.kern = KernEdit(self.doc, self.manager)


# Every open master; the globals below point at the current one (_activate).
_masters: list[MasterSession] = []
_current = 0
_doc: UfoDocument | None = None
_manager: FontGroupsManager | None = None
_lang: LangChecker | None = None
_kern: KernEdit | None = None
_pending_save: dict[int, dict[str, bytes | None]] = {}
_pending_import: groups_io.ImportReport | None = None
_pending_tool = None
_designspace: Designspace | None = None
# Which masters a membership edit reaches (designspace only): see EDIT_SCOPES.
_scope = "compatibleAll"

EDIT_SCOPES = {
    "compatibleAll": "every master with the same kern groups (the default)",
    "compatible": "masters with the same kern groups in this discrete subspace (e.g. italic=0)",
    "master": "this master only",
}


def _require() -> UfoDocument:
    if _doc is None:
        raise RuntimeError("no font is open")
    return _doc


def _point(index: int) -> None:
    """Point the current-master globals at a master (no other side effects)."""
    global _current, _doc, _manager, _lang, _kern
    session = _masters[index]
    session.ensure()
    _current = index
    _doc, _manager, _lang, _kern = session.doc, session.manager, session.lang, session.kern


def _activate(index: int) -> None:
    global _pending_import, _pending_tool
    _point(index)
    # A dry run belongs to the master it was planned on.
    _pending_import = _pending_tool = None


def open_font(path: str) -> str:
    global _masters, _designspace, _scope
    _designspace, _scope = None, "compatibleAll"
    _masters = [MasterSession(UfoDocument(path))]
    _activate(0)
    return json.dumps(_doc.summary())




def open_designspace(path: str, progress=None) -> str:
    """Open a designspace and every master (glyphs lazily); view the default one.

    `progress(label, done, total)` is called as masters load (a JS callback
    in the worker; optional).
    """
    global _masters, _designspace, _scope
    _scope = "compatibleAll"
    report = progress or (lambda *_args: None)
    report("Reading the designspace", 0, 1)
    ds = Designspace(path)
    t0 = time.perf_counter()
    masters = []
    total = len(ds.masters)
    for i, m in enumerate(ds.masters):
        report(f"Opening master {m['name']}", i, total)
        doc = UfoDocument(m["path"])
        doc.index = i
        masters.append(MasterSession(doc))
    report("Opening masters", total, total)
    ds.timings["mastersMs"] = round((time.perf_counter() - t0) * 1000)
    _designspace, _masters = ds, masters
    return switch_master(ds.default)


def switch_master(index: int) -> str:
    """Make another master of the open designspace current; nothing is reloaded."""
    ds = _designspace
    if ds is None:
        raise RuntimeError("no designspace is open")
    if not 0 <= index < len(_masters):
        raise ValueError(f"no master {index}")
    t0 = time.perf_counter()
    _activate(index)
    summary = _doc.summary()
    summary["designspace"] = _designspace_info()
    summary["designspace"]["timings"] = {**ds.timings, "activateMs": round((time.perf_counter() - t0) * 1000)}
    return json.dumps(summary)


def _designspace_info() -> dict:
    info = _designspace.info(_current, [m.doc.master for m in _masters])
    info["scope"] = _scope
    # How many masters each scope reaches now, for the selector's labels.
    info["reach"] = {scope: len(_targets(scope)) for scope in EDIT_SCOPES}
    here = _designspace.masters[_current]["discrete"]
    info["subspace"] = " ".join(f"{k}={_num(v)}" for k, v in here.items())
    return info


def set_edit_scope(scope: str) -> str:
    """Which masters membership edits reach (EDIT_SCOPES)."""
    global _scope
    if scope not in EDIT_SCOPES:
        raise ValueError(f"unknown edit scope {scope!r}")
    _scope = scope
    return json.dumps(_designspace_info() if _designspace else None)


def _num(v) -> str:
    return str(int(v)) if float(v).is_integer() else str(v)


def _targets(scope: str | None = None) -> list[int]:
    """Masters a membership edit reaches (the current scope by default): the current one first."""
    scope = scope or _scope
    if _designspace is None or scope == "master":
        return [_current]
    groups = [kern_groups(m.doc.master.groups) for m in _masters]
    here = _designspace.masters[_current]["discrete"]
    same_space = scope == "compatibleAll"
    return [_current] + [
        i
        for i in range(len(_masters))
        if i != _current
        and groups[i] == groups[_current]
        and (same_space or _designspace.masters[i]["discrete"] == here)
    ]


def _order_only_targets() -> list[int]:
    """Masters whose kern groups have the current master's members in another order.

    Reach follows the edit scope: the discrete subspace, every subspace, or
    none for "this master only".
    """
    if _designspace is None or _scope == "master":
        return []
    ref = kern_groups(_doc.master.groups)
    here = _designspace.masters[_current]["discrete"]
    out = []
    for i, m in enumerate(_masters):
        if i == _current:
            continue
        if _scope == "compatible" and _designspace.masters[i]["discrete"] != here:
            continue
        if compare(ref, kern_groups(m.doc.master.groups))["level"] == "order":
            out.append(i)
    return out


def match_order() -> str:
    """Copy the current master's member order (key glyphs included) to the
    masters that differ from it only in order. Kerning is not touched."""
    origin = _current
    ref = kern_groups(_require().master.groups)
    changed = []
    reordered = 0
    for i in _order_only_targets():
        _point(i)
        groups = _doc.master.groups
        for name, members in ref.items():
            if list(groups[name]) != members:
                groups[name] = tuple(members)
                reordered += 1
        _manager.makeReverseGroupsMapping()  # set_font() would also clear the history
        _doc.master.groups.take_diff()
        changed.append(i)
    _point(origin)
    delta = _doc.take_delta()
    delta["lang"] = {"set": [], "clear": []}
    return json.dumps(
        {
            "result": {"masters": len(changed), "groups": reordered},
            "delta": delta,
            "dirty": _dirty(),
            **_ds_extra(changed),
        }
    )


def _dirty() -> bool:
    return any(m.doc.is_dirty() for m in _masters)


def font_data() -> str:
    """Outlines, metrics, groups and kerning for the TS mirror."""
    return json.dumps(font_payload(_require()), separators=(",", ":"))


def close_font() -> str:
    global _doc, _manager, _lang, _kern, _designspace, _masters, _current
    _doc = _manager = _lang = _kern = _designspace = None
    _masters, _current = [], 0
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
    return json.dumps({"result": result, "delta": delta, "dirty": _dirty(), **_ds_extra([])})


def _ds_extra(others: list[int]) -> dict:
    """Designspace part of an edit's answer: masters changed besides the current one."""
    if _designspace is None:
        return {}
    return {"others": others, "designspace": _designspace_info()}


def _scoped(fn) -> str:
    """Run a membership edit in every target master (_targets), all or nothing.

    `fn` works on the current-master globals and returns the result; the
    current master's result is answered. Each master remaps its own kerning.
    Other masters' deltas are not sent: the TS mirror drops their cached
    models and rebuilds them on the next switch (Lang statuses included).
    """
    origin = _current
    targets = _targets()
    snapshots: dict[int, tuple[dict, dict]] = {}
    results: dict[int, object] = {}
    for i in targets:
        _point(i)
        view = _doc.master
        snapshots[i] = (dict(view.groups), dict(view.kerning))
        try:
            results[i] = fn()
        except Exception as err:
            for j, (groups, kerning) in snapshots.items():
                _point(j)
                _doc.master.groups.reset_to(groups)
                _doc.master.kerning.reset_to(kerning)
                _manager.makeReverseGroupsMapping()
            _point(origin)
            if i == origin:
                raise
            raise ValueError(
                f"{_designspace.masters[i]['name']}: {err} Nothing was changed."
            ) from err
    changed = []
    for i in targets[1:]:
        _point(i)
        groups_diff, kerning_diff = _doc.master.groups.take_diff(), _doc.master.kerning.take_diff()
        if groups_diff != ({}, []) or kerning_diff != ({}, []):
            changed.append(i)
    _point(origin)
    delta = _doc.take_delta()
    delta["lang"] = _lang_update(delta)
    return json.dumps(
        {"result": results[origin], "delta": delta, "dirty": _dirty(), **_ds_extra(changed)}
    )


def _replace_all(groups: dict, kerning: dict, result) -> str:
    """Replace groups and kerning wholesale (import, session restore) as one step.

    reset_to() hands back its own diff, so the delta is built from that.
    """
    doc = _require()
    view = doc.master
    delta = delta_of(doc.index, view.groups.reset_to(groups), view.kerning.reset_to(kerning))
    _manager.makeReverseGroupsMapping()
    delta["lang"] = _lang_update(delta)
    return json.dumps({"result": result, "delta": delta, "dirty": _dirty(), **_ds_extra([])})


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
    return _scoped(lambda: _add_glyphs(group, glyphs_json, check_kerning, index))


def _add_glyphs(group: str, glyphs_json: str, check_kerning: bool, index: int) -> dict:
    free, grouped = _split_grouped(json.loads(glyphs_json), _prefix(group))
    added: list[str] = []
    if free:
        before = set(_require().master.groups.get(group, ()))
        _manager.add_glyphs_to_group(group, free, check_kerning=check_kerning)
        added = [g for g in _require().master.groups.get(group, ()) if g not in before]
        if index >= 0 and added:
            _place(group, added, index)
    return {"added": added, "grouped": grouped}


def create_group(prefix: str, short_name: str, glyphs_json: str, check_kerning: bool) -> str:
    """New group from the free glyphs; refuses a bad name or no free glyphs."""
    return _scoped(lambda: _create_group(prefix, short_name, glyphs_json, check_kerning))


def _create_group(prefix: str, short_name: str, glyphs_json: str, check_kerning: bool) -> dict:
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
    return {"group": group, "added": free, "grouped": grouped}


def remove_glyphs(group: str, glyphs_json: str, check_kerning: bool) -> str:
    return _scoped(lambda: _remove_glyphs(group, glyphs_json, check_kerning))


def _remove_glyphs(group: str, glyphs_json: str, check_kerning: bool) -> dict:
    glyphs = [g for g in json.loads(glyphs_json) if g in _require().master.groups.get(group, ())]
    if glyphs:
        _manager.remove_glyphs_from_group(group, glyphs, check_kerning=check_kerning)
    return {"removed": glyphs}


def delete_group(group: str, check_kerning: bool) -> str:
    """With Keep Kerning the group's pairs become member exceptions; its own pairs always go."""
    def run():
        _manager.delete_group(group, check_kerning=check_kerning)

    return _scoped(run)


def rename_group(old: str, new_short: str) -> str:
    """Rename within the same side. Kerning always follows the group: renaming
    without it (desktop with Keep Kerning off) leaves pairs on a missing group."""
    prefix = _prefix(old)
    new_short = new_short.strip()
    if prefix + new_short == old:
        return _finish({"group": old})

    def run():
        problem = name_problem(new_short, prefix, _require().master.groups)
        if problem:
            raise ValueError(problem)
        _manager.rename_group(old, prefix + new_short, check_kerning=True)
        return {"group": prefix + new_short}

    return _scoped(run)


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


# -- import / export of groups (KernTool4 text, Font-Rover groups_io.py) ---------------


def export_groups(scope: str) -> str:
    """`name=g1,g2` lines, sorted by group name."""
    return json.dumps({"text": groups_io.format_groups(_require().master.groups, scope)})


def import_preview(text: str, scope: str) -> str:
    """Dry run: what importing would change. Nothing is written until import_apply()."""
    global _pending_import
    groups, problems = groups_io.parse_groups(text)
    _pending_import = groups_io.import_groups(FRFont(_require()), groups, scope, problems=problems)
    view = _require().master
    changes = (
        _pending_import.result.groups != dict(view.groups)
        or _pending_import.result.kerning != dict(view.kerning)
    )
    return json.dumps(
        {
            "lines": groups_io.report_lines(_pending_import),
            "ok": _pending_import.ok,
            "changes": changes,
            "imported": _pending_import.imported,
        }
    )


def import_apply() -> str:
    """Replace groups and kerning with the previewed import (one step)."""
    global _pending_import
    report = _pending_import
    if report is None:
        raise RuntimeError("nothing to import")
    _pending_import = None
    if not report.ok:
        raise RuntimeError("the import cannot be applied")
    return _replace_all(
        {k: tuple(v) for k, v in report.result.groups.items()},
        report.result.kerning,
        {"imported": report.imported},
    )


# -- tools (Font-Rover Groups Control board scripts) ---------------------------------


def tool_list() -> str:
    return json.dumps([t.spec() for t in TOOLS.values()])


def tool_plan(tool_id: str, options_json: str) -> str:
    """Dry run: report lines; nothing changes until tool_apply()."""
    global _pending_tool
    _pending_tool = plan_tool(_require(), tool_id, json.loads(options_json))
    return json.dumps({"lines": _pending_tool.lines, "changes": _pending_tool.changes})


def tool_apply() -> str:
    """Run the planned tool on a working copy and take its groups and kerning."""
    global _pending_tool
    plan, _pending_tool = _pending_tool, None
    if plan is None:
        raise RuntimeError("nothing planned")
    doc = _require()
    if doc.read_only_reason:
        raise RuntimeError(doc.read_only_reason)
    work = WorkFont(doc)
    plan.apply(work, FontGroupsManager(work))
    return _replace_all(dict(work.groups), dict(work.kerning), None)


# -- session (autosave) -------------------------------------------------------------


def session_state() -> str:
    """Current groups, kerning and history, to restore on top of the opened file."""
    view = _require().master
    return json.dumps(
        {
            "groups": {k: list(v) for k, v in view.groups.items()},
            "kerning": [[l, r, v] for (l, r), v in view.kerning.items()],
            "history": [list(e) for e in _manager.history],
        }
    )


def restore_state(state_json: str) -> str:
    """Put a saved session's groups/kerning/history back; returns the delta."""
    state = json.loads(state_json)
    _manager.history[:] = [tuple(e) for e in state.get("history", [])]
    return _replace_all(
        {k: tuple(v) for k, v in state["groups"].items()},
        {(l, r): v for l, r, v in state["kerning"]},
        None,
    )


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


def load_history(text: str) -> str:
    """Replace the journal with a saved one (applies nothing); returns notes."""
    entries, notes = parse_history(text)
    _manager.history[:] = entries
    return json.dumps({"notes": notes, **json.loads(history())})


def move_in_group(group: str, glyphs_json: str, index: int) -> str:
    """Move members to `index` (in the current order); index 0 = key glyph.

    Like FontGroupsManager.reposition_glyph_in_group (insert before the
    member now at `index`), but `index == len(group)` moves to the end and
    a target that is itself moved falls through to the next kept member.
    Reordering never touches kerning.
    """
    def run():
        view = _require().master
        members = list(view.groups[group])
        moving = [g for g in json.loads(glyphs_json) if g in members]
        kept = [g for g in members if g not in moving]
        anchor = next((g for g in members[index:] if g not in moving), None)
        at = kept.index(anchor) if anchor is not None else len(kept)
        view.groups[group] = tuple(kept[:at] + moving + kept[at:])
        _manager.makeReverseGroupsMapping()  # set_font() would also clear the history

    return _scoped(run)


def revert() -> str:
    """Revert to file — every master of a designspace; answers the current one's delta."""
    origin = _current
    others = []
    for i, m in enumerate(_masters):
        if i != origin and m.doc.is_dirty():
            _point(i)
            _doc.revert()
            _manager.makeReverseGroupsMapping()
            _doc.glyph_edits.revert()
            others.append(i)
    _point(origin)
    doc = _require()
    delta = doc.revert()
    _manager.makeReverseGroupsMapping()
    delta["lang"] = _lang_update(delta)
    names = doc.glyph_edits.revert()
    if names:
        delta["glyphs"] = {n: glyph_record(doc, n) for n in names}
    delta.update(_ds_extra(others))
    return json.dumps(delta)


def margin_nudge(name: str, side: str, delta: float) -> str:
    """Desktop arrow-key margin edit of one glyph; composites follow."""
    doc = _require()
    if doc.read_only_reason:
        raise RuntimeError(doc.read_only_reason)
    changed = doc.glyph_edits.nudge(name, side, delta)
    out = doc.take_delta()
    out["lang"] = {"set": [], "clear": []}
    out["glyphs"] = {n: glyph_record(doc, n) for n in changed}
    return json.dumps({"result": {"changed": changed}, "delta": out, "dirty": doc.is_dirty()})


# -- saving ---------------------------------------------------------------------


def _check_writable(doc: UfoDocument) -> None:
    for m in _masters or [MasterSession(doc)]:
        if m.doc.read_only_reason:
            raise RuntimeError(m.doc.read_only_reason)


def _master_root(index: int) -> str:
    """A master's folder relative to the designspace's folder (the drop root)."""
    base = os.path.dirname(_designspace.path)
    return os.path.relpath(_masters[index].doc.path, base).replace(os.sep, "/")


def _pending_files() -> dict[str, bytes | None]:
    """What saving writes, keyed by path: UFO-relative for one UFO,
    designspace-folder-relative (`Bold.ufo/groups.plist`) for a designspace.
    Also sets _pending_save (per master) for mark_saved()."""
    global _pending_save
    if _designspace is None:
        _pending_save = {0: _require().changed_files()}
        return dict(_pending_save[0])
    _pending_save = {i: m.doc.changed_files() for i, m in enumerate(_masters)}
    return {
        f"{_master_root(i)}/{name}": data
        for i, files in _pending_save.items()
        for name, data in files.items()
    }


def changed_files(out_dir: str) -> str:
    """Write the plists that differ from disk into out_dir.

    Returns [{"name", "path" | null}] — path null means delete the file.
    Call mark_saved() once the files are on disk.
    """
    _check_writable(_require())
    os.makedirs(out_dir, exist_ok=True)
    out = []
    for name, data in _pending_files().items():
        path = None
        if data is not None:
            path = os.path.join(out_dir, name)
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "wb") as f:
                f.write(data)
        out.append({"name": name, "path": path})
    return json.dumps(out)


def build_ufoz(out_path: str) -> str:
    """Write a .ufoz of the current state to out_path.

    Every entry except groups.plist / kerning.plist is copied unchanged from
    the source (.ufoz archive or .ufo folder). Call mark_saved() afterwards.
    """
    doc = _require()
    _check_writable(doc)
    if _designspace is not None:
        raise RuntimeError("a designspace is saved into its folder or as a zip of the changes")
    _pending_files()
    current = doc.current_files()
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


def build_changes_zip(out_path: str) -> str:
    """Designspace without a writable folder: a zip of just the changed files,
    at their paths inside the designspace's folder (unzip there to apply).

    Files to delete cannot travel in a zip; they are returned for the UI to
    name. Call mark_saved() afterwards.
    """
    _check_writable(_require())
    if _designspace is None:
        raise RuntimeError("no designspace is open")
    files = _pending_files()
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as out:
        for name, data in sorted(files.items()):
            if data is not None:
                out.writestr(name, data)
    return json.dumps(
        {
            "path": out_path,
            "written": sorted(n for n, d in files.items() if d is not None),
            "deleted": sorted(n for n, d in files.items() if d is None),
        }
    )


def mark_saved(written_json: str = "null") -> str:
    """The files from the last changed_files()/build_ufoz()/build_changes_zip() are on disk.

    `written_json`: the names actually written when writing stopped part way
    (null = all). A master counts as saved only when all its files were
    written; the others stay dirty, so the next save writes them again.
    """
    global _pending_save
    written = json.loads(written_json)
    unsaved = []
    for i, files in _pending_save.items():
        names = {(f"{_master_root(i)}/{n}" if _designspace else n): n for n in files}
        if written is None or all(full in written for full in names):
            (_masters[i].doc if _masters else _require()).mark_saved(files)
        else:
            unsaved.append(i)
    _pending_save = {}
    return json.dumps({"unsaved": unsaved, "dirty": _dirty()})


def has_changes() -> str:
    _require()
    return json.dumps(_dirty())
