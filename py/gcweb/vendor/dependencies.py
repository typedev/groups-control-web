# Vendored from Font-Rover font_rover/groups_control/dependencies.py @ a052428 (Apache-2.0).
# Do not edit here: fix upstream, then run scripts/vendor_sync.py.
# Copyright 2024 Alexander Lubovenko
# Licensed under the Apache License, Version 2.0

"""
Dependency line for the Groups Control preview (GTK-free).

Selecting a kerning group (or a glyph) shows every glyph whose kerning side
follows from it: the members, the base glyph each member is built on, and all
composites of that base, nested composites included. Each glyph is wrapped in
control glyphs of its own script and case (``H A H``, ``n a n``, ``Н Д Н``) so
the side being checked is seen against a known reference, and glyphs whose
margin on that side differs from the key glyph's are flagged.

This replaces the prototype's language-set patterns with a table derived from
``unicodedata`` — the same control glyphs, without the language database.
"""

from __future__ import annotations

import unicodedata
from dataclasses import dataclass
from typing import Any, Callable, Iterable, Optional

from .compat import glyph_codepoint
from gcweb.fr_font import safe_glyph_order
from gcweb.fr_font import same_margin, side_margin  # noqa: F401 (re-exported)

# Script -> (upper control, lower control, digit control) as code points.
# Punctuation and symbols use the upper control of the script they sit in.
_SCRIPT_CONTROLS: dict[str, tuple[int, int, int]] = {
    "LATIN": (0x0048, 0x006E, 0x0030),  # H n zero
    "CYRILLIC": (0x041D, 0x043D, 0x0030),  # Н н zero
    "GREEK": (0x0397, 0x03B7, 0x0030),  # Η η zero
    "ARMENIAN": (0x0548, 0x0578, 0x0030),  # Ո ո zero
    "GEORGIAN": (0x10B6, 0x10D8, 0x0030),  # Ⴖ ი zero
    "HEBREW": (0x05DD, 0x05DD, 0x0030),  # ם
    "ARABIC": (0x0627, 0x0627, 0x0661),  # ا ١
}
_DEFAULT_SCRIPT = "LATIN"


@dataclass(frozen=True)
class PreviewToken:
    """One glyph of the dependency line.

    Attributes:
        name: Glyph name.
        is_context: True for a control glyph added around a real glyph.
        is_member: True if the glyph belongs to the group being shown.
        mismatch: True if its margin on the checked side differs from the key's.
        margin: That margin (None for context glyphs and empty glyphs).
        context: The control glyph to show around it (glyph tokens only).
        pair_left: The left glyph of a kerning pair on show (pairs mode): the
            pair it starts is one the user edits, unlike glyph-control pairs.
    """

    name: str
    is_context: bool = False
    is_member: bool = False
    mismatch: bool = False
    margin: Optional[float] = None
    context: Optional[str] = None
    pair_left: bool = False


# ─────────────────────────────────────────────────────────────────
# Chain: base glyph + all composites
# ─────────────────────────────────────────────────────────────────


def _carries_body(font: Any, component: Any) -> bool:
    """Whether a component is letter body rather than an accent.

    Its outline must cross the lower half of the x-height band (25-50 % of
    x-height). Accents sit wholly above it (acute, caron) or below it
    (ogonek, cedilla, dot below), however the font spaces them — some give
    their ``.uc`` accents an advance and no mark anchors.
    """
    bounds = component.bounds
    if bounds is None:
        return False
    x_height = font.info.xHeight or (font.info.unitsPerEm or 1000) * 0.5
    _, y_min, _, y_max = bounds
    return y_min < x_height * 0.5 and y_max > x_height * 0.25


def side_parent(font: Any, name: str, side: str) -> Optional[str]:
    """The component a composite inherits its kerning side from, or None.

    The first component (the prototype's rule: ``Aacute`` -> ``A``), unless
    another component that is letter body reaches further past the checked
    edge — then that one. So ``DZ`` (D + Z) hangs off Z on side 1 (its right
    edge is Z's) and off D on side 2, while ``Zacute`` stays with Z however
    the accent is spaced.
    """
    components = [c for c in font[name].components if c.baseGlyph in font]
    if not components:
        return None
    parent = components[0]
    parent_bounds = parent.bounds
    for other in components[1:]:
        other_bounds = other.bounds
        if other_bounds is None or not _carries_body(font, other):
            continue
        if parent_bounds is None:
            parent, parent_bounds = other, other_bounds
        elif side == "kern1" and other_bounds[2] > parent_bounds[2]:
            parent, parent_bounds = other, other_bounds
        elif side != "kern1" and other_bounds[0] < parent_bounds[0]:
            parent, parent_bounds = other, other_bounds
    return parent.baseGlyph


