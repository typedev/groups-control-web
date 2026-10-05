"""UfoDocument + api: ufo-spacing-lib on ufoLib2 via tracked mappings."""

from __future__ import annotations

import difflib
import json
import shutil
from pathlib import Path

import pytest
import ufoLib2
from ufo_spacing_lib.groups_core import FontGroupsManager

from gcweb import api
from gcweb.document import GROUPS_FILE, KERNING_FILE, UfoDocument

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures"
MUTATOR = FIXTURES / "MutatorSansLightCondensed.ufo"

K1 = "public.kern1.@MMK_L_A"
K2 = "public.kern2.@MMK_R_A"


@pytest.fixture
def ufo(tmp_path) -> Path:
    dst = tmp_path / MUTATOR.name
    shutil.copytree(MUTATOR, dst)
    return dst


@pytest.fixture
def doc(ufo) -> UfoDocument:
    api.open_font(str(ufo))
    yield api._doc
    api.close_font()


def op(name: str, **kwargs) -> dict:
    return json.loads(api.op(name, json.dumps(kwargs)))


def write(ufo: Path, files: dict[str, bytes | None]) -> None:
    for name, data in files.items():
        if data is None:
            (ufo / name).unlink(missing_ok=True)
        else:
            (ufo / name).write_bytes(data)


def mtimes(ufo: Path) -> dict[str, int]:
    return {
        str(p.relative_to(ufo)): p.stat().st_mtime_ns
        for p in ufo.rglob("*")
        if p.is_file()
    }


# -- open ---------------------------------------------------------------------


def test_summary(ufo):
    summary = json.loads(api.open_font(str(ufo)))
    assert summary["formatVersion"] == [3, 0]
    assert summary["glyphs"] == 50
    assert (summary["kern1Groups"], summary["kern2Groups"], summary["otherGroups"]) == (1, 1, 1)
    assert summary["pairs"] == 3
    assert summary["readOnlyReason"] is None
    api.close_font()


def test_master_view_wraps_ufolib2(doc):
    view = doc.master
    assert view.groups[K1] == ("A",)
    assert view.kerning[(K1, "V")] == -15
    assert "A" in view and "Nope" not in view


def test_glyph_order_dedupes(doc):
    doc.ufo.glyphOrder = ["B", "A", "B"]
    order = doc.glyph_order()
    assert order[:2] == ["B", "A"]
    assert len(order) == len(set(order)) == 50


def test_op_without_font_fails():
    api.close_font()
    with pytest.raises(RuntimeError):
        api.op("delete_group", "{}")


def test_unknown_op_rejected(doc):
    with pytest.raises(ValueError):
        op("set_font", font=None)


# -- operations ---------------------------------------------------------------


def test_add_to_existing_group_reports_delta(doc):
    out = op("add_glyphs_to_group", group_name=K1, glyph_list=["Aacute"])
    assert out["delta"]["master"] == 0
    assert out["delta"]["groups"] == {"changed": {K1: ["A", "Aacute"]}, "removed": []}
    assert out["delta"]["kerning"] == {"changed": [], "removed": []}


def test_add_glyph_with_equal_kerning_drops_its_pair(doc):
    doc.master.kerning[("Aacute", "V")] = -15
    doc.master.kerning[("Adieresis", "V")] = -40
    doc.master.kerning.take_diff()
    out = op("add_glyphs_to_group", group_name=K1, glyph_list=["Aacute", "Adieresis"])
    assert out["delta"]["kerning"]["removed"] == [["Aacute", "V"]]
    assert doc.master.kerning[("Adieresis", "V")] == -40  # kept as exception


def test_add_refuses_glyph_grouped_on_same_side(doc):
    op("add_glyphs_to_group", group_name="public.kern1.B", glyph_list=["B"])
    out = op("add_glyphs_to_group", group_name="public.kern1.X", glyph_list=["B"])
    assert "B" in out["result"][0]
    assert doc.master.groups["public.kern1.B"] == ("B",)


def test_remove_with_check_kerning_creates_exceptions(doc):
    out = op("remove_glyphs_from_group", group_name=K2, glyph_list=["A"])
    changed = {(l, r): v for l, r, v in out["delta"]["kerning"]["changed"]}
    assert changed == {("T", "A"): -75, ("V", "A"): -100}
    assert out["delta"]["groups"]["changed"] == {K2: []}


def test_remove_without_check_kerning(doc):
    out = op("remove_glyphs_from_group", group_name=K2, glyph_list=["A"], check_kerning=False)
    assert out["delta"]["kerning"] == {"changed": [], "removed": []}


def test_delete_group(doc):
    out = op("delete_group", group_name=K2)
    assert out["delta"]["groups"]["removed"] == [K2]
    removed = {tuple(p) for p in out["delta"]["kerning"]["removed"]}
    assert removed == {("T", K2), ("V", K2)}


def test_rename_group_uses_remove(doc):
    out = op("rename_group", old_name=K1, new_name="public.kern1.A")
    assert out["delta"]["groups"] == {"changed": {"public.kern1.A": ["A"]}, "removed": [K1]}
    assert out["delta"]["kerning"]["changed"] == [["public.kern1.A", "V", -15]]
    assert out["delta"]["kerning"]["removed"] == [[K1, "V"]]


def move(group, glyphs, index) -> dict:
    return json.loads(api.move_in_group(group, json.dumps(glyphs), index))


