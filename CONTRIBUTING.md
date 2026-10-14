# Contributing to Sceneform

Thanks for helping. Sceneform is a Fountain screenplay IDE, and contributions that make it better for working screenwriters are welcome.

## Before you start

- **Bugs:** open an issue with your OS, the build string from Settings → About (e.g. `0.80.0+sf-xxxx Q4 2026`), the steps to reproduce, and a small sample `.fountain`/`.sfp` if you can. Never attach a script you aren't allowed to share.
- **Features:** open an issue to discuss it before writing a large change.
- **Spellcheck words:** add screenwriting terms to `dictionaries/screenwriting.txt`, one per line (see `dictionaries/README.md`). This is the easiest first PR.

## Setup

```bash
npm ci
npm run dev
```

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the pieces fit together.

## Ground rules for code

- **Keep the layers apart.** The renderer (`src/renderer`) never imports Node or Electron. Everything goes through `window.sceneform`, typed in `src/shared/bridge.ts`. Parsing, persistence, file formats and PDF belong in `src/backend`; windows, dialogs and the filesystem belong in `src/desktop`.
- **Fountain is the source of truth.** Don't store script content anywhere except the Fountain text. Metadata goes in the `.sfp` side files.
- **Keep the project format compatible.** Older `.sfp` files must keep opening. If you change the format, explain how old files are read.
- **Parser changes** (`src/backend/fountain-js/`) go in their own commit prefixed `parser:`, because the parser is shared with other Sceneform tools.
- **No network calls, telemetry or accounts.** Sceneform is offline by design.
- **Write for writers.** UI copy uses screenwriting terms in sentence case.

## Before you open a pull request

```bash
npm run typecheck
npm run backend:typecheck
npm run build
```

All three must pass. Keep PRs focused, describe what changed and why, and add a screenshot for UI changes. Add a line under `## [Unreleased]` in `CHANGELOG.md` for anything user-visible.

## License of contributions

Sceneform is source-available under the [sceneform Source-Available License](LICENSE). By submitting a contribution you agree to Section 12 of that license: you keep copyright in your contribution, and it is licensed to the project and the public under the same license.
