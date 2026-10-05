# Vendored from Font-Rover font_rover/utils/outline_intersections.py @ a052428 (Apache-2.0).
# Do not edit here: fix upstream, then run scripts/vendor_sync.py.
# Copyright 2024 Alexander Lubovenko
# Licensed under the Apache License, Version 2.0

"""
Intersections of straight lines with glyph outlines.

Finds where a horizontal, vertical or angled line crosses a glyph's outline:
guideline intersections in the glyph editor, the beam in a glyph line
(``utils/beam.py``). Pure Python, no GTK.

Outlines are read through a pen (:class:`SegmentPen`), so anything with
``draw(pen)`` works — a fontParts glyph, a fontTools glyph-set glyph, an
interpolated glyph — and components are decomposed to any depth.
"""

from typing import Any, List, Optional, Tuple, TYPE_CHECKING
import math

from fontTools.pens.basePen import BasePen
from fontTools.pens.transformPen import TransformPen

if TYPE_CHECKING:
    from fontParts.base import BaseGlyph, BaseContour

# Tolerance for floating point comparisons
EPSILON = 1e-9

# Two crossings closer than this are one point reached from two segments (the
# line passes through an on-curve point, or touches a curve at its extremum).
CROSSING_MERGE_TOLERANCE = 1e-6

# How far a line is moved off an outline it only touches, so that every
# crossing is a real one and their number is even. Far below anything visible.
TOUCH_NUDGE = 1e-3

# Component nesting deeper than this is a cycle (a glyph using itself).
MAX_COMPONENT_DEPTH = 32


# === Outline reading ===


class SegmentPen(BasePen):
    """Collects an outline as segment dicts, decomposing components.

    Each segment is ``{"type": "line"|"curve"|"qcurve", "points": [...]}``,
    points including the start point (the format of
    :func:`_get_contour_segments`). TrueType runs with implied on-curve points
    arrive already split into single quadratics.

    A component whose base glyph cannot be found is skipped silently: the
    outline is redrawn on every frame, and a warning per frame helps nobody.
    """

    def __init__(self, glyphSet: Any = None, _depth: int = 0):
        super().__init__(glyphSet)
        self.segments: List[dict] = []
        self._depth = _depth
        self._start: Optional[Tuple[float, float]] = None

    def _moveTo(self, pt):
        self._start = (float(pt[0]), float(pt[1]))

    def _lineTo(self, pt):
        p0 = self._getCurrentPoint()
        self.segments.append({"type": "line", "points": [_pt(p0), _pt(pt)]})

    def _curveToOne(self, pt1, pt2, pt3):
        p0 = self._getCurrentPoint()
        self.segments.append({"type": "curve", "points": [_pt(p0), _pt(pt1), _pt(pt2), _pt(pt3)]})

    def _qCurveToOne(self, pt1, pt2):
        p0 = self._getCurrentPoint()
        self.segments.append({"type": "qcurve", "points": [_pt(p0), _pt(pt1), _pt(pt2)]})

    def _closePath(self):
        current = self._getCurrentPoint()
        if self._start is not None and current is not None and _pt(current) != self._start:
            self.segments.append({"type": "line", "points": [_pt(current), self._start]})
        self._start = None

    def _endPath(self):
        self._start = None

    def addComponent(self, glyphName, transformation):
        if self.glyphSet is None or self._depth >= MAX_COMPONENT_DEPTH:
            return
        try:
            base = self.glyphSet[glyphName]
        except (KeyError, TypeError):
            return
        if base is None:
            return
        # A fresh pen per component: BasePen tracks one current point, and the
        # base glyph's contours must not continue this glyph's open path.
        sub = SegmentPen(self.glyphSet, _depth=self._depth + 1)
        base.draw(TransformPen(sub, transformation))
        self.segments.extend(sub.segments)


def _pt(p) -> Tuple[float, float]:
    return (float(p[0]), float(p[1]))


def _default_glyph_set(glyph: Any) -> Any:
    """Where a glyph's components are looked up: its layer, then the default layer.

    A master layer is sparse — a composite in it may use a base glyph only the
    default layer draws — so the layer alone would drop such a component.
    """
    try:
        font = glyph.font
    except AttributeError:
        return None
    if font is None:
        return None
    try:
        layer = glyph.layer
    except AttributeError:
        layer = None
    if layer is None:
        return font
    from .layers import LayerGlyphSet

    return LayerGlyphSet(font, layer.name)


