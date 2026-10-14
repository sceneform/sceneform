# Architecture

Sceneform is an Electron desktop app. Everything runs locally; there is no server and the app makes no network requests.

```text
sceneform/
├── src/backend/     # Screenplay model, .sfp archive, PDF export, bundled Fountain parser
├── src/desktop/     # Electron main process + sandboxed preload (the host)
├── src/shared/      # bridge.ts (main <-> renderer contract), fdx.ts (Final Draft / Fade In)
├── src/renderer/    # The UI: React 19 + Vite + CodeMirror 6
├── dictionaries/    # Spellcheck word lists
├── build/           # App icons used by the packager
├── scripts/         # Build helpers
└── test/fixtures/   # Interop sample files
```

## Desktop app

- **Host:** Electron. `src/desktop/main.ts` owns the window, the filesystem and every dialog, and wires the backend services (`createProfileService`, `createProjectService`) to IPC. The window is frameless with a custom titlebar on Windows and Linux; macOS keeps its traffic lights.
- **Bridge:** `src/desktop/preload.ts` (sandboxed, contextIsolation on, bundled to CommonJS) exposes `window.sceneform`. Its shape and every channel name live in `src/shared/bridge.ts`. Channel names follow the `sf:*` / `fountain:*` contract, plus `sf:project:trash` (moves to the OS trash instead of deleting), `sf:project:reveal`, `sf:settings:*`, `sf:window:*` and `sf:app:info`.
- **Renderer:** React 19 + Vite, in `src/renderer`. The renderer never imports Node or Electron. It runs the bundled Fountain parser directly (`lib/fountain.ts`), so highlighting, outline, characters, locations and statistics all come from the same parse with no IPC per keystroke.
- **Editor:** CodeMirror 6 with a parser-driven Fountain extension (`editor/fountain-extension.ts`): line classes per element, scene numbers on both margins, clickable `!heading` / `@character` badges, hidden `[[id:…]]` / `@@ID` markers (atomic, never shown), hover docs, `@` / `!` / `INT` autocomplete, and auto-continuation after headings and transitions.
- **Settings** persist to `settings.json` in Electron's userData folder and are all applied (UI size, motion, focus rings, highlight intensity, notes visibility, live outline, autosave, idle timeout, editor zoom, reopen-last-project).
- **Browser preview:** `vite` alone (no Electron) runs the renderer against an in-memory mock bridge (`lib/api.ts`), labelled in the titlebar. Nothing touches disk.

## Backend

Backend modules:

- `src/backend/screenplay.ts`: Fountain parser adapter and semantic screenplay queries.
- `src/backend/fountain-js/`: bundled Fountain parser, declaration file, and parser documentation.
- `src/backend/project-profile.ts`: profile lock, project folder validation, project registration, and project path logic.
- `src/backend/sfp-archive.ts`: `.sfp` ZIP container format and metadata synchronization.
- `src/backend/project-service.ts`: project workflows and Electron save/open dialogs.
- `src/backend/filesystem.ts`: Fountain file reads/writes and Electron open dialog.
- `src/backend/pdf-export.ts`: PDF rendering.
- `src/backend/result.ts`: success/error result type helpers.
- `src/backend/types/`: active domain types for projects, screenplay items, and canvas cards.

The active build helper `scripts/prepare-parser.cjs` copies the bundled `fountain-parser.js` to the ignored `fountain-parser.cjs` path. `screenplay.ts` loads that CommonJS copy with `createRequire`.

`scripts/prepare-parser.cjs` copies the bundled `fountain-parser.js` to the ignored `fountain-parser.cjs` path; `screenplay.ts` loads that CommonJS copy with `createRequire`. `scripts/desktop.mjs` bundles main and preload with esbuild and copies the parser next to them in `dist-electron/fountain-js/`.

No `.env` variables are read. The default project folder is `Documents/Sceneform Projects`.

## Storage and format

