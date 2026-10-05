# Vendored from Font-Rover font_rover/languages/compat.py @ a052428 (Apache-2.0).
# Do not edit here: fix upstream, then run scripts/vendor_sync.py.
"""
Script and language compatibility of glyphs — which kerning pairs cross
writing systems.

Two levels, as in KernTool4's TDLangSet, but with different sources:

- **Level 1 — script.** The Unicode Script property of the glyph's character
  (``fontTools.unicodedata.script_extension``), not a list of languages. With
  a thousand languages some letters legitimately belong to orthographies of
  two scripts (``A`` is in a Cyrillic orthography's auxiliary set), so "shares
  a language" is too weak a test for "same script". Common and Inherited
  characters (digits, punctuation, combining marks) are compatible with
  everything.
- **Level 2 — language.** Some language needs both characters. Only the
  languages the font supports count (its ``base`` letters are all present),
  and only letters take part — some orthographies list ``'`` or ``-`` as
  letters, which would otherwise make every Cyrillic/hyphen pair "foreign".

A kerning group stands for all its members: its masks are the union of the
members' masks, so a pair is cross-language only if no member combination
shares a script (or language). A glyph whose character cannot be determined is
compatible with everything (in a group it is skipped), so nothing is ever
flagged on a guess.

Every glyph and every codepoint is reduced to integer bitmasks once; a pair
check is then a single ``&``.

The font side follows edits made while it is open: a defcon font's
``unicodeData`` posts a notification on every glyph added, removed, renamed or
re-encoded, which marks the per-font tables stale; they are rebuilt (a few ms)
on the next query. Groups are read live on every query. Fonts without defcon's
notifications are refreshed only by :meth:`ScriptCompat.invalidate`, which
bulk operations call before they start.

Copyright 2026 Alexander Lubovenko
Licensed under the Apache License, Version 2.0
"""

from __future__ import annotations

import logging
import re
import unicodedata
import weakref
from functools import lru_cache
from typing import Any, Callable, Iterable, Mapping, Optional, Sequence

from fontTools import unicodedata as ft_unicodedata

from .charsets import get_languages

logger = logging.getLogger(__name__)

LEVEL_SCRIPT = 1
LEVEL_LANGUAGE = 2
LEVELS = (LEVEL_SCRIPT, LEVEL_LANGUAGE)

# Pair status, ordered by severity (sorting on it puts the worst last).
# "Partial" exists at the script level only: a Cyrillic group always mixes
# letters of different languages (Н, Ґ, Љ), so a language-level "partial"
# would flag nearly every pair and mean nothing. A script-level one means a
# mixed group — Latin A and Cyrillic А kerned as one.
PAIR_OK = 0
PAIR_LANGUAGE_CROSS = 1  # no supported language uses both sides
PAIR_SCRIPT_PARTIAL = 2  # some member of a group never meets the other side
PAIR_SCRIPT_CROSS = 3  # the sides share no script at all

KERN_GROUP_PREFIX = "public.kern"

# Script codes that carry no script identity: Common, Inherited, Unknown.
_NEUTRAL_SCRIPTS = frozenset({"Zyyy", "Zinh", "Zzzz"})

# Latin by the Unicode property, but used as ordinal signs after digits in
# any script — kerning them against Cyrillic is not cross-language.
_NEUTRAL_CODEPOINTS = frozenset({0x00AA, 0x00BA})  # ª º

# One writing system for kerning purposes: CJK text mixes these freely.
_SCRIPT_ALIASES = {"Hira": "Hani", "Kana": "Hani", "Hang": "Hani", "Bopo": "Hani"}

_UNI_NAME = re.compile(r"^(?:uni([0-9A-Fa-f]{4})|u([0-9A-Fa-f]{4,6}))$")

# Script code -> bit, assigned on first sight (there are ~170 scripts).
_script_bits: dict[str, int] = {}


# ─────────────────────────────────────────────────────────────────
# Codepoint level (process-wide, cached)
# ─────────────────────────────────────────────────────────────────


def is_private_use(codepoint: int) -> bool:
    """True for private-use codepoints, which say nothing about a script."""
    return 0xE000 <= codepoint <= 0xF8FF or codepoint >= 0xF0000


def _script_bit(script: str) -> int:
    script = _SCRIPT_ALIASES.get(script, script)
    bit = _script_bits.get(script)
    if bit is None:
        bit = _script_bits[script] = 1 << len(_script_bits)
    return bit


@lru_cache(maxsize=None)
def codepoint_script_mask(codepoint: int) -> int:
    """Script bitmask of a codepoint; 0 means compatible with every script."""
    if codepoint in _NEUTRAL_CODEPOINTS or is_private_use(codepoint):
        return 0
    try:
        scripts = ft_unicodedata.script_extension(chr(codepoint))
    except ValueError:
        return 0
    mask = 0
    for script in scripts:
        if script not in _NEUTRAL_SCRIPTS:
            mask |= _script_bit(script)
    return mask


