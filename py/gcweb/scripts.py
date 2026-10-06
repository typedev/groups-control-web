"""The script a glyph belongs to, for the font grid's script filter and sort.

The character comes from Font-Rover's glyph_codepoint (own unicode, then the
base name before the dot, uniXXXX names, ligature parts; no components). Its
script is the Unicode Script property, not Script_Extensions: combining
marks, the middle dot or the modifier apostrophe list a dozen scripts in
their extensions, which would fill the filter with scripts the font does not
have. Common and Inherited characters (figures, punctuation, marks) have no
script here and are shown as Common.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable, Sequence

from fontTools import unicodedata

from gcweb.vendor.compat import glyph_codepoint

COMMON = "Zyyy"
_NO_SCRIPT = frozenset({"Zyyy", "Zinh", "Zzzz"})


def glyph_scripts(names: Iterable[str], unicodes_of: Callable[[str], Sequence[int] | None]) -> dict[str, str]:
    """{glyph: ISO 15924 code} for the glyphs that have a script."""
    out = {}
    for name in names:
        codepoint = glyph_codepoint(name, unicodes_of)
        if codepoint is None:
            continue
        script = unicodedata.script(chr(codepoint))
        if script not in _NO_SCRIPT:
            out[name] = script
    return out


def script_label(code: str) -> str:
    """``Cyrillic`` for ``Cyrl``; ``Common`` for no script."""
    try:
        return unicodedata.script_name(code)
    except KeyError:
        return code
