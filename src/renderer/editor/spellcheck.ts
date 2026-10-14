// spellcheck.ts
//
// Dictionary spellcheck for prose lines (action, dialogue, parentheticals,
// lyrics, centered text). Words come from dictionaries/*.txt (bundled as lazy
// chunks), the user's own dictionary, and the project's character and location
// names. Hovering a flagged word offers suggestions and "Add to dictionary".

import { StateEffect, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, hoverTooltip, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";
import { parsedField } from "./fountain-extension";
import { contextMenuIsOpen } from "./context-menu-state";

const PROSE = new Set(["action", "dialogue", "parenthetical", "lyrics", "centered"]);
const WORD = /\p{L}+(?:['’]\p{L}+)*/gu;

let dictionary: Set<string> | null = null;
/** Each editor's current misspelling decorations, for the right-click menu. */
const flagged = new WeakMap<EditorView, () => DecorationSet>();

/** The flagged word at `pos`, if any. */
export function misspellingAt(view: EditorView, pos: number): { from: number; to: number; word: string } | null {
    const deco = flagged.get(view)?.();
    if (!deco) return null;
    let hit: { from: number; to: number } | null = null;
    deco.between(pos, pos, (from, to) => {
        hit = { from, to };
        return false;
    });
    if (!hit) return null;
    const { from, to } = hit as { from: number; to: number };
    return { from, to, word: view.state.sliceDoc(from, to) };
}
let loading: Promise<void> | null = null;
const refresh = StateEffect.define<null>();

function addList(set: Set<string>, text: string) {
    for (const raw of text.split(/\r?\n/)) {
        const w = raw.trim();
        if (w && !w.startsWith("#")) set.add(w.toLowerCase());
    }
}

function load(): Promise<void> {
    loading ??= Promise.all([import("../../../dictionaries/en_US-LARGE.txt?raw"), import("../../../dictionaries/screenwriting.txt?raw")]).then(
        (lists) => {
            const set = new Set<string>();
            for (const l of lists) addList(set, l.default);
            dictionary = set;
        },
    );
    return loading;
}

export interface SpellOptions {
    enabled: () => boolean;
    /** User dictionary plus project names; checked case-insensitively. */
    extraWords: () => string[];
    onAddWord: (word: string) => void;
}

function known(word: string, extra: Set<string>): boolean {
    if (!dictionary) return true;
    const w = word.toLowerCase().replace(/’/g, "'");
    if (dictionary.has(w) || extra.has(w)) return true;
    const base = w.replace(/'s$/, "").replace(/s'$/, "s");
    if (base !== w && (dictionary.has(base) || extra.has(base))) return true;
    // Contractions the list may lack ("wouldn't", "we'll"): accept when the stem is a word.
    const stem = /^(.+)(n't|'ll|'re|'ve|'d|'m)$/.exec(w);
    if (stem && dictionary.has(stem[1])) return true;
    // Single letters and ALL-CAPS shouting of a known word.
    return w.length < 2;
}

/** Up to five dictionary words one edit away. */
export function suggest(word: string): string[] {
    if (!dictionary) return [];
    const w = word.toLowerCase();
    const letters = "abcdefghijklmnopqrstuvwxyz'";
    const out = new Set<string>();
    const tryAdd = (c: string) => {
        if (out.size < 5 && c !== w && dictionary!.has(c)) out.add(c);
    };
    for (let i = 0; i <= w.length && out.size < 5; i++) {
        for (const ch of letters) tryAdd(w.slice(0, i) + ch + w.slice(i)); // insert
        if (i < w.length) {
            tryAdd(w.slice(0, i) + w.slice(i + 1)); // delete
            for (const ch of letters) tryAdd(w.slice(0, i) + ch + w.slice(i + 1)); // replace
            if (i < w.length - 1) tryAdd(w.slice(0, i) + w[i + 1] + w[i] + w.slice(i + 2)); // swap
        }
    }
    const cased = (s: string) => (word === word.toUpperCase() ? s.toUpperCase() : word[0] === word[0].toUpperCase() ? s[0].toUpperCase() + s.slice(1) : s);
    return [...out].map(cased);
}

export function spellcheck(opts: SpellOptions): Extension {
    const mark = Decoration.mark({ class: "sf-misspelled" });
    const build = (view: EditorView): DecorationSet => {
        if (!opts.enabled() || !dictionary) return Decoration.none;
        const extra = new Set(opts.extraWords().flatMap((w) => w.toLowerCase().split(/[\s-]+/)));
        const parsed = view.state.field(parsedField);
        const b = new RangeSetBuilder<Decoration>();
        for (const { from, to } of view.visibleRanges) {
            let line = view.state.doc.lineAt(from);
            for (;;) {
                if (PROSE.has(parsed.lines[line.number - 1]?.type ?? "")) {
                    // Skip [[notes]], /* boneyard */ and links on the line.
                    const masked = line.text.replace(/\[\[[^\]]*\]\]|\/\*.*?\*\/|https?:\/\/\S+/g, (m) => " ".repeat(m.length));
                    WORD.lastIndex = 0;
                    for (let m; (m = WORD.exec(masked)); ) if (!known(m[0], extra)) b.add(line.from + m.index, line.from + m.index + m[0].length, mark);
                }
                if (line.to >= to || line.number >= view.state.doc.lines) break;
                line = view.state.doc.line(line.number + 1);
            }
        }
        return b.finish();
    };

    const plugin = ViewPlugin.fromClass(
        class {
            decorations: DecorationSet = Decoration.none;
            constructor(readonly view: EditorView) {
                flagged.set(view, () => this.decorations);
                if (dictionary) this.decorations = build(view);
                else void load().then(() => view.dispatch({ effects: refresh.of(null) }));
            }
            update(u: ViewUpdate) {
                if (u.docChanged || u.viewportChanged || u.transactions.some((t) => t.effects.some((e) => e.is(refresh)))) this.decorations = build(u.view);
            }
        },
        { decorations: (v) => v.decorations },
    );

    const tooltip = hoverTooltip((view, pos) => {
        if (contextMenuIsOpen()) return null; // one popup at a time: the right-click menu wins
        const deco = view.plugin(plugin)?.decorations;
        if (!deco) return null;
        let hit: { from: number; to: number } | null = null;
        deco.between(pos, pos, (from, to) => {
            hit = { from, to };
            return false;
        });
        if (!hit) return null;
        const { from, to } = hit as { from: number; to: number };
        const word = view.state.sliceDoc(from, to);
        return {
            pos: from,
            end: to,
            above: true,
            create: () => {
                const dom = document.createElement("div");
                dom.className = "sf-spell";
                const head = document.createElement("div");
                head.className = "sf-spell__head";
                head.textContent = "Not in the dictionary";
                dom.appendChild(head);
                for (const s of suggest(word)) {
                    const b = document.createElement("button");
                    b.className = "sf-spell__opt";
                    b.textContent = s;
                    b.onmousedown = (e) => {
                        e.preventDefault();
                        view.dispatch({ changes: { from, to, insert: s }, userEvent: "input.spell" });
                    };
                    dom.appendChild(b);
                }
                const add = document.createElement("button");
                add.className = "sf-spell__add";
                add.textContent = `Add “${word}” to dictionary`;
                add.onmousedown = (e) => {
                    e.preventDefault();
                    opts.onAddWord(word);
                    view.dispatch({ effects: refresh.of(null) });
                };
                dom.appendChild(add);
                return { dom };
            },
        };
    });

    return [plugin, tooltip];
}

/** Re-run the spellcheck (after the user dictionary or the setting changed). */
export const refreshSpellcheck = (view: EditorView) => view.dispatch({ effects: refresh.of(null) });
