# Vendored from Font-Rover font_rover/groups_control/rename_groups.py @ a052428 (Apache-2.0).
# Do not edit here: fix upstream, then run scripts/vendor_sync.py.
# Copyright 2026 Alexander Lubovenko
# Licensed under the Apache License, Version 2.0

"""
Rename kerning groups in bulk.

The engine behind the *Rename Groups* board script, ported from KernTool4's
``renameGroupsByKeyGlyph`` and ``removeCyrFromGroupsName``. Two ways to get
the new name, both applied to the part after ``public.kern1.`` /
``public.kern2.`` (a group never changes side):

- **by key glyph** — the name becomes the group's first member:
  ``public.kern1._A`` holding ``A`` first → ``public.kern1.A``;
- **find and replace** — plain text, every occurrence: ``_cyr`` → nothing
  turns ``_A_cyr`` into ``_A``.

Nothing is overwritten. A new name that another group already has, or that
two groups would both get, is reported and those groups stay as they are; so
is a name that is empty or holds spaces. Renames that depend on each other
(``A`` → ``B`` while ``B`` → ``C``, or a swap) are ordered, and a cycle goes
through a temporary name. Kerning follows through the manager's
``rename_group``, which also records each rename in the groups journal.

GTK-free.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Iterable

from .clean_kerning import KERN1, KERN2
from .naming import name_problem

logger = logging.getLogger(__name__)

MODE_KEY_GLYPH = "key_glyph"
MODE_REPLACE = "replace"


@dataclass
class RenamePlan:
    renames: list[tuple[str, str]] = field(default_factory=list)  # old, new
    taken: list[tuple[str, str]] = field(default_factory=list)  # new name exists
    shared: list[tuple[str, str]] = field(default_factory=list)  # two groups → one name
    invalid: list[tuple[str, str, str]] = field(default_factory=list)  # old, new, why
    unchanged: int = 0


def _prefix(group: str) -> str | None:
    return next((p for p in (KERN1, KERN2) if group.startswith(p)), None)


def plan_renames(
    font: Any, groups: Iterable[str], mode: str, find: str = "", replace: str = ""
) -> RenamePlan:
    plan = RenamePlan()
    wanted: dict[str, str] = {}
    for group in groups:
        prefix = _prefix(group)
        if prefix is None or group not in font.groups:
            continue
        short = group[len(prefix) :]
        if mode == MODE_KEY_GLYPH:
            members = list(font.groups[group])
            if not members:
                plan.invalid.append((group, "", "the group is empty"))
                continue
            new_short = members[0]
        elif mode == MODE_REPLACE:
            if not find:
                raise ValueError("find must not be empty")
            new_short = short.replace(find, replace)
        else:
            raise ValueError("unknown mode %r" % mode)
        if new_short == short:
            plan.unchanged += 1
            continue
        problem = name_problem(new_short, prefix, ())
        if problem:
            plan.invalid.append((group, prefix + new_short, problem))
            continue
        wanted[group] = prefix + new_short

    targets: dict[str, list[str]] = {}
    for old, new in wanted.items():
        targets.setdefault(new, []).append(old)
    leaving = set(wanted)
    for new, olds in targets.items():
        if len(olds) > 1:
            plan.shared += [(old, new) for old in olds]
        elif new in font.groups and new not in leaving:
            plan.taken.append((olds[0], new))
        else:
            plan.renames.append((olds[0], new))
    plan.renames.sort()
    return plan


def ordered_steps(renames: list[tuple[str, str]], existing: Iterable[str]) -> list[tuple[str, str]]:
    """The renames as steps that never land on a name still in use.

    A rename whose target is free goes first; that frees its old name for the
    next. What is left is cycles (a swap): one member of each moves to a
    temporary name first and takes its final name last.
    """
    pending = dict(renames)
    occupied = set(existing)
    steps: list[tuple[str, str]] = []
    deferred: list[tuple[str, str]] = []
    while pending:
        free = [old for old, new in pending.items() if new not in occupied]
        if free:
            for old in free:
                new = pending.pop(old)
                steps.append((old, new))
                occupied.discard(old)
                occupied.add(new)
            continue
        # Only cycles remain: break one.
        old, new = next(iter(pending.items()))
        temp = _temporary_name(old, occupied)
        steps.append((old, temp))
        occupied.discard(old)
        occupied.add(temp)
        del pending[old]
        deferred.append((temp, new))
        # The cycle can now unwind; the temporary one moves last.
    for temp, new in deferred:
        steps.append((temp, new))
    return steps


def _temporary_name(group: str, occupied: set[str]) -> str:
    number = 1
    while f"{group}.renaming{number}" in occupied:
        number += 1
    return f"{group}.renaming{number}"


def apply_renames(font: Any, manager: Any, renames: list[tuple[str, str]]) -> int:
    """Carry out the renames in a safe order; returns how many were done.

    Given a plan made on another font, a rename whose group this font lacks,
    or whose new name it already uses for another group, is skipped. Main
    thread only when the font is on screen.
    """
    leaving = {old for old, _new in renames if old in font.groups}
    usable = [
        (old, new)
        for old, new in renames
        if old in font.groups and (new not in font.groups or new in leaving)
    ]
    for old, new in ordered_steps(usable, font.groups.keys()):
        manager.rename_group(old, new)
    renamed = sum(1 for _old, new in usable if new in font.groups)
    logger.info("Rename groups: %d group(s) renamed in %s", renamed, getattr(font, "path", None))
    return renamed


def rename_in_font(
    font: Any, manager: Any, old: str, new: str, check_kerning: bool = True
) -> str | None:
    """Rename one group in one font; None when done, else why it was not.

    For Groups Control's Rename Group across the UFOs of a designspace: a UFO
    that lacks the group, or already uses the new name, is left as it is.
    Main thread only when the font is on screen.
    """
    if old not in font.groups:
        return "no group %s" % old
    if new in font.groups:
        return "%s exists already" % new
    manager.rename_group(old, new, check_kerning=check_kerning)
    return None


def plan_lines(plan: RenamePlan) -> list[str]:
    from .cross_pairs import side_label

    return [
        "%s %s → %s" % (_number(old), side_label(old), side_label(new)) for old, new in plan.renames
    ]


def skipped_lines(plan: RenamePlan) -> list[str]:
    from .cross_pairs import side_label

    lines = [
        "%s %s → %s: another group has that name" % (_number(old), side_label(old), side_label(new))
        for old, new in plan.taken
    ]
    lines += [
        "%s %s → %s: another group would get the same name"
        % (_number(old), side_label(old), side_label(new))
        for old, new in plan.shared
    ]
    lines += ["%s %s: %s" % (_number(old), side_label(old), why) for old, _new, why in plan.invalid]
    return lines


def _number(group: str) -> str:
    return "1" if group.startswith(KERN1) else "2"
