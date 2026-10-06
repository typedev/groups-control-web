"""Tools between the masters of an open designspace (Tools menu, stage 4).

Like gcweb.tools, every tool is a dry run first: `plan(ctx, options)` reads
the masters and returns report lines plus the new groups and kerning of each
master it would change. Nothing is written until api.tool_apply(), which puts
every result in place as one step (deltas, Lang, dirty state as for any edit).

Options use the same plain-data format as gcweb.tools, plus
    {"id", "type": "masters", "label"}  → a list of master indices
(the UI lists every master but the current one),
    {"id", "type": "master", "label"}   → one master index (not the current one),
    {"id", "type": "checklist", "label"} → values chosen from tool_choices()
Context the UI passes:
options["_keepKerning"], options["_selectedGlyphs"].
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

from ufo_spacing_lib import FontGroupsManager

import re

from gcweb.fr_font import FRFont
from gcweb.scripts import glyph_scripts
from gcweb.vendor import copy_kerning, groups_history, interpolate_kerning, transfer_kerning
from gcweb.vendor.copy_groups import FontProxy, describe_changes, is_kern_group

GROUP_LINES = 40  # per master, in the dialog
PAIR_LINES = 40


@dataclass
class MasterContext:
    """What a tool sees: every master's document, its name, the current one."""

    docs: list
    names: list[str]
    current: int
    # design-space location of each master
    locations: list[dict] = field(default_factory=list)
    # the current master's journal (FontGroupsManager.history)
    history: list = field(default_factory=list)

    def targets(self, options: dict) -> list[int]:
        chosen = options.get("targets") or []
        return [i for i in dict.fromkeys(int(i) for i in chosen) if 0 <= i < len(self.docs) and i != self.current]


@dataclass
class MasterPlan:
    lines: list[str]
    changes: bool
    # master index → (groups, kerning) it gets on apply
    results: dict[int, tuple[dict, dict]] = field(default_factory=dict)


@dataclass
class MasterTool:
    id: str
    name: str
    description: str
    options: list[dict]
    plan: Callable[[MasterContext, dict], MasterPlan]

    def spec(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "options": self.options,
            "needsDesignspace": True,
        }


TARGETS_OPTION = {"id": "targets", "type": "masters", "label": "Into"}


# -- Copy Groups ------------------------------------------------------------------


def match_groups(proxy: FontProxy, source: dict, *, kern: bool, other: bool, keep_kerning: bool) -> dict:
    """Make `proxy`'s groups equal to `source`'s with as few operations as possible.

    Kern groups go through FontGroupsManager so the target's kerning follows
    membership (Keep Kerning semantics): delete the groups the source lacks,
    take out members that belong elsewhere, add the missing ones, then copy
    the member order (key glyphs). Glyphs the target does not have are left
    out. Other groups carry no kerning and are replaced outright.

    Returns {"missing": {group: [glyphs not in the target]},
             "skipped": {group: [glyphs the manager refused]}}.
    """
    manager = FontGroupsManager(proxy)
    groups = proxy.groups
    report: dict = {"missing": {}, "skipped": {}}
    if kern:
        wanted = {n: list(m) for n, m in source.items() if is_kern_group(n)}
        for name in [n for n in groups if is_kern_group(n) and n not in wanted]:
            manager.delete_group(name, check_kerning=keep_kerning)
        for name in [n for n in groups if is_kern_group(n)]:
            keep = set(wanted[name])
            out = [g for g in groups[name] if g not in keep]
            if out:
                manager.remove_glyphs_from_group(name, out, check_kerning=keep_kerning)
        for name, members in wanted.items():
            have = set(groups.get(name, ()))
            missing = [g for g in members if g not in proxy]
            if missing:
                report["missing"][name] = missing
            add = [g for g in members if g not in have and g in proxy]
            if add:
                skipped, _new, _deleted = manager.add_glyphs_to_group(name, add, check_kerning=keep_kerning)
                if skipped:
                    report["skipped"][name] = list(skipped)
        for name, members in wanted.items():
            if name not in groups:
                continue
            current = list(groups[name])
            order = [g for g in members if g in current] + [g for g in current if g not in members]
            if not order:
                manager.delete_group(name, check_kerning=keep_kerning)
            elif order != current:
                groups[name] = tuple(order)
    if other:
        for name in [n for n in groups if not is_kern_group(n) and n not in source]:
            del groups[name]
        for name, members in source.items():
            if not is_kern_group(name) and tuple(groups.get(name, ())) != tuple(members):
                groups[name] = tuple(members)
    return report


