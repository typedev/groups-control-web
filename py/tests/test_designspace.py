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
