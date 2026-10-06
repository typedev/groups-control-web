"""Designspace spike: masters, default, kern-group compatibility, switching."""

from __future__ import annotations

import json
import plistlib
import shutil
from pathlib import Path

import pytest

from gcweb import api
from gcweb.designspace import compare, compatibility_sets

MUTATOR = Path(__file__).resolve().parents[2] / "fixtures" / "MutatorSansLightCondensed.ufo"

DESIGNSPACE = """<?xml version='1.0' encoding='UTF-8'?>
<designspace format="5.0">
  <axes>
    <axis tag="wght" name="weight" minimum="0" maximum="1000" default="0"/>
    <axis tag="ital" name="italic" values="0 1" default="0"/>
  </axes>
  <sources>
    <source filename="masters/Light.ufo" stylename="Light">
      <location><dimension name="weight" xvalue="0"/><dimension name="italic" xvalue="0"/></location>
    </source>
    <source filename="masters/Bold.ufo" stylename="Bold">
      <location><dimension name="weight" xvalue="1000"/><dimension name="italic" xvalue="0"/></location>
    </source>
    <source filename="masters/Italic.ufo" stylename="Italic">
      <location><dimension name="weight" xvalue="0"/><dimension name="italic" xvalue="1"/></location>
    </source>
    <source filename="masters/Light.ufo" layer="support" stylename="Support">
      <location><dimension name="weight" xvalue="500"/><dimension name="italic" xvalue="0"/></location>
    </source>
  </sources>
</designspace>
"""


def _edit_groups(ufo: Path, fn) -> None:
    path = ufo / "groups.plist"
    groups = plistlib.loads(path.read_bytes())
    fn(groups)
    path.write_bytes(plistlib.dumps(groups))


@pytest.fixture
def project(tmp_path):
    for name in ("Light", "Bold", "Italic"):
        shutil.copytree(MUTATOR, tmp_path / "masters" / f"{name}.ufo")
    # The italic master diverges: one more kern1 group.
    _edit_groups(
        tmp_path / "masters" / "Italic.ufo",
        lambda g: g.__setitem__("public.kern1.@MMK_L_E", ["E", "F"]),
    )
    ds = tmp_path / "Family.designspace"
    ds.write_text(DESIGNSPACE)
    yield ds
    api.close_font()


def test_open_views_the_default_master(project):
    summary = json.loads(api.open_designspace(str(project)))
    info = summary["designspace"]
    assert [m["name"] for m in info["masters"]] == ["Light", "Bold", "Italic"]
    assert info["current"] == 0 and info["masters"][0]["isDefault"]
    assert info["layerSources"] == ["masters/Light.ufo"]
    assert summary["readOnlyReason"] is None
    assert info["scope"] == "compatibleAll"
    # Italic has an extra group: not compatible, whatever the subspace.
    assert info["reach"] == {"compatibleAll": 2, "compatible": 2, "master": 1}
    assert info["subspace"] == "italic=0"


def test_compatibility_respects_discrete_subspace(project):
    info = json.loads(api.open_designspace(str(project)))["designspace"]
    assert [m["set"] for m in info["masters"]] == [0, 0, 1]
    assert info["sets"] == 2
    # Italic is in another discrete subspace: Light is compatible with Bold only.
    assert (info["compatibleInSubspace"], info["subspaceSize"]) == (2, 2)
    assert info["masters"][2]["vsCurrent"]["level"] == "different"
    assert info["masters"][2]["vsCurrent"]["onlyThere"] == 1


def test_switch_master(project):
    api.open_designspace(str(project))
    summary = json.loads(api.switch_master(2))
    assert summary["designspace"]["current"] == 2
    assert summary["kern1Groups"] == 2


def test_compare_levels():
    a = {"public.kern1.O": ["O", "Q"]}
    assert compare(a, {"public.kern1.O": ["O", "Q"]})["level"] == "identical"
    assert compare(a, {"public.kern1.O": ["Q", "O"]})["level"] == "order"
    assert compare(a, {"public.kern1.O": ["O"]})["level"] == "different"
    assert compatibility_sets([a, {}, dict(a)]) == [0, 1, 0]