def _side_children(font: Any, name: str, side: str, reverse: dict[str, Iterable[str]]) -> list[str]:
    """Composites of ``name`` that inherit ``side`` from it.

    ``reverse`` is the font's reverse component mapping (a composite is listed
    under every component); only those candidates are checked.
    """
    return [c for c in reverse.get(name, ()) if c in font and side_parent(font, c, side) == name]


def _root_base(font: Any, name: str, parent: Callable[[str], Optional[str]]) -> str:
    """Follow ``parent`` down to the glyph the chain is built on."""
    seen = {name}
    current = name
    while current in font:
        base = parent(current)
        if base is None or base in seen or base not in font:
            break
        seen.add(base)
        current = base
    return current


def _expand_composites(
    name: str,
    children: Callable[[str], Iterable[str]],
    order: dict[str, int],
    out: list[str],
    seen: set[str],
) -> None:
    """Append ``name`` and, depth-first, every composite built on it."""
    if name in seen:
        return
    seen.add(name)
    out.append(name)
    for child in sorted(children(name), key=lambda n: (order.get(n, len(order)), n)):
        _expand_composites(child, children, order, out, seen)


CHAIN_MEMBERS = "members"
CHAIN_ALL = "all"
CHAIN_SMART = "smart"
CHAIN_MODES = (CHAIN_MEMBERS, CHAIN_ALL, CHAIN_SMART)


def dependency_chain(
    font: Any,
    names: Iterable[str],
    side: str = "kern1",
    mode: str = CHAIN_SMART,
    reverse: Optional[dict] = None,
) -> list[str]:
    """Glyphs that share a kerning side with ``names``, in display order.

    Modes:
        ``"members"``: just ``names``.
        ``"all"``: the prototype's reach — root base by the first component,
            then every composite that uses a glyph as *any* component,
            recursively. Most inclusive: a ``DZ`` in a Z group brings in D and
            all its composites.
        ``"smart"``: both steps follow :func:`side_parent`, so a composite
            joins the chain of the glyph whose edge it shares on ``side``.

    Names missing from the font are dropped; duplicates are listed once, at
    their first appearance. ``reverse`` is the font's
    ``getReverseComponentMapping()`` when the caller already has it — it is
    expensive, and a loop over groups must build it once.
    """
    present = [n for n in names if n in font]
    if mode == CHAIN_MEMBERS:
        return list(dict.fromkeys(present))

    if reverse is None:
        reverse = font.getReverseComponentMapping()
    if mode == CHAIN_ALL:

        def parent(glyph_name: str) -> Optional[str]:
            components = font[glyph_name].components
            return components[0].baseGlyph if components else None

        def children(glyph_name: str) -> Iterable[str]:
            return [c for c in reverse.get(glyph_name, ()) if c in font]

    else:

        def parent(glyph_name: str) -> Optional[str]:
            return side_parent(font, glyph_name, side)

        def children(glyph_name: str) -> Iterable[str]:
            return _side_children(font, glyph_name, side, reverse)

    order = {n: i for i, n in enumerate(safe_glyph_order(font))}
    out: list[str] = []
    seen: set[str] = set()
    for name in present:
        _expand_composites(_root_base(font, name, parent), children, order, out, seen)
    return out


# ─────────────────────────────────────────────────────────────────
# Context control glyphs
# ─────────────────────────────────────────────────────────────────


def _codepoint_for(font: Any, name: str) -> Optional[int]:
    """Best guess at the character a glyph stands for.

    Its own unicode, else the base name's (before the first dot), else a
    ``uniXXXX`` / ``uXXXXX`` name, else a ligature's first part, else its
    first component's — see :func:`~font_rover.languages.compat.glyph_codepoint`.
    """

    def unicodes_of(glyph_name: str):
        return font[glyph_name].unicodes if glyph_name in font else None

    def first_component(glyph_name: str) -> Optional[str]:
        if glyph_name not in font:
            return None
        components = font[glyph_name].components
        return components[0].baseGlyph if components else None

    return glyph_codepoint(name, unicodes_of, first_component)


