# Designspace / multi-master UFO — work plan

Status: **in progress** (spike on branch `designspace-spike`). Background and
the list of tools that need a second font: [LATER.md](LATER.md) §1. Glyphs
sources build on this machinery: [GLYPHS_PLAN.md](GLYPHS_PLAN.md).

---

## What two real designspaces showed (2026-10-05)

Two local commercial designspaces (not in the repo), measured with a CPython
script:

| | A | B |
|---|---|---|
| Axes | weight, slant (continuous) | width, weight (continuous), italic (**discrete** `values="0 1"`) |
| Sources | 4 (folder holds 7 UFOs, 2 designspaces) | 18 (9 per italic value) |
| Glyphs / kern groups | 729 / 161 | 1049 / 170 |
| Kern groups across sources | **identical** | **identical**, member order included, even across italic |
| Kerning | differs (1490–1530 pairs) | differs (1113–2098 pairs) |
| Folder size | ~25 MB | **404 MB**, of which the UFOs are 82 MB |
| groups + kerning of all sources | — | 0.15 s |
| one source fully parsed | — | ~0.1 s |

Formally every UFO has its own groups; in practice they are the same and
kerning is not. That is the model to optimise for, without assuming it.

## Spike results (2026-10-05, Chrome, Pyodide 314.0.7)

Done on branch `designspace-spike`: `py/gcweb/designspace.py`,
`api.open_designspace` / `switch_master`, folder drop + designspace choice
in `src/files.ts`, master dropdown + compatibility badge in the header.
Read-only; the session autosave skips designspaces.

Measured on designspace B (18 masters; the referenced UFOs are 19 239 files,
**22.6 MB** of content — `du` reports 82 MB because of block size):

| Step | Time |
|---|---|
| open in the worker (MEMFS write + parse + plists of 18 masters + default master + outlines to the mirror) | 1.4 s |
| — designspaceLib parse | 321 ms (mostly first import) |
| — groups/kerning plists of 18 masters | 183 ms |
| — default master `UfoDocument` | 41 ms |
| switch master (reopen + outlines + new mirror), no cache | 340–380 ms |

Designspace A with one master's groups altered in memory: badge "3/4
compatible · 2 group sets", tooltip lists the differences.

Findings:
- **Eager reading is fine** at this size; lazy reading of masters is not
  needed for now. Reading time from a real drop is still to be measured by
  hand (automation cannot drop a folder; the test fed files through a
  dev-only `window.__gcOpen` hook).
- **Master names are ambiguous**: `stylename` repeats across widths ("Extra
  Bold" ×3). Masters are now labelled by the UFO file name.
- Of the ~350 ms switch, reopening the UFO is ~30 ms; the rest is the
  outline payload and the new mirror;
  caching per master makes repeat switches instant.

## Opening

- **Drop the project folder** (works in every browser). The `.designspace`
  files at its top level are listed; with more than one, the user picks.
  Dropping a `.ufo` folder or a `.ufoz` keeps working as before.
- **Read selectively.** Never walk the whole folder (build outputs, logs,
  `.git`): read the chosen `.designspace`, then only the UFOs its sources
  reference. Paths leaving the dropped folder (`../`) are an error with a
  clear message.
- Parse with `fontTools.designspaceLib` (pure Python, already in Pyodide).
  `findDefault()` gives the default source (axis maps included).
- Sources with `layer=` (sparse layers inside a UFO) are not masters for
  groups/kerning: list them, do not edit.
- Load groups + kerning of every master at open; outlines of the default
  master only; others on first switch, then cached. Whether drop entries stay
  readable long after the drop (needed to read a master lazily) is checked
  in the spike.

## Group compatibility

At open (and after every edit) masters are partitioned into **sets with
identical kern groups**. Three levels:

- **identical** — names, members and member order;
- **same members, different order** — the key glyph differs; soft warning;
- **different** — names or members differ; warning with the list of
  differences.

The header shows the state of the current master's set, e.g. "17/18
compatible".

**Match order**: masters whose kern groups differ from the current one
only in member order get a header button that copies the current order
(key glyphs included) to them — within the scope's reach (subspace, all
subspaces; hidden for "this master only"). Kerning is not touched.

## Applying a membership edit

A scope selector in the header, next to the master dropdown. Labels count
the masters reached ("Edit all compatible masters (6 of 18)"):

- **All compatible masters** (default) — every master whose kern groups
  equal the current one's, upright and italic alike;
- **Compatible masters of this subspace** (e.g. italic=0) — shown only when
  the designspace has discrete axes;
- **This master only** — for bringing diverged masters back in line.

Changed on 2026-10-06 after real use: the first default (current subspace
only) left the italics out of an edit the user expected to reach every
master with identical groups; "compatible" alone did not say so.

