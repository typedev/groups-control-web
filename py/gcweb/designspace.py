"""A designspace: its masters and the kern-group compatibility between them.

Every source UFO has its own groups; in practice they are usually identical
while kerning differs. Masters are partitioned into sets with identical kern
groups — see docs/DESIGNSPACE_PLAN.md. The fonts themselves are opened by
gcweb.api (one UfoDocument per master).
"""

from __future__ import annotations

import os
import time

from fontTools.designspaceLib import DesignSpaceDocument

KERN_PREFIXES = ("public.kern1.", "public.kern2.")


def kern_groups(groups: dict) -> dict[str, list[str]]:
    return {k: list(v) for k, v in groups.items() if k.startswith(KERN_PREFIXES)}


def compare(a: dict[str, list[str]], b: dict[str, list[str]]) -> dict:
    """How two masters' kern groups differ: identical / order / different."""
    only_a = sorted(set(a) - set(b))
    only_b = sorted(set(b) - set(a))
    members = sorted(n for n in set(a) & set(b) if set(a[n]) != set(b[n]))
    order = sorted(n for n in set(a) & set(b) if a[n] != b[n] and set(a[n]) == set(b[n]))
    if only_a or only_b or members:
        level = "different"
    elif order:
        level = "order"
    else:
        level = "identical"
    return {"level": level, "onlyA": only_a, "onlyB": only_b, "members": members, "order": order}


def compatibility_sets(groups: list[dict[str, list[str]]]) -> list[int]:
    """Set index per master: masters with identical kern groups share one."""
    reps: list[int] = []
    out: list[int] = []
    for i, g in enumerate(groups):
        for set_index, rep in enumerate(reps):
            if groups[rep] == g:
                out.append(set_index)
                break
        else:
            reps.append(i)
            out.append(len(reps) - 1)
    return out


class Designspace:
    """The parsed designspace: master paths, locations, default. No fonts."""

    def __init__(self, path: str) -> None:
        t0 = time.perf_counter()
        self.path = path
        self.doc = DesignSpaceDocument.fromfile(path)
        base = os.path.dirname(path)
        self.discrete_axes = [a.name for a in self.doc.axes if getattr(a, "values", None)]
        default = self.doc.findDefault()
        self.masters: list[dict] = []
        for s in self.doc.sources:
            if s.layerName:
                continue  # a sparse layer inside a UFO: not a groups/kerning master
            self.masters.append(
                {
                    # stylename repeats across widths ("Extra Bold" ×3): label by file.
                    "name": os.path.splitext(os.path.basename(s.filename))[0],
                    "styleName": s.styleName,
                    "filename": s.filename,
                    "path": os.path.normpath(os.path.join(base, s.filename)),
                    "location": dict(s.location),
                    "discrete": {a: s.location.get(a) for a in self.discrete_axes},
                    "isDefault": s is default,
                }
            )
        self.layer_sources = [s.filename for s in self.doc.sources if s.layerName]
        self.default = next((i for i, m in enumerate(self.masters) if m["isDefault"]), 0)
        self.timings = {"parseMs": _ms(t0, time.perf_counter())}

    def info(self, current: int, views) -> dict:
        """Masters and kern-group compatibility, from the live (possibly edited) groups.

        `views` holds each master's MasterView (tracked groups/kerning).
        """
        groups = [kern_groups(v.groups) for v in views]
        sets = compatibility_sets(groups)
        diffs = [compare(groups[current], g) for g in groups]
        # Compatible = identical groups, within the current master's discrete subspace.
        here = self.masters[current]["discrete"]
        subspace = [i for i, m in enumerate(self.masters) if m["discrete"] == here]
        return {
            "file": os.path.basename(self.path),
            "axes": [
                {"name": a.name, "discrete": a.name in self.discrete_axes} for a in self.doc.axes
            ],
            "masters": [
                {k: m[k] for k in ("name", "styleName", "filename", "location", "discrete", "isDefault")}
                | {
                    "pairs": len(views[i].kerning),
                    "set": sets[i],
                    "groups": len(groups[i]),
                    "vsCurrent": _brief(diffs[i]),
                }
                for i, m in enumerate(self.masters)
            ],
            "current": current,
            "sets": max(sets) + 1 if sets else 0,
            "compatibleInSubspace": sum(1 for i in subspace if sets[i] == sets[current]),
            "subspaceSize": len(subspace),
            "layerSources": self.layer_sources,
            "timings": self.timings,
        }


def _brief(diff: dict) -> dict:
    """Counts plus a few names, enough for a tooltip."""
    return {
        "level": diff["level"],
        "onlyHere": len(diff["onlyA"]),
        "onlyThere": len(diff["onlyB"]),
        "members": len(diff["members"]),
        "order": len(diff["order"]),
        "sample": (diff["onlyA"] + diff["onlyB"] + diff["members"] + diff["order"])[:5],
    }


def _ms(a: float, b: float) -> int:
    return round((b - a) * 1000)
