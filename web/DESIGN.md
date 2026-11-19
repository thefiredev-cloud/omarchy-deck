# Deck design system v3

Mode: Operate. Shipped 2026-11-14 on every page. It replaced the 2026-10 deck look (violet-grey ramp, amber tint, system-ui at 15/13/12 px, glass capsule, three nested column scrollers). Product truth lives in `PRODUCT.md`; this file owns the values. Code: `static/tokens.css` (tokens), `static/ui.css` (shared components), `static/tv.css` and `static/tv.js` (TV view), `static/fonts/` (Geist, OFL licence). Code is the source of truth: where this file and the code differ, fix this file.

## The rules every page follows

- Pages show values and one freshness mark. Source names, dates and coverage live in the Data sheet, one tap away. A page never prints a source line, a file name or a coverage line.
- A status shows only when something is out of date or missing. Out of date means older than twice the feed's own refresh.
- Smallest text: 13 px on a phone, 14 px on a desktop, 22 px on a TV at 1920 px wide (TV type scales with width, so 17.6 px at 1536). The one exception is the 12 px state codes on the phone map.
- Sentence case. No capitals with tracking, no em dashes.
- Money amounts stay hidden until the owner taps Show amounts.

## 1. Direction

**Thesis.** A private instrument for one reader: carbon ground, bone text, one signal accent, numbers set like survey readings. It refuses the category default of grey cards with a rainbow of page hues and small grey footnotes.

**World.** Palantir and Anduril register (owner, 2026-11-13): near-black ground, neutral grotesk, mono for data, hairlines instead of shadows, one accent used sparingly. No military motifs, no tracked capitals.

**Signature move: survey cells.** Anything spatial is drawn as square cells on a hairline grid, the way a land survey or a section map is ruled: the 51-tile state map, the strip of stat tiles (one panel, hairline cells), the 14-segment coast strip, the 7-day outlook columns. Codes and coordinates read in mono (`92629`, `33.475 N 117.706 W`, `CA`). Cell fill is one bone ramp, brighter is better; the chosen cell gets the signal outline.

