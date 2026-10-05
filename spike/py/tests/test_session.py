"""Spike tests: ufo-spacing-lib on ufoLib2 via tracked mappings."""

from __future__ import annotations

import difflib
import os
import shutil
import sys
from pathlib import Path

import pytest
import ufoLib2

from session import GROUPS_FILE, KERNING_FILE, Session

MUTATOR = Path.home() / "WORK/test_fonts/MutatorSans/MutatorSansLightCondensed.ufo"
LIB_TESTS = Path.home() / "WORK/ufo-spacing-lib/tests"

K1 = "public.kern1.@MMK_L_A"
K2 = "public.kern2.@MMK_R_A"


@pytest.fixture
def ufo(tmp_path) -> Path:
    dst = tmp_path / MUTATOR.name
    shutil.copytree(MUTATOR, dst)
    return dst


@pytest.fixture
def session(ufo) -> Session:
    s = Session()
    s.open(str(ufo))
    return s


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


# -- adapter ------------------------------------------------------------------


def test_open_wraps_ufolib2(session):
    font = session.font
    assert font.groups[K1] == ("A",)
    assert font.kerning[(K1, "V")] == -15
    assert "A" in font and "Nope" not in font


def test_add_to_existing_group_reports_delta(session):
    out = session.op("add_glyphs_to_group", group_name=K1, glyph_list=["Aacute"])
    assert out["delta"]["master"] == 0
    assert out["delta"]["groups"] == {"changed": {K1: ["A", "Aacute"]}, "removed": []}
    assert out["delta"]["kerning"] == {"changed": [], "removed": []}


def test_add_glyph_with_equal_kerning_drops_its_pair(session):
    session.font.kerning[("Aacute", "V")] = -15
    session.font.kerning[("Adieresis", "V")] = -40
    session.font.kerning.take_diff()
    out = session.op(
        "add_glyphs_to_group", group_name=K1, glyph_list=["Aacute", "Adieresis"]
    )
    assert out["delta"]["kerning"]["removed"] == [["Aacute", "V"]]
    assert session.font.kerning[("Adieresis", "V")] == -40  # kept as exception


def test_add_refuses_glyph_grouped_on_same_side(session):
    session.op("add_glyphs_to_group", group_name="public.kern1.B", glyph_list=["B"])
    out = session.op("add_glyphs_to_group", group_name="public.kern1.X", glyph_list=["B"])
    skipped = out["result"][0]
    assert "B" in skipped
    assert session.font.groups["public.kern1.B"] == ("B",)


def test_remove_with_check_kerning_creates_exceptions(session):
    out = session.op("remove_glyphs_from_group", group_name=K2, glyph_list=["A"])
    changed = {(l, r): v for l, r, v in out["delta"]["kerning"]["changed"]}
    assert changed == {("T", "A"): -75, ("V", "A"): -100}
    assert out["delta"]["groups"]["changed"] == {K2: []}


def test_remove_without_check_kerning(session):
    out = session.op(
        "remove_glyphs_from_group", group_name=K2, glyph_list=["A"], check_kerning=False
    )
    assert out["delta"]["kerning"] == {"changed": [], "removed": []}


def test_delete_group(session):
    out = session.op("delete_group", group_name=K2)
    assert out["delta"]["groups"]["removed"] == [K2]
    removed = {tuple(p) for p in out["delta"]["kerning"]["removed"]}
    assert removed == {("T", K2), ("V", K2)}


def test_rename_group_needs_remove_adapter(session):
    out = session.op("rename_group", old_name=K1, new_name="public.kern1.A")
    assert out["delta"]["groups"] == {
        "changed": {"public.kern1.A": ["A"]},
        "removed": [K1],
    }
    assert out["delta"]["kerning"]["changed"] == [["public.kern1.A", "V", -15]]
    assert out["delta"]["kerning"]["removed"] == [[K1, "V"]]


def test_reposition_changes_key_glyph(session):
    session.op("add_glyphs_to_group", group_name=K1, glyph_list=["Aacute"])
    out = session.op(
        "reposition_glyph_in_group", group_name=K1, target_index=0, glyph_list=["Aacute"]
    )
    assert out["delta"]["groups"]["changed"] == {K1: ["Aacute", "A"]}


