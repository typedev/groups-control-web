"""Tools menu: every tool plans without changing the font and applies in one step."""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest
import ufoLib2

from gcweb import api

MUTATOR = Path(__file__).resolve().parents[2] / "fixtures" / "MutatorSans" / "MutatorSansLightCondensed.ufo"
K1 = "public.kern1.@MMK_L_A"
K2 = "public.kern2.@MMK_R_A"


@pytest.fixture
def ufo(tmp_path):
    """MutatorSans with a few problems the tools can fix."""
    dst = tmp_path / "t.ufo"
    shutil.copytree(MUTATOR, dst)
    font = ufoLib2.Font.open(dst)
    font.newGlyph("afii10017").unicodes = [0x0410]  # Cyrillic A
    font.groups["public.kern1.O"] = ["Q", "O", "afii10017", "Nope"]  # key not first, mixed, missing
    font.groups["public.kern2.empty"] = []
    font.kerning[("public.kern1.O", "V")] = -83
    font.kerning[("A", "B")] = 3
    font.save(dst, overwrite=True)
    api.open_font(str(dst))
    yield dst
    api.close_font()


def plan(tool, **options):
    return json.loads(api.tool_plan(tool, json.dumps(options)))


def state():
    view = api._doc.master
    return dict(view.groups), dict(view.kerning)


def test_list_has_ten_single_font_tools(ufo):
    tools = [t for t in json.loads(api.tool_list()) if not t.get("needsDesignspace")]
    assert len(tools) == 10
    assert {t["id"] for t in tools} >= {"clean", "split", "round"}


@pytest.mark.parametrize(
    "tool,options",
    [
        ("clean", {}),
        ("keyGlyphs", {}),
        ("flatten", {}),
        ("merge", {"suffixes": "_cyrl"}),
        ("placeComposites", {"groups": "all"}),
        ("placeLigatures", {}),
        ("crossPairs", {}),
        ("rename", {"groups": "all"}),
        ("round", {"step": "5"}),
        ("split", {}),
    ],
)
def test_plan_is_a_dry_run(ufo, tool, options):
    before = state()
    out = plan(tool, **options)
    assert isinstance(out["lines"], list) and out["lines"]
    assert state() == before


def test_clean_removes_missing_and_empty(ufo):
    assert plan("clean")["changes"] is True
    out = json.loads(api.tool_apply())
    groups, _ = state()
    assert "Nope" not in groups["public.kern1.O"]
    assert "public.kern2.empty" not in groups
    assert out["dirty"] is True and "public.kern2.empty" in out["delta"]["groups"]["removed"]


def test_key_glyph_moves_named_glyph_first(ufo):
    plan("keyGlyphs")
    api.tool_apply()
    assert state()[0]["public.kern1.O"][0] == "O"


def test_round_rounds_and_drops_noise(ufo):
    plan("round", step="5")
    api.tool_apply()
    kerning = state()[1]
    assert kerning[("public.kern1.O", "V")] == -85
    assert ("A", "B") not in kerning


def test_split_moves_cyrillic_member(ufo):
    out = plan("split", sides="kern1")
    assert out["changes"] is True
    api.tool_apply()
    groups = state()[0]
    assert "afii10017" not in groups["public.kern1.O"]
    assert any(g.startswith("public.kern1.O_") and "afii10017" in m for g, m in groups.items())


def test_place_composites_adds_to_base_group(ufo):
    plan("placeComposites", groups="all")
    api.tool_apply()
    assert "Aacute" in state()[0][K1]


def test_rename_by_key_glyph_moves_kerning(ufo):
    plan("rename", groups="selected", _selectedGroups=[K1], mode="key_glyph")
    api.tool_apply()
    groups, kerning = state()
    assert "public.kern1.A" in groups and K1 not in groups
    assert kerning[("public.kern1.A", "V")] == -15


def test_flatten_turns_group_pairs_into_glyph_pairs(ufo):
    plan("flatten")
    api.tool_apply()
    groups, kerning = state()
    assert not any(g.startswith("public.kern") for g in groups)
    assert kerning[("A", "V")] == -15


def test_apply_without_plan_fails(ufo):
    with pytest.raises(RuntimeError):
        api.tool_apply()


def test_bad_options_raise(ufo):
    with pytest.raises(ValueError, match="needs something to find"):
        api.tool_plan("rename", json.dumps({"mode": "replace", "find": ""}))
    with pytest.raises(ValueError, match="No suffix"):
        api.tool_plan("merge", json.dumps({"suffixes": " "}))
