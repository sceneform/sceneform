<p align="center"><img src="build/icon.png" width="96" alt="Sceneform icon"></p>

<h1 align="center">Sceneform</h1>

<p align="center">A free desktop screenplay editor for <a href="https://fountain.io">Fountain</a> that works like a code IDE, built for screenwriters.<br>Windows · macOS · Linux</p>

---

Your script stays plain-text Fountain. Sceneform adds what an IDE gives a programmer, aimed at a writer's craft: inspections with quick fixes, rename across the project, find usages, local history, merging, and a live, paginated preview.

> **Beta (0.80.x).** Back up your projects. Every save also keeps a `.bak` next to the `.sfp`, and File → Local history keeps snapshots.

## Features

- **Writer's intuition:** inspections for craft problems (cue typos, missing time of day, long action blocks, missing (CONT'D), parenthetical-only speeches, scenes over ~3 pages, act length drift and more), with Alt+Enter fixes and a Problems window (Ctrl/Cmd+6).
- **Refactoring for scripts:** rename a character everywhere (Shift+F6), find usages (Alt+F7), move scenes (Ctrl/Cmd+Shift+Up/Down), and an outline/structure view with page and minute totals that you can drag to reorder.
- **Live templates** with tab stops, plus a picker on Ctrl/Cmd+J.
- **Local history:** side-by-side diff, restoring a whole script or a single scene, and WGA-coloured revision marks.
- **Collaboration without a server:** an authorship gutter and *Merge another copy…*, a three-way merge of a collaborator's `.sfp`.
- **Interop:** Final Draft (`.fdx`) import and export, Fade In (`.fadein`) import, plus PDF and `.fountain` export.
- **Projects:** multiple screenplays or episodes, notes, canvases with picture cards, character/location/scene pages, title-page defaults, dual dialogue, `%%%` special pages and `*include`.
- **Private by design:** no accounts, no telemetry, no network requests.

Full list: [docs/FEATURES.md](docs/FEATURES.md) · Changes: [CHANGELOG.md](CHANGELOG.md)

## Download

Installers are on the [Releases](https://github.com/sceneform/sceneform/releases) page. Beta builds aren't code-signed yet, so Windows SmartScreen and macOS Gatekeeper will warn the first time you open Sceneform. The release notes explain how to get past the warning.

## Build from source

You need Node.js 22 and npm.

```bash
npm ci
npm run dev        # Vite dev server + Electron, with reload
npm run build      # bundle main/preload and the renderer
npm start          # build, then run the built app
npm run typecheck  # desktop + renderer types
npm run make       # installers for your platform (Electron Forge) in out/
```

Running `npx vite` alone serves the UI in a browser against an in-memory mock, without touching the disk.

How the code is laid out: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Contributing

Bug reports, word-list additions and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first.

## TBA

- Scene notes from cards in Inspector
- Fix installer

## License

Sceneform is **source-available**, not open source. It uses the [sceneform Source-Available License](LICENSE): you may use, study and modify it, and redistribute it non-commercially under its terms. Commercial redistribution needs a separate license. Read [LICENSE](LICENSE) for the details.

The bundled fonts, dictionaries and test fixtures keep their own licenses (see `dictionaries/README.md` and `test/fixtures/interop/`). Interface icons are [Tabler Icons](https://github.com/tabler/tabler-icons) (MIT), bundled at build time through `@tabler/icons-react`.