def test_unknown_op_rejected(session):
    with pytest.raises(ValueError):
        session.op("set_font", font=None)


# -- parity with the library's own mock font ----------------------------------


def test_same_result_as_mock_font(session):
    sys.path.insert(0, str(LIB_TESTS))
    try:
        from mocks import MockFont  # type: ignore
    finally:
        sys.path.pop(0)
    from ufo_spacing_lib.groups_core import FontGroupsManager

    glyphs = list(session.ufo.keys())
    mock = MockFont(glyph_names=glyphs)
    mock.groups.update({k: tuple(v) for k, v in session.font.groups.items()})
    mock.kerning.update(dict(session.font.kerning))
    manager = FontGroupsManager(mock)

    steps = [
        ("add_glyphs_to_group", dict(group_name=K1, glyph_list=["Aacute", "Adieresis"])),
        ("remove_glyphs_from_group", dict(group_name=K2, glyph_list=["A"])),
        ("rename_group", dict(old_name=K1, new_name="public.kern1.A")),
        ("delete_group", dict(group_name="testGroup")),
    ]
    for name, kwargs in steps:
        getattr(manager, name)(**kwargs)
        session.op(name, **kwargs)
    assert {k: tuple(v) for k, v in mock.groups.items()} == dict(session.font.groups)
    assert dict(mock.kerning) == dict(session.font.kerning)


# -- saving -------------------------------------------------------------------


def test_open_save_writes_nothing(session):
    assert session.changed_files() == {}


def test_edit_then_manual_revert_writes_nothing(session):
    session.op("add_glyphs_to_group", group_name=K1, glyph_list=["Aacute"])
    session.op(
        "remove_glyphs_from_group", group_name=K1, glyph_list=["Aacute"], check_kerning=False
    )
    assert session.changed_files() == {}


def test_real_edit_touches_only_groups_plist(session, ufo):
    before = mtimes(ufo)
    orig = (ufo / GROUPS_FILE).read_text().splitlines()
    session.op("add_glyphs_to_group", group_name=K1, glyph_list=["Aacute"])
    files = session.changed_files()
    assert set(files) == {GROUPS_FILE}
    write(ufo, files)
    session.mark_saved(files)
    after = mtimes(ufo)
    assert [k for k in after if after[k] != before[k]] == [GROUPS_FILE]
    new = (ufo / GROUPS_FILE).read_text().splitlines()
    diff = [l for l in difflib.unified_diff(orig, new, lineterm="", n=0) if l[:1] in "+-" and l[:3] not in ("+++", "---")]
    assert len(diff) == 1 and diff[0].startswith("+")
    assert diff[0][1:].strip() == "<string>Aacute</string>"
    reopened = ufoLib2.Font.open(ufo)
    assert reopened.groups[K1] == ["A", "Aacute"]
    assert session.changed_files() == {}


def test_kerning_edit_writes_minimal_kerning_diff(session, ufo):
    orig = (ufo / KERNING_FILE).read_text().splitlines()
    session.op("delete_group", group_name=K2)
    files = session.changed_files()
    assert set(files) == {GROUPS_FILE, KERNING_FILE}
    write(ufo, files)
    reopened = ufoLib2.Font.open(ufo)
    assert K2 not in reopened.groups
    assert dict(reopened.kerning) == dict(session.font.kerning)
    new = (ufo / KERNING_FILE).read_text().splitlines()
    assert new[:2] == orig[:2]  # header kept verbatim


def test_revert_to_file(session):
    session.op("delete_group", group_name=K2)
    delta = session.revert()
    assert delta["groups"]["changed"] == {K2: ["A"]}
    assert session.changed_files() == {}
    # the manager sees the restored groups
    out = session.op("add_glyphs_to_group", group_name=K2, glyph_list=["Aacute"])
    assert out["delta"]["groups"]["changed"] == {K2: ["A", "Aacute"]}
