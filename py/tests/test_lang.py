"""Lang column statuses on a small synthetic font."""

from __future__ import annotations

import shutil
from pathlib import Path

import ufoLib2

from gcweb.document import UfoDocument
from gcweb.lang import LangChecker
from gcweb.vendor.compat import PAIR_LANGUAGE_CROSS, PAIR_SCRIPT_CROSS, PAIR_SCRIPT_PARTIAL

MUTATOR = Path(__file__).resolve().parents[2] / "fixtures" / "MutatorSans" / "MutatorSansLightCondensed.ufo"


def make_doc(tmp_path) -> UfoDocument:
    path = tmp_path / "t.ufo"
    shutil.copytree(MUTATOR, path)
    font = ufoLib2.Font.open(path)
    for name, cp in (("afii10017", 0x0410), ("afii10018", 0x0411), ("alpha", 0x03B1)):
        font.newGlyph(name).unicodes = [cp]
    font.groups["public.kern1.mixed"] = ["V", "afii10017"]
    font.save(path, overwrite=True)
    return UfoDocument(str(path))


def test_flags_cross_script_pairs(tmp_path):
    doc = make_doc(tmp_path)
    checker = LangChecker(doc)
    flagged = {
        (l, r): (status, note)
        for l, r, status, note in checker.flagged(
            [("A", "afii10018"), ("A", "V"), ("public.kern1.mixed", "A"), ("alpha", "afii10017")]
        )
    }
    assert flagged[("A", "afii10018")][0] == PAIR_SCRIPT_CROSS
    assert flagged[("A", "afii10018")][1].startswith("Different scripts: Latn")
    assert ("A", "V") not in flagged
    assert flagged[("public.kern1.mixed", "A")][0] == PAIR_SCRIPT_PARTIAL
    assert "afii10017" in flagged[("public.kern1.mixed", "A")][1]
    assert flagged[("alpha", "afii10017")][0] == PAIR_SCRIPT_CROSS
    assert PAIR_LANGUAGE_CROSS == 1