def outline_segments(glyph: Any, glyph_set: Any = None) -> List[dict]:
    """The glyph's outline, components decomposed, as segment dicts.

    Args:
        glyph: Anything with ``draw(pen)``.
        glyph_set: Mapping resolving component base glyphs. Defaults to the
            glyph's own layer (fontParts); without one, components are skipped.
    """
    if glyph is None:
        return []
    if glyph_set is None:
        glyph_set = _default_glyph_set(glyph)
    pen = SegmentPen(glyph_set)
    try:
        glyph.draw(pen)
    except Exception:
        return pen.segments
    return pen.segments


def _merge_close(values: List[float]) -> List[float]:
    """Sorted values with near-equal neighbours merged into one."""
    merged: List[float] = []
    for v in sorted(values):
        if merged and abs(v - merged[-1]) <= CROSSING_MERGE_TOLERANCE:
            continue
        merged.append(v)
    return merged


def _crossings(segments: List[dict], value: float, per_segment) -> List[float]:
    """Crossings of an axis-parallel line with a closed outline, even in number.

    A line that touches the outline (a curve extremum on it, or a vertex
    that turns back) reports a point that is not a crossing and leaves an odd
    count, which pairs every following stem with the wrong partner. Such a
    line is moved by :data:`TOUCH_NUDGE` — first up/right, then down/left —
    and measured again.
    """
    result: List[float] = []
    for candidate in (value, value + TOUCH_NUDGE, value - TOUCH_NUDGE):
        found: List[float] = []
        for segment in segments:
            found.extend(per_segment(segment, candidate))
        result = _merge_close(found)
        if len(result) % 2 == 0:
            return result
    return result


def horizontal_crossings(glyph: Any, y: float, glyph_set: Any = None) -> List[float]:
    """X coordinates where the glyph's outline crosses the line at height ``y``.

    Sorted left to right, even in number (see :func:`_crossings`), so
    consecutive pairs are the ink spans. Components are included.
    """
    return _crossings(outline_segments(glyph, glyph_set), y, _segment_horizontal_intersections)


def vertical_crossings(glyph: Any, x: float, glyph_set: Any = None) -> List[float]:
    """Y coordinates where the glyph's outline crosses the line at ``x``, bottom to top."""
    return _crossings(outline_segments(glyph, glyph_set), x, _segment_vertical_intersections)


# === fontParts-style API (glyph editor guidelines) ===


def find_horizontal_intersections(
    glyph: "BaseGlyph", y: float, include_components: bool = True, glyph_set: Any = None
) -> List[float]:
    """Find all X coordinates where glyph contours cross horizontal line at Y=y.

    Args:
        glyph: Glyph with ``draw(pen)`` (fontParts, fontTools, interpolated).
        y: Y coordinate of horizontal line
        include_components: If True, include component outlines (decomposed)
        glyph_set: Component lookup; defaults to the glyph's own layer.

    Returns:
        Sorted list of X coordinates (left to right)
    """
    if not include_components:
        glyph_set = _NO_COMPONENTS
    return horizontal_crossings(glyph, y, glyph_set)


def find_vertical_intersections(
    glyph: "BaseGlyph", x: float, include_components: bool = True, glyph_set: Any = None
) -> List[float]:
    """Find all Y coordinates where glyph contours cross vertical line at X=x.

    Args:
        glyph: Glyph with ``draw(pen)`` (fontParts, fontTools, interpolated).
        x: X coordinate of vertical line
        include_components: If True, include component outlines (decomposed)
        glyph_set: Component lookup; defaults to the glyph's own layer.

    Returns:
        Sorted list of Y coordinates (bottom to top)
    """
    if not include_components:
        glyph_set = _NO_COMPONENTS
    return vertical_crossings(glyph, x, glyph_set)


def find_angled_intersections(
    glyph: "BaseGlyph",
    x: float,
    y: float,
    angle: float,
    include_components: bool = True,
    glyph_set: Any = None,
) -> List[Tuple[float, float]]:
    """Find all (x,y) points where glyph contours cross angled line.

    Args:
        glyph: Glyph with ``draw(pen)`` (fontParts, fontTools, interpolated).
        x, y: Anchor point of the angled line
        angle: Angle in degrees (0 = horizontal right, 90 = vertical up)
        include_components: If True, include component outlines (decomposed)
        glyph_set: Component lookup; defaults to the glyph's own layer.

    Returns:
        List of (x, y) tuples sorted by distance from anchor point
    """
    if not include_components:
        glyph_set = _NO_COMPONENTS
    intersections = []
    for segment in outline_segments(glyph, glyph_set):
        intersections.extend(_segment_angled_intersections(segment, x, y, angle))

    # Sort by distance from anchor point
    def distance_from_anchor(pt):
        return math.sqrt((pt[0] - x) ** 2 + (pt[1] - y) ** 2)

    # Remove duplicates (using rounding for comparison)
    unique = []
    seen = set()
    for pt in intersections:
        key = (round(pt[0], 4), round(pt[1], 4))
        if key not in seen:
            seen.add(key)
            unique.append(pt)

    return sorted(unique, key=distance_from_anchor)