Projects are `.sfp` ZIP archives. Format v2 (current, `manifest.json` version 2) contains `manifest.json`, `project.json`, `documents.json` (index of `{ id, kind, title, order, file }`), `scripts/<id>.fountain` (one per screenplay/episode), `notes/<id>.md`, `canvases/<id>.json` (`{ cards }`), `entities.json` (`characters` keyed by uppercase cue, `locations` keyed by uppercase name, `scenes` keyed by screenplay id then scene key `id:…`/`scene-N`), `title-page.json` (project title-page defaults keyed by lowercase key; `draft date` is ISO `YYYY-MM-DD`), `project-settings.json` (`type` film/series, `pageSize` letter/a4, `sceneNumbers`, `autosave` inherit/on/off; the desktop app adds optional `inspections` inherit/on/off, `targetPages`, `liveTemplates` and `words`, which the archive carries through unchanged) and `assets/` (real picture binaries). Legacy copies `script.fountain` (first screenplay), `meta.json` (first screenplay's scenes + first canvas's cards) and `notes/scene-notes.md` (first note) are still written so older builds open something. v1 archives open as one screenplay "Screenplay", one note "Notes" and one canvas "Canvas", and are rewritten as v2 on the next save. Every write copies existing `assets/` entries byte for byte; assets are **never deleted automatically**, even when unreferenced. Saves and asset imports are serialized per file. Saves write a temporary file and rename it into place; a `.bak` copy is retained when requested. Profile state uses `profile-lock.sfc` and a `config.json` file in the configured application-data/profile location.

The project profile tracks registered project locations and checks for missing files. The service uses local filesystem access only. No database, cloud storage, analytics service, or external API integration was found.

## IPC contract

There is no active HTTP API. The Electron bridge (`src/shared/bridge.ts`) is the desktop contract. Core channels:

- Fountain: `fountain:open`, `fountain:read`, `fountain:write`, `fountain:parse`.
- Profile: `sf:profile:open`, `sf:profile:default-folder`, `sf:profile:pick-folder`, `sf:profile:set-folder`, `sf:profile:new-project-path`, `sf:profile:register`.
- Projects: `sf:project:list`, `sf:project:open`, `sf:project:save`, `sf:project:create`, `sf:project:delete`, `sf:project:rename`, `sf:project:export-pdf`, `sf:project:export-fountain`, `sf:project:browse`.

The preload bridge returns the backend `Result` shape for most operations: `{ ok: true, value }` or `{ ok: false, error }`. Project archives use the structured `SfpProjectData` shape described above. Errors are domain-coded rather than thrown across the bridge where the service catches them.

Authentication and authorization are not implemented. The backend assumes local desktop access and caller-controlled file paths. It should not be exposed directly to an untrusted network without adding path validation, authentication, authorization, and an HTTP boundary.

## Saving

Autosave runs one second after the last edit (or on Ctrl+S when autosave is off). Saves are single-flight; edits made during a save trigger another one. A failed save shows "Not saved" plus a banner and retries with backoff. Closing the window, leaving the editor, or switching projects flushes first; if the flush fails, the user is asked before anything is discarded.

Backup recovery: every save first copies the previous file to `<project>.sfp.bak` (backend). When a project is opened, main reads that `.bak` once and keeps it in memory (`sf:project:backup`), so it still means the pre-session version after autosave has replaced the file on disk. If the project doesn't open but its backup does, the app asks to restore it. If it opens but the backup holds much more text (at least 1,500 characters more and over twice as much across screenplays and notes), a banner above the editor offers Restore backup, Local history… or Keep this version. Restoring (`sf:project:restore-backup`, `src/desktop/main.ts`) saves anything pending, keeps the current file as `<project>.sfp.replaced-<time>` (not listed as a project), writes the backup in place atomically and reopens the project.

Scene metadata (`meta.json` scenes) is keyed by the scene's `[[id:…]]` marker when one exists, otherwise by position (`scene-N`, matching the old format). Metadata is merged, never regenerated from the parse.
