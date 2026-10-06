# Vendored from Font-Rover font_rover/groups_control/interpolate_kerning.py @ a052428 (Apache-2.0).
# Do not edit here: fix upstream, then run scripts/vendor_sync.py.
# Copyright 2026 Alexander Lubovenko
# Licensed under the Apache License, Version 2.0

"""
Interpolate the kerning of two UFOs into a third.

The engine behind the *Interpolate Kerning* board script. Master A and
master B are given positions on a line (0–1000 in the script), the target a
position between them; every pair of A or B gets
``a + (b - a) * (target - posA) / (posB - posA)``.

A pair one master lacks is not taken as 0 there: that master's value for it
is the one its kerning applies by UFO precedence — an exception ``A V``
missing in B interpolates towards B's ``@A @V``, not towards nothing. Only
when no key covers it at all is the value 0.

A pair is written only where all three UFOs have the glyphs it names, and
the groups it names with the same members (the order does not matter): the
same group pair over other members kerns other glyphs. A pair the target has
already keeps its value unless ``overwrite`` is asked for.

The unit is the UFO: kerning belongs to the file, so every layer master
stored in one shares it.

GTK-free.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Iterable

from .clean_kerning import KERN1, KERN2, raw_kerning, side_group_maps


@dataclass
class InterpolationPlan:
    to_write: dict[tuple[str, str], Any] = field(default_factory=dict)
    sources: dict[tuple[str, str], tuple[Any, Any]] = field(default_factory=dict)  # pair: (a, b)
    one_master: int = 0  # pairs to write that one master has no key for
    present_same: int = 0
    present_other: list[tuple[tuple[str, str], Any, Any]] = field(default_factory=list)
    overwritten: int = 0
    side_issues: list[tuple[tuple[str, str], str]] = field(default_factory=list)  # pair, why


def _is_group(side: str) -> bool:
    return side.startswith((KERN1, KERN2))


def factor(position_a: float, position_b: float, position_target: float) -> float:
    """How far the target lies from A towards B (0 at A, 1 at B)."""
    if position_a == position_b:
        raise ValueError("master A and master B need different positions")
    return (position_target - position_a) / (position_b - position_a)


def key_value(pair: tuple[str, str], kerning: Any, group_of) -> Any:
    """The value a font applies for a kerning key, by UFO precedence.

    The key itself, then the less specific keys that cover it: a glyph side
    falls back to its group on that side, a group side stays. None when no
    key covers it.
    """
    left, right = pair
    lefts = [left] if _is_group(left) else [left, group_of[0].get(left)]
    rights = [right] if _is_group(right) else [right, group_of[1].get(right)]
    # Precedence: glyph-glyph, glyph-group, group-glyph, group-group.
    for left_side in lefts:
        for right_side in rights:
            key = (left_side, right_side)
            if None not in key and key in kerning:
                return kerning[key]
    return None


def kerning_keys(*fonts: Any) -> list[tuple[str, str]]:
    """Every key of the fonts' kerning, sorted, each once."""
    keys: set[tuple[str, str]] = set()
    for font in fonts:
        keys.update(raw_kerning(font).keys())
    return sorted(keys)


def keys_touching(
    keys: Iterable[tuple[str, str]],
    glyphs: Iterable[str] = (),
    groups: Iterable[str] = (),
    group_maps: Iterable = (),
    with_groups: bool = True,
) -> list[tuple[str, str]]:
    """The keys with one of ``glyphs`` or ``groups`` on a side.

    A group counts on its own side (``public.kern1.*`` on the left). With
    ``with_groups``, a glyph brings in the group holding it on each side in
    any of ``group_maps`` (from :func:`side_group_maps`).
    """
    lefts: set[str] = set()
    rights: set[str] = set()
    group_maps = list(group_maps)
    for name in glyphs:
        lefts.add(name)
        rights.add(name)
        if with_groups:
            for group_of in group_maps:
                if name in group_of[0]:
                    lefts.add(group_of[0][name])
                if name in group_of[1]:
                    rights.add(group_of[1][name])
    for name in groups:
        if name.startswith(KERN1):
            lefts.add(name)
        elif name.startswith(KERN2):
            rights.add(name)
    return [key for key in keys if key[0] in lefts or key[1] in rights]