def test_masters_stay_open_and_helpers_are_lazy(project):
    api.open_designspace(str(project))
    assert [m.manager is not None for m in api._masters] == [True, False, False]
    light = api._masters[0].doc
    api.switch_master(2)
    api.switch_master(0)
    assert api._masters[0].doc is light  # switched back, not reopened
    assert api._masters[2].manager is not None


def test_progress_reports_every_master(project):
    calls = []
    api.open_designspace(str(project), lambda label, done, total: calls.append((done, total)))
    assert (0, 3) in calls and (2, 3) in calls and calls[-1] == (3, 3)


def test_deltas_carry_the_master_index(project):
    api.open_designspace(str(project))
    api.switch_master(1)
    assert api._doc.take_delta()["master"] == 1


def test_compatibility_follows_live_groups(project):
    api.open_designspace(str(project))
    # Give Light the italic's extra group: all three share one set again.
    api._masters[0].doc.master.groups["public.kern1.@MMK_L_E"] = ("E", "F")
    api._masters[1].doc.master.groups["public.kern1.@MMK_L_E"] = ("E", "F")
    info = json.loads(api.switch_master(0))["designspace"]
    assert info["sets"] == 1


K2A = "public.kern2.@MMK_R_A"


def _kerning(i):
    return dict(api._masters[i].doc.master.kerning)


def _groups(i):
    return dict(api._masters[i].doc.master.groups)


def test_edit_reaches_compatible_masters_in_the_subspace(project):
    api.open_designspace(str(project))
    italic_before = _kerning(2)
    res = json.loads(api.delete_group(K2A, True))
    assert res["others"] == [1] and res["dirty"]
    for i in (0, 1):
        assert K2A not in _groups(i)
        # Keep kerning: each master turned its own group pairs into exceptions.
        assert _kerning(i)[("T", "A")] == -75
    assert K2A in _groups(2) and _kerning(2) == italic_before
    assert res["designspace"]["sets"] == 2


def test_this_master_only_splits_the_set(project):
    api.open_designspace(str(project))
    api.set_edit_scope("master")
    res = json.loads(api.remove_glyphs("public.kern1.@MMK_L_A", '["A"]', True))
    assert res["others"] == []
    assert "public.kern1.@MMK_L_A" in _groups(1)
    assert res["designspace"]["sets"] == 3
    assert res["designspace"]["compatibleInSubspace"] == 1


def test_compatible_all_crosses_discrete_axes(project):
    api.open_designspace(str(project))
    # Bring the italic in line first: this master only, from the italic.
    api.switch_master(2)
    api.set_edit_scope("master")
    api.delete_group("public.kern1.@MMK_L_E", False)
    api.switch_master(0)
    api.set_edit_scope("compatible")
    # Same groups everywhere now, but the italic is in another subspace.
    assert json.loads(api.create_group("public.kern1.", "H", '["H"]', True))["others"] == [1]
    api.set_edit_scope("compatibleAll")
    # Light and Bold have H, the italic does not: it is no longer compatible.
    assert json.loads(api.create_group("public.kern1.", "O", '["O"]', True))["others"] == [1]
    api.switch_master(2)
    api.create_group("public.kern1.", "H", '["H"]', True)  # reaches only itself
    api.create_group("public.kern1.", "O", '["O"]', True)
    api.switch_master(0)
    assert json.loads(api.create_group("public.kern1.", "I", '["I"]', True))["others"] == [1, 2]


def test_a_failing_master_rolls_every_master_back(project, monkeypatch):
    api.open_designspace(str(project))
    api.switch_master(1)
    api.switch_master(0)
    before = [(_groups(i), _kerning(i)) for i in range(3)]

    def boom(*_a, **_k):
        raise ValueError("cannot.")

    monkeypatch.setattr(api._masters[1].manager, "rename_group", boom)
    with pytest.raises(ValueError, match="Bold: cannot. Nothing was changed."):
        api.rename_group("public.kern1.@MMK_L_A", "AA")
    assert [(_groups(i), _kerning(i)) for i in range(3)] == before
    assert api._current == 0
    assert json.loads(api.has_changes()) is False


