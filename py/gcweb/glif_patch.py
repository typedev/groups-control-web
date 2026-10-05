"""Minimal-diff edits of GLIF text for margin changes.

fontTools' glifLib writes its own style (quotes, indentation), so rewriting a
glyph from objects turns a one-number edit into a whole-file diff on many
fonts (docs/RESEARCH_MARGINS.md §3). A margin edit only changes numbers, so
this patches the original text in place:

- ``shift`` moves the drawing: every <point x>, <component xOffset>,
  <anchor x> and <guideline x> (guidelines without x are horizontal);
- ``component_dx`` adds to the xOffset of components by index;
- ``width`` sets <advance width>.

Everything else stays byte-identical. <image xOffset> is not moved (fontParts
and the desktop do not move images either).
"""

from __future__ import annotations

import re
from decimal import Decimal

_TAG = re.compile(r"<(point|component|anchor|guideline|advance)\b([^>]*?)(\s*/?)>")
_GLYPH_OPEN = re.compile(r"<glyph\b[^>]*>")


def _dec(value) -> Decimal:
    return value if isinstance(value, Decimal) else Decimal(repr(value) if isinstance(value, float) else str(value))


def fmt(value) -> str:
    """Integers without a decimal point; others with no trailing zeros.

    Sums are done in Decimal (see add()), so "549.716172201" + 7 keeps every
    digit the file had instead of float noise or rounding.
    """
    d = _dec(value)
    if d == d.to_integral_value():
        return str(int(d))
    text = format(d.normalize(), "f")
    return text.rstrip("0").rstrip(".") if "." in text else text


def add(text: str, delta) -> str:
    return fmt(Decimal(text) + _dec(delta))


def _attr(name: str) -> re.Pattern:
    return re.compile(r"(\s" + name + r"\s*=\s*)([\"'])([^\"']*)\2")


_X = _attr("x")
_X_OFFSET = _attr("xOffset")
_WIDTH = _attr("width")
_BASE = _attr("base")


def _shift_attr(attrs: str, pattern: re.Pattern, dx: float) -> tuple[str, bool]:
    m = pattern.search(attrs)
    if not m:
        return attrs, False
    new = add(m.group(3), dx)
    return attrs[: m.start(3)] + new + attrs[m.end(3) :], True


def _quote_of(attrs: str) -> str:
    m = re.search(r"=\s*([\"'])", attrs)
    return m.group(1) if m else '"'


def patch_glif(
    text: str,
    shift: float = 0,
    width: float | None = None,
    component_dx: dict[int, float] | None = None,
) -> str:
    component_dx = component_dx or {}
    component_index = -1
    saw_advance = False

    def edit(m: re.Match) -> str:
        nonlocal component_index, saw_advance
        tag, attrs, end = m.group(1), m.group(2), m.group(3)
        if tag in ("point", "anchor", "guideline") and shift:
            attrs, _ = _shift_attr(attrs, _X, shift)
        elif tag == "component":
            component_index += 1
            dx = shift + component_dx.get(component_index, 0)
            if dx:
                attrs, found = _shift_attr(attrs, _X_OFFSET, dx)
                if not found:
                    q = _quote_of(attrs)
                    base = _BASE.search(attrs)
                    at = base.end() if base else len(attrs)
                    attrs = attrs[:at] + f" xOffset={q}{fmt(dx)}{q}" + attrs[at:]
        elif tag == "advance":
            saw_advance = True
            if width is not None:
                m_w = _WIDTH.search(attrs)
                if m_w:
                    attrs = attrs[: m_w.start(3)] + fmt(width) + attrs[m_w.end(3) :]
                else:
                    q = _quote_of(attrs)
                    attrs = f" width={q}{fmt(width)}{q}" + attrs
        return f"<{tag}{attrs}{end}>"

    out = _TAG.sub(edit, text)
    if width is not None and not saw_advance and width != 0:
        opening = _GLYPH_OPEN.search(out)
        if opening is None:
            raise ValueError("not a GLIF: no <glyph> element")
        rest = out[opening.end() :]
        indent = re.match(r"(\r?\n)([ \t]*)", rest)
        newline, pad = (indent.group(1), indent.group(2)) if indent else ("\n", "  ")
        q = _quote_of(opening.group(0))
        out = out[: opening.end()] + f"{newline}{pad}<advance width={q}{fmt(width)}{q}/>" + rest
    return out
