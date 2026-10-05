"""Groups import/export, history files, session state."""

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


def test_export_scopes():
    assert call(api.export_groups, "kern")["text"] == f"{K1}=A\n{K2}=A\n"
    assert call(api.export_groups, "other")["text"] == "testGroup=E,F,H\n"


def test_import_preview_writes_nothing_then_apply():
    text = "public.kern1.O=O,Q,Nope\npublic.kern2.@MMK_R_A=A,Aacute\n"
    preview = call(api.import_preview, text, "kern")
    assert preview["ok"] and preview["changes"]
    joined = "\n".join(preview["lines"])
    assert "Nope" in joined  # missing glyph reported
    assert K1 in dict(api._doc.master.groups)  # dry run: untouched
    out = call(api.import_apply)
    assert out["delta"]["groups"]["changed"]["public.kern1.O"] == ["O", "Q"]
    assert K1 in out["delta"]["groups"]["removed"]
    assert ["A", "V", -15] in out["delta"]["kerning"]["changed"]
    groups = dict(api._doc.master.groups)
    assert K1 not in groups  # kern groups replaced
    assert groups["public.kern1.O"] == ("O", "Q")
    assert groups["testGroup"] == ("E", "F", "H")  # other groups kept (scope kern)
    assert out["dirty"] is True
    # kerning followed: the A side-1 group pair became a glyph pair
    assert api._doc.master.kerning.get(("A", "V")) == -15
    with pytest.raises(RuntimeError):
        api.import_apply()


def test_import_round_trip_is_no_change():
    text = call(api.export_groups, "all")["text"]
    assert call(api.import_preview, text, "all")["changes"] is False


def test_history_load_replaces_journal():
    out = call(api.load_history, "# saved\nadd K+ public.kern1.O O D\nbogus line\n")
    assert out["count"] == 1
    assert out["text"] == "add K+ public.kern1.O O D\n"
    assert out["notes"] and "bogus" in out["notes"][0]


def test_session_state_round_trip(tmp_path):
    api.add_glyphs(K1, json.dumps(["Aacute"]), True)
    api.kern_nudge("A", "V", -5)
    state = api.session_state()
    api.close_font()
    dst = tmp_path / "again.ufo"
    shutil.copytree(MUTATOR, dst)
    api.open_font(str(dst))
    out = call(api.restore_state, state)
    assert out["dirty"] is True
    assert out["delta"]["groups"]["changed"] == {K1: ["A", "Aacute"]}
    assert out["delta"]["kerning"]["changed"] == [[K1, "V", -20]]
    assert api._doc.master.groups[K1] == ("A", "Aacute")
    assert api._doc.master.kerning[(K1, "V")] == -20
    assert call(api.history)["text"].startswith(f"add K+ {K1} Aacute")