A master whose groups differ is never a target: applying an edit to
different groups could do something other than what the user sees.

Each master runs the operation on its own groups and remaps its own kerning
(no shared groups object, so the Glyphs trap does not apply). One edit = one
undo step across all touched masters. Sets are recomputed after each edit:
"this master only" can split a set, fixing diverged masters merges them.

## Masters in the UI

- Master dropdown in the header, default master first selected. It switches
  kerning, margins, outlines and margin validation.
- Margin validation: current master only. Checking every master at once was
  considered and dropped (2026-10-06): the user steps through the masters to
  look; margins are not compared across masters.

## Saving

Write only the changed files of the changed UFOs (`groups.plist`,
`kerning.plist`, edited `.glif`s), keeping each file's style; the
`.designspace` is never modified. Chromium writes into the dropped folder;
other browsers download a zip of just the changed files. Open → save → zero
diff in every UFO. Details: stage 3 below.

## Stages

0. **Spike** (read-only): folder drop → designspace choice → selective read
   → load all masters in Pyodide with timings → compatibility report →
   master dropdown that switches the viewed master.
1. **Multi-master document** — done (still read-only): every master is a
   `UfoDocument` held in `api._masters` (`MasterSession`: manager, Lang
   checker and kern editor built on first activation); `switch_master`
   re-points the current-master globals without reopening anything;
   compatibility is computed from the live tracked groups; deltas carry the
   master index. TS caches one `FontModel` per visited master. Progress bar
   for reading files, handing them to Python, opening each master and
   preparing outlines (start screen; under the header when switching).
   Measured (18 masters): open 0.9–1.2 s in the worker (all 18 `UfoDocument`s
   ≈ 0.4 s), first switch to a master ≈ 370 ms, repeat switch ≈ 30 ms.
   When edits arrive (stage 2), deltas for non-current masters must update
   or drop their cached `FontModel`.
2. **Scoped edits** — done. Header selector: *Edit compatible masters*
   (default: same kern groups, same discrete subspace), *…all subspaces*
   (shown only with discrete axes), *Edit this master only*. Membership
   edits (add, create, remove, delete, rename, reorder) run in every target
   master through its own manager, so each remaps its own kerning; if any
   master fails, every master is rolled back and the error names it. There
   is no undo in the app yet: one edit = one RPC across masters; Revert
   reverts every master. Kerning, margin, import and tool edits stay on the
   current master. The badge is recomputed after every edit; the TS mirror
   drops the cached models of the other changed masters. Designspaces are
   editable but **saving is blocked** until stage 3 (Save disabled with the
   reason; leaving the page with edits asks first).
3. **Saving** — done. Every master's `UfoDocument.changed_files()` (groups,
   kerning, edited `.glif`s; unchanged content skipped, original plist style
   kept), keyed by the master's path in the designspace folder
   (`Bold.ufo/groups.plist`). Chromium: the dropped folder's handle (asked
   for read-write on the first save) and `writeToFolder`. Other browsers:
   **Download changes** — a zip of just the changed files at those paths, to
   unzip into the designspace folder (files to delete, e.g. an emptied
   `groups.plist`, are named in the status line). Tests: open → save = no
   files; save writes only the changed masters and nothing else changes on
   disk; reopen → save = no files; style kept; zip content. Since then: the
   session autosave keeps one state per changed master (plus the scope),
   and the folder picker opens a project folder too (drop and picker share
   one folder interface in `src/files.ts`).
4. **Two-font tools** between masters of the open designspace, in the
   Tools dialog (decided 2026-10-06), in this order:
   - **Copy Groups** — current master → chosen masters. Incremental, not the
     desktop's delete-all-then-add (14 s for 17 masters in CPython, and it
     churns kerning even where groups are equal): per target, delete the
     groups the source lacks, take out members that belong elsewhere, add
     the missing ones, then copy the order. Equal masters are skipped.
   - **Diff Groups** — a separate tool with a visual view: the differing
     groups shown with our glyph grid cells, side by side per master.
     Kerning differences are left out (user, 2026-10-06).
   - **Copy Kerning of Glyphs**, then **Interpolate** / **Transfer Kerning
     by Script** — engines vendored from Font-Rover (`copy_kerning`,
     `interpolate_kerning`, `transfer_kerning`). Interpolate writes into the
     current master and takes the position from the designspace locations.

   All five done (2026-10-06): `py/gcweb/master_tools.py`; option types
   `masters`, `master`, `checklist` in the Tools dialog.

## Fixtures

The repo needs an open-source designspace: MutatorSans (already partly in
`fixtures/`) has one with several masters; add a discrete-axis variant for
tests.