**How it was chosen.** The brief pins palette, type and register, so the concept roll (`impeccable concept-seed`, key 908e0d79) only picked the signature move: assigned index 5 of seven grounded candidates (nautical chart soundings, tide booklet columns, offering-memorandum rent roll, lifeguard tower board, survey section grid, departure board, surveyor's field book). Challengers, fused and judged on audience fit and clarity: split-flap board declined (kept: numbers change in place, columns never move); orienteering map competitive (kept: signal reserved for the active choice only); Crouwel grid competitive (kept: layouts reflow by whole cells and columns); design-annual plates declined (kept: hairline credit rows); transit diagram declined (kept: focus one region, keep its neighbours visible); cassette j-card declined (kept: Today fits a fixed capacity, at most eight sections). No user round was possible (subagent, no question tool); the brief stood in for it.

## 2. Colour

Dark only, one scheme, never auto-inverted (always-on OLED phone, a desk at night, a TV across a room). Status hues mean status and nothing else; every status pairs a mark shape with a word. Signal marks only where you are (active tab, active sub-page), the one primary action per view, focus, the now marker, the selected map cell or region, and needs you. Selected filter chips and segments are bone on panel (baseline problem 31).

| Token | Value | Use |
|---|---|---|
| `--c-ground` | `#0A0B0D` | page |
| `--c-bar` | `#111317` | rail, bars, sheets |
| `--c-panel` | `#171A1F` | the one surface level |
| `--c-panel-2` | `#1F232A` | hover, selected, inputs |
| `--c-line` / `--c-line-strong` | `#2A2F37` / `#6E7784` | hairline (decorative) / control border |
| `--c-text-1/2/3` | `#F1EFEA` / `#B5B2AA` / `#8F8C85` | text, secondary, quiet (14 px and up only) |
| `--c-signal` | `#FF6B1A` | where you are, primary action, focus, now marker, selected cell |
| `--c-ok/warn/bad` | `#3DD68C` / `#F2C230` / `#FF5C77` | status, with washes `#1C342E` / `#363221` / `#37232B` |
| `--c-ramp-1..5` | `#2D2F33` `#47494C` `#6A6B6C` `#959695` `#CAC9C5` | maps and cells; hatched = no data |

Contrast (WCAG 2.x):

| Pair | Ratio | Grade |
|---|---|---|
| text-1 on ground / panel / panel-2 | 17.13 / 15.18 / 13.72 | AAA |
| text-2 on ground / panel / panel-2 | 9.29 / 8.23 / 7.44 | AAA (body copy uses text-1 or text-2) |
| text-3 on ground / panel / panel-2 | 5.87 / 5.20 / 4.70 | AA |
| text-1 / text-2 on bar | 16.18 / 8.78 | AAA |
| signal on ground / panel / panel-2 | 6.91 / 6.12 / 5.53 | AA |
| on-signal text on signal fill | 6.91 | AA |
| ok / warn / bad on panel | 9.30 / 10.41 / 5.85 | AA (marks also differ by shape) |
| text-1 on ok / warn / bad wash | 11.57 / 11.18 / 12.71 | AAA |
| text-2 on ok / warn / bad wash | 6.27 / 6.06 / 6.90 | AA |
| line-strong (control border) on ground / panel / panel-2 | 4.35 / 3.85 / 3.48 | 3:1 non-text |
| text-1 on ramp 1 / 2 / 3 | 11.67 / 7.86 / 4.65 | AA |
| ground on ramp 4 / 5 | 6.63 / 11.88 | AA |

`prefers-contrast: more` lifts text-2, text-3 and both lines. `forced-colors` keeps every mark visible.

## 3. Type

Geist (UI and text) and Geist Mono (figures, codes, table numerals, times) ship from the deck's own origin (`/fonts/*.woff2`, the full OFL variable files from the public `geist` 1.9.2 package, 69 KB and 71 KB, 728 and 889 glyphs, licence in `fonts/OFL-Geist.txt`), preloaded, `font-display: swap`. Metric-matched fallbacks (`Geist Fallback` = Arial-class at size-adjust 105.9%, ascent 94.9%, descent 27.9%; `Geist Mono Fallback` at 100%) so the swap moves nothing. Icons stay SVG (no glyph icons). Weights 400, 500, 600 only. Sentence case everywhere; no capitals with tracking; no eyebrows.

Fluid steps (CSS `clamp`, 390 to 1100 px, constant on D, XL is one step up, TV in `vw` so a 960 or 1920 CSS-pixel TV reads the same). Old deck: 12 / 13 / 15 / 20 / 28 on every screen.

| Step | P 390 | P 430 | T 834 | L 908x411 | D 1100-1599 | XL 1920 | XL 2560 | TV 1080p | Use |
|---|---|---|---|---|---|---|---|---|---|
| micro | 13 | 13.1 | 13.6 | 13 | 14 | 15 | 15 | 22 | axis labels, map codes (map may drop to 12 on P), tab labels |
| meta | 14 | 14.1 | 14.6 | 14 | 15 | 16.3 | 17 | 24 | labels, second lines, table heads |
| body | 16 | 16.1 | 17.3 | 17 | 18 | 19.3 | 20 | 28 | body, table cells, inputs (16 px floor) |
| lead | 17 | 17.1 | 18.3 | 18 | 19 | 20.3 | 21 | 30 | row titles, card titles |
| title | 21 | 21.2 | 22.9 | 21 | 24 | 26.7 | 28 | 36 | section titles |
| page | 26 | 26.3 | 29.8 | 24 | 32 | 35.3 | 38 | 48 | page title |
| fig | 30 | 30.3 | 33.8 | 30 | 36 | 41.3 | 44 | 56 | stat tile numbers (mono) |
| display | 40 | 40.7 | 47.5 | 36 | 52 | 58.7 | 64 | 72 | one hero number |

Line height 1.5 body, 1.35 rows, 1.2 titles, 1.05 figures. Measure 68ch. Strip numbers also scale with their own cell (`clamp(title, 15cqi, fig)`) so `$1,715/mo` never wraps.

## 4. Space, shape, surfaces

- Space in rem off the body step: 4, 8, 12, 16, 24, 32, 48, 64 px at 16 px; it grows with the type and with TV.
- Radii: 4 px controls, 6 px panels, 12 px sheet top corners, pills only for status. One elevation method: a 1 px hairline. Shadows only under sheets.
- One container level: a section is a sentence-case title and one surface (`.panel`, `.flist`, `.strip`, `.htw`, `.rank`). Separation inside is a hairline row, never a card in a card.
- Pages show values, one freshness mark and a status only when stale or missing. Sources, coverage, weights and method live in the Data sheet.

## 5. Device classes and the shell

| Class | Rule | Shell | Content |
|---|---|---|---|
| P phone portrait | width < 600 | slim top bar, 52 px (host switch with 44 px buttons, status, clock; 56 px corner kept empty), header row (sub-tabs or title, freshness; a warning mark with a figure shows its mark and figure, "12" or "59 min", beside sub-tabs and beside a title alike; "Not reporting" keeps its words beside a title and shows its mark and "No data" beside up to four sub-tabs from 360 px wide, the mark alone beside five or more; every sub-tab whole, Home's six and a row of three or four in equal cells of 44 px or more, 13 px under 420 px wide for five and up), one bottom bar with all 8 tabs whole in equal cells (48.75 px at 390), icon over label at 13 px, "Real estate" on two lines; nothing scrolls sideways | 1 column; tables become cards with P1 and P2; filters in a sheet |
| L phone landscape | height < 500, width >= 600 (Pixel 908x411 always on, iPhone 932x430) | one capsule row: host, 8 text tabs, the freshness mark as its mark and figure ("3", "15 days", "No data"; the words are its accessible name), status mark, clock; a page's Filters button joins the bar only when its filter row holds nothing else (Gigs, and Jobs, whose person picker moves into the Filters sheet), so the row goes, and in the bar it shows its mark and count (the word is its accessible name); beside a search or a switch it stays in its row, and a page never shows two; all 8 tabs fit at 908, and at 956 with a Filters button in the bar; narrower than that the strip scrolls with edge fades; sub-tabs in a 112 px left rail | 2 columns, one page scroller; tables show P1 |
| T tablet | 600-1099, height >= 500 | top bar with 8 tabs, edge fades when they scroll, active tab kept whole; segmented sub-tabs in the header row | 2 columns; P1-P2 |
| D desktop | >= 1100, height >= 500 | 220 px rail (240 on XL), icons and labels, sub-pages nested under the active tab, host switch on top, clock at the foot; Data button in the header | 12-column grid, content capped at 1600 px (96rem on XL); P1-P3; visible scrollbar; text selection on |
| XL | >= 1600 | as D | one type step up; P1-P4; up to 4 flow columns |
| TV | opt-in: `?view=tv` or the stored switch; a TV user agent gets a one-time prompt, never an automatic switch | top row of 8 large tabs, sub-tabs as pills, 5% side and 4% top overscan | board fits one screen; P1 only; no filters; D-pad focus with a 4 px ring and 1.04 lift |

Density: coarse pointers keep 44 px targets in every class, `.btn-sm` included; a fine pointer on D gets 36 px controls and rows (28 px for `.btn-sm`). iPad landscape (1366x1024) is D with touch sizes.

Layout primitives: `.flow` (balanced section columns, `--col-w` 20rem, at most 1/2/2/3/4/2 by class) and `.g12` (12-column rows; `.c-4` to `.c-8` spans on D and TV, halves on L and T, full on P). Halves suit blocks of similar height only; a page's long main list never takes a half (see "Layout: what a check cannot see" below). The document is the one scroller everywhere.

Navigation (D): `[` `]` tab, `{` `}` sub-tab, `1`-`8` jump, `/` search, `j` `k` row focus, `?` the list of keys (a sheet; also Keyboard shortcuts in every page's Data sheet under Display), Enter opens, Esc closes. Wheel scrolls the page; tables never need sideways scroll. The header names the sub-page after the page ("Money · Markets") unless it carries its own scope controls; the rail foot is two lines: clock and date, then status or weather.

**TV remote navigation** (baseline problem 2: arrows moved nothing, focus started on `body`, a Tizen remote has no Tab key). `static/tv.js`:
1. On load, focus sits on the active tab. No press is wasted.
2. Arrows move focus spatially across every focusable: tabs, sub-tab pills, strip tiles, cards, rows, map tiles, coast segments. The nearest candidate in the pressed direction wins (main-axis distance plus three times cross-axis distance). Left and Right stay in a row; Down leaves the tabs for the sub-tabs, then content; Up from the first content row returns to the sub-tabs.
3. Enter activates (opens the row's sheet). Back (Escape, Backspace, `GoBack`, `BrowserBack` 166, Tizen 10009, webOS 461) closes the open sheet, else returns focus to the active tab. Focus never leaves an open sheet. A game controller works the same way: d-pad or left stick to move, button 0 is OK, button 1 is Back.
4. The focused element scrolls into view (`block: nearest`); a page is a board that fits one screen, secondary content one Down press below.
5. Ring: 4 px signal outline, 3 px offset, plus a `panel-2` fill and a 1.04 lift on cards, rows and tiles. At 1080p that is a 4 px line around 56-72 px numbers, visible at 10 ft. No hover states on TV.
6. Test hook: `?press=DDR` replays remote presses (used by the renders and the QA harness).

Surf keeps its home spots in one TV band: a region-only group spans its own break count, not a separate full-width row. The height-for-region caption stays in the accessibility tree but is visually hidden on TV. Phone segment sizes and non-TV grouping stay unchanged.

**Phone chrome** (problems 10, 11, 33): one top bar (host switch, status slot, clock; 56 px corner empty) and one header row (sub-tabs or title, freshness). No stacked chip rows: section jump chips are gone on P, filters fold into one Filters button with a count. The status slot shows one mark and one word ("Not sent"), is capped at 9rem, never wraps; the full message opens in a sheet. The bar is `flex-wrap: nowrap`, so the clock never drops a row.

**Tables** (problems 5, 8, 9, 23, 7): every table names columns P1 to P4. P never shows a table: each row becomes a card with P1 and P2 values under their labels (the ZIP factor table becomes factor cards, nothing hides off the right edge). L shows P1, T P1-P2, D P1-P3, XL all, TV P1; a narrower panel drops columns by its own width too (container queries), and a table that still does not fit gets sideways scroll with a frozen first column as a last resort, flagged by the QA harness. L is two columns, never three. A null value never gets a tile or a row: the sheet names all missing values once ("Not reported: units, year built, occupancy."). Cell content is text or real elements, never escaped markup.

### Layout: what a check cannot see

Learned on 2026-11-15, when an audit by eye at phone landscape and tablet found 149 faults that `--check` passed, and every
lane then found the same holes at laptop and desktop. These rules bind every page and every PR that touches layout.

1. **No half-empty page.** A long list never sits beside a short panel. The page's main list takes the full width, as
   columns of rows or cards; short side blocks (At a glance, Market, Filters) go above it as a strip, under it, or behind
   their button. Independent blocks flow into balanced columns, never pinned to a half. A list, group or card never
   continues in another column: a section that is many screens tall is capped with Show more instead, and whole sections
   are balanced by the shared helper (`data-balance` on the container; `DeckBalance` in `deck.js`, ui.css under `.flow`).
   The line: no half of a page is empty for more than about 200 px while the other half still has content, at any size.
2. **P and L are both phones.** Where phone portrait shows five rows and Show more, phone landscape does too, so a short
   section pairs with its neighbour.
3. **Text.** A figure never breaks from its unit or its word ("12 W", "build 18", "39 days to sell"), and a number never
   breaks inside itself: no `word-break:break-all` on values. Code never cuts text at a fixed length without a mark: the
   text wraps, or it ends in an ellipsis at a word where the full text is one tap away. Text clipped with no mark is a fault.
4. **Touch.** A control is 44 px tall wherever the pointer is coarse (P, L, T and a touch D), `.btn-sm` included.
5. **A standalone page has no top bar** (`/cre`). The shell hands a page's head row to the bar at L; a page without the
   bar keeps its own head row at every size, or its title, Filters and Data cannot be reached.
6. **The shell bar.** A page shows one Filters control, never two; a filter row that repaints replaces any copy in the bar.
   On L and beside a P sub-tab row the freshness mark shows its mark and figure, so the tabs keep their room; every tab and
   sub-tab on a phone is whole (none scrolls), and on L and T a side with hidden tabs fades with the active tab kept whole.
7. **How to check.** `--check` measures text size, grey share and overflow, not empty space or a cut label. Before a layout
   PR merges, cut the full shots into slices (about 1,200 px) at phone landscape (932x430, 908x411), tablet (834x1194,
   1366x1024), laptop (1440x900) and desktop (1920x1080), and look at each slice; never judge a scaled-down whole. Name the
   sizes that were looked at in the PR. A phone fix is proved in WebKit too (the kit's WebKitGTK runner), not only Chromium.

Burn-in guard (dim at 2 min, first tap wakes) runs only with the Always-on display flag: on by default for the installed fullscreen web app with a coarse pointer in landscape, off elsewhere, never on TV.

## 6. Focus, motion, states

- Focus: 2 px signal outline, 2 px offset, instant (4 px and a 1.04 lift on TV). Table rows show a 3 px signal edge.
- Accessibility: loading strips and lists are named groups with `aria-busy`; Fleet and Cluster group headings follow the page heading at level 2. Middle-ramp map figures keep full text opacity, so the ramp's AA contrast is preserved.
- Motion: one curve `cubic-bezier(.2,0,0,1)`; 120 ms press, 200 ms sheets; data never animates; skeletons pulse opacity only. `prefers-reduced-motion` removes all of it.
- States: empty (dashed hairline, icon, one line), stale (warn triangle, "Out of date · 3 days", one Try again in the page status), failed (crossed square), needs a key (dash mark), building ("Building · 6 of 14 days"), loading (static skeleton). A state's icon sits beside its title, with the line and Try again under the title; the stale and failed icons are the triangle and the crossed square drawn as outlines. With no answer from the deck server and no stored role, the shell shows the failed state inside the page margins ("The deck server did not answer", Try again); signed out shows Sign in the same way.
- Formats (`DeckCore.fmt`, static/ui-core.js): every page uses these, never its own. Money `money`, rent `rent`, price per foot `psf`, rates `rate`, shares and ratios `share`, changes `chg`, counts `count`, and a figure with its unit word `days` ("39 days"), `months` ("4.3 months"), `unit` ("12 W"), joined by a no-break space. A missing value is null and the page draws `na()`. The nine best-ZIP points map as: home value money, 1-year change chg, rent rent, gross yield share, days to sell days, 30-year rate rate, price cuts share, inventory count, payment to income share.
- Marks: ok check, warn triangle, bad crossed square, wait (needs you) signal square, off dash, never ring. Listed versus estimated: solid disc versus ring. Model-only surf values: a hollow square before the value.
- Confidence (blended numbers only, no word on the page): a hairline capsule meter, a pill outline 1 px in `line-strong` (#6E7784) split into three equal segments with 1 px gaps; low fills 1, medium 2, high 3 segments in `text-2` (#B5B2AA), empty segments transparent, no hue. Sized on the meta step (width 1.45em, height .5em at `--fs-meta`): about 20×7 px on P, L and T, 22×7.5 on D, 23×8 on XL, 35×12 on TV. It sits after the value and its unit with a .5em gap, vertically centred on the figure, never touching a digit. Markup and aria text are unchanged. Change note (2026-11-14): replaces the three dots, because on the iOS lane's real screenshots three filled dots read as an ellipsis.

## 7. Components (`ui.css`)

Shell (`#top`, `#pgs`, `.rsub`, `#topr`), page header (`.phead`, `.ptitle`, `.pscope`, `.pact`, `.fresh`, `.subrow`), layout (`.flow`, `.g12`, `.sect`, `.secttl`), surfaces (`.panel`, `.card`, `.cards`), stat tile and strip (`.tile` `.h .v .u .t`, `.strip`, `.delta`, `.conf`), list row (`.flist .frow .fl .fr`), ranked rows (`.rank .rank-row`), data table (`.htw .htbl`, `data-pri` 2-4, `data-l` card labels, `.htw.scroll` for sheets), controls (`.btn`, `.btn-primary`, `.btn-quiet`, `.seg`, `.chips`, `.fchip`, `.field`, `.search`), filter bar (`.fbar` with the inline-or-sheet `dialog.fbar-panel`), status (`.pill`, `.sd`, `.pips`, `.stale-bar`), states (`.es`, `.es-stale`, `.es-bad`, `.es-setup`, `.skel`), sheets (`dialog.sheet`, `.sheet-h/-b/-a`, legacy `#sheet*` ids, `.kv`, `.tiles4`), Data sheet (`.ds-src`, `.ds-blend`, `.ds-part`, `.toggle-row`), charts (`.spark`, `.bar`, `.hbars`, `.range`, `.chart` with `.ln .ref .now .pt`, `.obars`), the state map (`.usmap .st`, `.legend`), the coast strip (`.coast .cs`), surf cards (`.spot`).

## 8. Decisions (answered by Main, 2026-11-14)

1. L is one page scroller with two balanced columns. Yes.
2. Full Geist and Geist Mono, vendored with the licence, no CDN. Yes (done).
3. 12 px state codes on the P map are the one exception to the 13 px floor. Yes.
4. Signal marks "needs you". Yes. Signal means only: where you are, the one primary action, focus, the now marker, the selected cell, needs you. A selected filter chip or segment is bone on panel, never signal.
5. The Deck keeps its own palette and stops following the desktop theme. Yes (Main, under the owner's 2026-11-13 direction).

## 9. Measured before and after

Before: the baseline pass of 2026-11-14 (live feed copies, staging server, 11 viewports). After: the staging kit's `shoot --check` on the shipped pages in headless Chromium. That is Chromium emulation: not iOS WebKit and not the TV's Chrome 108, and no real TV, phone or tablet was tested. First pass on `ef2e897`: 16 pages at phone 390x844 (P), laptop 1440x900 (D) and TV 1536x864. Re-check on `b33d9da` of the five pages that merged after it (Dev, Crons, Launch, Jobs, Gigs), at those sizes plus TV 1920x1080.

| Measure | Before | Target | After |
|---|---|---|---|
| Smallest text | 12 px everywhere | P >= 13 (map codes 12), D >= 14, TV >= 22 at 1920 (17.6 at 1536) | P 13, D 14, TV 22 (21.1 at 1536); every record passes |
| Quiet grey (`text-3`) share of characters | 55-56% on Housing | <= 5% on every page | 0% on 44 of 48 first-pass records; Dev was over (17%, 7%, 12%) before its rewrite merged and reads 0% on the re-check |
| Source text on screen | 49% (1920) and 53% (1440) of Housing characters | none; one freshness mark per page | 0 characters on screen on all 16 pages at P and D |
| First data, from the top of the screen | phone chrome 245-290 px (29-34%) at 390x844 | <= 200 px on P; on TV 200 at 1920, 160 at 1536 | P 160 to 183 px on the re-check; Commercial 280 px on P, accepted because its type switch has its own row. TV 160 at 1536 and 200 at 1920 on the re-check; Orders 212 at 1536 accepted (board heading); Commercial 251 at 1536 still over |
| Overflow: text or boxes cut by their own box, not only by the viewport edge | 27 addresses and type lines cut at 390 | 0 | 0 on all 20 re-check records; in the first pass only Dev and Launch overflowed, before their rewrites merged |
| Commercial page height | 16.6 vp (390), 15 (1440), 11.6 (1920) | <= 8, <= 4, <= 3 | 6.7 (390), 3.3 (1440), 1.0 at TV 1536; desktop 1920 not measured |
| Today height on a phone | 8.8 vp | <= 3.5 | 3.9 (D 1.8) |
| TV board fits one screen | not measured | every board child inside the safe area | every page at 1536; Home > Cluster since #275 (board ends at 354 of 829 at 1536 and 396 of 1037 at 1920). Dev, Launch and Jobs open on a board and scroll below it |
| Signal marks on one screen | 5 meanings on one Life screen | <= 4 | every re-check record passes; Launch had 8 to 17 before its rewrite merged |
| TV focus contrast | 2 px ring after 3 Tabs | >= 4.5:1 inside the focused element | no record fails |

Detector (`impeccable detect`): "overused font" flags Geist, which the owner's brief pins; "side-tab" flags the 3 px underline of the selected segment (a tab indicator, not a card stripe); "cramped padding" flags segmented controls and table wrappers whose cells carry their own padding; "repeating stripes" is the hatch that means no data on the map and coast strip. Kept on purpose.

## 10. Pad keys

The Pad keeps its own rules from 2026-10-06, enforced by the server (`rust/src/pad.rs`) and the page alike: a key tapped with Super may only be C, V, X, Z, A, W, F, Space, Tab, Enter, the four arrows, the digits 0 to 9 and F4; Ctrl, Alt and Shift can still be latched on top. A refused combo is told in words, never as a bare "Rejected".
