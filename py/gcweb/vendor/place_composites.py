# Vendored from Font-Rover font_rover/groups_control/place_composites.py @ a052428 (Apache-2.0).
# Do not edit here: fix upstream, then run scripts/vendor_sync.py.
# Copyright 2026 Alexander Lubovenko
# Licensed under the Apache License, Version 2.0

"""
Place composites into the kerning groups of the glyphs they are built on.

The engine behind the *Place Composites into Groups* board script, ported
from KernTool4's ``placeCompositesIntoSelectedGroups``. The rule is the
user's, and strict: a composite joins a group when the base glyph of its
first component (index 0) is in the group — ``Aacute`` (A + acute) joins the
group of A, on either side. Followed through: ``Aringacute`` built on
``Aring`` joins too, as ``Aring`` does. Nothing is measured and nothing is
guessed from shapes: margins, and which component reaches furthest, play no
part.

A candidate is left out, and reported, when:

- it is already in another group of that side (a glyph kerns in one group per
  side; moving it is a decision, not a cleanup) — only counted, as that is
  the normal state of most glyphs reached; the composites built on it belong
  to that group, not to this one;
- with ``same_script_only`` (off by default: the point is to gather every
  composite quickly), its script differs from the key glyph's — fonts share
  components across scripts (``a.ss01`` built on ``alpha``, Cyrillic Ve on
  ``B``). A glyph of no identifiable script (``.liga``, ``.den``) is never
  held back;
- two groups of the same side claim it (only possible when the groups given
  share a member).

GTK-free.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Iterable

from .compat import script_compat_for
from gcweb.fr_font import safe_glyph_order
from .clean_kerning import KERN1, side_group_maps

logger = logging.getLogger(__name__)


@dataclass
class PlacePlan:
    """What placing composites would add, and what it left out."""

    additions: dict[str, tuple[str, ...]] = field(default_factory=dict)  # group → glyphs
    elsewhere: int = 0  # candidates already in another group of that side
    other_script: list[tuple[str, str]] = field(default_factory=list)  # glyph, group
    contested: list[tuple[str, tuple[str, ...]]] = field(default_factory=list)  # glyph, groups

    @property
    def count(self) -> int:
        return sum(len(glyphs) for glyphs in self.additions.values())


def _side(group: str) -> str:
    return "kern1" if group.startswith(KERN1) else "kern2"


def first_base(font: Any, name: str) -> str | None:
    """The base glyph of a glyph's first component, or None without components."""
    components = font[name].components
    return components[0].baseGlyph if components else None


def built_on(font: Any, names: Iterable[str], reverse: dict[str, Iterable[str]]):
    """Composites whose first component is one of ``names``, then theirs, in order.

    Yields ``(composite, base)``, breadth first: a composite comes after the
    glyph it is built on, so the caller can judge the base before it. The
    composites of one base come in glyph order.
    """
    position = {name: index for index, name in enumerate(safe_glyph_order(font))}
    queue = [name for name in names if name in font]
    seen = set(queue)
    while queue:
        base = queue.pop(0)
        children = sorted(reverse.get(base, ()), key=lambda n: (position.get(n, len(position)), n))
        for child in children:
            if child in seen or child not in font or first_base(font, child) != base:
                continue
            seen.add(child)
            yield child, base
            queue.append(child)


def plan_composites(
    font: Any,
    groups: Iterable[str],
    same_script_only: bool = False,
) -> PlacePlan:
    plan = PlacePlan()
    group_of = side_group_maps(font.groups)
    reverse = font.getReverseComponentMapping()  # once per font: expensive
    compat = script_compat_for(font)
    compat.invalidate()
    # Per side: a glyph belongs to one group on each side, so a side-1 and a
    # side-2 group wanting it are no conflict.
    claims: dict[tuple[int, str], list[str]] = {}
    for group in groups:
        members = [name for name in font.groups.get(group, ()) if name in font]
        if not members:
            continue
        index = 0 if _side(group) == "kern1" else 1
        key_scripts = compat.glyph_mask(members[0])
        member_set = set(members)
        # Composites of a glyph grouped elsewhere belong to that group.
        blocked: set[str] = set()
        for name, base in built_on(font, members, reverse):
            if base in blocked:
                blocked.add(name)
                continue
            if name in member_set:
                continue
            owner = group_of[index].get(name)
            if owner is not None:
                if owner != group:
                    plan.elsewhere += 1
                    blocked.add(name)
                continue
            scripts = compat.glyph_mask(name)
            if same_script_only and key_scripts and scripts and not key_scripts & scripts:
                plan.other_script.append((name, group))
                continue
            claims.setdefault((index, name), []).append(group)

    additions: dict[str, list[str]] = {}
    for (_index, name), claimants in claims.items():
        claimants = list(dict.fromkeys(claimants))
        if len(claimants) > 1:
            plan.contested.append((name, tuple(claimants)))
        else:
            additions.setdefault(claimants[0], []).append(name)
    plan.additions = {group: tuple(glyphs) for group, glyphs in sorted(additions.items())}
    return plan


