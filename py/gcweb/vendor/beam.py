# Vendored from Font-Rover font_rover/utils/beam.py @ a052428 (Apache-2.0).
# Do not edit here: fix upstream, then run scripts/vendor_sync.py.
# Copyright 2024 Alexander Lubovenko
# Licensed under the Apache License, Version 2.0

"""
The beam: a horizontal line at height Y measuring a glyph where it crosses.

Ported from KernTool4's "ray beam". Its outermost crossings give the glyph's
margins *at that height* — the distance a spacer actually sees at the x-height
of a round letter, rather than the one set by an extremum far above — and the
crossings in between are the stems and counters.

Pure Python, no GTK.
"""

from __future__ import annotations

from typing import Any, List, Optional, Tuple

from .outline_intersections import calculate_distances, horizontal_crossings


def beam_crossings(glyph: Any, y: float, glyph_set: Any = None) -> List[float]:
    """X coordinates where the outline crosses the beam, left to right.

    Even in number, so ``xs[0::2]``/``xs[1::2]`` pair into ink spans. Empty
    when the beam misses the glyph (a period above it, an empty glyph).
    """
    if glyph is None:
        return []
    return horizontal_crossings(glyph, y, glyph_set)


def margins_from_crossings(
    xs: List[float], y: float, width: float, slant: float = 0.0
) -> Tuple[Optional[float], Optional[float]]:
    """Beam margins from crossings already found: ``(left, right)``.

    ``slant`` is :func:`utils.angled_margins.slant_factor` of the italic angle;
    the crossings are unskewed about the baseline (``x' = x - y * slant``), so
    the beam at height 0 measures the same as the angled margins.
    Both None when the beam misses the glyph.
    """
    if len(xs) < 2:
        return None, None
    shift = y * slant
    return xs[0] - shift, width - (xs[-1] - shift)


def beam_margins(
    glyph: Any,
    y: float,
    glyph_set: Any = None,
    width: Optional[float] = None,
    slant: float = 0.0,
) -> Tuple[Optional[float], Optional[float]]:
    """Left and right margins of the glyph measured along the beam at ``y``.

    Args:
        glyph: Anything with ``draw(pen)``.
        y: Beam height, font units.
        glyph_set: Component lookup; defaults to the glyph's own layer.
        width: Advance width; defaults to ``glyph.width``.
        slant: Italic slant factor (0 = upright).

    Returns:
        ``(left, right)``; ``(None, None)`` when the beam misses the glyph.
    """
    if glyph is None:
        return None, None
    if width is None:
        width = getattr(glyph, "width", 0.0) or 0.0
    return margins_from_crossings(beam_crossings(glyph, y, glyph_set), y, width, slant)


def beam_spans(xs: List[float]) -> List[Tuple[float, float, float]]:
    """``(start, end, length)`` between consecutive crossings: stems and counters alternate."""
    return calculate_distances(xs)
