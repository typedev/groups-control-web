# Vendored from Font-Rover font_rover/groups_control/cross_pairs.py @ a052428 (Apache-2.0).
# Do not edit here: fix upstream, then run scripts/vendor_sync.py.
# Copyright 2026 Alexander Lubovenko
# Licensed under the Apache License, Version 2.0

"""
Cross-language kerning pairs: find them, describe them, show them in context.

The engine behind the *Remove Cross-Language Pairs* board script, ported from
KernTool4's ``removeCrossLanguagePairs``. What counts as cross-language is
decided by ``font_rover.languages.compat``:

- **script** — the sides share no script (Latin A against Cyrillic Д). Such a
  pair can never occur in text;
- **language** — one script, but no language the font supports uses both
  sides (Ukrainian Ґ against Serbian Ђ). Rarer to remove on purpose: a
  language the font does not cover may still need the pair.

A *partial* pair (a mixed group, where only some members never meet the other
side) is never offered: the pair still serves real combinations.

GTK-free: the board script and tests use it as is. Removing the pairs is the
caller's job (``api.remove_kerning_pairs``), so that the font Groups Control
shows gets its undo step.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable

from .compat import PAIR_LANGUAGE_CROSS, PAIR_SCRIPT_CROSS, script_compat_for
from .dependencies import KERN_GROUP_PREFIX, context_glyph, key_glyph


@dataclass(frozen=True)
class CrossPair:
    """One kerning pair found to be cross-language."""

    pair: tuple[str, str]
    value: float
    status: int  # PAIR_SCRIPT_CROSS or PAIR_LANGUAGE_CROSS
    note: str  # why, one line


def find_cross_pairs(font: Any, include_language: bool = False) -> list[CrossPair]:
    """The font's cross-script pairs, and with ``include_language`` also the
    pairs no supported language uses. Script ones first, then by key."""
    wanted = {PAIR_SCRIPT_CROSS}
    if include_language:
        wanted.add(PAIR_LANGUAGE_CROSS)
    compat = script_compat_for(font)
    compat.invalidate()  # a bulk operation starts from a fresh read
    keys = list(font.kerning.keys())
    statuses = compat.pair_statuses(keys)
    found = [
        CrossPair(key, font.kerning[key], statuses[key], compat.pair_status_note(key))
        for key in keys
        if statuses[key] in wanted
    ]
    found.sort(key=lambda item: (-item.status, item.pair))
    return found


def side_label(name: str) -> str:
    """``@name`` for a kerning group, the glyph name otherwise."""
    if name.startswith(KERN_GROUP_PREFIX):
        return "@" + name.split(".", 2)[-1]
    return name


def report_lines(pairs: Iterable[CrossPair]) -> list[str]:
    """One aligned line per pair: value, left, right, reason."""
    rows = [
        (_format_value(item.value), side_label(item.pair[0]), side_label(item.pair[1]), item.note)
        for item in pairs
    ]
    if not rows:
        return []
    widths = [max(len(row[column]) for row in rows) for column in range(3)]
    return [
        "%s  %s  %s  %s"
        % (
            value.rjust(widths[0]),
            left.ljust(widths[1]),
            right.ljust(widths[2]),
            note,
        )
        for value, left, right, note in rows
    ]


def _format_value(value: float) -> str:
    return str(int(value)) if float(value).is_integer() else str(value)


def context_lines(font: Any, pairs: Iterable[CrossPair], per_line: int = 8) -> list[str]:
    """The pairs as Runway text, each between its script's control glyphs.

    ``/H/A/uni0402/H`` — a group side is shown by its key glyph, the controls
    come from the side's own script and case, so a pair reads as it would in
    text. ``per_line`` pairs to a line, ready to paste into the Runway.
    """
    cmap = font.getCharacterMapping()
    lines: list[str] = []
    line: list[str] = []
    for item in pairs:
        left = key_glyph(font, item.pair[0])
        right = key_glyph(font, item.pair[1])
        if left is None or right is None:
            continue
        before = context_glyph(font, left, cmap) or left
        after = context_glyph(font, right, cmap) or right
        line.append("/%s/%s/%s/%s" % (before, left, right, after))
        if len(line) == per_line:
            lines.append("".join(line))
            line = []
    if line:
        lines.append("".join(line))
    return lines