def _part(groups: dict, kern: bool, other: bool) -> dict:
    return {
        n: tuple(m)
        for n, m in groups.items()
        if (kern and is_kern_group(n)) or (other and not is_kern_group(n))
    }


def _copy_groups(ctx: MasterContext, o: dict) -> MasterPlan:
    what = o.get("what", "all")
    kern, other = what in ("all", "kern"), what in ("all", "other")
    keep = bool(o.get("_keepKerning", True))
    source = {n: tuple(m) for n, m in ctx.docs[ctx.current].master.groups.items()}
    targets = ctx.targets(o)
    if not targets:
        return MasterPlan(["Choose the masters to copy the groups into."], False)
    lines = [
        f"From {ctx.names[ctx.current]} into {len(targets)} master(s); "
        f"Keep Kerning {'on' if keep else 'off'}."
    ]
    results: dict[int, tuple[dict, dict]] = {}
    for i in targets:
        view = ctx.docs[i].master
        old_groups = {n: tuple(m) for n, m in view.groups.items()}
        old_kerning = dict(view.kerning)
        if _part(old_groups, kern, other) == _part(source, kern, other):
            lines.append(f"{ctx.names[i]}: already the same")
            continue
        proxy = FontProxy(dict(old_groups), dict(old_kerning), ctx.docs[i].ufo.keys())
        report = match_groups(proxy, source, kern=kern, other=other, keep_kerning=keep)
        new_groups, new_kerning = dict(proxy.groups), dict(proxy.kerning)
        group_lines, kerning_lines, summary = describe_changes(old_groups, new_groups, old_kerning, new_kerning)
        lines.append(f"{ctx.names[i]}: {summary}")
        lines.extend("    " + line for line in group_lines[:GROUP_LINES])
        if len(group_lines) > GROUP_LINES:
            lines.append(f"    … {len(group_lines) - GROUP_LINES} more groups")
        for name, glyphs in report["missing"].items():
            lines.append(f"    not in this master, left out of {name}: {' '.join(glyphs)}")
        for name, glyphs in report["skipped"].items():
            lines.append(f"    already in another group, not added to {name}: {' '.join(glyphs)}")
        results[i] = (new_groups, new_kerning)
    return MasterPlan(lines, bool(results), results)


# -- Copy Kerning of Glyphs ---------------------------------------------------------


def _proxy(doc) -> FontProxy:
    """A master's groups and kerning as copies the engines can read (and change)."""
    view = doc.master
    return FontProxy({n: tuple(m) for n, m in view.groups.items()}, dict(view.kerning), doc.ufo.keys())


def _glyph_list(o: dict) -> list[str]:
    if o.get("glyphs") == "typed":
        names = re.split(r"[\s,]+", str(o.get("typed", "")).strip())
    else:
        names = list(o.get("_selectedGlyphs") or [])
    return [n for n in dict.fromkeys(names) if n]


def _copy_kerning(ctx: MasterContext, o: dict) -> MasterPlan:
    glyphs = _glyph_list(o)
    if not glyphs:
        return MasterPlan(["Select glyphs in the font or in the group, or type their names."], False)
    targets = ctx.targets(o)
    if not targets:
        return MasterPlan(["Choose the masters to copy the kerning into."], False)
    source = _proxy(ctx.docs[ctx.current])
    known = [g for g in glyphs if g in source]
    lines = []
    unknown = [g for g in glyphs if g not in source]
    if unknown:
        lines.append(f"Not in {ctx.names[ctx.current]}: {' '.join(unknown)}")
    with_groups = bool(o.get("withGroups", True))
    pairs = copy_kerning.pairs_of_glyphs(source, known, with_groups)
    lines.insert(
        0,
        f"{len(pairs)} pair(s) of {len(known)} glyph(s) in {ctx.names[ctx.current]}"
        + (" (with their groups' pairs)" if with_groups else "")
        + f", into {len(targets)} master(s). Pairs a master has keep their value.",
    )
    results: dict[int, tuple[dict, dict]] = {}
    for i in targets:
        target = _proxy(ctx.docs[i])
        plan = copy_kerning.plan_copy(pairs, target)
        lines.append(copy_kerning.summary_line(ctx.names[i], plan))
        details = copy_kerning.pair_lines(plan)
        lines.extend("    " + line for line in details[:PAIR_LINES])
        if len(details) > PAIR_LINES:
            lines.append(f"    … {len(details) - PAIR_LINES} more")
        if plan.to_copy:
            kerning = dict(target.kerning)
            kerning.update(plan.to_copy)
            results[i] = (dict(target.groups), kerning)
    return MasterPlan(lines, bool(results), results)


