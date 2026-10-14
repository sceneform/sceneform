# Changelog

All notable changes to Sceneform are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Before 1.0 every release is a beta; the build ID after `+` (e.g. `0.80.0+sf-9hmw`)
identifies one particular build.

## [Unreleased]

## [0.80.0] - 2026-10-13

First public beta of the Sceneform desktop app (Windows, macOS, Linux).

### Added

#### Editor and project basics
- Electron desktop app with a React/CodeMirror 6 editor, a sandboxed preload bridge and no network access.
- Project format v2 (`.sfp`): screenplays, episodes, notes, canvases, character/location/scene pages, title-page defaults, project settings and picture assets in one file.
- Live preview with approximate pagination, (MORE) / NAME (CONT'D) when a speech breaks across pages, and side-by-side dual dialogue.
- Full pages for characters, locations and scenes; Markdown pictures; title-page highlighting and auto-detection.
- Recent projects on the project screen.
- Light, Dark and System themes; Catppuccin, Ayu and Nord palettes; custom CSS; per-project banner.
- App icon, maximized start and F11 full screen, date picker for the draft date.
- Autocomplete for the title page, character cues and extensions, transitions, `.` headings, and `@` characters / `#` locations mid-line.
- Clickable character names in action lines (Ctrl/Cmd+click), Cast inspector tab.
- `%%%` special pages with 3x3 placement, in the editor, preview and PDF.
- Spellcheck (en_US plus a community screenwriting list), user dictionary and suggestions.
- `*include: Title` pulls another screenplay of the project into the preview and every export (nested, loop-safe).
- Canvas picture cards: drop, paste or pick pictures.
- Per-project editor settings (Project settings → Writing): inspections, target length, project live templates and a project dictionary.

#### Writer's intuition (IDE features)
- Inspections with Alt+Enter fixes: cue typos, cues with no dialogue, headings with no time of day, long action blocks, missing (CONT'D), CAPS introductions, location spelling drift, long speeches, empty scenes, parenthetical-only speeches, parentheticals that are really action, bracketed lines with no speaker, scenes over ~3 pages, and act length drift against a target length.
- Problems and Find usages tool window (Ctrl/Cmd+6, Alt+F7), including usages of a location from its heading.
- Rename a character everywhere (Shift+F6), optionally in scene headings too.
- Move scene (Ctrl/Cmd+Shift+Up/Down or Alt+Shift+PageUp/PageDown), extend/shrink selection (Alt+Shift+Up/Down), breadcrumbs, double Shift for Search Everywhere.
- Outline as a structure view: section headers with page and minute totals, scene lengths in eighths, drag to reorder.
- Scene ID markers so a scene's details follow it when scenes move.
- Live templates with tab stops (`$1`, `${1:default}`, `$0`) and a Ctrl/Cmd+J picker; your own templates in Settings.
- Right-click menus in the editor (spelling, cut/copy/paste, find usages, rename, go to character/location page, line actions) and on tabs (close, close others, close to the right).

#### History and collaboration
- Authorship (blame) gutter (Ctrl/Cmd+Alt+A) with per-line stamps; canvas cards record who created and last edited them.
- Local history: snapshots on save (kept in the app's data folder, not in the `.sfp`), unified or side-by-side diff, restore a whole script or a single scene, labels.
- Revision marks since a snapshot in WGA colours, remembered per project.
- File → Merge another copy…: three-way merge of a collaborator's `.sfp` using the authorship stamps; conflicts are kept between notes and listed in Problems.
- `.bak` recovery: the backup is offered when a project won't open, and a banner appears when the backup holds much more text.

#### Import and export
- Final Draft: import and export `.fdx`.
- Fade In: import `.fadein` (Open Screenplay Format), tested on real Fade In 3.x/5.x files and the OSF reference documents.
- File → Import screenplay… adds a `.fountain`, `.fdx` or `.fadein` file to an open project as a new screenplay or episode.
- PDF export prints dual dialogue in two columns and `%%%` special pages.

#### Packaging
- Electron Forge packaging: Windows installer (Squirrel), macOS (DMG and ZIP), Linux (`.deb` and `.rpm`).
- Build identifier in About and Settings, e.g. `0.80.0+sf-9hmw Q4 2026`.

### Changed
- Ctrl/Cmd+W closes the current tab, like a browser; Electron's default menu (which closed the window on Ctrl/Cmd+W and reloaded on Ctrl+R) is replaced.
- Inspections run debounced while you type, and turning them off applies at once.
- The parser accepts custom title-page keys after a known first key, plus contact info, `tc` and `cc` keys.
- The `npm start` script builds first and clears `ELECTRON_RUN_AS_NODE` before launching Electron.

### Fixed
- Spellcheck suggestion popup now has a readable background.
- The dual-dialogue `^` is dimmed in the editor and no longer printed in the preview or PDF.
- Moving scenes with the keyboard no longer gets swallowed by other bindings.

### Known limitations
- Builds are not code-signed: Windows SmartScreen and macOS Gatekeeper warn on first launch.
- There is no automatic update; download new versions by hand.
- The PDF does not yet print revision asterisks or colours, locked pages or A-pages.
- Pictures inside a merged copy are not brought over; unreferenced assets are never cleaned up.

[Unreleased]: https://github.com/sceneform/sceneform-pvt/compare/v0.80.0...HEAD
[0.80.0]: https://github.com/sceneform/sceneform-pvt/releases/tag/v0.80.0