def _side_problem(side: str, fonts: list[tuple[str, Any]]) -> str:
    if _is_group(side):
        members = None
        for name, font in fonts:
            if side not in font.groups:
                return "no group %s in %s" % (side, name)
            here = set(font.groups[side])
            if members is None:
                members = here
            elif here != members:
                return "group %s has other members in %s" % (side, name)
        return ""
    for name, font in fonts:
        if side not in font:
            return "no glyph %s in %s" % (side, name)
    return ""


def interpolated(a: Any, b: Any, t: float, round_values: bool = True) -> Any:
    value = a + (b - a) * t
    if round_values:
        # Halves away from zero, as Round Kerning does.
        return int(abs(value) + 0.5) * (1 if value >= 0 else -1)
    value = round(value, 3)
    return int(value) if float(value).is_integer() else value


def plan_interpolation(
    master_a: Any,
    master_b: Any,
    target: Any,
    t: float,
    keys: Iterable[tuple[str, str]] | None = None,
    overwrite: bool = True,
    round_values: bool = True,
    names: tuple[str, str, str] = ("A", "B", "the target"),
) -> InterpolationPlan:
    """What interpolating ``keys`` (default: every key of A and B) at ``t``
    into ``target`` would write.

    ``t`` is :func:`factor`; ``names`` name the three UFOs in the reasons a
    pair is held back.
    """
    plan = InterpolationPlan()
    kerning_a = raw_kerning(master_a)
    kerning_b = raw_kerning(master_b)
    target_kerning = raw_kerning(target)
    groups_a = side_group_maps(master_a.groups)
    groups_b = side_group_maps(master_b.groups)
    fonts = list(zip(names, (master_a, master_b, target)))
    if keys is None:
        keys = kerning_keys(master_a, master_b)
    for pair in keys:
        problem = next((p for p in (_side_problem(side, fonts) for side in pair) if p), "")
        if problem:
            plan.side_issues.append((pair, problem))
            continue
        a = key_value(pair, kerning_a, groups_a)
        b = key_value(pair, kerning_b, groups_b)
        if a is None and b is None:
            continue
        value = interpolated(a or 0, b or 0, t, round_values)
        if pair in target_kerning:
            if target_kerning[pair] == value:
                plan.present_same += 1
                continue
            if not overwrite:
                plan.present_other.append((pair, value, target_kerning[pair]))
                continue
            plan.overwritten += 1
        plan.to_write[pair] = value
        plan.sources[pair] = (a, b)
        if pair not in kerning_a or pair not in kerning_b:
            plan.one_master += 1
    return plan


def summary_line(name: str, plan: InterpolationPlan) -> str:
    group_pairs = sum(1 for pair in plan.to_write if all(_is_group(side) for side in pair))
    text = "%d to write" % len(plan.to_write)
    if plan.to_write:
        text += " (%d with a glyph side, %d group × group)" % (
            len(plan.to_write) - group_pairs,
            group_pairs,
        )
    parts = [text]
    if plan.overwritten:
        parts.append("%d of them overwrite a value" % plan.overwritten)
    if plan.one_master:
        parts.append("%d of them kerned by a key in one master only" % plan.one_master)
    if plan.present_same:
        parts.append("%d there already" % plan.present_same)
    if plan.present_other:
        parts.append("%d there with another value (kept)" % len(plan.present_other))
    if plan.side_issues:
        parts.append("%d held back by groups or glyphs" % len(plan.side_issues))
    return "%s: %s" % (name, ", ".join(parts))


def _value_text(v: Any) -> str:
    if v is None:
        return "–"
    return str(int(v)) if float(v).is_integer() else str(v)


def _pair_text(pair: tuple[str, str]) -> str:
    from .cross_pairs import side_label

    return "%s %s" % (side_label(pair[0]), side_label(pair[1]))


def write_lines(plan: InterpolationPlan) -> list[str]:
    """``+ pair: value (a … b)`` for every pair the run writes.

    A master without any key covering the pair shows ``–`` (taken as 0).
    """
    value = _value_text
    lines = []
    for pair, result in plan.to_write.items():
        a, b = plan.sources[pair]
        lines.append("+ %s: %s (%s … %s)" % (_pair_text(pair), value(result), value(a), value(b)))
    return lines


def detail_lines(plan: InterpolationPlan) -> list[str]:
    """``?`` held-back and ``~`` kept pairs — the ones that are not written."""
    value, pair = _value_text, _pair_text
    lines = ["? %s: %s" % (pair(p), why) for p, why in plan.side_issues]
    lines += [
        "~ %s: %s interpolated, %s there (kept)" % (pair(p), value(a), value(b))
        for p, a, b in plan.present_other
    ]
    return lines