# -- Interpolate Kerning --------------------------------------------------------------


def factor_from_locations(a: dict, b: dict, t: dict) -> tuple[float, str]:
    """Where `t` lies from `a` to `b` (0..1) when the three are on one line.

    Axes where A and B agree must hold the target there too; every other
    axis must give the same factor. Returns (factor, a line explaining it).
    """
    factors, parts = [], []
    for axis in sorted(set(a) | set(b) | set(t)):
        va, vb, vt = a.get(axis, 0), b.get(axis, 0), t.get(axis, 0)
        if va == vb:
            if vt != va:
                raise ValueError(f"this master is not between A and B: {axis} {vt:g} vs {va:g}")
            continue
        factors.append((vt - va) / (vb - va))
        parts.append(f"{axis} {vt:g} between {va:g} and {vb:g}")
    if not factors:
        raise ValueError("master A and master B are at the same location")
    if max(factors) - min(factors) > 1e-6:
        raise ValueError("this master is not on the line from A to B; give the position by hand")
    f = factors[0]
    if not 0 < f < 1:
        raise ValueError(f"this master is not between A and B (factor {f:g}); give the position by hand")
    return f, f"position {f:.3g} from the designspace: {', '.join(parts)}"


def _master_option(o: dict, key: str, ctx: MasterContext) -> int:
    try:
        i = int(o.get(key))
    except (TypeError, ValueError):
        raise ValueError("choose master A and master B") from None
    if not 0 <= i < len(ctx.docs) or i == ctx.current:
        raise ValueError("A and B must be other masters than this one")
    return i


def _interpolate(ctx: MasterContext, o: dict) -> MasterPlan:
    ia, ib = _master_option(o, "a", ctx), _master_option(o, "b", ctx)
    if ia == ib:
        raise ValueError("choose two different masters for A and B")
    typed = str(o.get("position", "")).strip()
    if typed:
        try:
            t = float(typed.replace(",", "."))
        except ValueError:
            raise ValueError(f"position {typed!r} is not a number between 0 and 1") from None
        how = f"position {t:g} (typed)"
    else:
        t, how = factor_from_locations(ctx.locations[ia], ctx.locations[ib], ctx.locations[ctx.current])
    a, b, target = _proxy(ctx.docs[ia]), _proxy(ctx.docs[ib]), _proxy(ctx.docs[ctx.current])
    keys = interpolate_kerning.kerning_keys(a, b)
    scope = o.get("pairs", "all")
    if scope == "selected":
        glyphs = _glyph_list({"glyphs": "selected", "_selectedGlyphs": o.get("_selectedGlyphs")})
        if not glyphs:
            return MasterPlan(["Select glyphs in the font or in the group, or choose all pairs."], False)
        maps = [interpolate_kerning.side_group_maps(f.groups) for f in (a, b)]
        keys = interpolate_kerning.keys_touching(keys, glyphs, (), maps, bool(o.get("withGroups", True)))
    names = (ctx.names[ia], ctx.names[ib], ctx.names[ctx.current])
    plan = interpolate_kerning.plan_interpolation(
        a, b, target, t, keys, overwrite=bool(o.get("overwrite", True)), round_values=bool(o.get("round", True)), names=names
    )
    lines = [f"Into {names[2]} from {names[0]} (A) and {names[1]} (B); {how}.", interpolate_kerning.summary_line(names[2], plan)]
    details = interpolate_kerning.detail_lines(plan)
    lines.extend("    " + line for line in details[:PAIR_LINES * 5])
    if len(details) > PAIR_LINES * 5:
        lines.append(f"    … {len(details) - PAIR_LINES * 5} more")
    results = {}
    if plan.to_write:
        kerning = dict(target.kerning)
        kerning.update(plan.to_write)
        results[ctx.current] = (dict(target.groups), kerning)
    return MasterPlan(lines, bool(results), results)