def test_move_to_front_changes_key_glyph(doc):
    op("add_glyphs_to_group", group_name=K1, glyph_list=["Aacute"])
    out = move(K1, ["Aacute"], 0)
    assert out["delta"]["groups"]["changed"] == {K1: ["Aacute", "A"]}
    assert out["delta"]["kerning"] == {"changed": [], "removed": []}


def test_move_to_end_and_middle(doc):
    op("add_glyphs_to_group", group_name=K1, glyph_list=["Aacute", "Adieresis", "B"])
    assert move(K1, ["A"], 4)["delta"]["groups"]["changed"] == {K1: ["Aacute", "Adieresis", "B", "A"]}
    # insert before the member now at index 1 (Adieresis); B moves along
    assert move(K1, ["B"], 1)["delta"]["groups"]["changed"] == {K1: ["Aacute", "B", "Adieresis", "A"]}
    # target is itself moved: falls through to the next kept member
    assert move(K1, ["B", "Adieresis"], 1)["delta"]["groups"] == {"changed": {}, "removed": []}


def test_delta_carries_lang_updates(doc):
    out = op("remove_glyphs_from_group", group_name=K2, glyph_list=["A"])
    lang = out["delta"]["lang"]
    assert lang["set"] == []
    assert ["T", "A"] in lang["clear"] and ["T", K2] in lang["clear"]


# -- parity with a plain-dict font --------------------------------------------


class _PlainMapping(dict):
    def remove(self, key):
        if key in self:
            del self[key]


class _PlainFont:
    """The minimal fontParts-like font ufo-spacing-lib's own tests use."""

    def __init__(self, glyphs, groups, kerning):
        self._glyphs = set(glyphs)
        self.groups = _PlainMapping({k: tuple(v) for k, v in groups.items()})
        self.kerning = _PlainMapping(kerning)

    def __contains__(self, name):
        return name in self._glyphs


def test_same_result_as_plain_font(doc):
    view = doc.master
    plain = _PlainFont(doc.ufo.keys(), dict(view.groups), dict(view.kerning))
    manager = FontGroupsManager(plain)
    steps = [
        ("add_glyphs_to_group", dict(group_name=K1, glyph_list=["Aacute", "Adieresis"])),
        ("remove_glyphs_from_group", dict(group_name=K2, glyph_list=["A"])),
        ("rename_group", dict(old_name=K1, new_name="public.kern1.A")),
        ("delete_group", dict(group_name="testGroup")),
    ]
    for name, kwargs in steps:
        getattr(manager, name)(**kwargs)
        op(name, **kwargs)
    assert dict(plain.groups) == dict(view.groups)
    assert dict(plain.kerning) == dict(view.kerning)


# -- saving -------------------------------------------------------------------


def test_open_save_writes_nothing(doc):
    assert doc.changed_files() == {}


def test_edit_then_manual_revert_writes_nothing(doc):
    assert op("add_glyphs_to_group", group_name=K1, glyph_list=["Aacute"])["dirty"] is True
    out = op("remove_glyphs_from_group", group_name=K1, glyph_list=["Aacute"], check_kerning=False)
    assert out["dirty"] is False
    assert doc.changed_files() == {}


def test_real_edit_touches_only_groups_plist(doc, ufo):
    before = mtimes(ufo)
    orig = (ufo / GROUPS_FILE).read_text().splitlines()
    op("add_glyphs_to_group", group_name=K1, glyph_list=["Aacute"])
    files = doc.changed_files()
    assert set(files) == {GROUPS_FILE}
    write(ufo, files)
    doc.mark_saved(files)
    after = mtimes(ufo)
    assert [k for k in after if after[k] != before[k]] == [GROUPS_FILE]
    new = (ufo / GROUPS_FILE).read_text().splitlines()
    diff = [
        line
        for line in difflib.unified_diff(orig, new, lineterm="", n=0)
        if line[:1] in "+-" and line[:3] not in ("+++", "---")
    ]
    assert len(diff) == 1 and diff[0].startswith("+")
    assert diff[0][1:].strip() == "<string>Aacute</string>"
    assert ufoLib2.Font.open(ufo).groups[K1] == ["A", "Aacute"]
    assert doc.changed_files() == {}


def test_kerning_edit_keeps_header(doc, ufo):
    orig = (ufo / KERNING_FILE).read_text().splitlines()
    op("delete_group", group_name=K2)
    files = doc.changed_files()
    assert set(files) == {GROUPS_FILE, KERNING_FILE}
    write(ufo, files)
    reopened = ufoLib2.Font.open(ufo)
    assert K2 not in reopened.groups
    assert dict(reopened.kerning) == dict(doc.master.kerning)
    assert (ufo / KERNING_FILE).read_text().splitlines()[:2] == orig[:2]


def test_revert_to_file(doc):
    op("delete_group", group_name=K2)
    out = json.loads(api.revert())
    assert out["groups"]["changed"] == {K2: ["A"]}
    assert doc.changed_files() == {}
    after = op("add_glyphs_to_group", group_name=K2, glyph_list=["Aacute"])
    assert after["delta"]["groups"]["changed"] == {K2: ["A", "Aacute"]}


def test_ufo2_is_read_only(tmp_path):
    ufo2 = tmp_path / "v2.ufo"
    shutil.copytree(MUTATOR, ufo2)
    meta = ufo2 / "metainfo.plist"
    meta.write_text(meta.read_text().replace("<integer>3</integer>", "<integer>2</integer>"))
    summary = json.loads(api.open_font(str(ufo2)))
    assert summary["formatVersion"][0] == 2
    assert "read-only" in summary["readOnlyReason"]
    api.close_font()
