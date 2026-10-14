<!--
DRAFT GitHub Release notes for v0.80.0. Not published.
Before publishing: attach the real artifacts, fix the file names in the table below to
match them, and remove this comment.
-->

# Sceneform 0.80.0 (beta)

The first public beta of **Sceneform**, a free desktop screenplay editor for
[Fountain](https://fountain.io). It works like a code IDE, but for screenwriters. Your
script stays plain-text Fountain, and the app adds inspections, quick fixes, rename,
find usages, local history, merging and a live preview on top.

> **Beta:** back up your projects. Every save also keeps a `.bak` next to the `.sfp`,
> and File → Local history keeps snapshots, but this is still a beta.

## Highlights

- **Writer's intuition:** inspections for craft problems with Alt+Enter fixes (cue typos,
  missing time of day, long action blocks, missing (CONT'D), parenthetical-only speeches,
  scenes over ~3 pages, act length drift and more), plus a Problems window (Ctrl/Cmd+6).
- **Refactoring for scripts:** rename a character everywhere (Shift+F6), find usages
  (Alt+F7), move scenes (Ctrl/Cmd+Shift+Up/Down), and a structure view with page and minute
  totals and drag to reorder.
- **Live templates** with tab stops, and a picker on Ctrl/Cmd+J.
- **Local history** with side-by-side diff, restoring a whole script or a single scene,
  and WGA-coloured revision marks.
- **Authorship gutter** and **Merge another copy…**: work with a collaborator by passing
  the `.sfp` back and forth, with no server.
- **Final Draft (.fdx)** import and export, and **Fade In (.fadein)** import. You can also
  import a script into an open project.
- Dual dialogue side by side, `%%%` special pages, `*include: Title` for assembling a
  master script, picture cards on the canvas, themes and custom CSS.

The full list is in [CHANGELOG.md](../CHANGELOG.md).

## Downloads

| Platform | File | Notes |
|---|---|---|
| Windows 10/11 (x64) | `Sceneform-0.80.0 Setup.exe` | Installs per user, with no admin rights needed |
| macOS (Apple silicon / Intel) | `Sceneform-0.80.0-arm64.dmg` / `Sceneform-0.80.0-x64.dmg`, or the `.zip` | Drag Sceneform to Applications |
| Debian / Ubuntu | `sceneform_0.80.0_amd64.deb` (`_arm64.deb`) | `sudo apt install ./sceneform_0.80.0_amd64.deb` |
| Fedora / RHEL / openSUSE | `sceneform-0.80.0-1.x86_64.rpm` (`.aarch64`/`.arm64`) | `sudo dnf install ./sceneform-0.80.0-1.x86_64.rpm` |

## Installing an unsigned beta

These builds are **not code-signed**, so your operating system will warn you the first
time you open Sceneform. This is expected for this beta.

- **Windows (SmartScreen):** if you see "Windows protected your PC", click **More info**,
  then **Run anyway**.
- **macOS (Gatekeeper):** if you see "Sceneform can't be opened because Apple cannot check
  it for malicious software", or that it "is damaged", open **System Settings → Privacy &
  Security**, scroll down and click **Open Anyway** next to Sceneform. On older macOS,
  right-click the app and choose **Open** instead. If macOS still refuses, run
  `xattr -dr com.apple.quarantine /Applications/Sceneform.app` in Terminal.
- **Linux:** install the `.deb` or `.rpm` with your package manager, then start
  **Sceneform** from your applications menu, or run `sceneform` in a terminal.

## Updating

Sceneform has **no automatic updates** and makes no network requests. To update, **download
the new version by hand** from the Releases page and install it over the old one. Your
projects (`.sfp` files) and settings are kept.

## Known limitations

- The builds are unsigned (see above), and there's no auto-update.
- Pagination in the preview is approximate. The PDF does not yet print revision asterisks
  or colours, locked pages or A-pages.
- The PDF title page prints only the title, credit, author, draft date and contact.
- Fade In import was tested on a set of real files, but unusual documents may still lose
  formatting. Please report them.
- Merge another copy does not bring over pictures from the other copy. Assets that are no
  longer used are never cleaned up.
- In a live template, using the same tab stop twice does not mirror the typing.
- Spellcheck is English only.

## Feedback

Please report bugs and ideas on the issue tracker. Include your OS, the build string from
Settings → Stuff → About (e.g. `0.80.0+sf-xxxx Q4 2026`), and a sample `.fountain` if you can.