def _control_codepoint(codepoint: Optional[int]) -> int:
    """Control glyph code point for a character, by script and case."""
    if codepoint is None:
        return _SCRIPT_CONTROLS[_DEFAULT_SCRIPT][0]
    char = chr(codepoint)
    try:
        uname = unicodedata.name(char)
    except ValueError:
        uname = ""
    script = next((s for s in _SCRIPT_CONTROLS if uname.startswith(s)), _DEFAULT_SCRIPT)
    upper, lower, digit = _SCRIPT_CONTROLS[script]
    category = unicodedata.category(char)
    if category == "Nd":
        if script == "ARABIC" or 0x0660 <= codepoint <= 0x06F9:
            return 0x0661
        return 0x0030
    if category == "Ll":
        return lower
    if category == "Lo" and script == "GEORGIAN":
        return lower  # Mkhedruli is the everyday (lowercase) form
    if category in ("Lu", "Lt", "Lo", "Lm"):
        return upper
    # Punctuation, symbols, marks: the script's upper control. Common-script
    # characters (period, dollar...) resolve to Latin.
    return upper


def context_glyph(font: Any, name: str, cmap: Optional[dict] = None) -> Optional[str]:
    """Control glyph to show next to ``name``, or None if the font has none.

    A suffixed glyph gets the same-suffixed control when the font has it
    (``a.sc`` -> ``n.sc``), like the prototype.
    """
    if cmap is None:
        cmap = font.getCharacterMapping()
    control_cp = _control_codepoint(_codepoint_for(font, name))
    names = cmap.get(control_cp) or cmap.get(_SCRIPT_CONTROLS[_DEFAULT_SCRIPT][0])
    if not names:
        return None
    control = names[0]
    if "." in name and not name.startswith("."):
        suffixed = f"{control}.{name.split('.', 1)[1]}"
        if suffixed in font:
            return suffixed
    return control


# ─────────────────────────────────────────────────────────────────
# Line
# ─────────────────────────────────────────────────────────────────


def dependency_glyphs(
    font: Any,
    names: list[str],
    side: str,
    key_glyph: Optional[str] = None,
    members: Optional[Iterable[str]] = None,
    mode: str = CHAIN_SMART,
    beam_y: Optional[float] = None,
) -> list[PreviewToken]:
    """The glyphs of the dependency line, without context, in order.

    Args:
        font: fontParts font.
        names: Glyphs to start from (group members, or a single glyph).
        side: ``"kern1"`` (right margin checked) or ``"kern2"`` (left margin).
        key_glyph: Glyph whose margin the others are compared with. Defaults
            to the first of ``names``.
        members: Glyphs belonging to the shown group (flagged ``is_member``).
            Defaults to ``names``.
        mode: How far the chain reaches (see :func:`dependency_chain`).
        beam_y: Measure the margins along the beam at this height; a glyph
            the beam misses is never a mismatch.

    Returns:
        One token per glyph, each carrying its control glyph in ``context``.
    """
    chain = dependency_chain(font, names, side, mode)
    if not chain:
        return []

    if key_glyph is None:
        key_glyph = names[0] if names else chain[0]
    key_margin = side_margin(font[key_glyph], side, beam_y) if key_glyph in font else None
    member_set = set(members if members is not None else names)
    cmap = font.getCharacterMapping()

    tokens: list[PreviewToken] = []
    for name in chain:
        margin = side_margin(font[name], side, beam_y)
        mismatch = (
            key_margin is not None and margin is not None and not same_margin(margin, key_margin)
        )
        tokens.append(
            PreviewToken(
                name=name,
                is_member=name in member_set,
                mismatch=mismatch,
                margin=margin,
                context=context_glyph(font, name, cmap),
            )
        )
    return tokens


