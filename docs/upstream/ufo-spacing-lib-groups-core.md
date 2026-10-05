# For a ufo-spacing-lib session: groups_core issues found by groups-control-web

Context: groups-control-web runs `FontGroupsManager` (ufo-spacing-lib 0.4.3,
`src/ufo_spacing_lib/groups_core.py`) in Pyodide on top of ufoLib2, through a
small adapter. While doing so, four issues showed up. All are reproducible in
plain CPython; none blocks us (we work around them), so fix at your pace and
bump the version — we pin it.

## 1. `groups_with_errors` grows on every rebuild

`_build_reverse_mapping()` appends to `self.groups_with_errors` but never
clears it; only `set_font()` does. Every mutating call rebuilds the mapping,
so an empty group appears once more after each operation:

```python
m.set_font(font)                      # ['public.kern1.empty']
m.add_glyphs_to_group(...) ×3         # ['public.kern1.empty'] ×3
```

Fix: reset the list at the start of `_build_reverse_mapping()`.

## 2. `print()` in library code

`_add_to_mapping` (around line 536) prints
`ERROR: A already in group X and Y` / `The extension may not work correctly.`
to stdout when a glyph is in two groups on one side. Use the module logger
(or collect it next to `groups_with_errors`) so callers can show it.

## 3. `reposition_glyph_in_group` cannot move a glyph to the end

With `target_index == len(group)` the call does nothing (the bound check runs
before the glyph is taken out). Dragging a member to the last slot is a
normal UI action. Suggestion: accept `0 <= target_index <= len(group)` and
clamp after removing the moved glyphs.

## 4. fontParts-only `.remove()`

`rename_group` calls `font.groups.remove(old_name)`; add/delete/rename call
`font.kerning.remove(pair)` (lines ~892, 903, 911, 1045, 1128, 1132). Plain
dicts and ufoLib2's `Kerning` lack it, so every non-fontParts caller needs an
adapter. Suggestion: a tiny helper

```python
def _remove(mapping, key):
    remove = getattr(mapping, "remove", None)
    if remove is not None:
        remove(key)
    elif key in mapping:
        del mapping[key]
```

and use it in all six places. Tests: run the existing manager tests also with
plain-dict `groups` / `kerning` (the mocks in `tests/mocks.py` add `remove`,
so this path is untested today). Related: tests use tuple group values only;
ufoLib2 loads lists — worth one test with list values.
