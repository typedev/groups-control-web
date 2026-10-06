"""Saving through the API: folder files and .ufoz archives."""

from __future__ import annotations

import json
import shutil
import zipfile
from pathlib import Path

import pytest
import ufoLib2

from gcweb import api

MUTATOR = Path(__file__).resolve().parents[2] / "fixtures" / "MutatorSans" / "MutatorSansLightCondensed.ufo"
K1 = "public.kern1.@MMK_L_A"


@pytest.fixture
def folder(tmp_path) -> Path:
    dst = tmp_path / MUTATOR.name
    shutil.copytree(MUTATOR, dst)
    api.open_font(str(dst))
    yield dst
    api.close_font()


@pytest.fixture
def ufoz(tmp_path) -> Path:
    src = tmp_path / "src.ufoz"
    ufoLib2.Font.open(MUTATOR).save(src, structure="zip")
    api.open_font(str(src))
    yield src
    api.close_font()


def edit():
    out = json.loads(api.op("add_glyphs_to_group", json.dumps({"group_name": K1, "glyph_list": ["Aacute"]})))
    assert out["dirty"] is True


def test_changed_files_lists_only_edits(folder, tmp_path):
    assert json.loads(api.changed_files(str(tmp_path / "out"))) == []
    edit()
    files = json.loads(api.changed_files(str(tmp_path / "out")))
    assert [f["name"] for f in files] == ["groups.plist"]
    data = Path(files[0]["path"]).read_bytes()
    assert b"<string>Aacute</string>" in data
    assert json.loads(api.has_changes()) is True
    shutil.copyfile(files[0]["path"], folder / "groups.plist")
    api.mark_saved()
    assert json.loads(api.has_changes()) is False
    assert ufoLib2.Font.open(folder).groups[K1] == ["A", "Aacute"]


def entries(path: Path) -> dict[str, bytes]:
    with zipfile.ZipFile(path) as z:
        return {i.filename.split("/", 1)[1]: z.read(i) for i in z.infolist() if not i.is_dir()}


def test_ufoz_from_ufoz_changes_only_groups(ufoz, tmp_path):
    edit()
    out = tmp_path / "out" / "result.ufoz"
    api.build_ufoz(str(out))
    before, after = entries(ufoz), entries(out)
    assert before.keys() == after.keys()
    assert [k for k in before if before[k] != after[k]] == ["groups.plist"]
    with ufoLib2.Font.open(out) as font:
        assert font.groups[K1] == ["A", "Aacute"]


def test_ufoz_from_folder_keeps_every_file(folder, tmp_path):
    edit()
    out = tmp_path / "out" / "result.ufoz"
    api.build_ufoz(str(out))
    got = entries(out)
    on_disk = {
        str(p.relative_to(folder)): p.read_bytes() for p in folder.rglob("*") if p.is_file()
    }
    assert got.keys() == on_disk.keys()
    assert [k for k in got if got[k] != on_disk[k]] == ["groups.plist"]


def test_unchanged_ufoz_round_trips_contents(ufoz, tmp_path):
    out = tmp_path / "out" / "same.ufoz"
    api.build_ufoz(str(out))
    assert entries(out) == entries(ufoz)


def test_read_only_font_refuses_to_save(tmp_path):
    ufo2 = tmp_path / "v2.ufo"
    shutil.copytree(MUTATOR, ufo2)
    meta = ufo2 / "metainfo.plist"
    meta.write_text(meta.read_text().replace("<integer>3</integer>", "<integer>2</integer>"))
    api.open_font(str(ufo2))
    with pytest.raises(RuntimeError, match="read-only"):
        api.changed_files(str(tmp_path / "out"))
    api.close_font()
