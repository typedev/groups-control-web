"""Raise the version: package.json, pyproject.toml and the CHANGELOG together.

    uv run python scripts/bump_version.py patch|minor|major   # or an exact 1.2.3

The CHANGELOG's "Unreleased" section becomes the new version with today's
date and an empty "Unreleased" is put above it. Commit, push and tag yourself
(e.g. `git tag v0.1.1 && git push --tags`).
"""

from __future__ import annotations

import datetime
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def bumped(current: str, how: str) -> str:
    if re.fullmatch(r"\d+\.\d+\.\d+", how):
        return how
    major, minor, patch = map(int, current.split("."))
    if how == "major":
        return f"{major + 1}.0.0"
    if how == "minor":
        return f"{major}.{minor + 1}.0"
    if how == "patch":
        return f"{major}.{minor}.{patch + 1}"
    raise SystemExit("usage: bump_version.py patch|minor|major|X.Y.Z")


def main() -> None:
    package = ROOT / "package.json"
    data = json.loads(package.read_text())
    new = bumped(data["version"], sys.argv[1] if len(sys.argv) > 1 else "")

    text = package.read_text()
    package.write_text(re.sub(r'("version":\s*")[^"]+(")', rf"\g<1>{new}\g<2>", text, count=1))

    pyproject = ROOT / "pyproject.toml"
    pyproject.write_text(
        re.sub(r'(?m)^version = "[^"]+"', f'version = "{new}"', pyproject.read_text(), count=1)
    )

    lock = ROOT / "package-lock.json"
    if lock.exists():
        lock_data = lock.read_text()
        # The root package entry appears twice in a v3 lockfile.
        lock_data = re.sub(r'("name":\s*"groups-control-web",\s*"version":\s*")[^"]+(")', rf"\g<1>{new}\g<2>", lock_data)
        lock.write_text(lock_data)

    changelog = ROOT / "CHANGELOG.md"
    today = datetime.date.today().isoformat()
    log = changelog.read_text()
    if "## [Unreleased]" not in log:
        raise SystemExit("CHANGELOG.md has no [Unreleased] section")
    log = log.replace("## [Unreleased]", f"## [Unreleased]\n\n## [{new}] — {today}", 1)
    changelog.write_text(log)
    # uv.lock records the project version too.
    subprocess.run(["uv", "lock", "--quiet"], cwd=ROOT, check=False)
    print(f"{data['version']} -> {new}")


if __name__ == "__main__":
    main()