# -- Transfer Kerning by Script -----------------------------------------------------------


def script_choices(ctx: MasterContext) -> list[list[str]]:
    """[[code, "Greek — 120 pairs"], …] for the scripts this master's kerning touches."""
    doc = ctx.docs[ctx.current]
    counts = transfer_kerning.script_counts(FRFont(doc))
    # Only scripts some glyph of this master is written in, plus Common: pairs
    # with marks or punctuation also count towards the scripts in those
    # characters' Script_Extensions (Syriac for the Arabic comma, …).
    layer = doc.ufo.layers.defaultLayer
    own = set(glyph_scripts(doc.glyph_order(), lambda n: layer[n].unicodes if n in layer else None).values())
    counts = {code: n for code, n in counts.items() if code in own or code == transfer_kerning.COMMON}
    return [
        [code, f"{transfer_kerning.script_label(code)} — {n} pairs"]
        for code, n in sorted(counts.items(), key=lambda kv: (kv[0] == transfer_kerning.COMMON, -kv[1]))
    ]


def _transfer(ctx: MasterContext, o: dict) -> MasterPlan:
    scripts = [str(c) for c in o.get("scripts") or []]
    if not scripts:
        return MasterPlan(["Choose the scripts whose kerning to transfer."], False)
    targets = ctx.targets(o)
    if not targets:
        return MasterPlan(["Choose the masters to transfer the kerning into."], False)
    source = FRFont(ctx.docs[ctx.current])
    pair_map = transfer_kerning.pair_scripts(source, list(ctx.docs[ctx.current].master.kerning.keys()))
    overwrite = bool(o.get("overwrite", False))
    lines = [
        f"{', '.join(transfer_kerning.script_label(c) for c in scripts)} from {ctx.names[ctx.current]} "
        f"into {len(targets)} master(s); pairs a master has {'are overwritten' if overwrite else 'keep their value'}."
    ]
    results = {}
    for i in targets:
        target = _proxy(ctx.docs[i])
        plan = transfer_kerning.plan_transfer(source, target, scripts, overwrite, pair_map)
        lines.append(transfer_kerning.summary_line(ctx.names[i], plan))
        details = transfer_kerning.detail_lines(plan)
        lines.extend("    " + line for line in details[:PAIR_LINES])
        if len(details) > PAIR_LINES:
            lines.append(f"    … {len(details) - PAIR_LINES} more")
        if plan.to_write:
            kerning = dict(target.kerning)
            kerning.update(plan.to_write)
            results[i] = (dict(target.groups), kerning)
    return MasterPlan(lines, bool(results), results)


# -- Replay History into Masters --------------------------------------------------------


def _replay_history(ctx: MasterContext, o: dict) -> MasterPlan:
    entries = list(ctx.history)
    if not entries:
        return MasterPlan(["The history of this master is empty: record edits, or load a history file."], False)
    targets = ctx.targets(o)
    if not targets:
        return MasterPlan(["Choose the masters to replay the history in."], False)
    lines = [f"Replaying {len(entries)} command(s) of {ctx.names[ctx.current]}'s history in {len(targets)} master(s)."]
    results = {}
    for i in targets:
        view = ctx.docs[i].master
        replayed = groups_history.replay(
            entries,
            ctx.names[i],
            {n: tuple(m) for n, m in view.groups.items()},
            dict(view.kerning),
            ctx.docs[i].ufo.keys(),
        )
        result = replayed.result
        lines.append(f"{ctx.names[i]}: {result.summary}")
        lines.extend("    " + line for line in result.group_changes[:GROUP_LINES])
        lines.extend("    " + note for note in replayed.notes)
        new_groups = {n: tuple(m) for n, m in result.groups.items()}
        if new_groups != {n: tuple(m) for n, m in view.groups.items()} or result.kerning != dict(view.kerning):
            results[i] = (new_groups, dict(result.kerning))
    return MasterPlan(lines, bool(results), results)


