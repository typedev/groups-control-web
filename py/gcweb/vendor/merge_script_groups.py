# Vendored from Font-Rover font_rover/groups_control/merge_script_groups.py @ a052428 (Apache-2.0).
# Do not edit here: fix upstream, then run scripts/vendor_sync.py.
# Copyright 2026 Alexander Lubovenko
# Licensed under the Apache License, Version 2.0

"""
Merge script groups back into their parents — the inverse of Split Groups by
Script.

The engine behind the *Merge Script Groups* board script, reworked from
KernTool4's unfinished ``combineGroupsIntoParent``. A *child* is a kerning
group whose name is its *parent*'s plus a suffix from the list given
(``public.kern1.A_grek`` → ``public.kern1.A``); nothing else is guessed.

KernTool4 moved the glyphs through the groups manager, which copies a group's
pairs onto every glyph leaving it and folds back only those matching the new
group: every pair the child had with a partner the parent never kerns
(``@A_cyrl @Ya_cyrl``) became one exception per glyph. Here the kerning is
computed first: each key naming a child is renamed to the parent, and

- if the parent has no pair with that partner, the pair simply moves — Latin
  A never meets Cyrillic Я in text, so ``@A @Ya_cyrl`` acts on Cyrillic А
  alone;
- if the parent has it with the same value, the two fold into one;
- if the values differ, the parent's stays.

Then the result is checked where it matters: every glyph pair the merged
groups touch and that can meet in text (same script, or a side of none) must
keep the value it has. A pair that would not — the child's ``@A_grek
@period`` now reaching Latin A, the parent's pairs reaching the child's
glyphs, differing values — is a *conflict*. By default a child with a
conflict is not merged at all (in any UFO, so the groups stay alike across
masters); with ``resolve_conflicts`` exactly those glyph pairs get
exceptions holding their old value. Only cross-script combinations, which
never meet in text, can gain a value.

GTK-free.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Iterable

from .clean_kerning import KERN1, KERN2, raw_kerning

logger = logging.getLogger(__name__)

DEFAULT_SUFFIXES = ("_cyrl", "_grek", "_latn")


def find_children(
    font: Any, suffixes: Iterable[str]
) -> tuple[dict[str, str], list[tuple[str, str]]]:
    """({child: parent}, [(child, missing parent)]) for the given suffixes."""
    suffixes = [s for s in suffixes if s]
    children: dict[str, str] = {}
    orphans: list[tuple[str, str]] = []
    for name in sorted(font.groups.keys()):
        if not name.startswith((KERN1, KERN2)):
            continue
        suffix = next((s for s in suffixes if name.endswith(s)), None)
        if suffix is None:
            continue
        parent = name[: -len(suffix)]
        if parent in (KERN1, KERN2):
            continue
        if parent in font.groups:
            children[name] = parent
        else:
            orphans.append((name, parent))
    return children, orphans


@dataclass
class MergeResult:
    """The new kerning of one UFO for a set of merges, and what it took."""

    kerning: dict[tuple[str, str], Any] = field(default_factory=dict)
    moved: int = 0  # child pairs that became the parent's
    folded: int = 0  # child pairs equal to the parent's
    # child, glyph pair that can meet in text, value before, value after
    changes: list[tuple[str, tuple[str, str], Any, Any]] = field(default_factory=list)
    exceptions: int = 0  # glyph pairs pinned to their old value (resolve_conflicts)


def _group_maps(groups: dict) -> tuple[dict[str, str], dict[str, str]]:
    maps: tuple[dict[str, str], dict[str, str]] = ({}, {})
    for name, members in groups.items():
        index = 0 if name.startswith(KERN1) else 1 if name.startswith(KERN2) else None
        if index is None:
            continue
        for glyph in members:
            maps[index].setdefault(glyph, name)
    return maps


def compute_kerning(
    font: Any, merges: dict[str, str], resolve_conflicts: bool = False
) -> MergeResult:
    """The kerning after merging ``merges`` (child → parent) in ``font``.

    Keys naming a child are renamed to the parent; where the parent has the
    key already, its value stays. Then every glyph pair the merged groups
    touch and that can meet in text (same script, or a side of none) is
    compared before and after by UFO precedence: each difference is recorded
    in ``changes`` and, with ``resolve_conflicts``, pinned to its old value by
    a glyph–glyph exception.
    """
    from .compat import script_compat_for
    from .flatten_kerning import effective_value

    result = MergeResult()
    before = dict(raw_kerning(font).items())
    groups_before = {n: tuple(m) for n, m in font.groups.items()}
    groups_after = {n: m for n, m in groups_before.items() if n not in merges}
    for child, parent in merges.items():
        if parent in groups_after:
            extra = [g for g in groups_before.get(child, ()) if g not in groups_after[parent]]
            groups_after[parent] = tuple(groups_after[parent]) + tuple(extra)
        else:  # a rename: the child becomes the parent
            groups_after[parent] = groups_before.get(child, ())

    def rename(side: str) -> str:
        return merges.get(side, side)

    for pair, value in before.items():
        if pair[0] not in merges and pair[1] not in merges:
            result.kerning[pair] = value
    for pair in sorted(before):
        if pair[0] not in merges and pair[1] not in merges:
            continue
        new = (rename(pair[0]), rename(pair[1]))
        if new not in result.kerning:
            result.kerning[new] = before[pair]
            result.moved += 1
        elif result.kerning[new] == before[pair]:
            result.folded += 1

    # Where a glyph came from, to name the child behind a change.
    origin = {g: child for child in merges for g in groups_before.get(child, ())}
    parents = set(merges.values())
    maps_before, maps_after = _group_maps(groups_before), _group_maps(groups_after)
    compat = script_compat_for(font)

    def members(side: str) -> tuple[str, ...]:
        if side.startswith((KERN1, KERN2)):
            return tuple(g for g in groups_after.get(side, ()) if g in font)
        return (side,) if side in font else ()

    checked: set[tuple[str, str]] = set()
    pinned: dict[tuple[str, str], Any] = {}
    for key in list(result.kerning) + [k for k in before if k not in result.kerning]:
        if key[0] not in parents and key[1] not in parents:
            continue
        for left in members(key[0]):
            for right in members(key[1]):
                pair = (left, right)
                if pair in checked:
                    continue
                checked.add(pair)
                a, b = compat.glyph_mask(left), compat.glyph_mask(right)
                if a and b and not a & b:
                    continue  # never meet in text
                old = effective_value(pair, before, maps_before) or 0
                new = effective_value(pair, result.kerning, maps_after) or 0
                if old == new:
                    continue
                child = origin.get(left) or origin.get(right)
                if child is None:
                    side_group = key[0] if key[0] in parents else key[1]
                    child = next(c for c, p in merges.items() if p == side_group)
                result.changes.append((child, pair, old, new))
                if resolve_conflicts:
                    pinned[pair] = old
    if pinned:
        result.kerning.update(pinned)
        result.exceptions = len(pinned)
    return result


@dataclass
class MergePlan:
    """What merging does across the UFOs chosen."""

    merges: dict[str, str] = field(default_factory=dict)  # child → parent, merged everywhere
    held_back: dict[str, list[str]] = field(default_factory=dict)  # child → conflict lines
    orphans: list[tuple[str, str]] = field(default_factory=list)
    renames: dict[str, str] = field(default_factory=dict)  # orphan child → its new name
    results: dict[int, MergeResult] = field(default_factory=dict)  # id(font) → result


def plan_merge(
    fonts: list[Any],
    suffixes: Iterable[str],
    resolve_conflicts: bool = False,
    rename_orphans: bool = False,
) -> MergePlan:
    """Plan on the first font's groups, check every font's kerning.

    Without ``resolve_conflicts`` a child with a conflict in any of the fonts
    is held back in all of them, so the groups stay alike across masters.
    """
    plan = MergePlan()
    children, plan.orphans = find_children(fonts[0], suffixes)
    if rename_orphans:
        plan.renames = {child: parent for child, parent in plan.orphans}
    merges = dict(children)
    while True:
        conflicted: dict[str, list[str]] = {}
        results = {}
        for font in fonts:
            usable = {c: p for c, p in merges.items() if c in font.groups and p in font.groups}
            usable.update({c: p for c, p in plan.renames.items() if c in font.groups})
            result = compute_kerning(font, usable, resolve_conflicts)
            results[id(font)] = result
            if not resolve_conflicts:
                for child, pair, old, new in result.changes:
                    if child in merges:
                        conflicted.setdefault(child, []).append(
                            _conflict_line(font, child, pair, old, new)
                        )
        if not conflicted:
            break
        # Held back children change what the others collide with: recompute.
        for child, lines in conflicted.items():
            plan.held_back.setdefault(child, []).extend(lines)
            merges.pop(child, None)
    plan.merges = merges
    plan.results = results
    return plan


def _conflict_line(font, child, pair, old, new) -> str:
    path = getattr(font, "path", None)
    name = path.rsplit("/", 1)[-1] if isinstance(path, str) else "font"
    return "%s %s: %s now, %s after merging (%s)" % (
        pair[0],
        pair[1],
        _value(old),
        _value(new),
        name,
    )


def _value(value: Any) -> str:
    return str(int(value)) if float(value).is_integer() else str(value)


def kerning_changes(font: Any, result: MergeResult) -> dict[tuple[str, str], Any]:
    """``{key: value | None}`` turning the font's kerning into the result."""
    current = raw_kerning(font)
    changes: dict[tuple[str, str], Any] = {}
    for key, value in result.kerning.items():
        # Not current.get(): defcon's Kerning.get answers 0 for a missing
        # pair, which hid every exception pinned at 0.
        if key not in current or current[key] != value:
            changes[key] = value
    for key in current.keys():
        if key not in result.kerning:
            changes[key] = None
    return changes


def apply_groups(font: Any, manager: Any, plan: MergePlan) -> int:
    """Move the glyphs, delete the children, rename orphans. Kerning is
    written separately (it is computed, not left to the manager). Main thread
    only when the font is on screen."""
    done = 0
    for child, parent in plan.merges.items():
        if child not in font.groups or parent not in font.groups:
            continue
        members = list(font.groups[child])
        manager.remove_glyphs_from_group(child, members, check_kerning=False)
        manager.add_glyphs_to_group(parent, members, check_kerning=False)
        manager.delete_group(child, check_kerning=False)
        done += 1
    for child, parent in plan.renames.items():
        if child in font.groups and parent not in font.groups:
            manager.rename_group(child, parent, check_kerning=False)
            done += 1
    logger.info("Merge script groups: %d group(s) merged in %s", done, getattr(font, "path", None))
    return done
