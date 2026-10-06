"""package.json and pyproject.toml carry the same version."""

import json
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def test_versions_match():
    package = json.loads((ROOT / "package.json").read_text())["version"]
    pyproject = tomllib.loads((ROOT / "pyproject.toml").read_text())["project"]["version"]
    assert package == pyproject


def test_changelog_has_this_version():
    version = json.loads((ROOT / "package.json").read_text())["version"]
    assert f"## [{version}]" in (ROOT / "CHANGELOG.md").read_text()
