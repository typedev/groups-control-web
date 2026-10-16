# For a Font-Rover session: Groups Control findings from groups-control-web

Context: groups-control-web (`~/WORK/groups-control-web`) ports Font-Rover's
Groups Control to the browser (Python in Pyodide + TypeScript canvas UI,
v0.3.2). The port read the desktop code closely and ran its engines on real
fonts. This list collects (A) problems in the desktop logic and (B) UI/UX
changes the web version made that the desktop could adopt. The web
implementation is cited as a reference for each item; reading it is
optional.

Items marked **verify** were found by reading code, not by running the
desktop. Confirm them before fixing. Nothing here is urgent: the web version
works around all of them. Fix at your pace; the web side re-vendors with
`scripts/vendor_sync.py` afterwards.

---

## A. Logic problems

### A1. The dependency line becomes kerned once pairs mode has been used
`groups_control/dependency_preview.py` `set_pairs` calls `setGroupsManager`
on the glyph line, and nothing resets it. After the first pairs view, every
later dependency line runs through `NaiveSequencer` with kerning. That
includes the gaps between glyphs and control glyphs, although the dependency
line is meant to be unkerned (`setShowKerning(False)`).
**Fix:** clear the groups manager, or restore the unkerned state, when the
preview leaves pairs mode.
Web: the dependency line is never kerned.

### A2. Rename with Keep Kerning off leaves pairs on a missing group
Renaming with Keep Kerning off renames the group but leaves its pairs keyed
by the old name, which no longer exists. The font then has orphan kerning.
**Fix:** a rename should always move the group's kerning to the new name.
Keep Kerning is about membership and has no meaning for a rename.
Web: `py/gcweb/api.py` `rename_group` always passes `check_kerning=True`.

### A3. Copy Groups deletes and re-adds every group in every target
`groups_control/copy_groups.py` `process_font` deletes all kern groups of a
target, so their pairs flatten to glyph pairs, and then adds the source's
groups back. This has two costs:
- **Speed:** about 14 s for 17 masters in CPython.
- **Kerning churn:** the flatten/fold round trip changes kerning even in
  masters whose groups are already identical.

**Fix:** use an incremental match. Skip targets whose groups are already
equal. For the others:
1. Delete the groups the source lacks.
2. Remove members that belong elsewhere.
3. Add the missing members.
4. Copy the member order, which sets the key glyphs.

Each step goes through `FontGroupsManager` with the Keep Kerning flag. On the
same 17 masters this takes about 2 ms and makes no spurious kerning changes.
Web: `py/gcweb/master_tools.py` `match_groups`.

### A4. Margin edits on a base glyph make its composites drift
`utils/margin_edit.py` `MarginEditController.edit` ignores composites:
- A left-margin edit of `A` moves the outline inside `Aacute` while the
  advance of `Aacute` stays the same. Its left margin grows by d and its
  right margin shrinks by d.
- A right-margin edit of `A` leaves `Aacute` unchanged.