def test_revert_covers_every_master(project):
    api.open_designspace(str(project))
    res = json.loads(api.delete_group(K2A, True))
    assert res["others"] == [1]
    delta = json.loads(api.revert())
    assert delta["others"] == [1]
    assert K2A in _groups(0) and K2A in _groups(1)
    assert json.loads(api.has_changes()) is False


def _tree(root: Path) -> dict[str, bytes]:
    """Every file of the project, without the tests' scratch output folders."""
    files = (p for p in sorted(root.rglob("*")) if p.is_file())
    return {str(p.relative_to(root)): p.read_bytes() for p in files if not p.relative_to(root).parts[0].startswith("out")}


def _save_into_folder(project: Path, out: Path) -> list[str]:
    """What the TS side does with a writable folder: write changed_files() there."""
    listed = json.loads(api.changed_files(str(out)))
    for f in listed:
        target = project.parent / f["name"]
        if f["path"] is None:
            target.unlink()
        else:
            target.write_bytes(Path(f["path"]).read_bytes())
    api.mark_saved()
    return [f["name"] for f in listed]


def test_open_save_without_edits_writes_nothing(project, tmp_path):
    api.open_designspace(str(project))
    assert json.loads(api.changed_files(str(tmp_path / "out"))) == []


def test_edit_then_undo_by_hand_writes_nothing(project, tmp_path):
    api.open_designspace(str(project))
    api.remove_glyphs("public.kern1.@MMK_L_A", '["A"]', True)
    api.add_glyphs("public.kern1.@MMK_L_A", '["A"]', True)
    # Removing the only member deleted the group and its kerning came back as
    # an exception, so compare files, not dirtiness.
    names = json.loads(api.changed_files(str(tmp_path / "out")))
    assert all(not n["name"].endswith("groups.plist") for n in names)


def test_save_writes_only_the_changed_masters(project, tmp_path):
    before = _tree(project.parent)
    api.open_designspace(str(project))
    api.delete_group(K2A, True)
    written = _save_into_folder(project, tmp_path / "out")
    assert sorted(written) == [
        "masters/Bold.ufo/groups.plist",
        "masters/Bold.ufo/kerning.plist",
        "masters/Light.ufo/groups.plist",
        "masters/Light.ufo/kerning.plist",
    ]
    after = _tree(project.parent)
    assert {k for k in after if after[k] != before.get(k)} == set(written)
    assert json.loads(api.has_changes()) is False
    # Reopening the saved project shows the edit; saving again writes nothing.
    api.close_font()
    api.open_designspace(str(project))
    assert K2A not in _groups(0) and K2A in _groups(2)
    assert json.loads(api.changed_files(str(tmp_path / "out2"))) == []


def test_saved_plists_keep_their_style(project, tmp_path):
    api.open_designspace(str(project))
    api.delete_group(K2A, True)
    _save_into_folder(project, tmp_path / "out")
    text = (project.parent / "masters/Light.ufo/groups.plist").read_text()
    original = (MUTATOR / "groups.plist").read_text()
    assert text.splitlines()[:4] == original.splitlines()[:4]
    assert "\n    <key>" in text  # the fixture's indent survives


def test_changes_zip_holds_only_changed_files(project, tmp_path):
    import zipfile

    api.open_designspace(str(project))
    api.set_edit_scope("master")
    api.delete_group(K2A, True)
    out = json.loads(api.build_changes_zip(str(tmp_path / "zip" / "changes.zip")))
    with zipfile.ZipFile(out["path"]) as z:
        assert sorted(z.namelist()) == ["masters/Light.ufo/groups.plist", "masters/Light.ufo/kerning.plist"]
    assert out["deleted"] == []
    api.mark_saved()
    assert json.loads(api.has_changes()) is False


