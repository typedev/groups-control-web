# Vendored from Font-Rover font_rover/groups_control/copy_groups.py @ a052428 (Apache-2.0).
# Do not edit here: fix upstream, then run scripts/vendor_sync.py.
# Copyright 2024 Alexander Lubovenko
# Licensed under the Apache License, Version 2.0

"""
Copy the groups of one designspace UFO into the others.

The engine behind the Groups Control "Copy Groups" board script. Kerning
groups go through FontGroupsManager, so a target's kerning survives the change
of membership: every existing kern group is deleted first (its pairs flatten to
glyph pairs), then the master's groups are added (glyph pairs fold back into
group pairs). Other groups are replaced outright.

The unit is the UFO, not the master: groups and kerning belong to the UFO, and
every layer master stored in it shares them.

Computing a target's new groups and kerning touches no live font —
`process_font` takes plain dicts, so it runs in worker processes — and
`apply_result` writes the answer back in one step per dictionary.
"""

from __future__ import annotations

import logging
from collections.abc import Callable, Iterable
from concurrent.futures import ThreadPoolExecutor as ProcessPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

logger = logging.getLogger(__name__)

KERN_PREFIX = "public.kern"

#: More processes than this spend longer starting than they save.
MAX_WORKERS = 8


def is_kern_group(name: str) -> bool:
    return name.startswith(KERN_PREFIX)


def count_groups(font) -> tuple[int, int]:
    """(kern groups, other groups) of a font."""
    kern = sum(1 for name in font.groups.keys() if is_kern_group(name))
    return kern, len(font.groups) - kern


def unique_ufo_sources(entry) -> list:
    """One source per UFO of a designspace, in designspace order.

    A UFO holding several layer masters is represented by its default-layer
    master — the one whose font object owns the groups.
    """
    sources = []
    seen = set()
    for source in entry.sources:
        if source.path in seen:
            continue
        seen.add(source.path)
        sources.append(entry.get_source_by_path(source.path) or source)
    return sources


def other_ufo_fonts(entry, current) -> list:
    """The fonts of the designspace's other UFOs, one per file.

    For a script that offers "this UFO / all UFOs": ``current`` is the font
    the window shows; a UFO is matched by its resolved path.
    """
    if entry is None or current is None:
        return []
    path = getattr(current, "path", None)
    here = Path(path).resolve() if path else None
    fonts = []
    for source in unique_ufo_sources(entry):
        if source.font is None or source.path is None:
            continue
        if here is not None and Path(source.path).resolve() == here:
            continue
        fonts.append(source.font)
    return fonts


# ─────────────────────────────────────────────────────────────
# The per-font computation (runs in a worker process)
# ─────────────────────────────────────────────────────────────


class _RemovableDict(dict):
    """A dict with the RoboFont-style remove() FontGroupsManager calls."""

    def remove(self, key):
        if key in self:
            del self[key]


class FontProxy:
    """What FontGroupsManager needs of a font: groups, kerning, `name in font`."""

    def __init__(self, groups, kerning, glyph_names):
        self.groups = _RemovableDict(groups)
        self.kerning = _RemovableDict(kerning)
        self._glyph_names = frozenset(glyph_names)

    def __contains__(self, name):
        return name in self._glyph_names

    def __len__(self):
        return len(self._glyph_names)


def clean_kern_and_groups(font) -> list[str]:
    """Drop what kerning can no longer use; report every change.

    Removes missing glyphs from kern groups, empty kern groups, pairs whose
    side is neither a group nor a glyph, and pairs without a value. Zero pairs
    are kept (an explicit zero is an exception) and only counted.
    """
    report: list[str] = []

    for name, members in list(font.groups.items()):
        if not is_kern_group(name):
            continue
        missing = [g for g in members if g not in font]
        if missing:
            report.append(f"  [{name}] removing missing: {missing}")
            font.groups[name] = tuple(g for g in members if g not in missing)

    empty = [name for name, members in font.groups.items() if is_kern_group(name) and not members]
    for name in empty:
        report.append(f"  [empty group] removed: {name}")
        del font.groups[name]

    for left, right in list(font.kerning.keys()):
        if not ((left in font.groups or left in font) and (right in font.groups or right in font)):
            report.append(f"  [lost pair] ({left}, {right})")
            del font.kerning[(left, right)]

    for (left, right), value in list(font.kerning.items()):
        if not (left and right) or value is None:
            report.append(f"  [None kern] ({left}, {right})")
            del font.kerning[(left, right)]

    zero = sum(1 for value in font.kerning.values() if value == 0)
    if zero:
        report.append(f"  [zero kern] {zero} pair(s)")

    return report


