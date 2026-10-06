"""The open-source MutatorSans designspace end to end (fixtures/MutatorSans).

Four masters on a discrete `width` axis (0, 1000) and a continuous `weight`
axis. Their kern groups are the same; the other group `testGroup` exists in
LightCondensed only; kerning differs (3, 78, 78, 1 pairs).
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest

from gcweb import api

SOURCE = Path(__file__).resolve().parents[2] / "fixtures" / "MutatorSans"
K2A = "public.kern2.@MMK_R_A"


@pytest.fixture
def ds(tmp_path):
    shutil.copytree(SOURCE, tmp_path / "MutatorSans")
    path = tmp_path / "MutatorSans" / "MutatorSans.designspace"
    yield path
    api.close_font()


def tree(root: Path) -> dict[str, bytes]:
    return {str(p.relative_to(root)): p.read_bytes() for p in sorted(root.rglob("*")) if p.is_file()}


def save_into(ds: Path, scratch: Path) -> list[str]:
    """What the UI does with a writable folder."""
    listed = json.loads(api.changed_files(str(scratch)))
    for f in listed:
        target = ds.parent / f["name"]
        if f["path"] is None:
            target.unlink()
        else:
            target.write_bytes(Path(f["path"]).read_bytes())
    api.mark_saved()
    return sorted(f["name"] for f in listed)


def test_opens_four_masters_on_a_discrete_axis(ds):
    info = json.loads(api.open_designspace(str(ds)))["designspace"]
    assert [m["name"] for m in info["masters"]] == [
        "MutatorSansLightCondensed",
        "MutatorSansBoldCondensed",
        "MutatorSansLightWide",
        "MutatorSansBoldWide",
    ]
    assert info["current"] == 0 and info["masters"][0]["isDefault"]
    assert info["axes"] == [{"name": "width", "discrete": True}, {"name": "weight", "discrete": False}]
    assert info["subspace"] == "width=0"
    assert info["sets"] == 1
    assert info["reach"] == {"compatibleAll": 4, "compatible": 2, "master": 1}
    assert [m["pairs"] for m in info["masters"]] == [3, 78, 78, 1]


def test_open_save_without_edits_writes_nothing(ds, tmp_path):
    api.open_designspace(str(ds))
    assert json.loads(api.changed_files(str(tmp_path / "out"))) == []


def test_subspace_edit_saves_only_the_condensed_masters(ds, tmp_path):
    before = tree(ds.parent)
    api.open_designspace(str(ds))
    api.set_edit_scope("compatible")  # width=0: LightCondensed and BoldCondensed
    res = json.loads(api.delete_group(K2A, True))
    assert res["others"] == [1]
    written = save_into(ds, tmp_path / "out")
    # BoldCondensed has no pairs with the group: only its groups.plist changes.
    assert written == [
        "MutatorSansBoldCondensed.ufo/groups.plist",
        "MutatorSansLightCondensed.ufo/groups.plist",
        "MutatorSansLightCondensed.ufo/kerning.plist",
    ]
    after = tree(ds.parent)
    assert {k for k in after if after[k] != before.get(k)} == set(written)
    # Reopen: the edit is there, the wide masters kept the group, nothing more to save.
    api.close_font()
    info = json.loads(api.open_designspace(str(ds)))["designspace"]
    assert info["sets"] == 2
    assert json.loads(api.changed_files(str(tmp_path / "out2"))) == []


def test_saved_plist_keeps_the_original_layout(ds, tmp_path):
    original = (ds.parent / "MutatorSansBoldCondensed.ufo" / "kerning.plist").read_text().splitlines()
    api.open_designspace(str(ds))
    api.switch_master(1)
    api.set_edit_scope("master")
    assert ("T", "A") in api._doc.master.kerning
    api.kern_nudge("T", "A", -5)
    save_into(ds, tmp_path / "out")
    saved = (ds.parent / "MutatorSansBoldCondensed.ufo" / "kerning.plist").read_text().splitlines()
    # Same layout: only the value line of that pair differs.
    assert len(saved) == len(original)
    assert sum(a != b for a, b in zip(original, saved)) == 1


def test_copy_other_groups_into_every_master(ds):
    api.open_designspace(str(ds))
    plan = json.loads(api.tool_plan("copyGroups", json.dumps({"targets": [1, 2, 3], "what": "other"})))
    assert plan["changes"]
    res = json.loads(api.tool_apply())
    assert sorted(res["others"]) == [1, 2, 3]
    for m in api._masters:
        assert list(m.doc.master.groups["testGroup"]) == ["E", "F", "H"]
    # Kern groups were the same already: no kerning moved.
    assert json.loads(api.groups_diff(json.dumps([1, 2, 3]))) == []


def test_transfer_lists_latin_only(ds):
    api.open_designspace(str(ds))
    choices = json.loads(api.tool_choices("transferKerning", "scripts"))
    assert [code for code, _label in choices] == ["Latn"]


def test_replay_history_into_other_masters(ds):
    api.open_designspace(str(ds))
    api.set_edit_scope("master")
    api.create_group("public.kern1.", "H", '["H", "I"]', True)  # recorded in LightCondensed's history
    assert json.loads(api.history())["count"] == 1
    plan = json.loads(api.tool_plan("replayHistory", json.dumps({"targets": [1, 3]})))
    assert plan["changes"] and plan["lines"][0].startswith("Replaying 1 command(s)")
    res = json.loads(api.tool_apply())
    assert sorted(res["others"]) == [1, 3]
    assert list(api._masters[3].doc.master.groups["public.kern1.H"]) == ["H", "I"]
    assert "public.kern1.H" not in api._masters[2].doc.master.groups