def script_codes(mask: int) -> tuple[str, ...]:
    """ISO 15924 codes of a script bitmask, sorted (``("Cyrl",)``)."""
    return tuple(sorted(code for code, bit in _script_bits.items() if mask & bit))


@lru_cache(maxsize=1)
def _language_tables() -> tuple[tuple[str, ...], tuple[frozenset, ...], dict[int, int]]:
    """(language ids, base codepoints per language, letter -> language mask).

    Bits index ``get_languages()`` and never change: the font's language scope
    is just another mask ANDed on top, so a scope change rebuilds nothing.
    """
    ids = []
    bases = []
    letter_masks: dict[int, int] = {}
    for index, entry in enumerate(get_languages()):
        ids.append(entry.id)
        bases.append(frozenset(entry.codepoints(("base",))))
        bit = 1 << index
        for codepoint in entry.codepoints(("base", "auxiliary")):
            if _is_letter(codepoint):
                letter_masks[codepoint] = letter_masks.get(codepoint, 0) | bit
    return tuple(ids), tuple(bases), letter_masks


def _is_letter(codepoint: int) -> bool:
    return unicodedata.category(chr(codepoint))[0] == "L" and bool(codepoint_script_mask(codepoint))


def covered_languages_mask(codepoints: Iterable[int]) -> int:
    """Mask of the languages whose base letters are all in ``codepoints``."""
    available = codepoints if isinstance(codepoints, (set, frozenset)) else set(codepoints)
    _ids, bases, _letters = _language_tables()
    mask = 0
    for index, base in enumerate(bases):
        if base and base <= available:
            mask |= 1 << index
    return mask


def language_ids(mask: int) -> tuple[str, ...]:
    """Language ids (``"ru_Cyrl"``) of a language bitmask."""
    ids, _bases, _letters = _language_tables()
    return tuple(lang_id for index, lang_id in enumerate(ids) if mask >> index & 1)


# ─────────────────────────────────────────────────────────────────
# Glyph name -> codepoint
# ─────────────────────────────────────────────────────────────────


def glyph_codepoint(
    name: str,
    unicodes_of: Callable[[str], Optional[Sequence[int]]],
    first_component: Optional[Callable[[str], Optional[str]]] = None,
    depth: int = 0,
) -> Optional[int]:
    """Best guess at the character a glyph stands for.

    In order: the glyph's own unicode, the base name's (before the first dot,
    ``a.sc`` -> ``a``), a ``uniXXXX`` / ``uXXXXX`` name, the first part of a
    ligature name when every part resolves (``f_f``; ``A_cyr`` is not a
    ligature of ``A``), and — only if ``first_component`` is given — the
    first component's (fine for a context glyph, wrong for a script test:
    Cyrillic glyphs are routinely built from Latin components). Private-use codepoints are
    skipped: a suffixed variant mapped to the PUA must still read as its
    script.

    Args:
        name: Glyph name.
        unicodes_of: The unicodes of a glyph in the font, None if absent.
        first_component: The base glyph of a glyph's first component.
    """
    if depth > 8:
        return None
    base = name.split(".", 1)[0] if "." in name and not name.startswith(".") else name
    for candidate in (name, base) if base != name else (name,):
        for codepoint in unicodes_of(candidate) or ():
            if not is_private_use(codepoint):
                return codepoint
    match = _UNI_NAME.match(base)
    if match:
        codepoint = int(match.group(1) or match.group(2), 16)
        if not is_private_use(codepoint):
            return codepoint
    if "_" in base.strip("_"):
        parts = [glyph_codepoint(part, unicodes_of, None, depth + 1) for part in base.split("_")]
        if parts and all(codepoint is not None for codepoint in parts):
            return parts[0]
    if first_component is not None:
        component = first_component(name)
        if component:
            return glyph_codepoint(component, unicodes_of, first_component, depth + 1)
    return None


# ─────────────────────────────────────────────────────────────────
# Font level
# ─────────────────────────────────────────────────────────────────


def is_kerning_group(name: str) -> bool:
    return name.startswith(KERN_GROUP_PREFIX)


