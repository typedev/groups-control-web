"""Margin edits: object state, composites, GLIF text, saving and revert."""

from __future__ import annotations

import json
import shutil
import zipfile
from pathlib import Path

import pytest
import ufoLib2

from gcweb import api

MUTATOR = Path(__file__).resolve().parents[2] / "fixtures" / "MutatorSans" / "MutatorSansLightCondensed.ufo"


@pytest.fixture
def ufo(tmp_path):
    dst = tmp_path / MUTATOR.name
    shutil.copytree(MUTATOR, dst)
    api.open_font(str(dst))
    yield dst
    api.close_font()


def call(fn, *args):
    return json.loads(fn(*args))


def margins(name):
    layer = api._doc.ufo.layers.defaultLayer
    g = layer[name]
    return g.getLeftMargin(layer), g.getRightMargin(layer), g.width


def test_right_edit_changes_advance_and_composites_follow(ufo):
    a0, aac0 = margins("A"), margins("Aacute")
    out = call(api.margin_nudge, "A", "right", 10)
    assert margins("A") == (a0[0], a0[1] + 10, a0[2] + 10)
    assert margins("Aacute")[1] == aac0[1] + 10
    assert set(out["result"]["changed"]) >= {"A", "Aacute", "Adieresis"}
    assert out["delta"]["glyphs"]["A"]["r"] == a0[1] + 10
    assert out["dirty"] is True


def test_left_edit_moves_drawing_and_composites_keep_margins(ufo):
    a0, aac0 = margins("A"), margins("Aacute")
    call(api.margin_nudge, "A", "left", -5)
    assert margins("A") == (a0[0] - 5, a0[1], a0[2] - 5)
    # composite margins follow the base exactly
    assert margins("Aacute") == (aac0[0] - 5, aac0[1], aac0[2] - 5)


def test_accent_edit_leaves_composites_unchanged(ufo):
    aac0 = margins("Aacute")
    call(api.margin_nudge, "acute", "left", 20)
    assert margins("Aacute") == aac0


def test_empty_glyph_is_left_alone(ufo):
    out = call(api.margin_nudge, "space", "left", 10)
    assert out["result"]["changed"] == [] and out["dirty"] is False


def test_saved_glifs_are_minimal_and_reload_equal(ufo, tmp_path):
    call(api.margin_nudge, "A", "left", 3)
    files = json.loads(api.changed_files(str(tmp_path / "out")))
    names = sorted(f["name"] for f in files)
    assert "glyphs/A_.glif" in names and "glyphs/A_acute.glif" in names
    assert "groups.plist" not in names
    for f in files:
        shutil.copyfile(f["path"], ufo / f["name"])
    api.mark_saved()
    reopened = ufoLib2.Font.open(ufo)
    layer = reopened.layers.defaultLayer
    assert layer["A"].getLeftMargin(layer) == margins("A")[0]
    assert layer["Aacute"].getLeftMargin(layer) == margins("Aacute")[0]
    assert json.loads(api.has_changes()) is False


def test_ufoz_contains_patched_glyph(ufo, tmp_path):
    call(api.margin_nudge, "B", "right", 7)
    out = tmp_path / "o" / "x.ufoz"
    api.build_ufoz(str(out))
    with ufoLib2.Font.open(out) as font:
        assert font.layers.defaultLayer["B"].width == margins("B")[2]


def test_revert_restores_glyphs(ufo):
    a0, aac0 = margins("A"), margins("Aacute")
    call(api.margin_nudge, "A", "left", 9)
    delta = call(api.revert)
    assert margins("A") == a0 and margins("Aacute") == aac0
    assert delta["glyphs"]["A"]["l"] == a0[0]
    assert json.loads(api.has_changes()) is False


def test_edit_back_and_forth_is_clean(ufo, tmp_path):
    call(api.margin_nudge, "A", "left", 4)
    out = call(api.margin_nudge, "A", "left", -4)
    assert out["dirty"] is False
    assert json.loads(api.changed_files(str(tmp_path / "out"))) == []


def test_metrics_rules_flag(ufo):
    assert json.loads(api.open_font(str(ufo)))["hasMetricsRules"] is False