class _NoComponents:
    """A glyph set with nothing in it: components are left out."""

    def __getitem__(self, name):
        raise KeyError(name)


_NO_COMPONENTS = _NoComponents()


# === Internal: Segment extraction ===


def _get_contour_segments(contour: "BaseContour") -> List[dict]:
    """Extract segments from contour as list of segment dictionaries.

    Each segment is a dict with:
        'type': 'line', 'curve', or 'qcurve'
        'points': list of (x, y) tuples
                  - line: [start, end]
                  - curve: [start, cp1, cp2, end]
                  - qcurve: [start, cp, end] or [start, cp1, cp2, ..., end] for TrueType
    """
    segments = []
    points = list(contour.points)

    if not points:
        return segments

    # Find on-curve point indices
    oncurve_indices = []
    for i, pt in enumerate(points):
        if pt.type != "offcurve":
            oncurve_indices.append(i)

    if len(oncurve_indices) < 2:
        return segments

    # Check if contour is open
    is_open = points[0].type == "move"

    # Build segments between consecutive on-curve points
    for i in range(len(oncurve_indices)):
        start_idx = oncurve_indices[i]

        # For open contours, don't wrap around
        if is_open and i == len(oncurve_indices) - 1:
            break

        end_idx = oncurve_indices[(i + 1) % len(oncurve_indices)]

        start_pt = points[start_idx]
        end_pt = points[end_idx]

        # Collect offcurve points between start and end
        offcurves = []
        j = (start_idx + 1) % len(points)
        while j != end_idx:
            if points[j].type == "offcurve":
                offcurves.append((points[j].x, points[j].y))
            j = (j + 1) % len(points)

        segment = {"points": [(start_pt.x, start_pt.y)], "type": "line"}

        if not offcurves:
            # Line segment
            segment["type"] = "line"
            segment["points"].append((end_pt.x, end_pt.y))
        elif end_pt.type == "curve":
            # Cubic bezier (PostScript) - end point explicitly marked as 'curve'
            segment["type"] = "curve"
            segment["points"].extend(offcurves)
            segment["points"].append((end_pt.x, end_pt.y))
        elif end_pt.type == "qcurve":
            # Quadratic bezier (TrueType)
            if len(offcurves) == 1:
                # Simple quadratic: start -> control -> end
                segment["type"] = "qcurve"
            else:
                # TrueType with multiple offcurves - has implied on-curve points
                segment["type"] = "qcurve_multi"
            segment["points"].extend(offcurves)
            segment["points"].append((end_pt.x, end_pt.y))
        elif len(offcurves) == 1:
            # Fallback: single offcurve, assume quadratic
            segment["type"] = "qcurve"
            segment["points"].extend(offcurves)
            segment["points"].append((end_pt.x, end_pt.y))
        else:
            # Fallback: multiple offcurves, assume TrueType qcurve_multi
            segment["type"] = "qcurve_multi"
            segment["points"].extend(offcurves)
            segment["points"].append((end_pt.x, end_pt.y))

        segments.append(segment)

    return segments


# === Internal: Segment intersection math ===


def _segment_horizontal_intersections(segment: dict, y: float) -> List[float]:
    """Find X coordinates where segment crosses horizontal line at Y=y."""
    seg_type = segment["type"]
    points = segment["points"]

    if seg_type == "line":
        return _line_horizontal_intersection(points[0], points[1], y)
    elif seg_type == "curve":
        return _cubic_horizontal_intersections(points, y)
    elif seg_type == "qcurve":
        return _quadratic_horizontal_intersections(points, y)
    elif seg_type == "qcurve_multi":
        return _qcurve_multi_horizontal_intersections(points, y)

    return []


def _segment_vertical_intersections(segment: dict, x: float) -> List[float]:
    """Find Y coordinates where segment crosses vertical line at X=x."""
    seg_type = segment["type"]
    points = segment["points"]

    if seg_type == "line":
        return _line_vertical_intersection(points[0], points[1], x)
    elif seg_type == "curve":
        return _cubic_vertical_intersections(points, x)
    elif seg_type == "qcurve":
        return _quadratic_vertical_intersections(points, x)
    elif seg_type == "qcurve_multi":
        return _qcurve_multi_vertical_intersections(points, x)

    return []