GLYPHS_OPTIONS = [
    {
        "id": "glyphs",
        "type": "radio",
        "label": "Glyphs",
        "default": "selected",
        "choices": [["selected", "Selected glyphs"], ["typed", "Typed below"]],
    },
    {"id": "typed", "type": "entry", "label": "Glyph names", "default": "", "placeholder": "Aogonek Eogonek"},
]


MASTER_TOOLS: dict[str, MasterTool] = {
    t.id: t
    for t in [
        MasterTool(
            "copyGroups",
            "Copy Groups to Masters",
            "Make the groups of the chosen masters the same as this master's. Kerning follows "
            "membership in each master (Keep Kerning applies); masters already the same are left alone.",
            [
                TARGETS_OPTION,
                {
                    "id": "what",
                    "type": "radio",
                    "label": "Groups",
                    "default": "all",
                    "choices": [["all", "All groups"], ["kern", "Kerning groups"], ["other", "Other groups"]],
                },
            ],
            _copy_groups,
        ),
        MasterTool(
            "copyKerning",
            "Copy Kerning of Glyphs",
            "Copy the kerning pairs of some glyphs from this master into others: the glyph's own pairs and, "
            "unless turned off, those of the group holding it (a group pair kerns every glyph of that group). "
            "Only missing pairs are added; a pair naming a glyph or group a master lacks is listed, not copied.",
            [
                TARGETS_OPTION,
                *GLYPHS_OPTIONS,
                {"id": "withGroups", "type": "checkbox", "label": "Also the pairs of their groups", "default": True},
            ],
            _copy_kerning,
        ),
        MasterTool(
            "replayHistory",
            "Replay History into Masters",
            "Run this master's recorded group edits (History panel: add, remove, delete, rename) in other "
            "masters. Each command goes through the same engine there and settles against that master's own "
            "groups and kerning; glyphs a master lacks are left out.",
            [TARGETS_OPTION],
            _replay_history,
        ),
        MasterTool(
            "interpolateKerning",
            "Interpolate Kerning",
            "Interpolate the kerning of two masters into this one: a + (b − a) × position. A pair one master "
            "lacks takes the value that master's kerning applies (its group pair), 0 only when nothing covers it. "
            "Pairs whose glyphs or groups differ between the three masters are listed, not written.",
            [
                {"id": "a", "type": "master", "label": "Master A"},
                {"id": "b", "type": "master", "label": "Master B"},
                {"id": "position", "type": "entry", "label": "Position", "default": "", "placeholder": "0–1; empty = from the designspace"},
                {
                    "id": "pairs",
                    "type": "radio",
                    "label": "Pairs",
                    "default": "all",
                    "choices": [["all", "All pairs of A and B"], ["selected", "Pairs of the selected glyphs"]],
                },
                {"id": "withGroups", "type": "checkbox", "label": "With the pairs of their groups", "default": True},
                {"id": "overwrite", "type": "checkbox", "label": "Overwrite pairs this master has", "default": True},
                {"id": "round", "type": "checkbox", "label": "Round to whole units", "default": True},
            ],
            _interpolate,
        ),
        MasterTool(
            "transferKerning",
            "Transfer Kerning by Script",
            "Copy the kerning of the chosen scripts from this master into others. A pair belongs to every script "
            "either side touches (a group touches the scripts of all its glyphs). Pairs whose glyphs or groups "
            "differ in a master are listed, not written.",
            [
                TARGETS_OPTION,
                {"id": "scripts", "type": "checklist", "label": "Scripts"},
                {"id": "overwrite", "type": "checkbox", "label": "Overwrite pairs a master has", "default": False},
            ],
            _transfer,
        ),
    ]
}


CHOICES = {("transferKerning", "scripts"): script_choices}


def tool_choices(ctx: MasterContext, tool_id: str, option_id: str) -> list[list[str]]:
    """Choices of a "checklist" option, computed from the open masters."""
    fn = CHOICES.get((tool_id, option_id))
    if fn is None:
        raise ValueError(f"no choices for {tool_id}.{option_id}")
    return fn(ctx)


# -- Diff Groups (a view, not a plan) -------------------------------------------------


