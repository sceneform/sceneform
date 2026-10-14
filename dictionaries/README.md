# Spellcheck dictionaries

The spellchecker accepts a word if it appears in any of these lists (case-insensitive), in the user's own dictionary (Settings → Editor, or "Add to dictionary" on a flagged word), or among the project's character and location names.

| File | What it is |
| --- | --- |
| `en_US-LARGE.txt` | US English word list from [languagetool-org/english-pos-dict](https://github.com/languagetool-org/english-pos-dict/blob/main/spell-dicts/en_US-LARGE.txt) (SCOWL-derived). Don't edit it by hand; refresh it from upstream. |
| `screenwriting.txt` | Community list of screenwriting terms. **Add words here with a pull request.** |

## Contributing words

1. Edit `screenwriting.txt` (or add a new `*.txt` list - only if it's a new language - and register it in `src/renderer/editor/spellcheck.ts`).
2. One word per line. Lines starting with `#` are comments.
3. Open a pull request on github.com/sceneform.