def _segment_angled_intersections(
    segment: dict, ax: float, ay: float, angle: float
) -> List[Tuple[float, float]]:
    """Find (x,y) points where segment crosses angled line."""
    # Convert angled line to parametric form: point + t * direction
    angle_rad = math.radians(angle)
    dx = math.cos(angle_rad)
    dy = math.sin(angle_rad)

    seg_type = segment["type"]
    points = segment["points"]

    if seg_type == "line":
        return _line_angled_intersection(points[0], points[1], ax, ay, dx, dy)
    elif seg_type == "curve":
        return _cubic_angled_intersections(points, ax, ay, dx, dy)
    elif seg_type == "qcurve":
        return _quadratic_angled_intersections(points, ax, ay, dx, dy)
    elif seg_type == "qcurve_multi":
        return _qcurve_multi_angled_intersections(points, ax, ay, dx, dy)

    return []


# === Line intersection ===


def _line_horizontal_intersection(
    p0: Tuple[float, float], p1: Tuple[float, float], y: float
) -> List[float]:
    """Find X where line segment crosses Y=y."""
    y0, y1 = p0[1], p1[1]

    # Check if y is within segment's y range
    if (y0 - EPSILON <= y <= y1 + EPSILON) or (y1 - EPSILON <= y <= y0 + EPSILON):
        if abs(y1 - y0) < EPSILON:
            # Horizontal line segment
            if abs(y - y0) < EPSILON:
                # Line is at target y - return both endpoints? Or midpoint?
                # Return nothing to avoid duplicate points
                return []
            return []

        t = (y - y0) / (y1 - y0)
        if -EPSILON <= t <= 1 + EPSILON:
            x = p0[0] + t * (p1[0] - p0[0])
            return [x]

    return []


def _line_vertical_intersection(
    p0: Tuple[float, float], p1: Tuple[float, float], x: float
) -> List[float]:
    """Find Y where line segment crosses X=x."""
    x0, x1 = p0[0], p1[0]

    if (x0 - EPSILON <= x <= x1 + EPSILON) or (x1 - EPSILON <= x <= x0 + EPSILON):
        if abs(x1 - x0) < EPSILON:
            # Vertical line segment
            if abs(x - x0) < EPSILON:
                return []
            return []

        t = (x - x0) / (x1 - x0)
        if -EPSILON <= t <= 1 + EPSILON:
            y = p0[1] + t * (p1[1] - p0[1])
            return [y]

    return []


def _line_angled_intersection(
    p0: Tuple[float, float], p1: Tuple[float, float], ax: float, ay: float, dx: float, dy: float
) -> List[Tuple[float, float]]:
    """Find (x,y) where line segment crosses angled line."""
    # Line segment: P = p0 + s * (p1 - p0), s in [0, 1]
    # Angled line: Q = (ax, ay) + t * (dx, dy)
    # Solve: p0 + s * (p1 - p0) = (ax, ay) + t * (dx, dy)

    px, py = p1[0] - p0[0], p1[1] - p0[1]

    # Cross product for denominator
    denom = px * dy - py * dx

    if abs(denom) < EPSILON:
        # Lines are parallel
        return []

    # Solve for s
    s = ((ax - p0[0]) * dy - (ay - p0[1]) * dx) / denom

    if -EPSILON <= s <= 1 + EPSILON:
        x = p0[0] + s * px
        y = p0[1] + s * py
        return [(x, y)]

    return []


# === Cubic Bezier intersection ===


def _cubic_horizontal_intersections(points: List[Tuple[float, float]], y: float) -> List[float]:
    """Find X coordinates where cubic bezier crosses Y=y."""
    p0, p1, p2, p3 = points

    # Cubic bezier Y(t) = (1-t)³*y0 + 3(1-t)²t*y1 + 3(1-t)t²*y2 + t³*y3
    # Solve Y(t) = y for t

    y0, y1, y2, y3 = p0[1], p1[1], p2[1], p3[1]

    # Convert to polynomial: at³ + bt² + ct + d = 0
    a = -y0 + 3 * y1 - 3 * y2 + y3
    b = 3 * y0 - 6 * y1 + 3 * y2
    c = -3 * y0 + 3 * y1
    d = y0 - y

    roots = _solve_cubic(a, b, c, d)

    intersections = []
    for t in roots:
        if -EPSILON <= t <= 1 + EPSILON:
            t = max(0, min(1, t))  # Clamp to [0, 1]
            x = _cubic_eval(p0[0], p1[0], p2[0], p3[0], t)
            intersections.append(x)

    return intersections


def _cubic_vertical_intersections(points: List[Tuple[float, float]], x: float) -> List[float]:
    """Find Y coordinates where cubic bezier crosses X=x."""
    p0, p1, p2, p3 = points

    x0, x1, x2, x3 = p0[0], p1[0], p2[0], p3[0]

    a = -x0 + 3 * x1 - 3 * x2 + x3
    b = 3 * x0 - 6 * x1 + 3 * x2
    c = -3 * x0 + 3 * x1
    d = x0 - x

    roots = _solve_cubic(a, b, c, d)

    intersections = []
    for t in roots:
        if -EPSILON <= t <= 1 + EPSILON:
            t = max(0, min(1, t))
            y = _cubic_eval(p0[1], p1[1], p2[1], p3[1], t)
            intersections.append(y)

    return intersections


