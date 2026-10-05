# Vendored from Font-Rover font_rover/groups_control/key_glyphs.py @ a052428 (Apache-2.0).
# Do not edit here: fix upstream, then run scripts/vendor_sync.py.
# Copyright 2026 Alexander Lubovenko
# Licensed under the Apache License, Version 2.0

"""
Put each kerning group's key glyph first.

The engine behind the *Fix Key Glyph Position* board script, ported from
KernTool4's ``fixingKeyGlyphPositionInGroups``. UFO does not order a group,
but Groups Control does: the first member is the key glyph — the margins
check, the preview, the Lang column and Split Groups by Script all read it.
A group is usually named after that glyph; when another member is first, the
group behaves as if it were a different one.

The key glyph is read from the group name, trying in order:

- the name itself (``public.kern1.f_f`` → ``f_f``), then without leading
  underscores (``_A`` → ``A``);
- underscores as dots (``a_sc`` → ``a.sc``, KernTool4's convention);
- the name with trailing ``_part`` s dropped one by one (``A_cyrl_2`` →
  ``A_cyrl`` → ``A``), each also with dots;
- trailing digits dropped one by one — FontLab numbers the group of the other
  side (``O1`` → ``O``, ``afii100321`` → ``afii10032``).

The first candidate that is a member wins. A name that names no member
(``_A_cyr`` holding ``uni0410``) is reported and left alone: nothing says
which glyph was meant.

GTK-free.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Iterable, Iterator

logger = logging.getLogger(__name__)

SIDE_PREFIXES = ("public.kern1.", "public.kern2.")


@dataclass
class KeyGlyphPlan:
    """What putting key glyphs first would change in one UFO."""

    moves: list[tuple[str, str, str]] = field(default_factory=list)  # group, was first, key
    unnamed: list[tuple[str, str]] = field(default_factory=list)  # group, first member
    in_place: int = 0


def name_candidates(short_name: str) -> Iterator[str]:
    """Glyph names a group's short name may stand for, most literal first."""
    seen: set[str] = set()
    bases = [short_name]
    if short_name.lstrip("_") and short_name.lstrip("_") != short_name:
        bases.append(short_name.lstrip("_"))
    names: list[str] = []
    for base in bases:
        parts = base.split("_")
        # Leading underscores give empty parts; keep them attached.
        for cut in range(len(parts), 0, -1):
            name = "_".join(parts[:cut])
            if name.strip("_"):
                names += [name, name.replace("_", ".")]
    # FontLab numbers the group of the other side: O1, afii100321.
    for name in list(names):
        stem = name
        while stem[-1:].isdigit() and stem[:-1].strip("_."):
            stem = stem[:-1]
            names.append(stem)
    for candidate in names:
        if candidate not in seen and not candidate.startswith("."):
            seen.add(candidate)
            yield candidate


def key_glyph_from_name(group: str, members: Iterable[str]) -> str | None:
    """The member the group is named after, or None."""
    prefix = next((p for p in SIDE_PREFIXES if group.startswith(p)), None)
    if prefix is None:
        return None
    members = set(members)
    for candidate in name_candidates(group[len(prefix) :]):
        if candidate in members:
            return candidate
    return None


def plan_key_glyphs(font: Any) -> KeyGlyphPlan:
    plan = KeyGlyphPlan()
    for group in sorted(font.groups.keys()):
        if not group.startswith(SIDE_PREFIXES):
            continue
        members = list(font.groups[group])
        if not members:
            continue
        key = key_glyph_from_name(group, members)
        if key is None:
            plan.unnamed.append((group, members[0]))
        elif members[0] == key:
            plan.in_place += 1
        else:
            plan.moves.append((group, members[0], key))
    return plan


def apply_key_glyphs(font: Any, manager: Any, plan: KeyGlyphPlan) -> None:
    """Move each key glyph to the front; the rest keep their order.

    Then the manager's maps are rebuilt, since it caches the key glyph
    (reordering does not go through it). Main thread only when the font is on
    screen.
    """
    for group, _first, key in plan.moves:
        members = list(font.groups.get(group, ()))
        if key in members:
            members.remove(key)
            font.groups[group] = tuple([key] + members)
    if manager is not None:
        manager.makeReverseGroupsMapping()
    logger.info(
        "Key glyphs: %d group(s) reordered in %s", len(plan.moves), getattr(font, "path", None)
    )


def plan_lines(plan: KeyGlyphPlan) -> list[str]:
    from .cross_pairs import side_label

    lines = [
        "%s: %s → %s first" % (_side(group) + side_label(group), first, key)
        for group, first, key in plan.moves
    ]
    return lines


def unnamed_lines(plan: KeyGlyphPlan) -> list[str]:
    from .cross_pairs import side_label

    return [
        "%s: the name names no member (first is %s)" % (_side(group) + side_label(group), first)
        for group, first in plan.unnamed
    ]


def _side(group: str) -> str:
    return "1 " if group.startswith(SIDE_PREFIXES[0]) else "2 "
