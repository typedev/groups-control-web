# Vendored from Font-Rover font_rover/groups_control/clean_kerning.py @ a052428 (Apache-2.0).
# Do not edit here: fix upstream, then run scripts/vendor_sync.py.
# Copyright 2026 Alexander Lubovenko
# Licensed under the Apache License, Version 2.0

"""
Clean kerning groups and kerning of one UFO.

The engine behind the *Clean Groups & Kerning* board script, ported from
KernTool4's ``clearingKernAndGroups``. It finds, inside one UFO:

- members of kerning groups the font does not have, and members listed twice;
- kerning groups left empty (already, or once those members are gone);
- *malformed* pairs: a group of the other side on a side
  (``public.kern2.V`` on the left). fontParts refuses the whole kerning of a
  font holding one (``font.kerning.keys()`` raises), so they are read and
  removed through defcon, before anything else;
- *lost* pairs: a side names a glyph the font does not have, or a group that
  does not exist or ends up empty;
- pairs without a value;
- zero pairs. A zero pair that overrides a non-zero group pair is an
  exception doing its job (``Aacute V`` at 0 against ``@A @V`` at -80) and is
  only listed; one that overrides nothing does nothing and may be removed.

designspace-lint compares groups *between* masters; this is the check inside
one. GTK-free: planning reads the font, applying goes through a
FontGroupsManager (groups) and the caller's pair removal (kerning), so the
UFO Groups Control shows gets its undo step for the pairs.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Iterable

logger = logging.getLogger(__name__)

KERN1 = "public.kern1."
KERN2 = "public.kern2."


@dataclass
class CleanPlan:
    """What cleaning one UFO would change."""

    missing_members: dict[str, tuple[str, ...]] = field(default_factory=dict)
    duplicate_members: dict[str, tuple[str, ...]] = field(default_factory=dict)
    empty_groups: list[str] = field(default_factory=list)
    malformed_pairs: list[tuple[str, str]] = field(default_factory=list)
    lost_pairs: list[tuple[tuple[str, str], str]] = field(default_factory=list)  # (pair, why)
    valueless_pairs: list[tuple[str, str]] = field(default_factory=list)
    idle_zero_pairs: list[tuple[str, str]] = field(default_factory=list)  # override nothing
    zero_exceptions: list[tuple[str, str]] = field(default_factory=list)  # listed only

    def pairs_to_remove(self, remove_idle_zeros: bool) -> list[tuple[str, str]]:
        pairs = [pair for pair, _why in self.lost_pairs] + list(self.valueless_pairs)
        if remove_idle_zeros:
            pairs += self.idle_zero_pairs
        return pairs

    def is_clean(self, remove_idle_zeros: bool) -> bool:
        return not (
            self.missing_members
            or self.duplicate_members
            or self.empty_groups
            or self.malformed_pairs
            or self.pairs_to_remove(remove_idle_zeros)
        )


def raw_kerning(font: Any) -> Any:
    """The kerning as stored (defcon), which fontParts' checks do not guard."""
    return font.naked().kerning if hasattr(font, "naked") else font.kerning


def _is_kern_group(name: str) -> bool:
    return name.startswith((KERN1, KERN2))


def plan_clean(font: Any) -> CleanPlan:
    """Look for everything :class:`CleanPlan` describes in one UFO."""
    plan = CleanPlan()
    groups = {name: tuple(members) for name, members in font.groups.items()}
    remaining: dict[str, tuple[str, ...]] = {}
    for name, members in groups.items():
        if not _is_kern_group(name):
            continue
        missing = tuple(dict.fromkeys(g for g in members if g not in font))
        seen: set[str] = set()
        twice = []
        for glyph in members:
            if glyph in seen and glyph not in twice:
                twice.append(glyph)
            seen.add(glyph)
        if missing:
            plan.missing_members[name] = missing
        if twice:
            plan.duplicate_members[name] = tuple(twice)
        kept = tuple(dict.fromkeys(g for g in members if g not in missing))
        remaining[name] = kept
        if not kept:
            plan.empty_groups.append(name)
    plan.empty_groups.sort()

    # Which group each glyph kerns with, per side, after the cleanup.
    group_of = side_group_maps(remaining)

    kerning = raw_kerning(font)
    for pair in sorted(kerning.keys()):
        value = kerning[pair]
        if pair[0].startswith(KERN2) or pair[1].startswith(KERN1):
            plan.malformed_pairs.append(pair)
            continue
        why = _lost_reason(font, pair, remaining)
        if why:
            plan.lost_pairs.append((pair, why))
        elif value is None:
            plan.valueless_pairs.append(pair)
        elif value == 0:
            if overrides_nonzero_pair(pair, kerning, group_of):
                plan.zero_exceptions.append(pair)
            else:
                plan.idle_zero_pairs.append(pair)
    return plan


def _lost_reason(font: Any, pair: tuple[str, str], remaining: dict) -> str:
    for index, (name, own) in enumerate(((pair[0], KERN1), (pair[1], KERN2))):
        side = "left" if index == 0 else "right"
        if name.startswith(own):
            if name not in remaining:
                return "%s group does not exist" % side
            if not remaining[name]:
                return "%s group is empty" % side
        elif name not in font:
            return "%s glyph is not in the font" % side
    return ""


