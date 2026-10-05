# Vendored from Font-Rover font_rover/groups_control/place_ligatures.py @ a052428 (Apache-2.0).
# Do not edit here: fix upstream, then run scripts/vendor_sync.py.
# Copyright 2026 Alexander Lubovenko
# Licensed under the Apache License, Version 2.0

"""
Place ligatures into the kerning groups of the glyphs they are made of.

The engine behind the *Place Ligatures into Groups* board script, ported from
KernTool4's ``placeLigaturesIntoGroups``. A ligature's edges are its parts'
edges: ``f_i`` kerns on side 1 (its right edge) like ``i`` and on side 2
(its left edge) like ``f``, so it joins the side-1 group of its last part and
the side-2 group of its first.

A ligature is a name with ``_`` between its parts (``f_f_i``), plus the two
traditional names written without one: ``fi`` and ``fl``, and the AGL form
``uni`` + several four-digit codes (``uni02346789`` → ``uni0234`` +
``uni6789``). After a uni-named first part a bare code is short for its uni
name (``uni0234_6789`` → ``uni0234`` + ``uni6789``). Hex digits are
uppercase, as the AGL requires. Nothing else is guessed. With a suffix, a part is looked for with it first: ``f_i.sc`` →
``i.sc``, then ``i`` (KernTool4 knew four ``locl`` suffixes and skipped every
other suffixed ligature).

Left out, and reported: a ligature whose parts are not all in the font, and
a side on which the part is in no group or the ligature already is in one.
The name decides, strictly (the user's rule): margins are not compared.

GTK-free. Applying reuses Place Composites' ``apply_additions``.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from gcweb.fr_font import safe_glyph_order
from .clean_kerning import side_group_maps

# Ligatures traditionally named without an underscore.
NAMED_LIGATURES = {"fi": ["f", "i"], "fl": ["f", "l"]}

# AGL: "uni" + four uppercase hex digits per code, several codes in a row.
_AGL_UNI_SEQUENCE = re.compile(r"uni((?:[0-9A-F]{4}){2,})")
_UNI_NAME = re.compile(r"(?:uni[0-9A-F]{4}|u[0-9A-F]{4,6})")
_BARE_CODE = re.compile(r"[0-9A-F]{4,6}")


@dataclass
class LigaturePlan:
    additions: dict[str, tuple[str, ...]] = field(default_factory=dict)  # group → ligatures
    unresolved: list[str] = field(default_factory=list)  # parts not in the font
    part_ungrouped: list[tuple[str, int, str]] = field(default_factory=list)  # lig, side, part
    already: int = 0  # sides the ligature is grouped on already

    @property
    def count(self) -> int:
        return sum(len(glyphs) for glyphs in self.additions.values())


def ligature_part_names(name: str) -> tuple[list[str], str] | None:
    """(part names, suffix) if ``name`` is a ligature name, else None."""
    if name.startswith((".", "_")):
        return None
    base, _dot, suffix = name.partition(".")
    if base in NAMED_LIGATURES:
        return list(NAMED_LIGATURES[base]), suffix
    sequence = _AGL_UNI_SEQUENCE.fullmatch(base)
    if sequence is not None:
        codes = sequence.group(1)
        return ["uni" + codes[i : i + 4] for i in range(0, len(codes), 4)], suffix
    parts = base.split("_")
    if len(parts) < 2 or not all(parts):
        return None
    if _UNI_NAME.fullmatch(parts[0]):
        # uni0234_6789: after a uni-named first part, a bare code is short
        # for its uni name (four digits -> uniXXXX, five or six -> uXXXXX).
        parts = [parts[0]] + [
            ("uni" if len(part) == 4 else "u") + part if _BARE_CODE.fullmatch(part) else part
            for part in parts[1:]
        ]
    return parts, suffix


def _resolve(font: Any, part: str, suffix: str) -> str | None:
    for candidate in ([part + "." + suffix] if suffix else []) + [part]:
        if candidate in font:
            return candidate
    return None


def plan_ligatures(font: Any) -> LigaturePlan:
    plan = LigaturePlan()
    group_of = side_group_maps(font.groups)
    additions: dict[str, list[str]] = {}
    for name in safe_glyph_order(font):
        if name not in font:
            continue
        parsed = ligature_part_names(name)
        if parsed is None:
            continue
        parts, suffix = parsed
        resolved = [_resolve(font, part, suffix) for part in parts]
        if any(part is None for part in resolved):
            plan.unresolved.append(name)
            continue
        # Side 1 is the right edge: the last part's; side 2 the first's.
        for index, part in ((0, resolved[-1]), (1, resolved[0])):
            if name in group_of[index]:
                plan.already += 1
                continue
            target = group_of[index].get(part)
            if target is None:
                plan.part_ungrouped.append((name, index, part))
                continue
            additions.setdefault(target, []).append(name)
    plan.additions = {group: tuple(glyphs) for group, glyphs in sorted(additions.items())}
    return plan


def plan_lines(plan: LigaturePlan) -> list[str]:
    from .cross_pairs import side_label

    return [
        "%s %s + %s" % (_number(group), side_label(group), ", ".join(glyphs))
        for group, glyphs in plan.additions.items()
    ]


def skipped_lines(plan: LigaturePlan) -> list[str]:
    lines = ["%s: not all its parts are in the font" % name for name in plan.unresolved]
    lines += [
        "%s: %s is in no group on side %d" % (name, part, index + 1)
        for name, index, part in plan.part_ungrouped
    ]
    return lines


def _number(group: str) -> str:
    return "1" if group.startswith("public.kern1.") else "2"
