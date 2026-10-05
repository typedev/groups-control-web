# Vendored from Font-Rover font_rover/groups_control/groups_history.py @ a052428 (Apache-2.0).
# Do not edit here: fix upstream, then run scripts/vendor_sync.py.
# Copyright 2024 Alexander Lubovenko
# Licensed under the Apache License, Version 2.0

"""
The history of group edits, as text, and its replay on another UFO.

The history is FontGroupsManager's own journal (``manager.history``), one per
UFO for as long as the font is open. It records the raw commands — what was
asked, not what came of it — as tuples::

    ("add", group, [glyphs], check_kerning, check_language)
    ("remove", group, [glyphs], check_kerning, check_language)
    ("delete", group, [], check_kerning, check_language)
    ("rename", old_name, new_name, check_kerning, check_language)

That is the point of it: replayed on another master, each command goes back
through the same engine, which settles it against that master's own groups
and kerning. A glyph free there joins the group even if it was taken here;
a delete arrives as remove-all + delete, so with ``K+`` the group's kerning
lands on its glyphs before the group goes, and with ``K-`` it goes with it.

The one thing the engine does not settle is a glyph the target font does not
have — ``add_glyphs_to_group`` would put the name in the group anyway — so
the replay leaves such glyphs out and says so.

Text form, one command per line (KernTool4's, without its language flag —
there is no language-compatibility check here)::

    add K+ public.kern1.O O D Q
    remove K- public.kern1.O Q
    delete K+ public.kern2.round
    rename K+ public.kern1.O public.kern1.round
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .copy_groups import FontProxy, TargetResult, describe_changes

OP_ADD = "add"
OP_REMOVE = "remove"
OP_DELETE = "delete"
OP_RENAME = "rename"
OPS = (OP_ADD, OP_REMOVE, OP_DELETE, OP_RENAME)


def entry_to_line(entry) -> str:
    """One journal tuple as a line of text."""
    op, group, arg, check_kerning = entry[0], entry[1], entry[2], entry[3]
    flag = "K+" if check_kerning else "K-"
    if op == OP_RENAME:
        return f"{op} {flag} {group} {arg}"
    if op == OP_DELETE:
        return f"{op} {flag} {group}"
    return " ".join([op, flag, group, *arg])


def history_to_text(entries) -> str:
    return "".join(entry_to_line(entry) + "\n" for entry in entries)


def parse_history(text: str) -> tuple[list[tuple], list[str]]:
    """Journal tuples from the text form, and a note for every line not taken.

    KernTool4 files carry a language flag after the kerning one
    (``add K+ L- …``); it is accepted and ignored, and an ``L+`` is noted,
    since the check it asks for does not exist here.
    """
    entries: list[tuple] = []
    problems: list[str] = []
    for number, raw in enumerate(text.splitlines(), start=1):
        words = raw.split()
        if not words or words[0].startswith("#"):
            continue
        op = words[0]
        if op not in OPS:
            problems.append(f"line {number}: unknown command '{op}'")
            continue
        if len(words) < 3 or words[1] not in ("K+", "K-"):
            problems.append(f"line {number}: expected '{op} K+|K- group …': {raw.strip()}")
            continue
        check_kerning = words[1] == "K+"
        rest = words[2:]
        if rest and rest[0] in ("L+", "L-"):
            if rest[0] == "L+":
                problems.append(f"line {number}: language check (L+) is not supported, ignored")
            rest = rest[1:]
        if not rest:
            problems.append(f"line {number}: no group name: {raw.strip()}")
            continue
        group, args = rest[0], rest[1:]
        if op == OP_RENAME:
            if len(args) != 1:
                problems.append(f"line {number}: rename needs one new name: {raw.strip()}")
                continue
            entries.append((op, group, args[0], check_kerning, False))
        elif op == OP_DELETE:
            entries.append((op, group, [], check_kerning, False))
        else:
            if not args:
                problems.append(f"line {number}: {op} lists no glyphs: {raw.strip()}")
                continue
            entries.append((op, group, list(args), check_kerning, False))
    return entries, problems


@dataclass
class ReplayResult:
    """A history replayed on one UFO. Nothing is written until applied."""

    result: TargetResult
    #: Glyphs left out (not in the font) and glyphs the engine skipped.
    notes: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return self.result.ok


def replay(entries, name, groups, kerning, glyph_names) -> ReplayResult:
    """Run the journal's commands on plain data: a UFO's groups, kerning, glyphs.

    Every command goes to FontGroupsManager as recorded, with its kerning
    flag; the engine settles it against this UFO. Glyphs the UFO lacks are
    left out first — the engine would add their names to the group.
    """
    from ufo_spacing_lib import FontGroupsManager

    old_groups = {g: tuple(members) for g, members in groups.items()}
    old_kerning = dict(kerning)
    proxy = FontProxy(groups, kerning, glyph_names)
    manager = FontGroupsManager(proxy)
    notes: list[str] = []

    for entry in entries:
        op, group, arg, check_kerning = entry[0], entry[1], entry[2], bool(entry[3])
        line = entry_to_line(entry)
        if op in (OP_ADD, OP_REMOVE):
            present = [g for g in arg if g in proxy]
            absent = [g for g in arg if g not in proxy]
            if absent:
                notes.append(f"{line}: not in the font, left out: {' '.join(absent)}")
            if not present:
                continue
            if op == OP_ADD:
                skipped, _, _ = manager.add_glyphs_to_group(
                    group, present, check_kerning=check_kerning
                )
                if skipped:
                    notes.append(f"{line}: kept where they are: {' '.join(skipped)}")
            else:
                manager.remove_glyphs_from_group(group, present, check_kerning=check_kerning)
        elif op == OP_DELETE:
            manager.delete_group(group, check_kerning=check_kerning)
        elif op == OP_RENAME:
            manager.rename_group(group, arg, check_kerning=check_kerning)

    new_groups, new_kerning = dict(proxy.groups), dict(proxy.kerning)
    group_lines, kerning_lines, summary = describe_changes(
        old_groups, new_groups, old_kerning, new_kerning
    )
    log = [f"Replaying {len(entries)} command(s) on {name}", *group_lines, *kerning_lines]
    result = TargetResult(name, new_groups, new_kerning, log, summary, group_lines)
    return ReplayResult(result, notes)
