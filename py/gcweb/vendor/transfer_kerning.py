# Vendored from Font-Rover font_rover/groups_control/transfer_kerning.py @ a052428 (Apache-2.0).
# Do not edit here: fix upstream, then run scripts/vendor_sync.py.
# Copyright 2026 Alexander Lubovenko
# Licensed under the Apache License, Version 2.0

"""
Transfer the kerning of chosen scripts from one UFO into others.

The engine behind the *Transfer Kerning by Script* board script, reworked
from KernTool4's ``transferKerningByLanguage``. A pair belongs to every script
either of its sides touches — a group touches the scripts of all its members
— so "everything Greek" takes Greek × Greek, Greek × punctuation, Latin ×
Greek and pairs of mixed groups alike; sorting out the unwanted ones is left
to the Lang column and Remove Cross-Language Pairs. A pair whose sides touch
no script (figures, punctuation) belongs to :data:`COMMON`.

A pair goes into a target only if the target has every side it names, and a
group there with the same members (the order does not matter to kerning):
the same group pair over other members kerns other glyphs. A pair the target
has already keeps its value unless ``overwrite`` is asked for.

GTK-free.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from typing import Any, Iterable

from fontTools import unicodedata as ft_unicodedata

from .compat import LEVEL_SCRIPT, script_codes, script_compat_for
from .clean_kerning import KERN1, KERN2, raw_kerning

COMMON = "Zyyy"  # ISO 15924 "Common": sides of no script at all


def script_label(code: str) -> str:
    """``Cyrillic`` for ``Cyrl``; the code itself if unknown."""
    try:
        return ft_unicodedata.script_name(code)
    except KeyError:
        return code


def pair_scripts(font: Any, pairs: Iterable[tuple[str, str]]) -> dict[tuple[str, str], set[str]]:
    """The scripts each pair touches (``{COMMON}`` when none)."""
    compat = script_compat_for(font)
    compat.invalidate()
    masks: dict[str, int] = {}
    result = {}
    for pair in pairs:
        mask = 0
        for side in pair:
            if side not in masks:
                masks[side] = compat.side_mask(side, LEVEL_SCRIPT)
            mask |= masks[side]
        result[pair] = set(script_codes(mask)) or {COMMON}
    return result


def script_counts(font: Any) -> Counter:
    """How many pairs of ``font`` touch each script."""
    counts: Counter = Counter()
    for scripts in pair_scripts(font, list(raw_kerning(font).keys())).values():
        counts.update(scripts)
    return counts


@dataclass
class TransferPlan:
    to_write: dict[tuple[str, str], Any] = field(default_factory=dict)
    by_script: Counter = field(default_factory=Counter)  # pairs to write per script
    present_same: int = 0
    present_other: list[tuple[tuple[str, str], Any, Any]] = field(default_factory=list)
    overwritten: int = 0
    side_issues: list[tuple[tuple[str, str], str]] = field(default_factory=list)  # pair, why


def _is_group(side: str) -> bool:
    return side.startswith((KERN1, KERN2))


def _side_problem(source: Any, target: Any, side: str) -> str:
    if _is_group(side):
        if side not in target.groups:
            return "no group %s there" % side
        if set(target.groups[side]) != set(source.groups.get(side, ())):
            return "group %s has other members there" % side
        return ""
    if side not in target:
        return "no glyph %s there" % side
    return ""


def plan_transfer(
    source: Any,
    target: Any,
    scripts: Iterable[str],
    overwrite: bool = False,
    pair_script_map: dict | None = None,
) -> TransferPlan:
    """What transferring the pairs of ``scripts`` into ``target`` would do.

    ``pair_script_map`` (from :func:`pair_scripts`) can be passed when one
    source goes into several targets.
    """
    wanted = set(scripts)
    plan = TransferPlan()
    source_kerning = raw_kerning(source)
    target_kerning = raw_kerning(target)
    if pair_script_map is None:
        pair_script_map = pair_scripts(source, list(source_kerning.keys()))
    for pair in sorted(source_kerning.keys()):
        touched = pair_script_map.get(pair, set()) & wanted
        if not touched:
            continue
        value = source_kerning[pair]
        if pair in target_kerning:
            if target_kerning[pair] == value:
                plan.present_same += 1
                continue
            if not overwrite:
                plan.present_other.append((pair, value, target_kerning[pair]))
                continue
            plan.overwritten += 1
        problem = next((p for p in (_side_problem(source, target, side) for side in pair) if p), "")
        if problem:
            plan.side_issues.append((pair, problem))
            continue
        plan.to_write[pair] = value
        plan.by_script.update(touched)
    return plan


def summary_line(name: str, plan: TransferPlan) -> str:
    scripts = ", ".join(
        "%s %d" % (script_label(code), count) for code, count in sorted(plan.by_script.items())
    )
    group_pairs = sum(1 for pair in plan.to_write if all(_is_group(side) for side in pair))
    kinds = ""
    if plan.to_write:
        kinds = "%d with a glyph side, %d group × group" % (
            len(plan.to_write) - group_pairs,
            group_pairs,
        )
    brackets = "; ".join(part for part in (scripts, kinds) if part)
    parts = ["%d to transfer" % len(plan.to_write) + (" (%s)" % brackets if brackets else "")]
    if plan.overwritten:
        parts.append("%d of them overwrite a value" % plan.overwritten)
    if plan.present_same:
        parts.append("%d there already" % plan.present_same)
    if plan.present_other:
        parts.append("%d there with another value (kept)" % len(plan.present_other))
    if plan.side_issues:
        parts.append("%d held back by groups or glyphs" % len(plan.side_issues))
    return "%s: %s" % (name, ", ".join(parts))


def _value_text(v: Any) -> str:
    return str(int(v)) if float(v).is_integer() else str(v)


def _pair_text(pair: tuple[str, str]) -> str:
    from .cross_pairs import side_label

    return "%s %s" % (side_label(pair[0]), side_label(pair[1]))


def transfer_lines(plan: TransferPlan) -> list[str]:
    """``+ pair: value`` for every pair the transfer writes."""
    return ["+ %s: %s" % (_pair_text(p), _value_text(v)) for p, v in plan.to_write.items()]


def detail_lines(plan: TransferPlan) -> list[str]:
    """``?`` held-back and ``~`` kept pairs — the ones that are not written."""
    value, pair = _value_text, _pair_text
    lines = ["? %s: %s" % (pair(p), why) for p, why in plan.side_issues]
    lines += [
        "~ %s: %s here, %s there (kept)" % (pair(p), value(a), value(b))
        for p, a, b in plan.present_other
    ]
    return lines