def describe_changes(
    old_groups, new_groups, old_kerning, new_kerning
) -> tuple[list[str], list[str], str]:
    """What the copy did to one target, group by group.

    The step log only names the target's own kern groups (each is deleted
    before the master's are added), so a group that is new to the target, or
    one that disappeared from it, was never mentioned by name.

    Returns:
        (group lines, kerning lines, one-line summary) — the group lines are
        "+ name: members", "- name: members", "~ name: +gained -lost".
    """
    added = sorted(set(new_groups) - set(old_groups))
    removed = sorted(set(old_groups) - set(new_groups))
    changed = sorted(
        name
        for name in set(old_groups) & set(new_groups)
        if tuple(old_groups[name]) != tuple(new_groups[name])
    )
    unchanged = len(set(old_groups) & set(new_groups)) - len(changed)

    lines = []
    for name in added:
        lines.append(f"+ {name}: {' '.join(new_groups[name])}")
    for name in removed:
        lines.append(f"- {name}: {' '.join(old_groups[name])}")
    for name in changed:
        old, new = list(old_groups[name]), list(new_groups[name])
        gained = [g for g in new if g not in old]
        lost = [g for g in old if g not in new]
        parts = []
        if gained:
            parts.append("+" + " +".join(gained))
        if lost:
            parts.append("-" + " -".join(lost))
        if not parts:
            parts.append("order changed")
        lines.append(f"~ {name}: {' '.join(parts)}")

    pairs_added = set(new_kerning) - set(old_kerning)
    pairs_removed = set(old_kerning) - set(new_kerning)
    values_changed = sum(
        1 for pair in set(old_kerning) & set(new_kerning) if old_kerning[pair] != new_kerning[pair]
    )
    kerning_lines = [
        f"kerning: +{len(pairs_added)} pair(s), -{len(pairs_removed)} pair(s), "
        f"{values_changed} value(s) changed"
    ]
    for pair in sorted(pairs_added):
        kerning_lines.append(f"  + {pair[0]} {pair[1]} = {new_kerning[pair]}")
    for pair in sorted(pairs_removed):
        kerning_lines.append(f"  - {pair[0]} {pair[1]} = {old_kerning[pair]}")

    summary = (
        f"groups +{len(added)} -{len(removed)} ~{len(changed)} (={unchanged}), "
        f"pairs +{len(pairs_added)} -{len(pairs_removed)}"
    )
    return lines, kerning_lines, summary


