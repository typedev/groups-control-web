"""Dependency line, pair rows and kerning edits."""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest

from gcweb import api

MUTATOR = Path(__file__).resolve().parents[2] / "fixtures" / "MutatorSans" / "MutatorSansLightCondensed.ufo"
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


def line(**subject):
    return call(api.preview_line, json.dumps(subject))


def test_members_mode_lists_names_with_controls():
    tokens = line(names=["A", "B"], side="kern1", key="A", members=["A", "B"], mode="members")
    assert [t["n"] for t in tokens] == ["A", "B"]
    assert all(t["c"] == "H" for t in tokens)
    assert tokens[0]["m"] and tokens[1]["m"]
    assert tokens[1].get("x")  # B's right margin differs from A's


def test_all_mode_adds_composites_flagged_as_non_members():
    tokens = line(names=["A"], side="kern1", key="A", members=["A"], mode="all")
    names = [t["n"] for t in tokens]
    assert names[0] == "A" and {"Aacute", "Adieresis"} <= set(names)
    assert not any(t.get("m") for t in tokens if t["n"] != "A")


def test_smart_mode_follows_side_parent():
    names = [t["n"] for t in line(names=["A"], side="kern1", key="A", members=["A"], mode="smart")]
    assert "Aacute" in names


def test_pair_rows_compact_and_expanded():
    api.add_glyphs(K1, json.dumps(["Aacute"]), True)
    rows = call(api.preview_pairs, json.dumps([[K1, "V"]]), False, 8)
    assert [t["n"] for t in rows[0]] == ["H", "A", "V", "H"]
    assert rows[0][1].get("pl") and rows[0][0].get("ctx")
    rows = call(api.preview_pairs, json.dumps([[K1, "V"]]), True, 1)
    assert [[t["n"] for t in r if not t.get("ctx")] for r in rows] == [["A", "V"], ["Aacute", "V"]]


def test_nudge_edits_resolved_key_and_drops_zero():
    out = call(api.kern_nudge, "A", "V", 10)
    assert out["result"]["key"] == [K1, "V"]
    assert out["delta"]["kerning"]["changed"] == [[K1, "V", -5]]
    out = call(api.kern_nudge, "A", "V", 5)
    assert out["delta"]["kerning"]["removed"] == [[K1, "V"]]


def test_nudge_creates_group_pair_when_none_applies():
    out = call(api.kern_nudge, "A", "O", -10)
    assert out["delta"]["kerning"]["changed"] == [[K1, "O", -10]]


def test_exceptions_by_side():
    api.add_glyphs(K1, json.dumps(["Aacute"]), True)
    out = call(api.kern_exception, "Aacute", "V", "left")
    assert out["delta"]["kerning"]["changed"] == [["Aacute", "V", -15]]
    with pytest.raises(ValueError, match="already applies"):
        api.kern_exception("Aacute", "V", "left")
    # now an exception at 0 survives a nudge to 0
    call(api.kern_nudge, "Aacute", "V", 15)
    assert api._doc.master.kerning[("Aacute", "V")] == 0


def test_remove_resolved_pair():
    out = call(api.kern_remove, "T", "A")
    assert out["result"]["key"] == ["T", K2]
    assert call(api.kern_remove, "B", "C")["result"]["key"] is None
