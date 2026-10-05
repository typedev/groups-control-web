"""User-level editing calls: add / create / remove / delete / rename / history."""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest

from gcweb import api

MUTATOR = Path(__file__).resolve().parents[2] / "fixtures" / "MutatorSansLightCondensed.ufo"
K1 = "public.kern1.@MMK_L_A"
K2 = "public.kern2.@MMK_R_A"


@pytest.fixture(autouse=True)
def font(tmp_path):
    dst = tmp_path / MUTATOR.name
    shutil.copytree(MUTATOR, dst)
    api.open_font(str(dst))
    yield
    api.close_font()


def call(fn, *args):
    return json.loads(fn(*args))


def groups():
    return dict(api._doc.master.groups)


def test_add_places_at_index_and_reports_grouped():
    out = call(api.add_glyphs, K1, json.dumps(["B", "A", "C"]), True, 0)
    assert out["result"] == {"added": ["B", "C"], "grouped": [["A", K1]]}
    assert groups()[K1] == ("B", "C", "A")  # dropped at 0: B is the new key glyph
    assert out["delta"]["groups"]["changed"] == {K1: ["B", "C", "A"]}


def test_add_without_index_appends():
    call(api.add_glyphs, K1, json.dumps(["B"]), True)
    assert groups()[K1] == ("A", "B")


def test_add_refuses_glyph_grouped_elsewhere_on_side():
    call(api.create_group, "public.kern1.", "B", json.dumps(["B"]), True)
    out = call(api.add_glyphs, K1, json.dumps(["B"]), True)
    assert out["result"] == {"added": [], "grouped": [["B", "public.kern1.B"]]}
    assert out["delta"]["groups"] == {"changed": {}, "removed": []}


def test_other_side_does_not_count_as_grouped():
    out = call(api.add_glyphs, K2, json.dumps(["V"]), True)
    assert out["result"]["added"] == ["V"]


def test_create_group_and_name_checks():
    out = call(api.create_group, "public.kern1.", "O", json.dumps(["O", "A", "Q"]), True)
    assert out["result"] == {"group": "public.kern1.O", "added": ["O", "Q"], "grouped": [["A", K1]]}
    with pytest.raises(ValueError, match="already exists"):
        api.create_group("public.kern1.", "O", json.dumps(["C"]), True)
    with pytest.raises(ValueError, match="spaces"):
        api.create_group("public.kern1.", "a b", json.dumps(["C"]), True)
    with pytest.raises(ValueError, match="empty"):
        api.create_group("public.kern1.", "", json.dumps(["C"]), True)


def test_create_with_no_free_glyphs_creates_nothing():
    out = call(api.create_group, "public.kern1.", "X", json.dumps(["A"]), True)
    assert out["result"]["group"] is None
    assert "public.kern1.X" not in groups()


def test_remove_keep_kerning_makes_exceptions():
    out = call(api.remove_glyphs, K2, json.dumps(["A", "nope"]), True)
    assert out["result"] == {"removed": ["A"]}
    changed = {(l, r) for l, r, _v in out["delta"]["kerning"]["changed"]}
    assert changed == {("T", "A"), ("V", "A")}
    out = call(api.remove_glyphs, K1, json.dumps(["A"]), False)
    assert out["delta"]["kerning"] == {"changed": [], "removed": []}


def test_delete_without_keep_kerning_loses_group_pairs():
    out = call(api.delete_group, K2, False)
    assert out["delta"]["groups"]["removed"] == [K2]
    assert out["delta"]["kerning"]["changed"] == []
    assert len(out["delta"]["kerning"]["removed"]) == 2


def test_rename_moves_kerning_and_validates():
    out = call(api.rename_group, K1, " A ")
    assert out["result"] == {"group": "public.kern1.A"}
    assert ["public.kern1.A", "V", -15] in out["delta"]["kerning"]["changed"]
    assert call(api.rename_group, "public.kern1.A", "A")["delta"]["groups"] == {"changed": {}, "removed": []}
    call(api.create_group, "public.kern1.", "B", json.dumps(["B"]), True)
    with pytest.raises(ValueError, match="already exists"):
        api.rename_group("public.kern1.A", "B")


def test_history_records_manager_operations():
    assert call(api.history) == {"text": "", "count": 0, "recording": True}
    call(api.add_glyphs, K1, json.dumps(["B"]), True)
    call(api.rename_group, K1, "A")
    h = call(api.history)
    assert h["text"] == f"add K+ {K1} B\nrename K+ {K1} public.kern1.A\n"
    call(api.set_history_recording, False)
    call(api.remove_glyphs, "public.kern1.A", json.dumps(["B"]), True)
    assert call(api.history)["count"] == 2
    assert call(api.clear_history)["count"] == 0


def test_placing_and_moving_keep_the_history():
    call(api.add_glyphs, K1, json.dumps(["B"]), True, 0)
    api.move_in_group(K1, json.dumps(["A"]), 0)
    call(api.remove_glyphs, K1, json.dumps(["B"]), True)
    assert call(api.history)["text"] == f"add K+ {K1} B\nremove K+ {K1} B\n"


def test_delete_pairs():
    out = call(api.delete_pairs, json.dumps([["T", K2], ["nope", "x"]]))
    assert out["result"] == {"removed": [["T", K2]]}
    assert out["delta"]["kerning"]["removed"] == [["T", K2]]
    assert ["T", K2] in out["delta"]["lang"]["clear"]
    assert out["dirty"] is True