def _reorder(ufo: Path, group: str, members: list[str]) -> None:
    _edit_groups(ufo, lambda g: g.__setitem__(group, members))


def test_match_order_fixes_order_only_masters(project):
    root = project.parent / "masters"
    for name in ("Light", "Bold", "Italic"):
        _reorder(root / f"{name}.ufo", "testGroup", ["E", "F", "H"])
    _edit_groups(root / "Light.ufo", lambda g: g.__setitem__("public.kern1.@MMK_L_A", ["A", "Aacute"]))
    _edit_groups(root / "Bold.ufo", lambda g: g.__setitem__("public.kern1.@MMK_L_A", ["Aacute", "A"]))
    _edit_groups(root / "Italic.ufo", lambda g: g.__setitem__("public.kern1.@MMK_L_A", ["Aacute", "A"]))
    info = json.loads(api.open_designspace(str(project)))["designspace"]
    assert info["masters"][1]["vsCurrent"]["level"] == "order"
    kerning_before = _kerning(1)

    api.set_edit_scope("master")
    assert json.loads(api.match_order())["result"]["masters"] == 0

    api.set_edit_scope("compatible")
    res = json.loads(api.match_order())
    # The italic differs in members too (its extra group) and in subspace.
    assert res["result"] == {"masters": 1, "groups": 1} and res["others"] == [1]
    assert list(_groups(1)["public.kern1.@MMK_L_A"]) == ["A", "Aacute"]
    assert _kerning(1) == kerning_before
    assert res["designspace"]["compatibleInSubspace"] == 2
    assert json.loads(api.has_changes()) is True


def test_default_scope_crosses_discrete_axes(project):
    _edit_groups(project.parent / "masters" / "Italic.ufo", lambda g: g.pop("public.kern1.@MMK_L_E"))
    info = json.loads(api.open_designspace(str(project)))["designspace"]
    assert info["reach"] == {"compatibleAll": 3, "compatible": 2, "master": 1}
    assert json.loads(api.delete_group(K2A, True))["others"] == [1, 2]


def test_a_save_stopped_part_way_keeps_unwritten_masters_dirty(project, tmp_path):
    api.open_designspace(str(project))
    api.delete_group(K2A, True)
    listed = json.loads(api.changed_files(str(tmp_path / "out")))
    light = [f["name"] for f in listed if f["name"].startswith("masters/Light.ufo/")]
    # Bold's groups.plist got written, its kerning.plist did not.
    res = json.loads(api.mark_saved(json.dumps(light + ["masters/Bold.ufo/groups.plist"])))
    assert res == {"unsaved": [1], "dirty": True}
    again = [f["name"] for f in json.loads(api.changed_files(str(tmp_path / "out2")))]
    assert sorted(again) == ["masters/Bold.ufo/groups.plist", "masters/Bold.ufo/kerning.plist"]


def test_edits_made_while_saving_stay_unsaved(project, tmp_path):
    api.open_designspace(str(project))
    api.delete_group(K2A, True)
    api.changed_files(str(tmp_path / "out"))  # writing starts…
    api.remove_glyphs("public.kern1.@MMK_L_A", '["A"]', True)  # …an edit sneaks in
    api.mark_saved()
    assert json.loads(api.has_changes()) is True
    again = [f["name"] for f in json.loads(api.changed_files(str(tmp_path / "out2")))]
    assert "masters/Light.ufo/groups.plist" in again


def test_session_state_restores_every_changed_master(project):
    api.open_designspace(str(project))
    api.delete_group(K2A, True)
    api.set_edit_scope("master")
    state = api.session_state()
    assert sorted(json.loads(state)["masters"]) == ["0", "1"]
    api.close_font()

    api.open_designspace(str(project))
    res = json.loads(api.restore_state(state))
    assert res["others"] == [1] and res["dirty"]
    assert K2A in res["delta"]["groups"]["removed"]
    assert K2A not in _groups(1) and K2A in _groups(2)
    assert res["designspace"]["scope"] == "master"