def groups_diff(ctx: MasterContext, masters: list[int]) -> list[dict]:
    """Kern groups that are not the same in every master of `masters`.

    For each such group, its distinct memberships ("variants") with the
    masters holding each — `members` None where the group does not exist.
    The current master's variant comes first; kerning is not compared.
    Entries: {"group", "level": "order" | "different", "variants": [{"members", "masters"}]}.
    """
    chosen = [ctx.current] + [i for i in dict.fromkeys(masters) if i != ctx.current and 0 <= i < len(ctx.docs)]
    groups = [
        {n: tuple(m) for n, m in ctx.docs[i].master.groups.items() if is_kern_group(n)} for i in chosen
    ]
    names = sorted(set().union(*groups))
    out = []
    for name in names:
        variants: dict[tuple | None, list[int]] = {}
        for i, g in zip(chosen, groups):
            variants.setdefault(g.get(name), []).append(i)
        if len(variants) < 2:
            continue
        sets = {frozenset(v) if v is not None else None for v in variants}
        out.append(
            {
                "group": name,
                "level": "order" if len(sets) == 1 else "different",
                "variants": [{"members": list(v) if v is not None else None, "masters": m} for v, m in variants.items()],
            }
        )
    return out


def match_one_group(proxy: FontProxy, members: list[str] | None, group: str, *, keep_kerning: bool) -> dict:
    """Make one kern group of `proxy` have `members` (None: no such group).

    Glyphs it should take that sit in another group on the same side are
    taken out of that group first. Kerning follows (Keep Kerning semantics).
    Returns {"missing": [glyphs the target lacks], "moved": {from_group: [glyphs]}}.
    """
    manager = FontGroupsManager(proxy)
    groups = proxy.groups
    report: dict = {"missing": [], "moved": {}}
    if members is None:
        if group in groups:
            manager.delete_group(group, check_kerning=keep_kerning)
        return report
    if group in groups:
        out = [g for g in groups[group] if g not in members]
        if out:
            manager.remove_glyphs_from_group(group, out, check_kerning=keep_kerning)
    have = set(groups.get(group, ()))
    report["missing"] = [g for g in members if g not in proxy]
    add = [g for g in members if g not in have and g in proxy]
    side = group[: len("public.kern1.")]
    for name in [n for n in groups if n != group and n.startswith(side)]:
        taken = [g for g in groups[name] if g in add]
        if taken:
            manager.remove_glyphs_from_group(name, taken, check_kerning=keep_kerning)
            report["moved"][name] = taken
            if name in groups and not groups[name]:
                manager.delete_group(name, check_kerning=keep_kerning)
    if add:
        manager.add_glyphs_to_group(group, add, check_kerning=keep_kerning)
    if group in groups:
        current = list(groups[group])
        order = [g for g in members if g in current] + [g for g in current if g not in members]
        if order != current:
            groups[group] = tuple(order)
    return report


def plan_match_group(ctx: MasterContext, group: str, masters: list[int], keep_kerning: bool) -> MasterPlan:
    """Diff Groups action: `group` in `masters` made the same as in the current master."""
    source = ctx.docs[ctx.current].master.groups.get(group)
    members = list(source) if source is not None else None
    lines, results = [], {}
    for i in ctx.targets({"targets": masters}):
        view = ctx.docs[i].master
        theirs = view.groups.get(group)
        if (list(theirs) if theirs is not None else None) == members:
            continue
        old_groups = {n: tuple(m) for n, m in view.groups.items()}
        old_kerning = dict(view.kerning)
        proxy = FontProxy(dict(old_groups), dict(old_kerning), ctx.docs[i].ufo.keys())
        report = match_one_group(proxy, members, group, keep_kerning=keep_kerning)
        results[i] = (dict(proxy.groups), dict(proxy.kerning))
        _g, _k, summary = describe_changes(old_groups, results[i][0], old_kerning, results[i][1])
        line = f"{ctx.names[i]}: {summary}"
        if report["moved"]:
            line += "; taken from " + ", ".join(f"{n} ({' '.join(g)})" for n, g in report["moved"].items())
        if report["missing"]:
            line += f"; not in this master: {' '.join(report['missing'])}"
        lines.append(line)
    return MasterPlan(lines, bool(results), results)


def plan_master_tool(ctx: MasterContext, tool_id: str, options: dict) -> MasterPlan:
    if tool_id not in MASTER_TOOLS:
        raise ValueError(f"unknown tool {tool_id!r}")
    return MASTER_TOOLS[tool_id].plan(ctx, options)
