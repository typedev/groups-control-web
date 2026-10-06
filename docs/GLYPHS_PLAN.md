# Glyphs sources — work plan (parked)

Status: **parked**. Discussed on 2026-10-05 and judged much larger than a
UFO-style input: editing a `.glyphs` file in place means reproducing a fair
part of Glyphs' own behaviour. Designspace / multi-master UFO comes first
([LATER.md](LATER.md) §1); most of its machinery (master switcher, edits
applied to every master) is a prerequisite for Glyphs anyway.

Background facts (data model, the one-manager-per-master trap, key glyph,
reading and writing) are in [LATER.md](LATER.md) §2. This file is the plan.

---

## Where the real cost is

| Area | Difficulty | Why |
|---|---|---|
| Groups ↔ `public.kern1/2` | low | `rightKerningGroup` ↔ kern1 (`@MMK_L_`), `leftKerningGroup` ↔ kern2 (`@MMK_R_`); verify against glyphsLib `builder/groups.py`, `kerning.py` |
| Membership edits | medium | groups are shared, kerning is per master: every edit remaps kerning in **all** masters as one undo step |
| Empty groups | medium | a Glyphs group exists only while a glyph carries it; kerning may still reference a memberless `@MMK_*` (orphan) |
| Key glyph | low | groups are unordered; key = member named like the group, else first in glyph order; no "drop at index 0" |
| Parser in Pyodide | medium, **risk** | `openstep-plist` is Cython-only; wasm wheel or a pure-Python shim |
| Zero-diff save | medium | patch the raw plist; open → save must give zero diff |
| Kerning keys | low | old Glyphs 2 files may key kerning by glyph ID instead of name; check |
| Margins: reading | low | geometry is stored (layer width, nodes); metrics keys need not be evaluated to display margins |
| Margins: editing | **high** | moving paths, components, anchors, guides, hints and background per layer; policy for glyphs driven by metrics keys |
| Metrics keys | medium | `=H`, `=|H`, `=H+10`, `=n*1.2`, glyph and layer level; small expression parser + dependency graph with cycle check; italic measuring |
| Drawing | **high** | smart components (interpolated), corner components, auto-aligned components |
| Masters | medium | kerning, margins and validation differ per master; brace/bracket layers |

## Decisions taken in the discussion

- Groups are shown once (they are shared). Open on the origin master:
  custom parameter `Variable Font Origin`, else the first master.
- A plain master dropdown switches what is per master (kerning, margins,
  outlines). No "All masters" view, no Apply-to-masters.
- Margin-mismatch validation may be computed over all masters (marker if any
  master mismatches).
- `.glyphspackage` and format 4: later.

## Stages

0. **Spike.** An OpenStep plist parser running in Pyodide; open → save →
   zero diff on an open-source multi-master `.glyphs` file (v3 and v2).
1. **Stage A — groups and kerning.** Groups ↔ kern1/kern2; per-master
   kerning with the master dropdown; membership edits remap kerning in every
   master as one undo step; minimal-diff save. Margins **read-only**,
   metrics keys shown as badges. Smart/corner components drawn as far as
   stored data allows (or as placeholders).
2. **Stage B — margins without keys.** Margin editing for glyphs with no
   metrics key on the edited side; with a key: refuse, or offer to unlink
   (open question).
3. **Stage C — metrics keys (optional).** Evaluate keys and cascade like
   Glyphs' Update Metrics.

## Open questions

- Metrics-key policy in Stage B: refuse the edit, or unlink the key?
- Test files: open-source (OFL) `.glyphs` sources — multi-master, one with an
  italic and metrics keys.
