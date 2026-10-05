"""Copy GTK-free Font-Rover modules into py/gcweb/vendor/.

Font-Rover (~/WORK/Font-Rover, Apache-2.0) is read-only from this repo: fix
bugs there first, then re-run this script. Each copied file gets a header
naming its source path and the Font-Rover commit.

    uv run python scripts/vendor_sync.py [path/to/Font-Rover]
"""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEST = ROOT / "py" / "gcweb" / "vendor"

# (source relative to Font-Rover, destination name, [(old, new), ...])
FILES = [
    ("font_rover/languages/charsets.py", "charsets.py", [
        (
            '_DATA_PATH = Path(__file__).parent.parent / "data" / "language_charsets.json"',
            '_DATA_PATH = Path(__file__).parent / "language_charsets.json"',
        ),
    ]),
    ("font_rover/languages/compat.py", "compat.py", []),
    ("font_rover/groups_control/naming.py", "naming.py", []),
    ("font_rover/groups_control/dependencies.py", "dependencies.py", [
        ("from ..languages.compat import glyph_codepoint", "from .compat import glyph_codepoint"),
        # Font-Rover's utils pull in GLib / designspace_lint; gcweb.fr_font
        # provides the same functions over ufoLib2.
        ("from ..utils.glyph_order import safe_glyph_order", "from gcweb.fr_font import safe_glyph_order"),
        (
            "from ..utils.margin_edit import same_margin, side_margin  # noqa: F401 (re-exported)",
            "from gcweb.fr_font import same_margin, side_margin  # noqa: F401 (re-exported)",
        ),
    ]),
    ("font_rover/groups_control/groups_history.py", "groups_history.py", []),
    ("font_rover/groups_control/groups_io.py", "groups_io.py", []),
    ("font_rover/groups_control/copy_groups.py", "copy_groups.py", [
        # No processes in Pyodide; threads keep the API (and run serially there).
        (
            "from concurrent.futures import ProcessPoolExecutor, as_completed",
            "from concurrent.futures import ThreadPoolExecutor as ProcessPoolExecutor, as_completed",
        ),
    ]),
]
# Engines of the Tools menu (Phase 7). All GTK-free; imports fixed by COMMON.
for _engine in (
    "clean_kerning", "key_glyphs", "flatten_kerning", "merge_script_groups",
    "place_composites", "place_ligatures", "cross_pairs", "rename_groups",
    "round_kerning", "split_groups",
):
    FILES.append((f"font_rover/groups_control/{_engine}.py", f"{_engine}.py", []))

# Applied to every vendored file where the text occurs.
COMMON = [
    ("from ..languages.compat import", "from .compat import"),
    ("from ..utils.glyph_order import safe_glyph_order", "from gcweb.fr_font import safe_glyph_order"),
]

DATA = [("font_rover/data/language_charsets.json", "language_charsets.json")]

HEADER = (
    "# Vendored from Font-Rover {path} @ {commit} (Apache-2.0).\n"
    "# Do not edit here: fix upstream, then run scripts/vendor_sync.py.\n"
)


def main() -> None:
    src_root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.home() / "WORK/Font-Rover"
    commit = subprocess.run(
        ["git", "-C", str(src_root), "rev-parse", "--short", "HEAD"],
        check=True, capture_output=True, text=True,
    ).stdout.strip()
    DEST.mkdir(parents=True, exist_ok=True)
    (DEST / "__init__.py").write_text(
        '"""Modules vendored from Font-Rover; see scripts/vendor_sync.py."""\n'
    )
    for rel, name, replacements in FILES:
        text = (src_root / rel).read_text()
        for old, new in replacements:
            if old not in text:
                raise SystemExit(f"{rel}: expected text not found: {old!r}")
            text = text.replace(old, new)
        for old, new in COMMON:
            text = text.replace(old, new)
        if "from .." in text:
            raise SystemExit(f"{rel}: an import still leaves the package: fix COMMON")
        (DEST / name).write_text(HEADER.format(path=rel, commit=commit) + text)
        print(f"{rel} -> vendor/{name}")
    for rel, name in DATA:
        shutil.copyfile(src_root / rel, DEST / name)
        print(f"{rel} -> vendor/{name}")
    (DEST / "SOURCE").write_text(f"Font-Rover {commit}\n")


if __name__ == "__main__":
    main()