def process_font(
    font_name,
    groups,
    kerning,
    glyph_names,
    master_kern_groups,
    master_other_groups,
    *,
    replace_kern=True,
    replace_other=True,
):
    """A target's groups and kerning after taking the master's groups.

    Plain data in, plain data out, so it can run in another process.

    Args:
        replace_kern: Replace the target's kern groups with the master's.
            Off, the kern groups and the kerning are left exactly as they are.
        replace_other: Replace the target's other groups with the master's.

    Returns:
        (new_groups, new_kerning, log_lines, report) — report holds the
        one-line "summary", the "groups" lines of describe_changes, and
        "skipped": {group: [glyphs]} a kern group could not take because the
        glyph was already in another group of the same side.
    """
    from ufo_spacing_lib import FontGroupsManager

    old_groups = {name: tuple(members) for name, members in groups.items()}
    old_kerning = dict(kerning)
    proxy = FontProxy(groups, kerning, glyph_names)
    kern_n, other_n = count_groups(proxy)
    log = [
        f"Processing: {font_name}",
        f"  glyphs: {len(proxy)}",
        f"  before: {kern_n} kern groups, {other_n} other groups, {len(proxy.kerning)} pairs",
    ]

    manager = FontGroupsManager(proxy)
    skipped_by_group: dict[str, list[str]] = {}
    if replace_kern:
        _replace_kern_groups(manager, proxy, master_kern_groups, log, skipped_by_group)
    if replace_other:
        _replace_other_groups(manager, proxy, master_other_groups, log)
    if replace_kern:
        # Only when the kern side was rewritten: otherwise the kerning the
        # caller asked to leave alone is not ours to clean.
        log.extend(clean_kern_and_groups(proxy))

    kern_n, other_n = count_groups(proxy)
    log.append(f"  after: {kern_n} kern groups, {other_n} other groups, {len(proxy.kerning)} pairs")

    new_groups, new_kerning = dict(proxy.groups), dict(proxy.kerning)
    group_lines, kerning_lines, summary = describe_changes(
        old_groups, new_groups, old_kerning, new_kerning
    )
    log.append("  groups:")
    log.extend("    " + line for line in group_lines or ["(no change)"])
    log.append(f"    {summary}")
    log.extend("  " + line for line in kerning_lines)
    report = {"summary": summary, "groups": group_lines, "skipped": skipped_by_group}
    return new_groups, new_kerning, log, report


def _replace_kern_groups(manager, proxy, master_kern_groups, log, skipped_by_group) -> None:
    """Delete the target's kern groups, then add the master's, kerning carried."""
    # Delete the target's own (pairs flatten to glyph pairs) ...
    for name in [g for g in proxy.groups.keys() if manager.is_kerning_group(g)]:
        new_pairs, deleted_pairs = manager.delete_group(name)
        log.append(
            f"  delete_group({name}): new_pairs={len(new_pairs)}, deleted_pairs={len(deleted_pairs)}"
        )
    log.append(f"  after group deletion: {len(proxy.kerning)} flat pairs")

    # ... then add the master's (glyph pairs fold back into group pairs).
    skipped_n = new_n = deleted_n = 0
    for name, members in master_kern_groups.items():
        skipped, new_pairs, deleted_pairs = manager.add_glyphs_to_group(name, list(members))
        skipped_n += len(skipped)
        new_n += len(new_pairs)
        deleted_n += len(deleted_pairs)
        if skipped:
            skipped_by_group[name] = list(skipped)
            log.append(f"  add_glyphs_to_group({name}): skipped={skipped}")
    log.append(
        f"  kern groups applied: {len(master_kern_groups)} "
        f"(skipped_glyphs={skipped_n}, new_pairs={new_n}, deleted_pairs={deleted_n})"
    )


def _replace_other_groups(manager, proxy, master_other_groups, log) -> None:
    """Other groups carry no kerning: replace them outright."""
    others = [g for g in proxy.groups.keys() if not manager.is_kerning_group(g)]
    for name in others:
        del proxy.groups[name]
    log.append(f"  deleted {len(others)} non-kern groups")
    for name, members in master_other_groups.items():
        proxy.groups[name] = tuple(members)
    log.append(f"  copied {len(master_other_groups)} non-kern groups from master")


def _quiet_worker() -> None:
    """Pool initializer: silence logging in a worker process.

    FontGroupsManager logs every step at debug level, and several processes
    writing to the application's rotating log file broke its rollover. Never
    called in-process — there it would silence the whole application.
    """
    logging.disable(logging.CRITICAL)


# ─────────────────────────────────────────────────────────────
# The whole copy
# ─────────────────────────────────────────────────────────────


@dataclass
class TargetResult:
    """The outcome for one target UFO."""

    name: str
    groups: dict | None = None
    kerning: dict | None = None
    log: list[str] = field(default_factory=list)
    summary: str = ""
    #: Groups by name: "+ new: …", "- gone: …", "~ changed: +gained -lost".
    group_changes: list[str] = field(default_factory=list)
    error: str | None = None

    @property
    def ok(self) -> bool:
        return self.error is None