def _cubic_angled_intersections(
    points: List[Tuple[float, float]], ax: float, ay: float, dx: float, dy: float
) -> List[Tuple[float, float]]:
    """Find (x,y) where cubic bezier crosses angled line."""
    # Transform problem: rotate so line is horizontal, then solve
    # For simplicity, use numerical subdivision approach

    return _bezier_line_intersections_numerical(points, "curve", ax, ay, dx, dy)


def _cubic_eval(p0: float, p1: float, p2: float, p3: float, t: float) -> float:
    """Evaluate cubic bezier at parameter t."""
    mt = 1 - t
    return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3


# === Quadratic Bezier intersection ===


def _quadratic_horizontal_intersections(points: List[Tuple[float, float]], y: float) -> List[float]:
    """Find X coordinates where quadratic bezier crosses Y=y."""
    p0, p1, p2 = points

    y0, y1, y2 = p0[1], p1[1], p2[1]

    # Quadratic: Y(t) = (1-t)²*y0 + 2(1-t)t*y1 + t²*y2
    # at² + bt + c = 0
    a = y0 - 2 * y1 + y2
    b = -2 * y0 + 2 * y1
    c = y0 - y

    roots = _solve_quadratic(a, b, c)

    intersections = []
    for t in roots:
        if -EPSILON <= t <= 1 + EPSILON:
            t = max(0, min(1, t))
            x = _quadratic_eval(p0[0], p1[0], p2[0], t)
            intersections.append(x)

    return intersections


def _quadratic_vertical_intersections(points: List[Tuple[float, float]], x: float) -> List[float]:
    """Find Y coordinates where quadratic bezier crosses X=x."""
    p0, p1, p2 = points

    x0, x1, x2 = p0[0], p1[0], p2[0]

    a = x0 - 2 * x1 + x2
    b = -2 * x0 + 2 * x1
    c = x0 - x

    roots = _solve_quadratic(a, b, c)

    intersections = []
    for t in roots:
        if -EPSILON <= t <= 1 + EPSILON:
            t = max(0, min(1, t))
            y = _quadratic_eval(p0[1], p1[1], p2[1], t)
            intersections.append(y)

    return intersections


def _quadratic_angled_intersections(
    points: List[Tuple[float, float]], ax: float, ay: float, dx: float, dy: float
) -> List[Tuple[float, float]]:
    """Find (x,y) where quadratic bezier crosses angled line."""
    return _bezier_line_intersections_numerical(points, "qcurve", ax, ay, dx, dy)


def _quadratic_eval(p0: float, p1: float, p2: float, t: float) -> float:
    """Evaluate quadratic bezier at parameter t."""
    mt = 1 - t
    return mt * mt * p0 + 2 * mt * t * p1 + t * t * p2


# === TrueType multi-offcurve qcurve ===


def _qcurve_multi_horizontal_intersections(
    points: List[Tuple[float, float]], y: float
) -> List[float]:
    """Find X where TrueType qcurve with multiple offcurves crosses Y=y."""
    # Expand implied on-curve points and process each sub-segment
    expanded = _expand_qcurve_multi(points)
    intersections = []

    for i in range(len(expanded) - 2):
        sub_points = [expanded[i], expanded[i + 1], expanded[i + 2]]
        # Check if middle point is implied (offcurve) - process as qcurve
        # For simplicity, treat all as quadratic segments
        if i % 2 == 0:  # Even index = on-curve to implied
            xs = _quadratic_horizontal_intersections(sub_points, y)
            intersections.extend(xs)

    return intersections


def _qcurve_multi_vertical_intersections(
    points: List[Tuple[float, float]], x: float
) -> List[float]:
    """Find Y where TrueType qcurve with multiple offcurves crosses X=x."""
    expanded = _expand_qcurve_multi(points)
    intersections = []

    for i in range(len(expanded) - 2):
        sub_points = [expanded[i], expanded[i + 1], expanded[i + 2]]
        if i % 2 == 0:
            ys = _quadratic_vertical_intersections(sub_points, x)
            intersections.extend(ys)

    return intersections


def _qcurve_multi_angled_intersections(
    points: List[Tuple[float, float]], ax: float, ay: float, dx: float, dy: float
) -> List[Tuple[float, float]]:
    """Find (x,y) where TrueType qcurve crosses angled line."""
    expanded = _expand_qcurve_multi(points)
    intersections = []

    for i in range(len(expanded) - 2):
        sub_points = [expanded[i], expanded[i + 1], expanded[i + 2]]
        if i % 2 == 0:
            pts = _quadratic_angled_intersections(sub_points, ax, ay, dx, dy)
            intersections.extend(pts)

    return intersections


