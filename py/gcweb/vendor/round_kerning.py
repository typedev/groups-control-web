# Vendored from Font-Rover font_rover/groups_control/round_kerning.py @ a052428 (Apache-2.0).
# Do not edit here: fix upstream, then run scripts/vendor_sync.py.
# Copyright 2026 Alexander Lubovenko
# Licensed under the Apache License, Version 2.0

"""
Round kerning to a multiple of 5 or 10.

The engine behind the *Round Kerning* board script, ported from KernTool4's
``roundKerning_x5``. A value under 5 in magnitude is noise and becomes 0, as
in KernTool4 (-4 → 0, not -5); the rest is rounded half away from zero
(-12.5 → -15, 7.5 → 10 at step 5). A pair that becomes 0 is removed — unless it is an
exception overriding a group pair that stays non-zero: removing it would
bring the group value back (``Aacute V`` at -2 against ``@A @V`` at -80
becomes 0, not -80). Whether a group pair "stays non-zero" is judged on the
rounded values, so an exception whose group pair also rounds to 0 goes.

Keys with a group on the wrong side are skipped: fontParts cannot write them,
and Clean Groups & Kerning removes them.

GTK-free: the caller writes the plan (``api.set_kerning_values``), so the UFO
Groups Control shows gets one undo step.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

from .clean_kerning import KERN1, KERN2, overrides_nonzero_pair, raw_kerning, side_group_maps

STEPS = (5, 10)

# Below this magnitude a value is dropped whatever the step.
NOISE_LIMIT = 5


def round_value(value: float, step: int) -> int:
    """``value`` to the nearest multiple of ``step``, halves away from zero;
    0 for anything under :data:`NOISE_LIMIT` in magnitude."""
    if abs(value) < NOISE_LIMIT:
        return 0
    magnitude = math.floor(abs(value) / step + 0.5) * step
    return int(math.copysign(magnitude, value)) if magnitude else 0


@dataclass
class RoundPlan:
    """What rounding one UFO would change."""

    step: int
    changes: dict[tuple[str, str], int | None] = field(default_factory=dict)
    rounded: int = 0  # new non-zero value
    removed: int = 0  # rounded to 0, overriding nothing
    kept_at_zero: list[tuple[str, str]] = field(default_factory=list)  # exceptions at work
    in_place: int = 0  # already a multiple


def plan_round(font: Any, step: int) -> RoundPlan:
    if step not in STEPS:
        raise ValueError("step must be one of %s" % (STEPS,))
    plan = RoundPlan(step)
    kerning = raw_kerning(font)
    current = {
        pair: value
        for pair, value in kerning.items()
        if value is not None and not (pair[0].startswith(KERN2) or pair[1].startswith(KERN1))
    }
    rounded = {pair: round_value(value, step) for pair, value in current.items()}
    group_of = side_group_maps(font.groups)
    for pair in sorted(current):
        old, new = current[pair], rounded[pair]
        if new == old:
            plan.in_place += 1
        elif new:
            plan.changes[pair] = new
            plan.rounded += 1
        elif overrides_nonzero_pair(pair, rounded, group_of):
            plan.changes[pair] = 0
            plan.kept_at_zero.append(pair)
        else:
            plan.changes[pair] = None
            plan.removed += 1
    return plan


def summary_lines(plan: RoundPlan) -> list[str]:
    rows = [
        ("pair(s) rounded", plan.rounded),
        ("pair(s) rounded to 0, removed", plan.removed),
        (
            "exception(s) rounded to 0, kept at 0 (they override a group pair)",
            len(plan.kept_at_zero),
        ),
        ("pair(s) already a multiple of %d" % plan.step, plan.in_place),
    ]
    return ["%d %s" % (count, text) for text, count in rows if count]


def change_lines(font: Any, plan: RoundPlan) -> list[str]:
    """``@A @V: -83 → -85`` for every change, removals and zeros first."""
    from .cross_pairs import side_label

    kerning = raw_kerning(font)

    def line(pair, new):
        old = kerning.get(pair)
        old = int(old) if float(old).is_integer() else old
        return "%s %s: %s → %s" % (
            side_label(pair[0]),
            side_label(pair[1]),
            old,
            "removed" if new is None else new,
        )

    order = sorted(plan.changes.items(), key=lambda item: (item[1] is not None, item[1] != 0))
    return [line(pair, new) for pair, new in order]
