"""Download the pinned pure-Python wheels the worker installs.

Pins come from pyproject.toml (`name==version` entries). Packages that ship
with Pyodide (fonttools, attrs) are loaded from the Pyodide distribution and
are not fetched here. Writes public/wheels/*.whl and manifest.json; sha256 is
checked against PyPI.

    uv run python scripts/fetch_wheels.py
"""

from __future__ import annotations

import hashlib
import json
import tomllib
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "wheels"


def pins() -> list[tuple[str, str]]:
    deps = tomllib.loads((ROOT / "pyproject.toml").read_text())["project"]["dependencies"]
    return [tuple(d.split("==")) for d in deps if "==" in d]


def fetch(name: str, version: str) -> str:
    meta = json.load(urllib.request.urlopen(f"https://pypi.org/pypi/{name}/{version}/json"))
    wheel = next(u for u in meta["urls"] if u["filename"].endswith("-py3-none-any.whl"))
    data = urllib.request.urlopen(wheel["url"]).read()
    if hashlib.sha256(data).hexdigest() != wheel["digests"]["sha256"]:
        raise SystemExit(f"sha256 mismatch for {wheel['filename']}")
    (OUT / wheel["filename"]).write_bytes(data)
    return wheel["filename"]


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("*.whl"):
        old.unlink()
    files = [fetch(name, version) for name, version in pins()]
    (OUT / "manifest.json").write_text(json.dumps({"wheels": files}, indent=2) + "\n")
    print("\n".join(files))


if __name__ == "__main__":
    main()