def _expand_qcurve_multi(points: List[Tuple[float, float]]) -> List[Tuple[float, float]]:
    """Expand TrueType qcurve with implied on-curve points."""
    if len(points) <= 3:
        return points

    # points: [on-curve, off1, off2, ..., offN, on-curve]
    expanded = [points[0]]  # First on-curve

    # Add implied points between consecutive off-curves
    for i in range(1, len(points) - 1):
        expanded.append(points[i])  # Off-curve
        if i < len(points) - 2:
            # Add implied on-curve between this and next off-curve
            implied = ((points[i][0] + points[i + 1][0]) / 2, (points[i][1] + points[i + 1][1]) / 2)
            expanded.append(implied)

    expanded.append(points[-1])  # Last on-curve
    return expanded


# === Numerical intersection for angled lines ===


def _bezier_line_intersections_numerical(
    points: List[Tuple[float, float]],
    seg_type: str,
    ax: float,
    ay: float,
    dx: float,
    dy: float,
    tolerance: float = 0.5,
) -> List[Tuple[float, float]]:
    """Find bezier-line intersections using numerical subdivision."""
    # Use recursive subdivision to find intersections
    intersections = []

    def subdivide(pts: List[Tuple[float, float]], depth: int = 0):
        if depth > 20:  # Max recursion depth
            return

        # Check if segment bounding box crosses the line
        min_x = min(p[0] for p in pts)
        max_x = max(p[0] for p in pts)
        min_y = min(p[1] for p in pts)
        max_y = max(p[1] for p in pts)

        # Quick rejection test using signed distance
        corners = [(min_x, min_y), (max_x, min_y), (max_x, max_y), (min_x, max_y)]
        signs = []
        for cx, cy in corners:
            # Signed distance from point to line
            dist = (cx - ax) * dy - (cy - ay) * dx
            signs.append(dist > 0)

        if all(signs) or not any(signs):
            # All corners on same side of line - no intersection
            return

        # Check if segment is small enough
        if max_x - min_x < tolerance and max_y - min_y < tolerance:
            # Compute midpoint as intersection
            mid_x = sum(p[0] for p in pts) / len(pts)
            mid_y = sum(p[1] for p in pts) / len(pts)
            intersections.append((mid_x, mid_y))
            return

        # Subdivide using de Casteljau at t=0.5
        if seg_type == "curve" and len(pts) == 4:
            left, right = _subdivide_cubic(pts)
            subdivide(left, depth + 1)
            subdivide(right, depth + 1)
        elif seg_type == "qcurve" and len(pts) == 3:
            left, right = _subdivide_quadratic(pts)
            subdivide(left, depth + 1)
            subdivide(right, depth + 1)

    subdivide(points)
    return intersections


