# sceneform-fountain.js

A line-based, offset-preserving, non-destructive Fountain parser for Sceneform.

Based on [Fountain 1.1](https://fountain.io/syntax), cross-checked against Beat's
Fountain docs, with scene-heading / transition / inline-style pattern ideas from
`fountain-js` 0.1.10 (MIT, Matt Daly).

> Every section below has two parts: **Plain English** (what it's for and how
> to think about it) and **Technical** (exact fields, types, and rules).

## Guarantees

**Plain English:** You can throw literally any text at this parser — weird,
broken, half-written Fountain — and it will never crash. It also never
"cleans up" or rewrites your script behind your back: if you parse a document
and immediately turn it back into text, you get back byte-for-byte what you
started with. And it figures out what every line is in a single, predictable
pass, so the same input always classifies the same way.

**Technical:**

1. **Nothing is lost or rewritten.** Every source character belongs to exactly one
   entry of `doc.lines`, and `serialize(doc)` reproduces the input byte for byte.
2. **`parse()` never throws** on any string input.
3. **Classification is deterministic and local** — one pass over the document,
   at most one line of lookahead.

## Installation / usage

**Plain English:** Drop the file in as a script tag or `require()` it — it
works either way. Feed it your screenplay text and it hands back one big
object with everything pre-parsed: every line, every scene, every character,
title-page info, and any problems it noticed.

**Technical:** UMD module — works as a CommonJS module (`module.exports`) or a
global (`window.SceneformFountain` / `self.SceneformFountain`).

```js
const doc = SceneformFountain.parse(text, {
    caretLine: 12,
    markers: [/^@@(END)?ID\b/],
});

doc.lines; // every source line, classified
doc.blocks; // lines grouped into structural blocks
doc.scenes; // scene_heading blocks, expanded with metadata
doc.outline; // sections + scenes, in document order
doc.characters; // speaking characters and their appearance counts
doc.titlePage; // parsed title-page key/value map
doc.notes; // [[ ... ]] note ranges
doc.omits; // /* ... */ boneyard ranges
doc.diagnostics; // non-fatal warnings

SceneformFountain.serialize(doc) === text; // always true
```

## `parse(input, options)`

**Plain English:** `caretLine` exists so that while someone is actively
typing a character name, it gets treated as a character cue right away —
even before they've typed any dialogue underneath it — as long as the cursor
is sitting right there. Without it, an all-caps line with nothing under it
yet would just look like action text. `markers` lets Sceneform tag its own
special lines (like hidden IDs) that should be ignored by the screenplay
logic entirely.

**Technical:**

| option      | type               | description                                                                                                                                                                                                                              |
| ----------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `caretLine` | number             | Index of the line the caret is currently on. Lets a bare, bodyless, all-caps line right at (or just before) the caret be provisionally treated as a character cue while it's being typed, instead of waiting for dialogue underneath it. |
| `markers`   | RegExp \| RegExp[] | Custom pattern(s) tested against each line's raw text. A match forces the line's type to `'marker'` (transparent to structure, like notes/omits) regardless of what it would otherwise parse as.                                         |

Returns a `doc` object (see **Document shape** below).

### Robustness

**Plain English:** A byte-order-mark (an invisible character some editors
stick at the very start of a file) is stripped before parsing so it doesn't
confuse anything, then quietly put back when you serialize. And instead of
crashing on malformed input (like a `/*` that never gets closed), the parser
just makes a note of it in `diagnostics` and keeps going.

**Technical:**

- Byte-order-mark (BOM) is detected and stripped before parsing, then
  re-added on `serialize()`.
- Any input, including malformed/unterminated boneyards, produces a result —
  problems are reported via `doc.diagnostics`, not thrown.

## `serialize(doc)`

**Plain English:** Turns a parsed document back into plain text. Because the
parser never throws away or alters a single character of your original
script, this always gives you back exactly what you started with, even if
you never touched the parsed result.

**Technical:** Reconstructs the exact original source text from `doc.lines`
(plus the BOM flag). Because every character is retained somewhere in
`doc.lines`, this is always a lossless round trip, even if the document was
never modified.

## `parseInline(text)`

**Plain English:** Handles bold/italic/underline formatting inside a single
line of text (not the overall screenplay structure — just the `*bold*`-style
markup within, say, an action line). Give it a string, get back a list of
chunks, each one tagged with which styles apply to it.

**Technical:**

```js
parseInline("**bold** *italic* ***both*** _underline_");
// => [
//   { text: 'bold',      bold: true,  italic: false, underline: false },
//   { text: ' ',         bold: false, italic: false, underline: false },
//   { text: 'italic',    bold: false, italic: true,  underline: false },
//   ...
// ]
```

Rules:

- `*italic*`, `**bold**`, `***bold+italic***`, `_underline_`.
- Delimiters must hug their content (no whitespace immediately inside them)
  to open or close a run; unmatched or stray markers are kept as literal text.
- `\*` and `\_` (and `\\`) escape the character.
- Underscores inside ordinary words (`snake_case`) are left untouched since a
  closing `_` is only recognized next to non-word-adjacent boundaries.

## `LINE_TYPES`

**Plain English:** This is just the full list of labels a line can get —
"this is a scene heading," "this is dialogue," and so on. Three of them
(`note`, `omit`, `marker`) are special: they're invisible to the structural
logic, so a note or a commented-out boneyard block never breaks up a scene
or a dialogue exchange.

**Technical:**

```
blank, title_page, scene_heading, action, shot, character, parenthetical,
dialogue, lyrics, transition, centered, section, synopsis, page_break,
note, omit, marker
```

`note`, `omit`, and `marker` are **transparent** — they carry no structural
weight and are skipped when determining block/scene boundaries.

## Document shape (`doc`)

**Plain English:** After parsing, you get one big object. `lines` is the raw
material (every line, one by one). `blocks` groups those lines into
meaningful chunks (a whole dialogue exchange counts as one block, for
example). `scenes` and `outline` give you the big-picture structure of the
script. `characters`, `titlePage`, `notes`, `omits`, and `diagnostics` are
convenience extras pulled out for you so you don't have to dig through
`lines` yourself.

**Technical:**

| field          | type                 | description                                                                 |
| -------------- | -------------------- | --------------------------------------------------------------------------- |
| `text`         | string               | The original input, verbatim.                                               |
| `bom`          | boolean              | Whether the input started with a BOM.                                       |
| `lines`        | Line[]               | One entry per source line — see **Line objects**.                           |
| `blocks`       | Block[]              | Lines grouped into structural units — see **Block objects**.                |
| `scenes`       | Scene[]              | Scene-heading blocks expanded with parsed metadata — see **Scene objects**. |
| `outline`      | (Scene \| Section)[] | Scenes and `#`-sections interleaved, in document order.                     |
| `notes`        | Note[]               | `[[ ... ]]` ranges.                                                         |
| `omits`        | Omit[]               | `/* ... */` boneyard ranges.                                                |
| `diagnostics`  | Diagnostic[]         | Non-fatal warnings collected during parsing.                                |
| `titlePage`    | object               | Lower-cased title-page key → value (multi-line values joined with `\n`).    |
| `titleEntries` | TitleEntry[]         | Title-page entries with original casing and line spans.                     |
| `characters`   | Character[]          | Unique speaking characters (by uppercased, whitespace-normalized name).     |

### Line objects

**Plain English:** Each entry in `doc.lines` is one physical line of the
script, tagged with what it is (`type`), what it actually says once any
forcing punctuation is stripped off (`text`), and exactly where it sits in
the original file (`start`/`end`) so nothing ever gets misplaced.

**Technical:** Every element of `doc.lines` describes exactly one physical line:

| field          | description                                                                                                                                     |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `index`        | Line number (0-based).                                                                                                                          |
| `start`, `end` | Character offsets into `doc.text` (end-exclusive, before the line terminator).                                                                  |
| `eol`          | The line terminator that followed (`'\n'`, `'\r\n'`, `'\r'`, or `''` for the last line).                                                        |
| `raw`          | The exact source text of the line, untouched.                                                                                                   |
| `masked`       | `raw` with any boneyard/note ranges blanked out (spaces), used for classification.                                                              |
| `visible`      | `masked`, trimmed — the text actually considered for parsing.                                                                                   |
| `type`         | One of `LINE_TYPES`.                                                                                                                            |
| `text`         | The classified content with any forcing punctuation stripped (e.g. a scene heading's leading `.`, a character cue's leading `@`).               |
| `forced`       | Whether an explicit Fountain marker (`.`, `!`, `@`, `~`, `>`, `!!`) forced this classification.                                                 |
| `indent`       | Leading whitespace width of `masked` (informational).                                                                                           |
| `continuation` | `true` for a two-space "blank" line used to continue action or dialogue across a paragraph break.                                               |
| `character`    | For `type: 'character'` lines: the parsed cue — see **Character cue parsing**.                                                                  |
| `inDialogue`   | For `type: 'lyrics'` lines that occur inside an active dialogue block.                                                                          |
| `provisional`  | `true` when a bare all-caps line was tentatively classified as a character cue only because of `caretLine`, with no dialogue underneath it yet. |
| `depth`        | For `type: 'section'` lines: the number of leading `#` characters.                                                                              |

### Block objects

**Plain English:** Blocks bundle related lines together — a character cue
plus all its dialogue and parentheticals become one dialogue block, several
consecutive action lines become one action block, and so on. A blank line
(or a note/omit/marker) always ends the current block.

**Technical:** Consecutive lines of compatible type are merged into blocks
(blank lines and transparent lines end a block):

| field           | description                                                                                                                                                       |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`          | `'title_page'`, `'action'`, `'dialogue'`, `'lyrics'`, `'scene_heading'`, `'section'`, `'synopsis'`, `'shot'`, `'transition'`, `'centered'`, or `'page_break'`.    |
| `first`, `last` | Line indices spanned by the block.                                                                                                                                |
| `start`, `end`  | Character offsets spanned by the block.                                                                                                                           |
| `character`     | For `type: 'dialogue'`: the cue that opened it (or `null` for an orphaned dialogue/parenthetical with no preceding character cue).                                |
| `elements`      | For `type: 'dialogue'`: ordered `{ type: 'dialogue' \| 'parenthetical' \| 'lyrics', line, text }` entries.                                                        |
| `speaker`       | For `type: 'dialogue'`: the normalized (uppercased) character name.                                                                                               |
| `continued`     | For `type: 'dialogue'`: `'explicit'` if the cue had a `(CONT'D)`-style extension, `'auto'` if the same character speaks again after an interruption, else `null`. |
| `dual`          | For `type: 'dialogue'`: `'left'` / `'right'` when paired via a trailing `^`, else `null`.                                                                         |

### Scene objects

**Plain English:** Every scene heading (`INT. KITCHEN - DAY`) gets expanded
into a rich record: where it starts and ends, what it's numbered, whether
it's interior or exterior, the location, the time of day, who speaks in it,
and any notes or shots that fall inside it. This is the object you'd use to
build a scene list or a scene-navigator sidebar.

**Technical:** Each `scene_heading` block is expanded into a scene record:

| field              | description                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------- |
| `index`            | Position in `doc.scenes`.                                                                   |
| `line`, `start`    | The scene heading's line index and character offset.                                        |
| `end`, `lastLine`  | Extent of the scene (up to, but not including, the next scene heading, or end of document). |
| `autoNumber`       | Sequential scene number, ignoring any explicit `#number#`.                                  |
| `customNumber`     | Explicit `#number#` tag from the heading, if present.                                       |
| `number`           | `customNumber` if given, else `autoNumber` as a string.                                     |
| `title`            | Full heading text (minus the `#number#` tag).                                               |
| `prefix`           | Normalized slug prefix: `INT`, `EXT`, `EST`, or `INT/EXT`.                                  |
| `location`, `time` | Heading split on `-` (or em/en dash): first segment / remaining segments joined.            |
| `parts`            | All dash-separated segments of the heading.                                                 |
| `color`            | A trailing `[[color note]]` on the heading line, if it matches a known color name/hex.      |
| `forced`           | Whether the heading used a leading `.` to force scene-heading status.                       |
| `synopsis`         | `=` synopsis lines immediately under the heading/section.                                   |
| `notes`            | `[[ ... ]]` notes whose line falls within the scene.                                        |
| `shots`            | `!!`-forced shot lines within the scene.                                                    |
| `characters`       | Uppercased names of characters who speak in the scene, in order of first appearance.        |
| `blocks`           | `[firstBlockIndex, lastBlockIndex]` into `doc.blocks` spanned by the scene.                 |

`doc.outline` interleaves these Scene objects with plain Section objects
(`{ kind: 'section', depth, title, line, start, synopsis }`) from `#`-headings,
in document order.

### Note / Omit / Diagnostic / TitleEntry / Character objects

**Plain English:** These are the small side-lists: `notes` are your `[[ ]]`
comments, `omits` are commented-out `/* */` chunks, `diagnostics` are
warnings the parser noticed (like an unclosed comment), `titleEntries` are
the raw title-page fields with their original capitalization, and
`characters` is a flat roster of everyone who speaks, with a line count for
each.

**Technical:**

- **Note** (`doc.notes`): `{ start, end, line, lastLine, text }` — offsets and
  line span of a `[[ ... ]]`, with the bracket delimiters stripped from `text`.
- **Omit** (`doc.omits`): `{ start, end, line, lastLine, unterminated }` — a
  `/* ... */` boneyard range. `unterminated: true` means an unclosed `/*`
  swallowed the rest of the document.
- **Diagnostic** (`doc.diagnostics`): `{ line, code, severity, message }`.
  Known codes: `unterminated-omit` (warning), `dual-without-partner`
  (warning — a `^` dual-dialogue marker with no preceding dialogue block).
- **TitleEntry** (`doc.titleEntries`): `{ key, keyLower, value, line, lastLine }`.
- **Character** (`doc.characters`): `{ name, count, firstLine, scenes }` —
  `name` is uppercased/whitespace-normalized, `count` is total dialogue-block
  appearances, `scenes` is the list of scene indices they speak in.

## Character cue parsing (`character` field / `cueParts`)

**Plain English:** Takes a messy character-name line like
`MARIA (V.O.) (CONT'D) ^` and pulls it apart into the actual name, the stuff
in parentheses, and whether it ends with the special `^` dual-dialogue
marker — plus some handy flags for common cases (voice-over, off-screen,
continued).

**Technical:** A character cue like `MARIA (V.O.) (CONT'D) ^` is broken down into:

| field        | description                                                                                               |
| ------------ | --------------------------------------------------------------------------------------------------------- |
| `name`       | The bare name, extensions and trailing `^` stripped.                                                      |
| `extensions` | Parenthetical suffixes, in order, e.g. `['V.O.', "CONT'D"]`.                                              |
| `dual`       | Whether a trailing `^` marks this as the right-hand side of dual dialogue.                                |
| `contd`      | Whether an extension matches a "continued" pattern (`CONT'D`, `CONT.`, `CONTINUED`, apostrophe-optional). |
| `voiceOver`  | Whether an extension matches `V.O.` / `VO`.                                                               |
| `offScreen`  | Whether an extension matches `O.S.` / `O.C.` / `OS` / `OC`.                                               |

## Recognized Fountain syntax

**Plain English:** This is the cheat sheet — the actual typing conventions
that turn plain text into a formatted screenplay element. Most things are
detected automatically from context (an all-caps line with dialogue under it
becomes a character cue on its own), but you can always force a line's type
explicitly with the listed punctuation if the automatic guess isn't what you
want.

**Technical:**

| Syntax                                                                                       | Result                                        |
| -------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `INT.`/`EXT.`/`EST.`/`INT./EXT.`/`I/E` at line start (after a blank line)                    | Scene heading                                 |
| `.` at line start                                                                            | Force scene heading                           |
| `ALL CAPS` line, blank before it, dialogue underneath                                        | Character cue                                 |
| `@Name`                                                                                      | Force character cue                           |
| `(parenthetical)` right after a character/dialogue line                                      | Parenthetical                                 |
| Any non-blank line right after a character/parenthetical/dialogue line                       | Dialogue                                      |
| `~lyric line`                                                                                | Lyrics                                        |
| `!action`                                                                                    | Force action                                  |
| `!!shot`                                                                                     | Shot                                          |
| Line ending in `TO:`, or `FADE TO BLACK.` / `FADE OUT.` / `FADE TO WHITE.` / `CUT TO BLACK.` | Transition                                    |
| `>transition`                                                                                | Force transition                              |
| `>text<`                                                                                     | Centered text                                 |
| `#Section`, `##Subsection`, ...                                                              | Section (depth = number of `#`)               |
| `=synopsis`                                                                                  | Synopsis                                      |
| `===` (3+ `=`)                                                                               | Page break                                    |
| `key: value` pairs at the very top of the document                                           | Title page                                    |
| `[[note]]`                                                                                   | Note (transparent)                            |
| `/* boneyard */`                                                                             | Omit (transparent)                            |
| `#123#` at the end of a scene heading                                                        | Explicit scene number                         |
| `^` at the end of a character cue                                                            | Dual dialogue (pairs with the block above)    |
| `(CONT'D)` / `(V.O.)` / `(O.S.)` etc. after a character name                                 | Cue extension                                 |
| Two trailing spaces on an otherwise-blank line, inside action or dialogue                    | Paragraph continuation (`continuation: true`) |
| Custom `markers` regex match                                                                 | Marker (transparent)                          |

## Known limitations

**Plain English:** A few edge cases behave in ways worth knowing about: a
note can't stretch across a fully blank line, three-or-more `[` in a row is
never read as the start of a note, and color-coding a scene heading only
works with a small fixed list of color names (plus hex codes).

**Technical:**

- Notes never span a fully blank line (a blank line inside `[[ ... ]]` ends
  the note early and the brackets are left as literal text).
- `[[[` (three or more consecutive `[`) is never treated as a note opener.
- Color detection for scene headings only recognizes a fixed set of named
  colors plus hex codes, taken from a trailing note on the heading line.
