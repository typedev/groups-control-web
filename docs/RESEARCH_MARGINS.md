# Research: margin editing (Phase 6)

Written before any Phase 6 code, as PLAN.md asks. Sources: Font-Rover
(`font_rover/utils/margin_edit.py`, `utils/angled_margins.py`, `utils/beam.py`,
`glyph_line/keys.py`, `groups_control/window.py`, `dependency_preview.py`),
ufo-spacing-lib 0.4.3 (`commands/margins.py`, `rules_*.py`), and experiments on
open-source UFOs in this repo's environment.

---

## 1. What the desktop does

**When.** There is no separate margin mode: in the preview's dependency line
(single-glyph selection) the arrow keys edit margins; in pairs mode they kern
(`default.json:173-190`, `"when": ["!pair_mode"]` vs `["pair_mode"]`).

**Keys** (`glyph_line/keys.py:30-39`):

| Key | Edit |
|---|---|
| Left / Right | right margin −1 / +1 |
| Shift+Left / Right | right margin −10 / +10 |
| Alt+Left / Right | left margin −1 / +1 |
| Alt+Shift+Left / Right | left margin −10 / +10 |
| Ctrl+Z / Ctrl+Shift+Z | per-glyph undo / redo |

Plain arrows always edit the **right** margin and Alt the **left**, whatever
the side being worked on (kern1/kern2 only chooses which label is drawn).

**Which glyph.** Exactly one: the selected glyph of the line (member, parent,
composite or control glyph). No group-wide edit, no margin groups.

**The edit** (`MarginEditController.edit`, `margin_edit.py:139-160`): read the
upright margin, skip empty glyphs, snapshot for undo, set `margin + delta`
through fontParts setters:
- left: move contours, components (offsets), anchors, guidelines by `d`, and
  `width += d` (the right margin is kept);
- right: `width += d` (only the advance changes).

Deltas need no angled or beam maths: shifting by `d` changes the upright,
angled and beam margins by the same `d`. No rounding (fractional margins stay
fractional; only comparisons round).

**Composites.** The desktop does **nothing** to them. Because a composite
references its base, a left-margin edit of `A` moves the outline inside
`Aacute` while its advance stays: `Aacute`'s left margin grows by `d`, its
right margin shrinks by `d`. A right-margin edit of the base does not touch
composites. (It also leaves composite caches stale on screen.)

**Undo.** Per glyph, one step per key press (GLIF snapshots in the font's
UndoManager).

**Recolouring.** The line keeps its selection and recomputes mismatches;
group cells, content badges and validation refresh.

## 2. What ufo-spacing-lib offers (unused by the desktop)

- `SetMarginCommand` / `AdjustMarginCommand` (`commands/margins.py`) with
  `propagate_to_composites=True`: composites follow their base — for a left
  edit, the composite's width grows by `d` and its components are moved so
  its margins stay as before relative to the base; right edit:
  `composite.rightMargin += d`. Composites with a metrics rule for that side
  are skipped. Undo state is lossy (margins/width only).
- The API needs fontParts objects (`leftMargin` properties, `moveBy`,
  `getReverseComponentMapping`, `changed()`); ufoLib2 has
  `get/setLeftMargin(value, layer)` and `Component.move` — an adapter or a
  port is needed.
- **Metrics rules** (`com.typedev.spacing.metricsRules`, `rules_*.py`):
  `{"version": 1, "rules": {"Aacute": {"left": "=A", "right": "=A"}}}`,
  grammar `=NAME`, `=NAME|`, `=|`, `=NAME±*/NUM`. Applied only by the margin
  commands (cascade to dependents). Editing a rule *target* is not checked —
  it silently drifts until the next cascade. **Font-Rover never reads or
  writes this key**, and it is absent from every UFO we have seen.

## 3. Saving `.glif` with a minimal diff

Experiment: re-serialise unchanged glyphs with fontTools'
`writeGlyphToString` and compare to the file:

| UFO (open source) | identical |
|---|---|
| MutatorSans Light Condensed | 5 / 50 |
| Spectral Regular | 300 / 300 |
| Amstelvar A2 Roman | 2 / 300 |
| Google Sans Flex (one master) | 300 / 300 |