def side_group_maps(groups: Any) -> tuple[dict[str, str], dict[str, str]]:
    """(glyph → side-1 group, glyph → side-2 group) of a groups mapping."""
    group_of: tuple[dict[str, str], dict[str, str]] = ({}, {})
    for name, members in groups.items():
        if not _is_kern_group(name):
            continue
        index = 0 if name.startswith(KERN1) else 1
        for glyph in members:
            group_of[index].setdefault(glyph, name)
    return group_of


def overrides_nonzero_pair(pair, kerning, group_of) -> bool:
    """True if some pair this one takes precedence over has a non-zero value.

    ``kerning`` is anything with ``.get`` (the kerning, or values about to be
    written); ``group_of`` comes from :func:`side_group_maps`. A zero pair for
    which this is True is an exception doing its job and must stay.
    """
    left, right = pair
    lefts = [left]
    rights = [right]
    if not left.startswith(KERN1) and left in group_of[0]:
        lefts.append(group_of[0][left])
    if not right.startswith(KERN2) and right in group_of[1]:
        rights.append(group_of[1][right])
    for key in ((a, b) for a in lefts for b in rights):
        if key != pair and kerning.get(key) not in (None, 0):
            return True
    return False


def remove_malformed(font: Any, plan: CleanPlan) -> int:
    """Delete the malformed pairs through defcon (fontParts cannot).

    No undo: nothing that records one can hold such a key. Main thread only
    when the font is on screen.
    """
    kerning = raw_kerning(font)
    gone = [pair for pair in plan.malformed_pairs if pair in kerning]
    for pair in gone:
        del kerning[pair]
    return len(gone)


def apply_groups(font: Any, manager: Any, plan: CleanPlan) -> None:
    """The group half of a plan: members out, duplicates folded, empties gone.

    Missing members and empty groups go through the manager, so the groups
    journal records them; a duplicate is folded in place (membership, and so
    the manager's reverse map, does not change). Main thread only when the
    font is on screen.
    """
    for name in plan.duplicate_members:
        if name in font.groups:
            font.groups[name] = tuple(dict.fromkeys(font.groups[name]))
    for name, glyphs in plan.missing_members.items():
        manager.remove_glyphs_from_group(name, list(glyphs), check_kerning=False)
    for name in plan.empty_groups:
        if name in font.groups:
            # The group's pairs are lost pairs of the plan: the manager drops
            # them here, and the pair removal that follows skips them.
            manager.delete_group(name, check_kerning=False)
    logger.info(
        "Clean groups: %d group(s) trimmed, %d folded, %d deleted in %s",
        len(plan.missing_members),
        len(plan.duplicate_members),
        len(plan.empty_groups),
        getattr(font, "path", None),
    )


def summary_lines(plan: CleanPlan, remove_idle_zeros: bool) -> list[str]:
    """One line per kind of finding, with its count (kinds with none left out)."""
    rows = [
        ("glyph(s) missing from the font, taken out of groups", _count(plan.missing_members)),
        ("glyph(s) listed twice in a group, folded", _count(plan.duplicate_members)),
        ("empty group(s), deleted", len(plan.empty_groups)),
        ("malformed pair(s) (a group on the wrong side), removed", len(plan.malformed_pairs)),
        ("lost pair(s), removed", len(plan.lost_pairs)),
        ("pair(s) without a value, removed", len(plan.valueless_pairs)),
        (
            "zero pair(s) overriding nothing, %s" % ("removed" if remove_idle_zeros else "listed"),
            len(plan.idle_zero_pairs),
        ),
        ("zero exception(s), listed (they override a non-zero pair)", len(plan.zero_exceptions)),
    ]
    return ["%d %s" % (count, text) for text, count in rows if count]


def _count(mapping: dict) -> int:
    return sum(len(value) for value in mapping.values())


def detail_lines(plan: CleanPlan) -> list[str]:
    """Everything the plan found, for the output."""
    from .cross_pairs import side_label

    lines: list[str] = []

    def section(title: str, items: Iterable[str]) -> None:
        items = list(items)
        if items:
            lines.append(title)
            lines.extend("  " + item for item in items)

    section(
        "Missing from the font:",
        ("%s: %s" % (side_label(g), ", ".join(n)) for g, n in plan.missing_members.items()),
    )
    section(
        "Listed twice:",
        ("%s: %s" % (side_label(g), ", ".join(n)) for g, n in plan.duplicate_members.items()),
    )
    section("Empty groups:", (side_label(g) for g in plan.empty_groups))
    section(
        "Malformed pairs:",
        ("%s %s" % (side_label(p[0]), side_label(p[1])) for p in plan.malformed_pairs),
    )
    section(
        "Lost pairs:",
        ("%s %s — %s" % (side_label(p[0]), side_label(p[1]), why) for p, why in plan.lost_pairs),
    )
    section(
        "Pairs without a value:",
        ("%s %s" % (side_label(p[0]), side_label(p[1])) for p in plan.valueless_pairs),
    )
    section(
        "Zero pairs overriding nothing:",
        ("%s %s" % (side_label(p[0]), side_label(p[1])) for p in plan.idle_zero_pairs),
    )
    section(
        "Zero exceptions (kept):",
        ("%s %s" % (side_label(p[0]), side_label(p[1])) for p in plan.zero_exceptions),
    )
    return lines