# -- tools between masters ----------------------------------------------------------


def _plan(tool, **options):
    return json.loads(api.tool_plan(tool, json.dumps(options)))


def test_master_tools_are_listed_and_need_a_designspace(project):
    tools = {t["id"]: t for t in json.loads(api.tool_list())}
    assert tools["copyGroups"]["needsDesignspace"] is True
    api.open_font(str(project.parent / "masters" / "Light.ufo"))
    with pytest.raises(RuntimeError, match="designspace"):
        _plan("copyGroups", targets=[1])


def test_copy_groups_follows_membership_in_each_master(project):
    api.open_designspace(str(project))
    api.set_edit_scope("master")
    api.delete_group(K2A, True)  # Light only: its group pairs become exceptions
    plan = _plan("copyGroups", targets=[1, 2], what="kern", _keepKerning=True)
    assert plan["changes"]
    assert any(line.startswith("Bold:") for line in plan["lines"])
    res = json.loads(api.tool_apply())
    assert sorted(res["others"]) == [1, 2]
    # Bold lost the group the same way Light did: same exceptions.
    assert K2A not in _groups(1) and _kerning(1) == _kerning(0)
    # The italic's extra group is gone too; all three now agree.
    assert res["designspace"]["sets"] == 1
    assert _plan("copyGroups", targets=[1, 2], what="kern")["changes"] is False


def test_copy_groups_leaves_equal_masters_and_other_groups_alone(project):
    api.open_designspace(str(project))
    plan = _plan("copyGroups", targets=[1], what="all")
    assert plan["changes"] is False and plan["lines"][-1] == "Bold: already the same"
    api.switch_master(2)  # the italic: extra kern group, same other groups
    assert _plan("copyGroups", targets=[0, 1], what="other")["changes"] is False


def test_groups_diff_lists_variants_with_their_masters(project):
    root = project.parent / "masters"
    _edit_groups(root / "Bold.ufo", lambda g: g.__setitem__("testGroup", ["H", "F", "E"]))  # not a kern group
    api.open_designspace(str(project))
    diff = json.loads(api.groups_diff(json.dumps([1, 2])))
    assert [d["group"] for d in diff] == ["public.kern1.@MMK_L_E"]
    entry = diff[0]
    assert entry["level"] == "different"
    assert entry["variants"] == [{"members": None, "masters": [0, 1]}, {"members": ["E", "F"], "masters": [2]}]
    api.set_edit_scope("master")
    api.move_in_group("public.kern1.@MMK_L_A", '["A"]', 1)  # one member: order cannot change
    assert json.loads(api.groups_diff(json.dumps([1]))) == []


def test_match_group_fixes_one_group_and_moves_glyphs(project):
    root = project.parent / "masters"
    # Light: E F in their own group; Bold: E in @MMK_L_A, F free; Italic: same as Light plus nothing else.
    _edit_groups(root / "Light.ufo", lambda g: g.__setitem__("public.kern1.@MMK_L_E", ["E", "F"]))
    _edit_groups(root / "Bold.ufo", lambda g: g.__setitem__("public.kern1.@MMK_L_A", ["A", "E"]))
    api.open_designspace(str(project))
    res = json.loads(api.match_group("public.kern1.@MMK_L_E", json.dumps([1, 2]), True))
    assert res["result"]["masters"] == 1 and res["others"] == [1]
    assert "taken from public.kern1.@MMK_L_A (E)" in res["result"]["lines"][0]
    assert list(_groups(1)["public.kern1.@MMK_L_E"]) == ["E", "F"]
    assert list(_groups(1)["public.kern1.@MMK_L_A"]) == ["A"]
    # Bold still differs elsewhere? No: its @MMK_L_A now matches Light's too.
    assert json.loads(api.groups_diff(json.dumps([1, 2]))) == []