class ScriptCompat:
    """Script / language compatibility for one font, kept current with edits.

    Get one with :func:`script_compat_for` so every caller shares the tables.
    """

    def __init__(self, font: Any, hold_font: bool = True):
        """
        Args:
            font: fontParts or defcon font.
            hold_font: False keeps only a weak reference to the defcon font.
                :func:`script_compat_for` needs that: its cache is keyed on the
                font, and a value holding its own key would keep every font
                ever checked alive after its window closed.
        """
        naked = font.naked() if hasattr(font, "naked") else font
        self._font_ref = lambda: naked
        if not hold_font:
            try:
                self._font_ref = weakref.ref(naked)
            except TypeError:  # not weak-referenceable: held after all
                pass
        self._dirty = True
        self._name_to_cps: dict[str, list[int]] = {}
        self._glyph_masks: dict[str, tuple[int, int]] = {}
        self._scope = 0
        unicode_data = _unicode_data(naked)
        self._observes = unicode_data is not None
        if unicode_data is not None:
            # defcon keeps weak references to observer and observable.
            unicode_data.addObserver(
                self, "_unicode_data_changed", unicode_data.changeNotificationName
            )

    @property
    def _font(self) -> Any:
        font = self._font_ref()
        if font is None:
            raise ReferenceError("the font of this ScriptCompat has been freed")
        return font

    # ── staleness ────────────────────────────────────────────────

    def _unicode_data_changed(self, notification=None) -> None:
        self._dirty = True

    def invalidate(self) -> None:
        """Forget everything derived from the font; rebuilt on next query."""
        self._dirty = True

    def _refresh(self) -> None:
        # Without defcon's notifications only invalidate() marks it stale.
        if not self._dirty:
            return
        if self._observes:
            cmap = self._font.unicodeData
        else:
            cmap = self._font.getCharacterMapping()
        name_to_cps: dict[str, list[int]] = {}
        for codepoint, names in cmap.items():
            for name in names:
                name_to_cps.setdefault(name, []).append(codepoint)
        self._name_to_cps = name_to_cps
        self._glyph_masks = {}
        self._scope = covered_languages_mask(cmap.keys())
        self._dirty = False

    # ── glyphs ───────────────────────────────────────────────────

    def codepoint(self, name: str) -> Optional[int]:
        """The character a glyph stands for (see :func:`glyph_codepoint`)."""
        self._refresh()
        return glyph_codepoint(name, self._name_to_cps.get)

    def _masks(self, name: str) -> tuple[int, int]:
        masks = self._glyph_masks.get(name)
        if masks is None:
            # No component fallback here: a Cyrillic glyph built from a Latin
            # component (a ligature of Latin I's) would read as Latin.
            codepoint = glyph_codepoint(name, self._name_to_cps.get)
            if codepoint is None:
                masks = (0, 0)
            else:
                _ids, _bases, letters = _language_tables()
                masks = (
                    codepoint_script_mask(codepoint),
                    letters.get(codepoint, 0) & self._scope,
                )
            self._glyph_masks[name] = masks
        return masks

    def glyph_mask(self, name: str, level: int = LEVEL_SCRIPT) -> int:
        """Script (level 1) or language (level 2) mask of a glyph; 0 = any."""
        self._refresh()
        return self._masks(name)[level - 1]

    def glyph_scripts(self, name: str) -> tuple[str, ...]:
        """ISO 15924 script codes of a glyph, empty when it has none."""
        return script_codes(self.glyph_mask(name, LEVEL_SCRIPT))

    @property
    def languages(self) -> tuple[str, ...]:
        """Ids of the languages the font supports — the level 2 scope."""
        self._refresh()
        return language_ids(self._scope)

    # ── sides and pairs ──────────────────────────────────────────

    def side_mask(self, side: str, level: int = LEVEL_SCRIPT) -> int:
        """Mask of a pair side: a glyph, or the union of a kerning group."""
        self._refresh()
        return self._side_mask(side, level, self._font.groups)

    def _side_mask(self, side: str, level: int, groups: Mapping) -> int:
        if not is_kerning_group(side):
            return self._masks(side)[level - 1]
        # Members without a script (an unresolvable alternate) are skipped:
        # the group is neutral only when none of its members has one.
        mask = 0
        for member in groups.get(side, ()):
            mask |= self._masks(member)[level - 1]
        return mask

    def pair_compatible(self, pair: tuple[str, str], level: int = LEVEL_SCRIPT) -> bool:
        """False if the two sides share no script (or supported language)."""
        self._refresh()
        groups = self._font.groups
        left = self._side_mask(pair[0], level, groups)
        right = self._side_mask(pair[1], level, groups)
        return not left or not right or bool(left & right)

    def cross_pairs(
        self, pairs: Optional[Iterable[tuple[str, str]]] = None, level: int = LEVEL_SCRIPT
    ) -> list[tuple[str, str]]:
        """Pairs whose sides share no script / language (default: the kerning).

        Starts from a fresh read of the font: meant for bulk operations.
        """
        self.invalidate()
        self._refresh()
        if pairs is None:
            pairs = list(self._font.kerning.keys())
        groups = {name: tuple(members) for name, members in self._font.groups.items()}
        side_cache: dict[str, int] = {}

        def side(name: str) -> int:
            mask = side_cache.get(name)
            if mask is None:
                mask = side_cache[name] = self._side_mask(name, level, groups)
            return mask

        result = []
        for pair in pairs:
            left = side(pair[0])
            right = side(pair[1])
            if left and right and not left & right:
                result.append(pair)
        return result

    # ── pair status (for tables) ─────────────────────────────────

    def _side_members(self, side: str, groups: Mapping) -> tuple[list[tuple[str, int]], int, int]:
        """(named script masks of members, script union, language union)."""
        names = groups.get(side, ()) if is_kerning_group(side) else (side,)
        members = []
        scripts = languages = 0
        for name in names:
            script_mask, language_mask = self._masks(name)
            if script_mask:
                members.append((name, script_mask))
                scripts |= script_mask
            languages |= language_mask
        return members, scripts, languages

    def _status(self, left, right) -> int:
        l_members, l_scripts, l_langs = left
        r_members, r_scripts, r_langs = right
        if l_scripts and r_scripts:
            if not l_scripts & r_scripts:
                return PAIR_SCRIPT_CROSS
            if any(not mask & r_scripts for _n, mask in l_members) or any(
                not mask & l_scripts for _n, mask in r_members
            ):
                return PAIR_SCRIPT_PARTIAL
        if l_langs and r_langs and not l_langs & r_langs:
            return PAIR_LANGUAGE_CROSS
        return PAIR_OK

    def pair_status(self, pair: tuple[str, str]) -> int:
        """One of the ``PAIR_*`` constants for a kerning pair."""
        self._refresh()
        groups = self._font.groups
        return self._status(
            self._side_members(pair[0], groups), self._side_members(pair[1], groups)
        )

    def pair_statuses(self, pairs: Iterable[tuple[str, str]]) -> dict[tuple[str, str], int]:
        """``pair_status`` for many pairs, reading each side once."""
        self._refresh()
        groups = {name: tuple(members) for name, members in self._font.groups.items()}
        sides: dict[str, tuple] = {}

        def side(name: str):
            info = sides.get(name)
            if info is None:
                info = sides[name] = self._side_members(name, groups)
            return info

        return {pair: self._status(side(pair[0]), side(pair[1])) for pair in pairs}

    def pair_status_note(self, pair: tuple[str, str]) -> str:
        """A one-line explanation of a pair's status (empty when fine)."""
        self._refresh()
        groups = self._font.groups
        left = self._side_members(pair[0], groups)
        right = self._side_members(pair[1], groups)
        status = self._status(left, right)
        if status == PAIR_SCRIPT_CROSS:
            return (
                f"Different scripts: {', '.join(script_codes(left[1]))}"
                f" | {', '.join(script_codes(right[1]))}"
            )
        if status == PAIR_SCRIPT_PARTIAL:
            stray = [n for n, mask in left[0] if not mask & right[1]]
            stray += [n for n, mask in right[0] if not mask & left[1]]
            shown = ", ".join(stray[:4]) + (f" +{len(stray) - 4}" if len(stray) > 4 else "")
            return f"Mixed scripts: {shown} never meet the other side"
        if status == PAIR_LANGUAGE_CROSS:
            return "No language the font supports uses both sides"
        return ""

    def foreign_members(self, group: str) -> dict[str, list[str]]:
        """Members of a group whose script the key glyph does not share.

        The key glyph is the first member. Returns ``{script code: [names]}``
        in member order; a member of several scripts goes under the first
        code, a member of no identifiable script is never foreign. A key glyph
        without a script makes the group mixed-safe: nothing is foreign.
        """
        self._refresh()
        members = list(self._font.groups.get(group, ()))
        if not members:
            return {}
        key_mask = self._masks(members[0])[0]
        result: dict[str, list[str]] = {}
        if not key_mask:
            return result
        for name in members[1:]:
            mask = self._masks(name)[0]
            if mask and not mask & key_mask:
                result.setdefault(script_codes(mask)[0], []).append(name)
        return result


def _unicode_data(font: Any):
    """The live defcon ``unicodeData`` behind a font, or None."""
    naked = font.naked() if hasattr(font, "naked") else font
    data = getattr(naked, "unicodeData", None)
    if data is not None and hasattr(data, "addObserver"):
        return data
    return None


_instances: "weakref.WeakKeyDictionary[Any, ScriptCompat]" = weakref.WeakKeyDictionary()


def script_compat_for(font: Any) -> ScriptCompat:
    """The shared :class:`ScriptCompat` of a font (fontParts or defcon).

    Keyed on the underlying defcon font, because fontParts wrappers are not
    identical (``font[n] is not font[n]``) and neither are font wrappers.
    """
    key = font.naked() if hasattr(font, "naked") else font
    try:
        compat = _instances.get(key)
    except TypeError:  # not weak-referenceable: no sharing
        return ScriptCompat(font)
    if compat is None:
        compat = _instances[key] = ScriptCompat(font, hold_font=False)
    return compat
