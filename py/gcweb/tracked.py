"""Change-tracking groups/kerning mappings.

ufo-spacing-lib's FontGroupsManager expects fontParts-like `groups` and
`kerning`: plain mapping access plus `.remove(key)`. These dict subclasses
add `remove()` and remember the original value of every key touched since
the last `take_diff()`, so one RPC can report exactly what it changed.

Group members are stored as tuples. ufoLib2 loads lists, and the manager does
`groups[name] += tuple(...)`, which on a list would mutate it in place behind
`__setitem__`'s back; tuples make every change go through `__setitem__`.
"""

from __future__ import annotations

from typing import Any

_MISSING = object()


class _Tracked(dict):
    def __init__(self, data=()):
        super().__init__()
        for key, value in dict(data).items():
            super().__setitem__(key, self._norm(value))
        self._orig: dict[Any, Any] = {}

    @staticmethod
    def _norm(value):
        return value

    def _touch(self, key) -> None:
        if key not in self._orig:
            self._orig[key] = dict.get(self, key, _MISSING)

    def __setitem__(self, key, value) -> None:
        self._touch(key)
        super().__setitem__(key, self._norm(value))

    def __delitem__(self, key) -> None:
        self._touch(key)
        super().__delitem__(key)

    def remove(self, key) -> None:
        """fontParts API used by ufo-spacing-lib; missing keys are ignored."""
        if key in self:
            del self[key]

    def pop(self, key, *default):
        if key in self:
            value = self[key]
            del self[key]
            return value
        if default:
            return default[0]
        raise KeyError(key)

    def setdefault(self, key, default=None):
        if key not in self:
            self[key] = default
        return self[key]

    def update(self, *args, **kwargs) -> None:
        for key, value in dict(*args, **kwargs).items():
            self[key] = value

    def clear(self):
        raise NotImplementedError("clear() is not tracked")

    def popitem(self):
        raise NotImplementedError("popitem() is not tracked")

    def take_diff(self) -> tuple[dict, list]:
        """Return (changed, removed) since the last call and start a new window.

        Keys that ended up back at their original value are not reported.
        """
        changed: dict = {}
        removed: list = []
        for key, orig in self._orig.items():
            if key in self:
                value = dict.__getitem__(self, key)
                if orig is _MISSING or orig != value:
                    changed[key] = value
            elif orig is not _MISSING:
                removed.append(key)
        self._orig = {}
        return changed, removed

    def reset_to(self, data) -> tuple[dict, list]:
        """Replace the whole content (Revert to file); returns the diff."""
        for key in list(self.keys()):
            if key not in data:
                del self[key]
        for key, value in data.items():
            if dict.get(self, key, _MISSING) != self._norm(value):
                self[key] = value
        return self.take_diff()


class TrackedGroups(_Tracked):
    @staticmethod
    def _norm(value):
        return tuple(value)


class TrackedKerning(_Tracked):
    pass
