"""Tools menu (Phase 7): Font-Rover's Groups Control board scripts, single UFO.

Every tool is a dry run first: `plan(font, options)` reads the font and
returns report lines plus an `apply` step. Applying runs that step on a
*working copy* of groups and kerning (the same path the desktop uses for
journal replay and import), and the copy then replaces the font's groups and
kerning in one step — so the worker's delta, Lang updates and dirty state work
as for any other edit. Engines are vendored from font_rover/groups_control/.

Options are described as plain data so the UI can build one dialog for all:
    {"id", "type": "radio" | "checkbox" | "entry", "label", "default",
     "choices": [[value, label], ...]  (radio), "placeholder" (entry)}
Context the UI passes along: options["_selectedGroups"], options["_side"].
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable

from gcweb.fr_font import FRFont
from gcweb.vendor import (
    clean_kerning,
    cross_pairs,
    flatten_kerning,
    key_glyphs,
    merge_script_groups,
    place_composites,
    place_ligatures,
    rename_groups,
    round_kerning,
    split_groups,
)
from gcweb.vendor.compat import script_compat_for
from gcweb.vendor.copy_groups import _RemovableDict
from gcweb.vendor.cross_pairs import side_label

SHOWN = 400  # report lines kept for the dialog


class WorkFont(FRFont):
    """FRFont over copies of the groups and kerning, for applying a plan."""

    def __init__(self, doc) -> None:
        super().__init__(doc)
        self._groups = _RemovableDict({k: tuple(v) for k, v in doc.master.groups.items()})
        self._kerning = _RemovableDict(dict(doc.master.kerning))

    @property
    def groups(self):
        return self._groups

    @property
    def kerning(self):
        return self._kerning


@dataclass
class Plan:
    lines: list[str]
    changes: bool
    apply: Callable[[WorkFont, Any], None] = field(repr=False)
    summary: str = ""


@dataclass
class Tool:
    id: str
    name: str
    description: str
    options: list[dict]
    plan: Callable[[FRFont, dict], Plan]

    def spec(self) -> dict:
        return {"id": self.id, "name": self.name, "description": self.description, "options": self.options}


def _set_values(work: WorkFont, values: dict) -> None:
    """desktop api.set_kerning_values: value None removes the pair."""
    for key, value in values.items():
        if value is None:
            work.kerning.pop(key, None)
        else:
            work.kerning[key] = value


def _remove(work: WorkFont, keys) -> None:
    for key in keys:
        work.kerning.pop(tuple(key), None)


def _kern_groups(font: FRFont, options: dict) -> list[str]:
    """'selected' → the groups selected in the groups grid, else all kern groups."""
    if options.get("groups") == "selected":
        return [g for g in options.get("_selectedGroups", []) if g in font.groups]
    return sorted(g for g in font.groups if g.startswith(("public.kern1.", "public.kern2.")))


def _clip(lines: list[str]) -> list[str]:
    if len(lines) <= SHOWN:
        return lines
    return lines[:SHOWN] + [f"… {len(lines) - SHOWN} more lines"]


GROUPS_OPTION = {
    "id": "groups",
    "type": "radio",
    "label": "Groups",
    "default": "selected",
    "choices": [["selected", "Selected group"], ["all", "All kerning groups"]],
}


# -- the tools --------------------------------------------------------------------


def _clean(font: FRFont, o: dict) -> Plan:
    plan = clean_kerning.plan_clean(font)
    rz = bool(o.get("removeIdleZeros"))
    lines = clean_kerning.summary_lines(plan, rz)
    clean = plan.is_clean(rz)
    if not clean:
        lines += [""] + clean_kerning.detail_lines(plan)

    def apply(work, manager):
        clean_kerning.remove_malformed(work, plan)
        clean_kerning.apply_groups(work, manager, plan)
        _remove(work, plan.pairs_to_remove(rz))

    return Plan(lines, not clean, apply)


def _key_glyphs(font: FRFont, o: dict) -> Plan:
    plan = key_glyphs.plan_key_glyphs(font)
    lines = key_glyphs.plan_lines(plan)
    unnamed = key_glyphs.unnamed_lines(plan)
    summary = f"{len(plan.moves)} to reorder, {plan.in_place} in place, {len(plan.unnamed)} unnamed"
    if unnamed:
        lines += ["", "Left as they are — the name names no member:"] + unnamed
    return Plan([summary, ""] + lines, bool(plan.moves), lambda w, m: key_glyphs.apply_key_glyphs(w, m, plan))


def _flatten(font: FRFont, o: dict) -> Plan:
    plan = flatten_kerning.plan_flatten(font, bool(o.get("keepGroups")))

    def apply(work, manager):
        _set_values(work, plan.values)
        flatten_kerning.delete_kerning_groups(work, manager, plan.groups)

    return Plan(flatten_kerning.summary_lines(plan), bool(plan.values or plan.groups), apply)


def _merge(font: FRFont, o: dict) -> Plan:
    suffixes = [s for s in str(o.get("suffixes", "")).replace(",", " ").split() if s]
    if not suffixes:
        raise ValueError("No suffix given.")
    plan = merge_script_groups.plan_merge([font], suffixes, bool(o.get("resolve")), bool(o.get("rename")))
    result = plan.results.get(id(font))
    lines = [f"Suffixes: {' '.join(suffixes)}"]
    lines += [f"  {side_label(p)} ← {side_label(c)}" for c, p in plan.merges.items()]
    lines += [f"  {side_label(c)} → {side_label(p)} (renamed)" for c, p in plan.renames.items()]
    if result is not None:
        lines.append(f"{result.moved} pair(s) move to the parent, {result.folded} fold into its own")
    if plan.held_back:
        lines += ["", "Left as they are — merging would change kerning that shows in text:"]
        for child, conflict in plan.held_back.items():
            lines.append(f"  {side_label(child)} ({len(conflict)} pair(s)):")
            lines += [f"    {line}" for line in conflict[:5]]
            if len(conflict) > 5:
                lines.append(f"    … {len(conflict) - 5} more")
    orphans = [(c, p) for c, p in plan.orphans if c not in plan.renames]
    if orphans:
        lines += ["", "No parent group:"] + [f"  {side_label(c)} (no {side_label(p)})" for c, p in orphans]

    def apply(work, manager):
        if result is not None:
            _set_values(work, merge_script_groups.kerning_changes(work, result))
        merge_script_groups.apply_groups(work, manager, plan)

    return Plan(lines, bool(plan.merges or plan.renames), apply)


def _place_composites(font: FRFont, o: dict) -> Plan:
    plan = place_composites.plan_composites(font, _kern_groups(font, o), bool(o.get("sameScript")))
    lines = place_composites.plan_lines(plan)
    skipped = place_composites.skipped_lines(plan)
    if skipped:
        lines += ["", "Left out:"] + skipped
    return Plan(
        lines or ["No composites to add."],
        bool(plan.additions),
        lambda w, m: place_composites.apply_additions(w, m, plan.additions),
    )


def _place_ligatures(font: FRFont, o: dict) -> Plan:
    plan = place_ligatures.plan_ligatures(font)
    lines = place_ligatures.plan_lines(plan)
    skipped = place_ligatures.skipped_lines(plan)
    if skipped:
        lines += ["", "Left out:"] + skipped
    return Plan(
        lines or ["No ligatures to add."],
        bool(plan.additions),
        lambda w, m: place_composites.apply_additions(w, m, plan.additions),
    )


def _cross_pairs(font: FRFont, o: dict) -> Plan:
    pairs = cross_pairs.find_cross_pairs(font, o.get("with") == "language")
    lines = [f"{len(pairs)} pair(s) to remove"] + ([""] + cross_pairs.report_lines(pairs) if pairs else [])
    return Plan(lines, bool(pairs), lambda w, m: _remove(w, [p.pair for p in pairs]))


def _rename(font: FRFont, o: dict) -> Plan:
    mode = o.get("mode", rename_groups.MODE_KEY_GLYPH)
    find = str(o.get("find", ""))
    if mode == rename_groups.MODE_REPLACE and not find:
        raise ValueError("Find and replace needs something to find.")
    plan = rename_groups.plan_renames(font, _kern_groups(font, o), mode, find, str(o.get("replace", "")))
    lines = rename_groups.plan_lines(plan)
    skipped = rename_groups.skipped_lines(plan)
    if skipped:
        lines += ["", "Left as they are:"] + skipped
    return Plan(
        lines or ["Nothing to rename."],
        bool(plan.renames),
        lambda w, m: rename_groups.apply_renames(w, m, plan.renames),
    )


def _round(font: FRFont, o: dict) -> Plan:
    plan = round_kerning.plan_round(font, int(o.get("step", 5)))
    lines = round_kerning.summary_lines(plan)
    if plan.changes:
        lines += [""] + round_kerning.change_lines(font, plan)
    return Plan(lines, bool(plan.changes), lambda w, m: _set_values(w, plan.changes))


def _split(font: FRFont, o: dict) -> Plan:
    sides = {"both": split_groups.SIDE_PREFIXES, "kern1": ("public.kern1.",), "kern2": ("public.kern2.",)}
    moves = split_groups.plan_split(font, sides[o.get("sides", "both")])
    remove_cross = bool(o.get("removeCross", True))

    def apply(work, manager):
        before = script_compat_for(work).pair_statuses(list(work.kerning.keys()))
        split_groups.apply_split(manager, moves)
        if remove_cross:
            script_compat_for(work).invalidate()
            _remove(work, split_groups.new_cross_pairs(work, before))

    lines = split_groups.plan_lines(moves)
    return Plan(lines or ["No group mixes scripts."], bool(moves), apply)


TOOLS: dict[str, Tool] = {
    t.id: t
    for t in [
        Tool(
            "clean",
            "Clean Groups & Kerning",
            "Remove what kerning can no longer use: missing or doubled group members, empty groups, "
            "malformed and lost pairs, pairs without a value.",
            [{"id": "removeIdleZeros", "type": "checkbox", "label": "Also remove zero pairs that override nothing", "default": False}],
            _clean,
        ),
        Tool(
            "keyGlyphs",
            "Fix Key Glyph Position",
            "Put the glyph a group is named after first, so it becomes the key glyph. Kerning is untouched.",
            [],
            _key_glyphs,
        ),
        Tool(
            "flatten",
            "Flatten Kerning",
            "Turn every group pair into glyph pairs with the value that applies today. "
            "Flat kerning is many times larger.",
            [{"id": "keepGroups", "type": "checkbox", "label": "Keep the kerning groups (flatten only the kerning)", "default": False}],
            _flatten,
        ),
        Tool(
            "merge",
            "Merge Script Groups",
            "Fold script groups (A_cyrl, A_grek…) back into their parent group, keeping the kerning that shows.",
            [
                {"id": "suffixes", "type": "entry", "label": "Suffixes", "default": " ".join(merge_script_groups.DEFAULT_SUFFIXES)},
                {"id": "resolve", "type": "checkbox", "label": "Merge groups with conflicts too — keep the changed glyph pairs with exceptions", "default": False},
                {"id": "rename", "type": "checkbox", "label": "Rename a group whose parent does not exist (A_grek → A)", "default": False},
            ],
            _merge,
        ),
        Tool(
            "placeComposites",
            "Place Composites into Groups",
            "Add each ungrouped composite to the group of its base glyph.",
            [
                GROUPS_OPTION,
                {"id": "sameScript", "type": "checkbox", "label": "Leave out glyphs of another script than the key glyph", "default": False},
            ],
            _place_composites,
        ),
        Tool(
            "placeLigatures",
            "Place Ligatures into Groups",
            "Side 1 takes the group of the ligature's last part, side 2 the group of its first part.",
            [],
            _place_ligatures,
        ),
        Tool(
            "crossPairs",
            "Remove Cross-Language Pairs",
            "Remove kerning pairs whose sides never meet in text.",
            [
                {
                    "id": "with",
                    "type": "radio",
                    "label": "Remove pairs with",
                    "default": "scripts",
                    "choices": [["scripts", "Different scripts"], ["language", "Different scripts, or no common language"]],
                }
            ],
            _cross_pairs,
        ),
        Tool(
            "rename",
            "Rename Groups",
            "Name groups after their key glyph, or find and replace in their names. Kerning follows.",
            [
                GROUPS_OPTION,
                {
                    "id": "mode",
                    "type": "radio",
                    "label": "New name",
                    "default": rename_groups.MODE_KEY_GLYPH,
                    "choices": [[rename_groups.MODE_KEY_GLYPH, "By key glyph"], [rename_groups.MODE_REPLACE, "Find and replace"]],
                },
                {"id": "find", "type": "entry", "label": "Find", "default": "", "placeholder": "_cyr"},
                {"id": "replace", "type": "entry", "label": "Replace with", "default": ""},
            ],
            _rename,
        ),
        Tool(
            "round",
            "Round Kerning",
            "Round values to a multiple of 5 or 10; values under 5 become 0 (removed unless they override a pair).",
            [{"id": "step", "type": "radio", "label": "To a multiple of", "default": "5", "choices": [["5", "5"], ["10", "10"]]}],
            _round,
        ),
        Tool(
            "split",
            "Split Groups by Script",
            "Move members of another script than the key glyph into their own group (A → A_cyrl). Kerning follows.",
            [
                {
                    "id": "sides",
                    "type": "radio",
                    "label": "Groups on",
                    "default": "both",
                    "choices": [["both", "Both sides"], ["kern1", "Side 1 (left)"], ["kern2", "Side 2 (right)"]],
                },
                {"id": "removeCross", "type": "checkbox", "label": "Remove the cross-script pairs the split creates", "default": True},
            ],
            _split,
        ),
    ]
}


def plan_tool(doc, tool_id: str, options: dict) -> Plan:
    if tool_id not in TOOLS:
        raise ValueError(f"unknown tool {tool_id!r}")
    plan = TOOLS[tool_id].plan(FRFont(doc), options)
    plan.lines = _clip(plan.lines)
    return plan
