# Interop fixtures (Final Draft / Fade In)

Real files written by Final Draft and Fade In, for testing `src/shared/fdx.ts`
(`fdxToFountain`, `osfToFountain`).

| File | Written by | Source | Licence |
| --- | --- | --- | --- |
| `TestFDX-FD.fdx` | Final Draft | https://github.com/wildwinter/screenplay-tools/blob/main/tests/TestFDX-FD.fdx | MIT, see `LICENSE-screenplay-tools` |
| `TestFDX-FI.fdx` | Fade In (FDX export) | https://github.com/wildwinter/screenplay-tools/blob/main/tests/TestFDX-FI.fdx | MIT |
| `TestFDX-FI.fadein` | Fade In 5.0.8 (OSF v50 in a zip) | https://github.com/wildwinter/screenplay-tools/blob/main/tests/TestFDX-FI.fadein | MIT |

Also tested against, but **not copied here** (AGPL-3.0 or no licence stated):

- OSF SDK reference documents, v1.2 / v2.0 / v4.0 (no licence): https://github.com/OpenScreenplayFormat/osf-sdk (`v1.2/file_format.xml`, `v1.2/file_format_numbered.xml`, `v2/OSF-2.0.xml`, `v4/OSF-4.0.xml`)
- rsdoiel/fdx `testdata/sample-01..06.fdx` and `.fadein` (Fade In 3.x, OSF v30, AGPL-3.0): https://github.com/rsdoiel/fdx/tree/main/testdata
- rsdoiel/osf `testdata/Screenplay_Sample.osf` (AGPL-3.0): https://github.com/rsdoiel/osf/tree/main/testdata
- Big Fish / Brick & Steel sample .fdx files linked from fountain.io (copyrighted scripts; the old `fountain.io/_downloads/` links no longer resolve).

All 20 files import with the right scene count, cast and title page (2026-10-12).