def wrap_with_context(
    glyphs: list[PreviewToken],
    advance: Callable[[str], float],
    width: float = float("inf"),
) -> list[list[PreviewToken]]:
    """Lay glyph tokens out in rows, each glyph between its control glyphs.

    Adjacent identical controls within a row are shared (``H A H B H``); a row
    that starts mid-run repeats the control, so no glyph loses its left
    neighbour to a line break.

    Args:
        glyphs: Tokens from :func:`dependency_glyphs`.
        advance: Width of a glyph name in the unit ``width`` is given in.
        width: Row width limit; a row always takes at least one glyph.
    """
    rows: list[list[PreviewToken]] = []
    row: list[PreviewToken] = []
    x = 0.0
    for token in glyphs:
        control = token.context
        shared = bool(row) and control is not None and row[-1].name == control
        added = []
        if control is not None and not shared:
            added.append(PreviewToken(name=control, is_context=True))
        added.append(token)
        if control is not None:
            added.append(PreviewToken(name=control, is_context=True))
        if row and x + sum(advance(t.name) for t in added) > width:
            rows.append(row)
            row, x = [], 0.0
            if shared:
                # The control it shared ends the previous row; repeat it.
                added.insert(0, PreviewToken(name=control, is_context=True))
        added_width = sum(advance(t.name) for t in added)
        row.extend(added)
        x += added_width
    if row:
        rows.append(row)
    return rows


def build_dependency_line(
    font: Any,
    names: list[str],
    side: str,
    key_glyph: Optional[str] = None,
    members: Optional[Iterable[str]] = None,
) -> list[PreviewToken]:
    """The whole dependency line as one row: ``ctx glyph ctx glyph ctx ...``.

    Same arguments as :func:`dependency_glyphs`.
    """
    glyphs = dependency_glyphs(font, names, side, key_glyph, members)
    rows = wrap_with_context(glyphs, lambda name: 0.0)
    return rows[0] if rows else []


# ─────────────────────────────────────────────────────────────────
# Kerning pairs
# ─────────────────────────────────────────────────────────────────

KERN_GROUP_PREFIX = "public.kern"


def side_glyphs(font: Any, key: str) -> list[str]:
    """Glyphs a kern key stands for: a group's members, or the glyph itself."""
    if key.startswith(KERN_GROUP_PREFIX):
        return [g for g in font.groups.get(key, ()) if g in font]
    return [key] if key in font else []


def key_glyph(font: Any, key: str) -> Optional[str]:
    """The glyph shown for a kern key: a group's first member (its key glyph)."""
    glyphs = side_glyphs(font, key)
    return glyphs[0] if glyphs else None


def glyph_pairs(
    font: Any, pairs: Iterable[tuple[str, str]], expanded: bool = False
) -> list[tuple[str, str]]:
    """Glyph pairs to show for kern keys.

    Compact: one glyph pair per key — the key glyphs of its sides.
    Expanded (meant for a single key): every glyph of the left side against
    every glyph of the right side.
    """
    out: list[tuple[str, str]] = []
    for left, right in pairs:
        if expanded:
            rights = side_glyphs(font, right)
            out.extend((gl, gr) for gl in side_glyphs(font, left) for gr in rights)
        else:
            gl, gr = key_glyph(font, left), key_glyph(font, right)
            if gl is not None and gr is not None:
                out.append((gl, gr))
    return out


def pair_rows(
    font: Any, glyph_pairs_: list[tuple[str, str]], per_row: int
) -> list[list[PreviewToken]]:
    """Lay glyph pairs out ``per_row`` to a row: ``ctx L R ctx`` per pair.

    Each pair sits between the control glyphs of its own glyphs (like the
    dependency line); a control shared by neighbouring pairs is drawn once,
    and every row starts with its first pair's control.
    """
    per_row = max(1, per_row)
    cmap = font.getCharacterMapping()
    rows: list[list[PreviewToken]] = []
    for start in range(0, len(glyph_pairs_), per_row):
        row: list[PreviewToken] = []
        for left, right in glyph_pairs_[start : start + per_row]:
            ctx_left = context_glyph(font, left, cmap)
            ctx_right = context_glyph(font, right, cmap)
            shared = bool(row) and row[-1].is_context and row[-1].name == ctx_left
            if ctx_left is not None and not shared:
                row.append(PreviewToken(name=ctx_left, is_context=True))
            row.append(PreviewToken(name=left, is_member=True, pair_left=True))
            row.append(PreviewToken(name=right, is_member=True))
            if ctx_right is not None:
                row.append(PreviewToken(name=ctx_right, is_context=True))
        rows.append(row)
    return rows
