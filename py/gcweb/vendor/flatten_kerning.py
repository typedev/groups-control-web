# Vendored from Font-Rover font_rover/groups_control/flatten_kerning.py @ a052428 (Apache-2.0).
# Do not edit here: fix upstream, then run scripts/vendor_sync.py.
# Copyright 2026 Alexander Lubovenko
# Licensed under the Apache License, Version 2.0

"""
Flatten kerning: every group pair expanded into glyph pairs, groups deleted.

The engine behind the *Flatten Kerning* board script, ported from KernTool4's
``flatKerning``. KernTool4 deleted the groups one by one and let each copy its
pairs onto its members; the result then depended on the order of the
deletions and could break UFO precedence (``g @R`` must beat ``@L r`` for
``g r``, and deleting ``@L`` first wrote ``@L r``'s value, which the later
deletion of ``@R`` then kept). Here every glyph pair any key covers gets the
value a UFO consumer would use — glyph–glyph, then glyph–group, then
group–glyph, then group–group — and that is what is written. A result of 0
is not written: a zero exception only meant "not the group value", and with
no groups left there is nothing to override.

Only kerning groups go (``public.kern1.*`` / ``public.kern2.*``); other
groups stay. With ``keep_groups`` the groups stay too and only the kerning is
flattened.

GTK-free.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

from .clean_kerning import KERN1, KERN2, raw_kerning, side_group_maps

logger = logging.getLogger(__name__)


@dataclass
class FlattenPlan:
    """The whole new kerning of one UFO, and what changes."""

    values: dict[tuple[str, str], Any] = field(default_factory=dict)  # key → value / None
    pairs_before: int = 0
    pairs_after: int = 0
    group_keys: int = 0  # keys that name a group, removed
    groups: list[str] = field(default_factory=list)  # kerning groups to delete
    skipped_zero: int = 0  # glyph pairs whose value resolves to 0


def plan_flatten(font: Any, keep_groups: bool = False) -> FlattenPlan:
    plan = FlattenPlan()
    kerning = dict(raw_kerning(font).items())
    groups = {name: tuple(m) for name, m in font.groups.items() if name.startswith((KERN1, KERN2))}
    group_of = side_group_maps(groups)
    plan.pairs_before = len(kerning)

    def members(side: str) -> tuple[str, ...]:
        if side.startswith((KERN1, KERN2)):
            return tuple(g for g in groups.get(side, ()) if g in font)
        return (side,) if side in font else ()

    flat: dict[tuple[str, str], Any] = {}
    for left, right in kerning:
        for glyph_left in members(left):
            for glyph_right in members(right):
                pair = (glyph_left, glyph_right)
                if pair in flat:
                    continue
                value = effective_value(pair, kerning, group_of)
                if value:
                    flat[pair] = value
                else:
                    plan.skipped_zero += 1
    # New values, and every old key that is not a glyph pair of the result.
    for pair, value in flat.items():
        if kerning.get(pair) != value:
            plan.values[pair] = value
    for pair in kerning:
        if pair not in flat:
            plan.values[pair] = None
            if pair[0].startswith((KERN1, KERN2)) or pair[1].startswith((KERN1, KERN2)):
                plan.group_keys += 1
    plan.pairs_after = len(flat)
    if not keep_groups:
        plan.groups = sorted(groups)
    return plan


def effective_value(pair: tuple[str, str], kerning: dict, group_of) -> Any:
    """The value of a glyph pair by UFO precedence, or None."""
    left, right = pair
    left_group = group_of[0].get(left)
    right_group = group_of[1].get(right)
    for key in (
        (left, right),
        (left, right_group),
        (left_group, right),
        (left_group, right_group),
    ):
        if None not in key and key in kerning:
            return kerning[key]
    return None


def delete_kerning_groups(font: Any, manager: Any, groups: list[str]) -> int:
    """Delete the groups (their kerning is gone already). Main thread only
    when the font is on screen."""
    done = 0
    for name in groups:
        if name in font.groups:
            manager.delete_group(name, check_kerning=False)
            done += 1
    logger.info("Flatten kerning: %d group(s) deleted in %s", done, getattr(font, "path", None))
    return done


def summary_lines(plan: FlattenPlan) -> list[str]:
    lines = [
        "%d pair(s) now, %d after flattening" % (plan.pairs_before, plan.pairs_after),
        "%d group pair(s) expanded into glyph pairs" % plan.group_keys,
    ]
    if plan.skipped_zero:
        lines.append("%d glyph pair(s) left out: their value is 0" % plan.skipped_zero)
    if plan.groups:
        lines.append("%d kerning group(s) deleted" % len(plan.groups))
    else:
        lines.append("the kerning groups are kept")
    return lines