Same cause as with the plists: XML declaration quotes, indentation (tab vs
two spaces). Rewriting a glyph with glifLib would turn a one-number edit into
a whole-file diff on half of real fonts.

**Plan: patch the GLIF text.** A margin edit changes only numbers:
- left by `d`: every `<point x>`, `<component xOffset>` (added when absent),
  `<anchor x>`, `<guideline x>` (vertical/angled guidelines only), and
  `<advance width>`;
- right by `d`: `<advance width>` only (added when absent).

Edit those attributes in place in the original text (regex over the element
tags, keeping attribute order, quoting and whitespace) and leave everything
else byte-identical. Numbers keep the file's style: integers stay integers;
non-integral results use the shortest repr. Verify each patched glyph by
parsing it back with glifLib and comparing outline/width with the edited
ufoLib2 glyph; if the patch cannot be applied (unexpected markup), fall back to
glifLib for that glyph and say so in the save report.

Images (`<image xOffset>`) are not moved, like the desktop (fontParts does not
move them either).

## 4. Proposed design

**Worker (Python).**
- `margin_nudge(glyph, side, delta, follow_composites)`:
  edit the ufoLib2 glyph (`move` + width; guidelines by hand), record the
  glyph as changed, optionally adjust composites (see decision 1), return a
  delta with **glyph records** (`w`, `l`, `r`, `p`) of every glyph whose
  outline or metrics changed — the edited glyph, and its composites (their
  drawing moves even when they are not adjusted).
- The tracked layer gets a glyph part: original GLIF bytes per touched glyph,
  current state, `is_dirty` covers glyphs too.
- `changed_files()` adds `glyphs/<file>.glif` for glyphs that differ from
  disk, produced by the GLIF text patch (§3). `revert()` reloads touched
  glyphs from their original bytes.
- Lang statuses do not depend on margins: no update.

**Mirror (TS).**
- `withDelta` replaces glyph records; the outline cache drops the changed
  glyphs **and every composite that uses them** (Path2D of a composite embeds
  its base).
- Validation, badges, the preview line recolour on their own (they read the
  records).

**UI.**
- Dependency line: click selects a glyph (single selection, like the
  desktop); arrows edit margins with the desktop keys; Esc clears.
- The selected glyph is highlighted; its margins are always shown.
- Pairs mode keeps the arrows for kerning.

**Not in Phase 6:** beam measurement (a later step: `utils/beam.py` +
`outline_intersections.py` are GTK-free and vendorable), metrics rules
(decision 2), undo (the prototype has Revert to file).

## 5. Decisions (2026-10-05, chosen in chat: all as recommended)

1. **Composites when a base glyph changes.**
   (a) Desktop parity: do nothing — `Aacute`'s margins drift when `A`'s left
   margin changes.
   (b) Follow the base, as ufo-spacing-lib does: composites keep the same
   margins as their base (left edit: width `+d`, components shifted back;
   right edit: width `+d`). *Recommended*: a group of `A Aacute Agrave` stays
   consistent, which is what Groups Control checks.
2. **Metrics rules key.** (a) Ignore it, like the desktop. (b) Ignore it but
   show a notice when a font has rules. (c) Apply cascades. *Recommended:
   (b)* — no real font uses it today; applying it brings a lossy, unchecked
   behaviour.
3. **Keys on side 2.** Desktop parity (plain arrows = right margin, Alt =
   left) or make plain arrows edit the side being checked (left on side 2).
   *Recommended: desktop parity* — muscle memory carries over.
4. **Undo.** None (Revert to file only, as for groups), or a per-glyph undo
   for margin edits now. *Recommended: none in Phase 6*; a general undo comes
   after the prototype.

**Chosen:** 1 (b) composites follow their base; 2 (b) ignore metrics rules,
show a notice; 3 desktop keys; 4 no undo in Phase 6.

Composite rule as implemented: when the edited glyph is a composite's
**first** component, the composite follows it (left edit: width `+d` and the
other components `+d`; right edit: width `+d`), recursively for composites of
that composite. When the edited glyph is a later component (an accent), that
component's offset is moved back by `d` for a left edit, so the composite looks
unchanged. ufo-spacing-lib's single-component branch differs (it cancels the
shift); ours keeps "composite margins follow the base" in every case.
