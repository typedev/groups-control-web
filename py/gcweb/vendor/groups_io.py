# Vendored from Font-Rover font_rover/groups_control/groups_io.py @ a052428 (Apache-2.0).
# Do not edit here: fix upstream, then run scripts/vendor_sync.py.
# Copyright 2024 Alexander Lubovenko
# Licensed under the Apache License, Version 2.0

"""
Import and export the groups of one UFO for Groups Control.

The text format is KernTool4's, so files go both ways between the two tools:
one group per line, ``name=glyph1,glyph2``, sorted by group name, glyphs in
group order, no header.

Import *replaces* groups — the kern groups, the other groups, or both — with
those of a text file or another UFO. Kerning follows the new membership
through the same FontGroupsManager path Copy Groups uses: the replaced kern
groups flatten their pairs to glyph pairs, the imported groups fold them back.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .copy_groups import TargetResult, is_kern_group, process_font, snapshot

SCOPE_KERN = "kern"
SCOPE_OTHER = "other"
SCOPE_ALL = "all"
SCOPES = (SCOPE_KERN, SCOPE_OTHER, SCOPE_ALL)

SCOPE_LABELS = {
    SCOPE_KERN: "Kerning groups",
    SCOPE_OTHER: "Other groups",
    SCOPE_ALL: "All groups",
}


def in_scope(name: str, scope: str) -> bool:
    if scope == SCOPE_KERN:
        return is_kern_group(name)
    if scope == SCOPE_OTHER:
        return not is_kern_group(name)
    return True


def filter_scope(groups, scope: str) -> dict[str, tuple]:
    """The groups a scope covers, as {name: tuple(members)}."""
    return {name: tuple(members) for name, members in groups.items() if in_scope(name, scope)}


# ─────────────────────────────────────────────────────────────
# Text format
# ─────────────────────────────────────────────────────────────


def format_groups(groups, scope: str = SCOPE_ALL) -> str:
    """The groups as KernTool4 text: ``name=g1,g2`` per line, sorted by name."""
    chosen = filter_scope(groups, scope)
    return "".join(f"{name}={','.join(chosen[name])}\n" for name in sorted(chosen))


def parse_groups(text: str) -> tuple[dict[str, tuple], list[str]]:
    """Groups from KernTool4 text, and a note for every line not taken as is.

    A little more forgiving than KernTool4: blank lines and ``#`` comments are
    skipped, the name ends at the first ``=``, and spaces around names are
    dropped. A group named twice keeps its last line.
    """
    groups: dict[str, tuple] = {}
    problems: list[str] = []
    for number, raw in enumerate(text.splitlines(), start=1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        name, sep, members = line.partition("=")
        name = name.strip()
        if not sep or not name:
            problems.append(f"line {number}: not 'name=glyph,glyph': {line}")
            continue
        if name in groups:
            problems.append(f"line {number}: {name} listed again, this line wins")
        groups[name] = tuple(g for g in (m.strip() for m in members.split(",")) if g)
    return groups, problems


# ─────────────────────────────────────────────────────────────
# Import
# ─────────────────────────────────────────────────────────────


@dataclass
class ImportReport:
    """What an import did to one UFO."""

    result: TargetResult
    #: Glyphs the source listed that the font does not have, by group.
    missing: dict[str, list[str]] = field(default_factory=dict)
    #: Source groups not created because none of their glyphs is in the font.
    dropped: list[str] = field(default_factory=list)
    #: Glyphs a kern group could not take: already in another group of that side.
    skipped: dict[str, list[str]] = field(default_factory=dict)
    #: Notes from reading the source (text-file lines not taken as is).
    problems: list[str] = field(default_factory=list)
    #: How many source groups the scope covered.
    imported: int = 0
    #: Source groups of the other kind, not imported under this scope.
    out_of_scope: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return self.result.ok


def import_groups(font, source_groups, scope: str, *, name: str = "", problems=()) -> ImportReport:
    """The font's groups and kerning after replacing the scoped groups. Writes nothing.

    Apply with ``copy_groups.apply_result(font, report.result)``.
    """
    if scope not in SCOPES:
        raise ValueError(f"unknown scope: {scope!r}")

    chosen = filter_scope(source_groups, scope)
    glyphs = set(font.keys())
    missing: dict[str, list[str]] = {}
    dropped: list[str] = []
    kern: dict[str, tuple] = {}
    other: dict[str, tuple] = {}
    for group, members in chosen.items():
        present = tuple(g for g in members if g in glyphs)
        absent = [g for g in members if g not in glyphs]
        if absent:
            missing[group] = absent
        if members and not present:
            dropped.append(group)
            continue
        (kern if is_kern_group(group) else other)[group] = present

    label, groups, kerning, names = snapshot(name or str(getattr(font, "path", "") or ""), font)
    new_groups, new_kerning, log, report = process_font(
        label,
        groups,
        kerning,
        names,
        kern,
        other,
        replace_kern=scope != SCOPE_OTHER,
        replace_other=scope != SCOPE_KERN,
    )
    result = TargetResult(label, new_groups, new_kerning, log, report["summary"], report["groups"])
    return ImportReport(
        result=result,
        missing=missing,
        dropped=dropped,
        skipped=report["skipped"],
        problems=list(problems),
        imported=len(kern) + len(other),
        out_of_scope=sorted(set(source_groups) - set(chosen)),
    )


def report_lines(report: ImportReport) -> list[str]:
    """The report as lines for a result dialog: changes first, then the notes."""
    lines = list(report.result.group_changes) or ["No group changed."]
    if report.dropped:
        lines.append("")
        lines.append("Not created — none of their glyphs is in the font:")
        lines.extend(f"  {group}" for group in report.dropped)
    if report.missing:
        lines.append("")
        lines.append("Glyphs not in the font, left out:")
        lines.extend(f"  {group}: {' '.join(glyphs)}" for group, glyphs in report.missing.items())
    if report.skipped:
        lines.append("")
        lines.append("Already in another group of the same side, left out:")
        lines.extend(f"  {group}: {' '.join(glyphs)}" for group, glyphs in report.skipped.items())
    if report.out_of_scope:
        lines.append("")
        lines.append(f"Outside the chosen groups, not imported ({len(report.out_of_scope)}):")
        lines.extend(f"  {group}" for group in report.out_of_scope)
    if report.problems:
        lines.append("")
        lines.append("Lines in the file not taken as they are:")
        lines.extend(f"  {problem}" for problem in report.problems)
    return lines