def test_match_group_removes_a_group_this_master_lacks(project):
    api.open_designspace(str(project))
    res = json.loads(api.match_group("public.kern1.@MMK_L_E", json.dumps([1, 2]), True))
    assert res["others"] == [2] and "public.kern1.@MMK_L_E" not in _groups(2)


def test_copy_kerning_of_glyphs_adds_only_missing_pairs(project):
    root = project.parent / "masters"
    import plistlib

    def kern(ufo, fn):
        path = root / ufo / "kerning.plist"
        data = plistlib.loads(path.read_bytes())
        fn(data)
        path.write_bytes(plistlib.dumps(data))

    kern("Light.ufo", lambda k: k.setdefault("T", {}).update({"O": -30}))
    kern("Bold.ufo", lambda k: k.setdefault("T", {}).update({"O": -50}))  # has it: kept
    api.open_designspace(str(project))
    assert not _plan("copyKerning", targets=[1, 2], glyphs="selected", _selectedGlyphs=[])["changes"]
    plan = _plan("copyKerning", targets=[1, 2], glyphs="typed", typed="T, Nope", withGroups=False)
    assert plan["lines"][0].startswith("2 pair(s) of 1 glyph(s)")
    assert "Not in Light: Nope" in plan["lines"]
    res = json.loads(api.tool_apply())
    assert res["others"] == [2]
    assert _kerning(1)[("T", "O")] == -50 and _kerning(2)[("T", "O")] == -30


def _kern(project, ufo, fn):
    import plistlib

    path = project.parent / "masters" / ufo / "kerning.plist"
    data = plistlib.loads(path.read_bytes())
    fn(data)
    path.write_bytes(plistlib.dumps(data))


def test_factor_from_locations():
    from gcweb.master_tools import factor_from_locations

    f, how = factor_from_locations({"wght": 300, "ital": 0}, {"wght": 700, "ital": 0}, {"wght": 400, "ital": 0})
    assert f == 0.25 and "wght 400 between 300 and 700" in how
    with pytest.raises(ValueError, match="not between"):
        factor_from_locations({"wght": 300, "ital": 0}, {"wght": 700, "ital": 0}, {"wght": 400, "ital": 1})
    with pytest.raises(ValueError, match="not on the line"):
        factor_from_locations({"a": 0, "b": 0}, {"a": 10, "b": 10}, {"a": 5, "b": 2})


def test_interpolate_kerning_into_this_master(project):
    _kern(project, "Bold.ufo", lambda k: k["T"].update({"public.kern2.@MMK_R_A": -125}))
    api.open_designspace(str(project))
    api.switch_master(2)  # the italic is not between Light and Bold in the designspace…
    with pytest.raises(ValueError, match="not between"):
        _plan("interpolateKerning", a=0, b=1, position="")
    plan = _plan("interpolateKerning", a=0, b=1, position="0.5")  # …so the position is typed
    assert plan["changes"] and "position 0.5 (typed)" in plan["lines"][0]
    res = json.loads(api.tool_apply())
    assert res["others"] == [] and res["dirty"]
    assert _kerning(2)[("T", K2A)] == -100
    assert _kerning(0)[("T", K2A)] == -75  # A and B are not touched


def test_transfer_kerning_by_script(project):
    _kern(project, "Light.ufo", lambda k: k["T"].update({"O": -30}))
    _kern(project, "Bold.ufo", lambda k: k["T"].update({"O": -50}))
    api.open_designspace(str(project))
    choices = json.loads(api.tool_choices("transferKerning", "scripts"))
    assert choices[0][0] == "Latn" and "4 pairs" in choices[0][1]
    assert not _plan("transferKerning", targets=[1, 2], scripts=[])["changes"]
    plan = _plan("transferKerning", targets=[1, 2], scripts=["Latn"])
    assert plan["changes"]
    res = json.loads(api.tool_apply())
    assert res["others"] == [2]
    assert _kerning(1)[("T", "O")] == -50  # kept: no overwrite
    assert _kerning(2)[("T", "O")] == -30
