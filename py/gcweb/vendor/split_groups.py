# Vendored from Font-Rover font_rover/groups_control/split_groups.py @ a052428 (Apache-2.0).
# Do not edit here: fix upstream, then run scripts/vendor_sync.py.
# Copyright 2026 Alexander Lubovenko
# Licensed under the Apache License, Version 2.0

"""
Split kerning groups by script.

The engine behind the *Split Groups by Script* board script, ported from
KernTool4's ``splitGroupsByLanguage``. A group's script is its key glyph's
(the first member). Members of another script leave for a group of their own,
named after the source with the ISO 15924 code in lowercase:
``public.kern1.A`` keeps Latin A, Á…; Cyrillic А, Я go to
``public.kern1.A_cyrl``.

What is left alone:

- a member whose script cannot be determined (an alternate with no unicode
  and no recognisable name) — KernTool4 moved these to an ``_unknown`` group;
  here they stay, since nothing says they are foreign;
- a group whose key glyph has no script (punctuation, figures).

Kerning follows the glyphs through ``FontGroupsManager``: removing them from
the group copies its pairs onto them as glyph pairs, adding them to the new
group folds pairs that match back into group pairs, and differing ones stay
exceptions. The new group therefore inherits the old group's kerning — also
against sides of the old script (``@A_cyrl`` against Latin ``@V``). Those are
the cross-script pairs the split creates; :func:`new_cross_pairs` finds them.

GTK-free.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Iterable, Mapping

from .compat import PAIR_SCRIPT_CROSS, script_compat_for
from .cross_pairs import side_label
from .naming import free_name

logger = logging.getLogger(__name__)

SIDE_PREFIXES = ("public.kern1.", "public.kern2.")


@dataclass(frozen=True)
class SplitMove:
    """Glyphs of one script leaving one group."""

    source: str  # full group name
    script: str  # ISO 15924 code, "Cyrl"
    glyphs: tuple[str, ...]
    target: str  # full group name
    target_exists: bool  # an earlier split made it; the glyphs join it


def _side_prefix(group: str) -> str:
    return next(prefix for prefix in SIDE_PREFIXES if group.startswith(prefix))


def plan_split(font: Any, prefixes: Iterable[str] = SIDE_PREFIXES) -> list[SplitMove]:
    """What splitting the font's kerning groups on the given sides would move."""
    compat = script_compat_for(font)
    compat.invalidate()  # a bulk operation starts from a fresh read
    prefixes = tuple(prefixes)
    groups = font.groups
    taken = set(groups.keys())
    moves: list[SplitMove] = []
    for group in sorted(name for name in groups.keys() if name.startswith(prefixes)):
        prefix = _side_prefix(group)
        short = group[len(prefix) :]
        for script, glyphs in compat.foreign_members(group).items():
            wanted = f"{short}_{script.lower()}"
            full = prefix + wanted
            exists = full in groups and _key_script_is(compat, groups[full], script)
            if not exists:
                full = prefix + free_name(wanted, prefix, taken)
            taken.add(full)
            moves.append(SplitMove(group, script, tuple(glyphs), full, exists))
    logger.info(
        "Split by script: %d move(s) planned in %s", len(moves), getattr(font, "path", None)
    )
    return moves


def _key_script_is(compat: Any, members: Iterable[str], script: str) -> bool:
    """True if a group's key glyph is of ``script`` (it can take the glyphs)."""
    members = list(members)
    return bool(members) and script in compat.glyph_scripts(members[0])


def apply_split(manager: Any, moves: Iterable[SplitMove]) -> None:
    """Carry out a plan through a FontGroupsManager (kerning follows).

    Main thread only when the font is on screen: windows read the groups and
    kerning while they draw.
    """
    moves = list(moves)
    for move in moves:
        glyphs = list(move.glyphs)
        manager.remove_glyphs_from_group(move.source, glyphs)
        manager.add_glyphs_to_group(move.target, glyphs)
    logger.info(
        "Split by script: %d move(s) applied in %s",
        len(moves),
        getattr(manager.font, "path", None),
    )


def new_cross_pairs(font: Any, before: Mapping[tuple, int]) -> list[tuple[str, str]]:
    """Pairs that are cross-script now and were not in ``before``.

    ``before`` is ``script_compat_for(font).pair_statuses(...)`` of the
    kerning taken before the split. A pair the split created (``@A_cyrl``
    against ``@V``) was not there at all, which counts as "was not".
    """
    compat = script_compat_for(font)
    compat.invalidate()
    now = compat.pair_statuses(list(font.kerning.keys()))
    return sorted(
        pair
        for pair, status in now.items()
        if status == PAIR_SCRIPT_CROSS and before.get(pair) != PAIR_SCRIPT_CROSS
    )


def plan_lines(moves: Iterable[SplitMove]) -> list[str]:
    """``@A → @A_cyrl (new): uni0410, uni042F`` — one line per move."""
    return [
        "%s → %s%s: %s"
        % (
            side_label(move.source),
            side_label(move.target),
            "" if move.target_exists else " (new)",
            ", ".join(move.glyphs),
        )
        for move in moves
    ]