def split_groups(font) -> tuple[dict, dict]:
    """The master's groups as (kern groups, other groups)."""
    kern: dict[str, tuple] = {}
    other: dict[str, tuple] = {}
    for name, members in font.groups.items():
        (kern if is_kern_group(name) else other)[name] = tuple(members)
    return kern, other


def snapshot(name: str, font) -> tuple:
    """A target reduced to what `process_font` reads."""
    return name, dict(font.groups), dict(font.kerning), frozenset(font.keys())


def compute(
    master_font,
    targets: Iterable[tuple[str, object]],
    *,
    parallel: bool = True,
    progress: Callable[[str], None] | None = None,
) -> list[TargetResult]:
    """New groups and kerning for every target. Writes nothing.

    Args:
        master_font: The font whose groups are copied.
        targets: (name, font) pairs.
        parallel: Spread the targets over worker processes. Falls back to
            running them here when the pool cannot start.
        progress: Called with one line per finished target.
    """
    kern, other = split_groups(master_font)
    data = [snapshot(name, font) for name, font in targets]
    results: dict[int, TargetResult] = {}
    say = progress or (lambda _line: None)

    def finish(index, outcome=None, error=None):
        name = data[index][0]
        if error is not None:
            results[index] = TargetResult(name, error=str(error))
            say(f"[{len(results)}/{len(data)}] {name} — ERROR: {error}")
            return
        groups, kerning, log, report = outcome
        results[index] = TargetResult(
            name, groups, kerning, log, report["summary"], report["groups"]
        )
        say(f"[{len(results)}/{len(data)}] {name} — done")

    if parallel and len(data) > 1:
        import multiprocessing

        try:
            with ProcessPoolExecutor(
                max_workers=min(MAX_WORKERS, len(data)),
                mp_context=multiprocessing.get_context("spawn"),
                initializer=_quiet_worker,
            ) as pool:
                futures = {
                    pool.submit(process_font, *item, kern, other): index
                    for index, item in enumerate(data)
                }
                for future in as_completed(futures):
                    try:
                        finish(futures[future], future.result())
                    except Exception as error:
                        finish(futures[future], error=error)
        except Exception as error:
            logger.warning("Copy Groups: process pool failed (%s), running in-process", error)
            say(f"Parallel run failed: {error}; continuing one by one")

    for index, item in enumerate(data):
        if index in results:
            continue
        try:
            finish(index, process_font(*item, kern, other))
        except Exception as error:
            finish(index, error=error)

    return [results[index] for index in range(len(data))]


def apply_result(font, result: TargetResult) -> None:
    """Write a computed result into a live font: one clear and one update each."""
    font.groups.clear()
    font.groups.update(result.groups)
    font.kerning.clear()
    font.kerning.update(result.kerning)


def write_logs(
    designspace_path: Path, master_name: str, results: list[TargetResult]
) -> Path | None:
    """Per-target logs and a main.log in `<designspace dir>/logs/copyGroups_<time>/`."""
    now = datetime.now()
    session_dir = designspace_path.parent / "logs" / f"copyGroups_{now:%Y-%m-%d_%H-%M-%S}"
    try:
        session_dir.mkdir(parents=True, exist_ok=True)
    except OSError as error:
        logger.warning("Copy Groups: cannot create %s: %s", session_dir, error)
        return None

    main = [f"Copy Groups — {now:%Y-%m-%d %H:%M:%S}", f"Master: {master_name}", ""]
    for result in results:
        lines = result.log if result.ok else [f"ERROR: {result.error}"]
        try:
            (session_dir / f"{Path(result.name).stem}.log").write_text(
                "\n".join(lines), encoding="utf-8"
            )
        except OSError as error:
            logger.warning("Copy Groups: cannot write log for %s: %s", result.name, error)
        main += ["=" * 60, result.name, *lines, ""]
    try:
        (session_dir / "main.log").write_text("\n".join(main), encoding="utf-8")
    except OSError as error:
        logger.warning("Copy Groups: cannot write main.log: %s", error)
    return session_dir