def apply_additions(font: Any, manager: Any, additions: dict[str, tuple[str, ...]]) -> int:
    """Add the glyphs through the manager (kerning follows); returns the count.

    A glyph the font lacks, or already groups on that side, is skipped, and
    so is a group it does not have (it is not created) — a plan is safe to
    apply to a font other than the one it was made on. Main thread only when
    the font is on screen.
    """
    group_of = side_group_maps(font.groups)
    added = 0
    for group, glyphs in additions.items():
        if group not in font.groups:
            continue
        index = 0 if _side(group) == "kern1" else 1
        wanted = [name for name in glyphs if name in font and name not in group_of[index]]
        if wanted:
            manager.add_glyphs_to_group(group, wanted)
            added += len(wanted)
    logger.info("Place composites: %d glyph(s) added in %s", added, getattr(font, "path", None))
    return added


def agreed_additions(
    fonts_and_additions: list[tuple[Any, dict[str, tuple[str, ...]]]],
) -> tuple[dict[str, tuple[str, ...]], list[tuple[str, tuple[str, ...], tuple[int, ...]]]]:
    """What every UFO agrees on, when each UFO of a designspace is planned on its own.

    A glyph goes into a group only if every UFO that has the group and the
    glyph planned the same addition: how the glyph is built and grouped in
    each UFO decides together, and the groups stay the same in every master. A UFO
    without the group or the glyph has no say (``apply_additions`` skips it
    there).

    Returns (agreed additions, held back): held back is a list of
    ``(group, glyphs, indices of the UFOs that did not plan them)``, glyphs
    with the same UFOs against them sharing one entry.
    """
    order: dict[str, list[str]] = {}
    for _font, additions in fonts_and_additions:
        for group, names in additions.items():
            listed = order.setdefault(group, [])
            listed += [name for name in names if name not in listed]
    planned = [
        {(group, name) for group, names in additions.items() for name in names}
        for _font, additions in fonts_and_additions
    ]
    agreed: dict[str, tuple[str, ...]] = {}
    held: dict[tuple[str, tuple[int, ...]], list[str]] = {}
    for group, names in order.items():
        kept = []
        for name in names:
            against = tuple(
                index
                for index, (font, _additions) in enumerate(fonts_and_additions)
                if group in font.groups and name in font and (group, name) not in planned[index]
            )
            if against:
                held.setdefault((group, against), []).append(name)
            else:
                kept.append(name)
        if kept:
            agreed[group] = tuple(kept)
    return agreed, [(group, tuple(names), against) for (group, against), names in held.items()]


def addition_lines(additions: dict[str, tuple[str, ...]]) -> list[str]:
    from .cross_pairs import side_label

    return [
        "%s %s + %s" % (_number(group), side_label(group), ", ".join(glyphs))
        for group, glyphs in additions.items()
    ]


def plan_lines(plan: PlacePlan) -> list[str]:
    return addition_lines(plan.additions)


def skipped_lines(plan: PlacePlan) -> list[str]:
    from .cross_pairs import side_label

    lines = [
        "%s: another script than the key glyph of %s %s" % (name, _number(group), side_label(group))
        for name, group in plan.other_script
    ]
    lines += [
        "%s: claimed by %s" % (name, ", ".join(_number(g) + " " + side_label(g) for g in groups))
        for name, groups in plan.contested
    ]
    return lines


def _number(group: str) -> str:
    return "1" if group.startswith(KERN1) else "2"