def _subdivide_cubic(pts: List[Tuple[float, float]]) -> Tuple[List, List]:
    """Subdivide cubic bezier at t=0.5 using de Casteljau."""
    p0, p1, p2, p3 = pts

    # First level
    q0 = ((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2)
    q1 = ((p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2)
    q2 = ((p2[0] + p3[0]) / 2, (p2[1] + p3[1]) / 2)

    # Second level
    r0 = ((q0[0] + q1[0]) / 2, (q0[1] + q1[1]) / 2)
    r1 = ((q1[0] + q2[0]) / 2, (q1[1] + q2[1]) / 2)

    # Third level (midpoint)
    s = ((r0[0] + r1[0]) / 2, (r0[1] + r1[1]) / 2)

    left = [p0, q0, r0, s]
    right = [s, r1, q2, p3]

    return left, right


def _subdivide_quadratic(pts: List[Tuple[float, float]]) -> Tuple[List, List]:
    """Subdivide quadratic bezier at t=0.5 using de Casteljau."""
    p0, p1, p2 = pts

    # First level
    q0 = ((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2)
    q1 = ((p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2)

    # Second level (midpoint)
    r = ((q0[0] + q1[0]) / 2, (q0[1] + q1[1]) / 2)

    left = [p0, q0, r]
    right = [r, q1, p2]

    return left, right


# === Polynomial solvers ===


def _solve_quadratic(a: float, b: float, c: float) -> List[float]:
    """Solve ax² + bx + c = 0."""
    if abs(a) < EPSILON:
        # Linear equation
        if abs(b) < EPSILON:
            return []
        return [-c / b]

    discriminant = b * b - 4 * a * c

    if discriminant < -EPSILON:
        return []
    elif discriminant < EPSILON:
        return [-b / (2 * a)]
    else:
        sqrt_d = math.sqrt(discriminant)
        return [(-b + sqrt_d) / (2 * a), (-b - sqrt_d) / (2 * a)]


def _solve_cubic(a: float, b: float, c: float, d: float) -> List[float]:
    """Solve ax³ + bx² + cx + d = 0 using Cardano's formula."""
    if abs(a) < EPSILON:
        return _solve_quadratic(b, c, d)

    # Normalize to x³ + px² + qx + r = 0
    p = b / a
    q = c / a
    r = d / a

    # Substitute x = t - p/3 to get t³ + pt + q = 0
    p_new = q - p * p / 3
    q_new = 2 * p * p * p / 27 - p * q / 3 + r

    # Cardano's formula
    discriminant = q_new * q_new / 4 + p_new * p_new * p_new / 27

    roots = []

    if discriminant > EPSILON:
        # One real root
        sqrt_d = math.sqrt(discriminant)
        u = _cbrt(-q_new / 2 + sqrt_d)
        v = _cbrt(-q_new / 2 - sqrt_d)
        roots.append(u + v - p / 3)
    elif discriminant < -EPSILON:
        # Three real roots (casus irreducibilis)
        m = 2 * math.sqrt(-p_new / 3)
        theta = math.acos(3 * q_new / (p_new * m)) / 3
        roots.append(m * math.cos(theta) - p / 3)
        roots.append(m * math.cos(theta - 2 * math.pi / 3) - p / 3)
        roots.append(m * math.cos(theta - 4 * math.pi / 3) - p / 3)
    else:
        # Multiple root
        if abs(q_new) < EPSILON:
            roots.append(-p / 3)
        else:
            u = _cbrt(-q_new / 2)
            roots.append(2 * u - p / 3)
            roots.append(-u - p / 3)

    return roots


def _cbrt(x: float) -> float:
    """Cube root that handles negative numbers."""
    if x >= 0:
        return x ** (1 / 3)
    else:
        return -((-x) ** (1 / 3))


# === Public utility functions ===


def calculate_distances(intersections: List[float]) -> List[Tuple[float, float, float]]:
    """Calculate distances between consecutive intersection points.

    Args:
        intersections: Sorted list of intersection coordinates

    Returns:
        List of (start, end, distance) tuples
    """
    if len(intersections) < 2:
        return []

    distances = []
    for i in range(len(intersections) - 1):
        start = intersections[i]
        end = intersections[i + 1]
        dist = abs(end - start)
        distances.append((start, end, dist))

    return distances


def calculate_distances_2d(
    intersections: List[Tuple[float, float]],
) -> List[Tuple[Tuple[float, float], Tuple[float, float], float]]:
    """Calculate distances between consecutive 2D intersection points.

    Args:
        intersections: Sorted list of (x, y) intersection points

    Returns:
        List of ((x1, y1), (x2, y2), distance) tuples
    """
    if len(intersections) < 2:
        return []

    distances = []
    for i in range(len(intersections) - 1):
        p1 = intersections[i]
        p2 = intersections[i + 1]
        dist = math.sqrt((p2[0] - p1[0]) ** 2 + (p2[1] - p1[1]) ** 2)
        distances.append((p1, p2, dist))

    return distances


# =============================================================================
# Raw contour data intersection functions (fontTools format)
# =============================================================================

# fontTools tag constants
FT_CURVE_TAG_ON = 1  # On-curve point
FT_CURVE_TAG_CUBIC = 2  # Off-curve cubic control point
# Quadratic off-curve: tag == 0 (not on-curve, not cubic)


def _get_segments_from_raw(
    points: List[Tuple[float, float]], tags: List[int], contours: List[int]
) -> List[dict]:
    """Extract segments from raw fontTools-style contour data.

    Args:
        points: Flat list of (x, y) tuples for all points
        tags: List of point tags (FT_CURVE_TAG_ON=1, FT_CURVE_TAG_CUBIC=2, 0=quad)
        contours: List of end indices for each contour

    Returns:
        List of segment dicts with 'type' and 'points' keys
        (same format as _get_contour_segments)
    """
    segments = []

    if not points or not tags or not contours:
        return segments

    start_idx = 0
    for contour_end in contours:
        end_idx = int(contour_end) + 1
        contour_points = points[start_idx:end_idx]
        contour_tags = tags[start_idx:end_idx]
        num_points = len(contour_points)

        if num_points < 2:
            start_idx = end_idx
            continue

        # Find on-curve point indices
        oncurve_indices = [i for i, t in enumerate(contour_tags) if t == FT_CURVE_TAG_ON]

        if len(oncurve_indices) < 2:
            # Need at least 2 on-curve points for segments
            start_idx = end_idx
            continue

        # Build segments between consecutive on-curve points
        for seg_idx in range(len(oncurve_indices)):
            on_idx = oncurve_indices[seg_idx]
            next_on_idx = oncurve_indices[(seg_idx + 1) % len(oncurve_indices)]

            start_pt = contour_points[on_idx]
            end_pt = contour_points[next_on_idx]

            # Collect off-curve points between start and end
            offcurves = []
            offcurve_tags = []
            i = (on_idx + 1) % num_points
            while i != next_on_idx:
                if contour_tags[i] != FT_CURVE_TAG_ON:
                    offcurves.append(contour_points[i])
                    offcurve_tags.append(contour_tags[i])
                i = (i + 1) % num_points

            segment = {"points": [(float(start_pt[0]), float(start_pt[1]))], "type": "line"}

            if not offcurves:
                # Line segment
                segment["type"] = "line"
                segment["points"].append((float(end_pt[0]), float(end_pt[1])))
            elif len(offcurves) == 2 and all(t == FT_CURVE_TAG_CUBIC for t in offcurve_tags):
                # Cubic bezier (2 cubic off-curves)
                segment["type"] = "curve"
                for oc in offcurves:
                    segment["points"].append((float(oc[0]), float(oc[1])))
                segment["points"].append((float(end_pt[0]), float(end_pt[1])))
            elif len(offcurves) == 1 and offcurve_tags[0] != FT_CURVE_TAG_CUBIC:
                # Quadratic bezier (1 quadratic off-curve)
                segment["type"] = "qcurve"
                oc = offcurves[0]
                segment["points"].append((float(oc[0]), float(oc[1])))
                segment["points"].append((float(end_pt[0]), float(end_pt[1])))
            elif all(t != FT_CURVE_TAG_CUBIC for t in offcurve_tags):
                # TrueType with multiple quadratic off-curves
                segment["type"] = "qcurve_multi"
                for oc in offcurves:
                    segment["points"].append((float(oc[0]), float(oc[1])))
                segment["points"].append((float(end_pt[0]), float(end_pt[1])))
            else:
                # Mixed or unknown - treat as line (fallback)
                segment["type"] = "line"
                segment["points"].append((float(end_pt[0]), float(end_pt[1])))

            segments.append(segment)

        start_idx = end_idx

    return segments


def find_horizontal_intersections_raw(
    points: List[Tuple[float, float]], tags: List[int], contours: List[int], y: float
) -> List[float]:
    """Find X coordinates where raw contours cross horizontal line at Y=y.

    Args:
        points: Flat list of (x, y) tuples for all points
        tags: List of point tags (fontTools format)
        contours: List of end indices for each contour
        y: Y coordinate of horizontal line

    Returns:
        Sorted list of X coordinates (left to right)
    """
    intersections = []
    segments = _get_segments_from_raw(points, tags, contours)

    for segment in segments:
        xs = _segment_horizontal_intersections(segment, y)
        intersections.extend(xs)

    return sorted(set(intersections))


def find_vertical_intersections_raw(
    points: List[Tuple[float, float]], tags: List[int], contours: List[int], x: float
) -> List[float]:
    """Find Y coordinates where raw contours cross vertical line at X=x.

    Args:
        points: Flat list of (x, y) tuples for all points
        tags: List of point tags (fontTools format)
        contours: List of end indices for each contour
        x: X coordinate of vertical line

    Returns:
        Sorted list of Y coordinates (bottom to top)
    """
    intersections = []
    segments = _get_segments_from_raw(points, tags, contours)

    for segment in segments:
        ys = _segment_vertical_intersections(segment, x)
        intersections.extend(ys)

    return sorted(set(intersections))


def find_angled_intersections_raw(
    points: List[Tuple[float, float]],
    tags: List[int],
    contours: List[int],
    x: float,
    y: float,
    angle: float,
) -> List[Tuple[float, float]]:
    """Find (x,y) points where raw contours cross angled line.

    Args:
        points: Flat list of (x, y) tuples for all points
        tags: List of point tags (fontTools format)
        contours: List of end indices for each contour
        x, y: Anchor point of the angled line
        angle: Angle in degrees (0 = horizontal right, 90 = vertical up)

    Returns:
        List of (x, y) tuples sorted by distance from anchor point
    """
    intersections = []
    segments = _get_segments_from_raw(points, tags, contours)

    for segment in segments:
        pts = _segment_angled_intersections(segment, x, y, angle)
        intersections.extend(pts)

    # Remove duplicates and sort by distance from anchor
    unique = list(set(intersections))
    unique.sort(key=lambda p: math.sqrt((p[0] - x) ** 2 + (p[1] - y) ** 2))

    return unique