A group of `A Aacute Agrave` then fails its own margin check after every
edit.
**Fix (the web's rule):**
- **Edited glyph is the composite's first component (the base):** the
  composite follows. A left edit adds d to the composite's width and to its
  other components' offsets. A right edit adds d to the width. This applies
  recursively, so `Aring` → `Aringacute` follows too.
- **Edited glyph is a later component (an accent):** for a left edit, move
  that component's offset back by d, so the composite looks unchanged.

ufo-spacing-lib's `AdjustMarginCommand(propagate_to_composites=True)` is
close, but its single-component branch cancels the shift instead.
Web: `py/gcweb/margins.py`; rationale in `docs/RESEARCH_MARGINS.md` §1 and §5.

### A5. Composite caches go stale after a margin edit (verify)
The keyboard margin path invalidates only the edited glyph's metrics
(`glyph_line/view.py` around line 482, `invalidateGlyphMetrics`). The full
`invalidateCache()` runs on `glyph-changed`, not on `glyph-metrics-changed`
(`groups_control/window.py` around lines 2636–2668). Composites shown in the
line can keep stale bounds and beam crossings.
**Fix:** after a margin edit, also invalidate the glyphs that use the edited
glyph as a component, recursively.

### A6. Refused edits of borrowed sparse-layer glyphs are silent (verify)
`margin_edit.py` (around lines 141–146) refuses to edit a glyph that a sparse
layer borrows, and reports this through the `on_borrowed` hook. Groups Control
does not pass that hook, so the key press appears to do nothing.
**Fix:** pass `on_borrowed` and show a status message.

### A7. Margin undo: one step per key press, unlimited stacks
`UndoManager.save_state` stores a full GLIF snapshot on every arrow press.
Holding an arrow key records N steps. The per-glyph stacks have no limit.
**Suggestion:** merge repeated nudges of the same glyph and side into one
step, for example until a pause or a change of glyph, and cap the stack.

### A8. Metrics rules are ignored without telling the user
Font-Rover never reads `com.typedev.spacing.metricsRules`. In a font that
has rules, margin edits silently break the rules' targets.
**Suggestion:** at least show a "metrics rules ignored" notice when the key
is present. The web does this in the header. Applying the rules is a
separate decision.

### A9. Transfer Kerning by Script lists scripts the font does not have
`transfer_kerning.script_counts` takes scripts from Unicode
Script_Extensions. Pairs with Arabic punctuation or marks therefore count
toward Syriac, Thaana, Nko and others, so the dialog offers scripts the font
has no glyphs for.
**Fix:** list only scripts that at least one glyph of the font is written in,
plus Common. Pair selection can stay as it is.
Web: `py/gcweb/master_tools.py` `script_choices`.

### A10. Script_Extensions is the wrong source for a glyph's own script
When the web first classified glyphs with Script_Extensions, combining marks,
the middle dot and the apostrophe made about 30 false scripts appear
(Tifinagh, Cherokee, Old Permic…). Use the primary Unicode `Script` property
to classify a glyph. Script_Extensions only belongs in pair compatibility.
Worth checking in `languages/compat.py` and in the glyph filters.
Web: `py/gcweb/scripts.py`.

### A11. The "Unicode Ranges" filter sees only a glyph's own unicode
`glyph_filter/script_filter.py` misses unencoded glyphs such as `a.sc` and
`uni0628.fina`.
**Fix:** resolve the character the way `compat.glyph_codepoint` does:
1. the glyph's own unicode;
2. the base name before the first dot;
3. a `uniXXXX` / `uXXXXX` name;
4. the parts of a ligature.

Web: the Scripts filter in the font panel (`py/gcweb/scripts.py`).

### A12. `set_font()` wipes the History journal
Calling `FontGroupsManager.set_font()` to rebuild the reverse mapping, for
example after a member reorder, also clears `manager.history`. The web uses
`makeReverseGroupsMapping()` instead. Check whether Groups Control calls
`set_font` after edits. If it does, the recorded history is lost
**(verify)**.

### A13. ufo-spacing-lib issues the desktop inherits
These are written up for a ufo-spacing-lib session in
`groups-control-web/docs/upstream/ufo-spacing-lib-groups-core.md`. Two of
them affect the desktop directly:
- **`reposition_glyph_in_group(..., target_index=len(group))` does
  nothing.** Dragging a member to the last slot probably fails on the
  desktop **(verify)**.
- **`_add_to_mapping` prints to stdout** when a glyph is in two groups on
  one side, so the user never sees the warning.

### A14. Minimal-diff saving (verify)
Font-Rover's own rule is "open → save without edits = zero diff". The web
found that standard writers break it as soon as a file changes:
- fontTools' plist writer rewrote an unchanged `kerning.plist` written by
  another editor as a 29,614-line diff.
- glifLib rewrote nearly every `.glif` of 2 of 4 open-source UFOs (quote
  style, indentation).

Check what the desktop's save path does to a `groups.plist` /
`kerning.plist` with one changed pair, and to a `.glif` after a one-unit
margin edit. The web's solutions:
- a style-preserving plist writer that keeps the header, indent, newlines
  and key order (`py/gcweb/plist_style.py`);
- in-place number patching of GLIF text (`py/gcweb/glif_patch.py`);
- never writing a file whose content equals what is on disk.

### A15. Known gaps (not bugs, but worth closing)
- No undo for membership edits, Import, or tools.
- Reorder, Import and Copy Groups are not recorded in History.
- Double-click on a group cell does nothing. An obvious use: open the group,
  or start a rename.
- Delete group has no confirmation (see B5).
- Import is replace-only (see B10).

---

## B. UI/UX improvements to consider

### Selection
**B1. One selection subject across panels.** Selecting a group or a member
clears the font selection. Selecting in the font clears the member and pair
selections, and the open group stays drawn dashed. Shift-click anchors are
reset together with their selection. Glyphs hidden by the search or a filter
leave the selection; this happens, for example, after dragging into a group
with Hide grouped on. This fixed real bugs: Add group took a stale, invisible
font selection. Web: the selection logic in `src/ui/GroupsControl.tsx`
(unit-tested).

**B2. Several glyphs selected in the font.** The pairs list shows the pairs
of all of them, and the preview lines them up, in grid order, against the
first one. The desktop shows only one glyph.

**B3. Several members selected in the open group.** The preview shows just
those members, checked against the key glyph.

**B4. Members selected in the open group are outlined dashed in the font
grid** when Hide grouped is off, like the open group in the groups grid.

### Safety
**B5. Confirmations that say what happens to the kerning.** These cover
Delete group (with Keep Kerning on, the pairs become member exceptions),
Delete Pairs and Import.

**B6. Keep Kerning as a prominent switch** at the front of the toolbar. When
off, it turns amber and reads "off — kerning is dropped". A help popover
explains what on and off do to add, remove and delete, and what the switch
does not affect: reorder, rename and value edits.

**B7. Revert to file**, with confirmation. Until undo exists for every edit,
this is the way back.

### Multi-master (designspace)
**B8. Membership edits apply to all compatible masters.**
- **Compatibility badge:** for example "17/18 compatible · 2 group sets",
  with a tooltip listing the differences. It is recomputed after every edit.
- **Edit scope selector:**
  - *All compatible masters* is the default and includes italics.
  - *Compatible masters of this subspace* appears only when the designspace
    has discrete axes.
  - *This master only.*
- **Labels and colours:** labels count the masters reached ("6 of 18"). The
  selector is coloured like Keep Kerning, with a warning colour for the
  narrower scopes.
- **Per-master kerning, all or nothing:** each master remaps its own
  kerning. If any master fails, nothing changes and the error names that
  master.
- **Masters with different groups are never targets.**

This replaces the desktop's per-script "This UFO / All N UFOs" choice with
one place that governs every edit.

**B9. "Match order".** When masters differ from the current one only in
member order, one header button copies the order, key glyphs included.
Kerning is not touched.

**B10. Import groups: Merge mode** next to Replace. Only the groups the file
lists change. Glyphs taken into them leave their other group, and kerning
follows Keep Kerning.

**B11. Diff Groups as a visual tool.** Each differing kern group is drawn as
rows of glyph cells, one row per variant, labelled with the masters that
have it.
- Glyphs this master's group lacks are outlined.
- Glyphs missing in a master are shown as missing cells.
- A different key glyph is dashed.
- Every row has a **Make like this master** action.

Kerning differences are left out. The desktop diff is a text report.

**B12. Interpolate Kerning takes its factor from the designspace locations**
of masters A, B and the current master, and can still be typed. If the
desktop asks the user to type the factor, check whether it can read the
locations instead.

**B13. Replay History into Masters** shows a plan first: per master, what
would change and the notes for commands that could not apply. The edits are
applied only after confirmation.

### Tools
**B14. One dialog for all tools:** options → plan report (nothing changes) →
Apply, run on a working copy and taken as one step. This keeps the desktop
convention but avoids output on stdout.

**B15. Scripts filter in the font panel.** A multi-select of Unicode scripts
with glyph counts, using the resolution rules in A11. A "sort by script" was
tried and dropped: without block separators it confused more than it helped.

**B16. Search by component** in the font panel. `A` finds the glyphs built
with A, and `*cmb` finds those using a combining mark.

### Preview
**B17. Long glyph names never overlap.** A name that would run into the
previous one moves to a second line below, and that line is added only when
needed.

**B18. Ctrl/Cmd+wheel zoom and a resizable preview pane**, with size, margin
and name options kept per session.

### Help and appearance
**B19. A contextual help drawer** on the right, opened with Help, `?` or F1.
Its topic follows the panel in use, and a tab can pin one topic. Every panel
has a "?" that opens its topic, and the Preview topic lists every key. The
workspace narrows instead of being covered.

**B20. Theme and accent.** The theme can be light, dark or system, with
seven accent colours. Every colour is a theme token, canvases included. The
side half of group cells is hatched. Semantic colours (error, warning,
kerning value) stay outside the accent set.

**B21. Grid inset.** A 6 px inset between the grid cells and the panel border
keeps the frame of a selected edge cell from merging with the panel frame.

### Kept on purpose (no change suggested)
- Plain arrows edit the right margin and Alt edits the left, on either side.
  The web kept this for muscle memory.
- Margin labels: "72 ▶" at the right edge, "◀ 33" one line lower.
- History line format, half-to-even margin rounding, angled margins for
  italics, and "a glyph the beam misses is never a mismatch".

---

## Status (Font-Rover reply, 2026-10-16)

Uncommitted in Font-Rover at the time of the reply; re-vendor only after the
user commits there.

- **Taken:** A1, A2, A3, A9/A10, A11, B5.
- **Vendored modules changed:** `groups_control/copy_groups.py` (incremental
  match; Keep Kerning not taken into account — kerning always follows),
  `rename_groups.py` and `groups_history.py` (rename always carries
  kerning), `transfer_kerning.py` (`script_choices(font, mapping)`),
  `split_groups.py`, `languages/compat.py` (`codepoint_script`,
  `ScriptCompat.glyph_script` / `font_scripts`; `foreign_members` uses the
  primary script). No `utils/*` changes.
- **Not bugs on desktop:** A5, A6, A12; A13 (drag-reorder does not use
  `reposition_glyph_in_group`). A14: defcon dirty-only + ufonormalizer by
  design.
- **Deferred:** A4, A7, A8 (one general solution for margin edits with
  composites across the glyph editor, Runway and Groups Control).
- **B items other than B5:** not taken yet.

**Re-vendored** Font-Rover 517caca (2026-10-16). Our own script filter in
`master_tools.script_choices` was dropped in favour of the vendored one
(regression test `test_transfer_lists_only_scripts_the_font_is_written_in`).
Earlier note, done: consider replacing our script filter in
`master_tools.script_choices` with the vendored `transfer_kerning.script_choices`,
and re-check the Lang column / Split Groups tests against the new
`compat.foreign_members`.
