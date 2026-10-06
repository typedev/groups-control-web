# Vendored from Font-Rover font_rover/groups_control/copy_kerning.py @ a052428 (Apache-2.0).
# Do not edit here: fix upstream, then run scripts/vendor_sync.py.
# Copyright 2026 Alexander Lubovenko
# Licensed under the Apache License, Version 2.0

"""
Copy the kerning of some glyphs from one UFO into others.

The engine behind the *Copy Kerning of Glyphs* board script, generalised from
KernTool4's ``batchCopyKerning``. That script took the glyphs a new version
of a font had and an old one did not, and copied their pairs into a folder of
other UFOs. Here the glyphs are any list — selected, typed, or "new compared
with another UFO" — and the targets are the other UFOs of the designspace or
other open fonts.

The pairs of a glyph are every kerning key with the glyph on a side — and,
with ``with_groups`` (KernTool4's way, the default), every key with the group
holding it on that side: for ``Aogonek`` in ``@A`` (side 1), ``Aogonek V``,
``@A V`` and ``@A @V``. A group pair kerns every member of the group in the
target, not only the glyphs asked for. A pair is copied only where the
target lacks it — an existing value is never overwritten, only counted — and
only if the target has every side it names (the glyph, or a group of that
name). Compared with an old version (KernTool4's case), a pair the old
version already had is not new and is left out.

GTK-free.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Iterable

from gcweb.fr_font import safe_glyph_order
from .clean_kerning import KERN1, KERN2, raw_kerning, side_group_maps


@dataclass
class CopyPlan:
    """What copying into one target would add."""

    to_copy: dict[tuple[str, str], float] = field(default_factory=dict)
    present_same: int = 0  # the target has the pair with the same value
    present_other: int = 0  # the target has the pair with another value (kept)
    missing_side: list[tuple[tuple[str, str], str]] = field(default_factory=list)  # pair, side
    in_old: int = 0  # the old version had the pair already


def new_glyphs(source: Any, old: Any) -> list[str]:
    """Glyphs ``source`` has and ``old`` does not, in ``source``'s order."""
    return [name for name in safe_glyph_order(source) if name in source and name not in old]


def pairs_of_glyphs(
    source: Any, glyphs: Iterable[str], with_groups: bool = True
) -> dict[tuple[str, str], float]:
    """Every kerning key that kerns one of ``glyphs`` — directly, and with
    ``with_groups`` through the group holding it on that side."""
    group_of = side_group_maps(source.groups)
    lefts: set[str] = set()
    rights: set[str] = set()
    for name in glyphs:
        lefts.add(name)
        rights.add(name)
        if with_groups and name in group_of[0]:
            lefts.add(group_of[0][name])
        if with_groups and name in group_of[1]:
            rights.add(group_of[1][name])
    return {
        pair: value
        for pair, value in raw_kerning(source).items()
        if value is not None and (pair[0] in lefts or pair[1] in rights)
    }


def _has_side(font: Any, name: str) -> bool:
    if name.startswith((KERN1, KERN2)):
        return name in font.groups
    return name in font


def plan_copy(pairs: dict[tuple[str, str], float], target: Any, old: Any = None) -> CopyPlan:
    plan = CopyPlan()
    target_kerning = raw_kerning(target)
    old_kerning = raw_kerning(old) if old is not None else None
    for pair in sorted(pairs):
        value = pairs[pair]
        if old_kerning is not None and pair in old_kerning:
            plan.in_old += 1
            continue
        if pair in target_kerning:
            if target_kerning[pair] == value:
                plan.present_same += 1
            else:
                plan.present_other += 1
            continue
        absent = next((side for side in pair if not _has_side(target, side)), None)
        if absent is not None:
            plan.missing_side.append((pair, absent))
            continue
        plan.to_copy[pair] = value
    return plan


def summary_line(name: str, plan: CopyPlan) -> str:
    parts = ["%d to copy" % len(plan.to_copy)]
    if plan.present_same:
        parts.append("%d there already" % plan.present_same)
    if plan.present_other:
        parts.append("%d there with another value (kept)" % plan.present_other)
    if plan.missing_side:
        parts.append("%d naming a glyph or group it lacks" % len(plan.missing_side))
    if plan.in_old:
        parts.append("%d not new (in the old version)" % plan.in_old)
    return "%s: %s" % (name, ", ".join(parts))


def pair_lines(plan: CopyPlan) -> list[str]:
    from .cross_pairs import side_label

    def value(v):
        return str(int(v)) if float(v).is_integer() else str(v)

    lines = [
        "+ %s %s %s" % (side_label(p[0]), side_label(p[1]), value(v))
        for p, v in plan.to_copy.items()
    ]
    lines += [
        "? %s %s: the target has no %s" % (side_label(p[0]), side_label(p[1]), side_label(side))
        for p, side in plan.missing_side
    ]
    return lines
