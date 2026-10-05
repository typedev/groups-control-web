# For a typedev.github.io session: add Groups Control to the landing page

Groups Control Web (repo `typedev/groups-control-web`) is deployed by its own
GitHub Actions workflow to GitHub Pages and served at
**https://typedev.github.io/groups-control-web/** (project pages of that
repo). Nothing is copied into typedev.github.io — unlike fea-proof, rangeproof
and ot-edit, it has no `deploy.sh`.

**Do not create a `groups-control-web/` directory in typedev.github.io**: the
project site already answers at that path, and a directory there would compete
with it.

## 1. A card on the landing page (`index.html`)

The tool fits neither *Proofing* nor *Metadata*: it edits kerning. Add a third
band after Metadata, in the same structure as the others, for example:

- band title: **Spacing**
- band gloss: *how glyphs sit together* (or similar, in the voice of the other
  glosses)

The card, following the existing `article.tool` pattern:

- link: `./groups-control-web/` (relative, like the other tools)
- title: **Groups Control**
- description (≈ the length of the others):
  > Edits the kerning groups and the kerning of a UFO: drag glyphs into
  > groups, check that members share the key glyph's margin, see the pairs a
  > group affects and adjust them in a live preview. Saves only the changed
  > files back into the folder.
- foot: formats `UFO UFOZ` (mono), tag `writes fonts`, source link
  `https://github.com/typedev/groups-control-web`
- spec miniature (CSS only, like the others — the site's own palette:
  `--guide` blue for structure, `--mark` amber for "found / changed"). An idea
  that mirrors the tool's own output: a kerning-group cell — the key glyph
  "A" with two faint members behind it, one half of the cell hatched (the
  side being checked), the key glyph's margin `20` in a corner and one member
  flagged `!15` in `--mark`. Label e.g. `@.A · side 1`. A two-row pairs
  table (`@.A  @.V  −50`, `Aacute  @.V  −60 ◀`) works as well.

## 2. Footer

- Add to the Source list (`dl.repos`):
  `groups-control-web` → `Groups Control`.
- The footer says the rebuilt copy downloads and originals are never touched.
  Groups Control can also **write back into the folder you opened** (Chrome,
  Edge — the browser asks for permission first). Reword so it stays true,
  e.g.: "…read and changed in your browser. Edited copies download straight
  back to you; tools that edit a source folder write only after you allow it."

## 3. CLAUDE.md of typedev.github.io

Add a row to the Layout table:

| `/groups-control-web/` | Groups Control | no — project pages of `typedev/groups-control-web` (GitHub Actions), not a directory here |

## 4. Check

Serve the site locally and confirm the card link resolves to the live tool
(`https://typedev.github.io/groups-control-web/` once deployed); the landing
page must not hard-code the number of tools.
