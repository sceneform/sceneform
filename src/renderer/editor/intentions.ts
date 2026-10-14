// src/renderer/editor/intentions.ts
//
// The "writer's intuition" layer, modelled on how IntelliJ treats code:
//   - inspections: craft problems underlined in the script (a cue that's probably a typo,
//     a cue with nothing to say, a heading with no time of day, an action block that
//     runs too long, a speaker who continues after action without (CONT'D));
//   - intentions (Alt+Enter): quick fixes for those, plus context actions for the line
//     (turn it into a heading or cue, flip INT./EXT., set the time of day, add V.O., ...);
//   - structural editing: move a whole scene up/down (Ctrl/Cmd+Shift+Up/Down, or
//     Alt+Shift+PageUp/PageDown) and extend/shrink the selection by word → line →
//     block → scene → section → script (Alt+Shift+Up / Alt+Shift+Down).
//     Ctrl/Cmd+W is left to the app: it closes the current tab.

import { EditorSelection, type EditorState, type Extension, Prec, RangeSetBuilder, StateEffect, StateField, type TransactionSpec } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, keymap } from "@codemirror/view";
import { expandTemplate, showTemplatePicker } from "./templates";
import { INCLUDE_LINE } from "../lib/include";
import { parsedField } from "./fountain-extension";
import { type FountainLine, LINES_PER_PAGE, buildScenes, formatEighths, sceneLengths } from "../lib/fountain";

/* ---------- types ---------- */

export interface Fix {
    label: string;
    apply: (state: EditorState) => TransactionSpec;
}

export interface Problem {
    /** 0-based line. */
    line: number;
    from: number;
    to: number;
    severity: "warn" | "hint";
    message: string;
    fixes: Fix[];
}

export interface IntentionOptions {
    /** Every known cast name (all screenplays plus cast entries). */
    cast: () => string[];
    /** Open the character's page. */
    openCharacter: (name: string, line: number) => void;
    /** List every cue and mention of a character (Alt+F7). */
    findUsages?: (name: string) => void;
    /** List every scene at a location (Alt+F7 on a scene heading). */
    findLocationUsages?: (location: string) => void;
    /** Rename a character everywhere. */
    renameCharacter: (name: string) => void;
    /** Inspections on/off. */
    inspections: () => boolean;
    /** Target script length in pages for the act-length check (0 = off). */
    targetPages?: () => number;
    /** Titles of the project's screenplays, for checking `*include` lines. */
    includeTargets?: () => string[];
    /** User live templates (abbreviation → text; `$1`, `$2`… tab stops, `$0` the final cursor), on top of the built-ins. */
    templates?: () => Array<{ abbr: string; text: string }>;
}

/* ---------- helpers ---------- */

const linesOf = (state: EditorState): FountainLine[] => state.field(parsedField).lines;
const typeOf = (l: FountainLine | undefined) => l?.type ?? "blank";
const isBlankText = (s: string | undefined) => !s || !s.trim();

/** A cue's name without extensions or the dual marker. */
export function cueName(text: string): string {
    return text.replace(/\^\s*$/, "").replace(/\(.*?\)/g, "").replace(/^@/, "").trim().toUpperCase();
}

function distance(a: string, b: string): number {
    if (Math.abs(a.length - b.length) > 2) return 3;
    const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        let prev = dp[0];
        dp[0] = i;
        for (let j = 1; j <= b.length; j++) {
            const tmp = dp[j];
            dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
            prev = tmp;
        }
    }
    return dp[b.length];
}

const HEADING_PREFIX = /^(INT\.?\/EXT\.?|I\/E\.?|INT\.?|EXT\.?|EST\.?)\s*/i;
const TIMES = ["DAY", "NIGHT", "CONTINUOUS", "LATER", "MOMENTS LATER", "MORNING", "EVENING"];

/** Replace a whole line's text. */
const setLine = (state: EditorState, lineNo: number, text: string): TransactionSpec => {
    const l = state.doc.line(lineNo + 1);
    return { changes: { from: l.from, to: l.to, insert: text }, userEvent: "input.intention" };
};

/** Replace a line and make sure it has a blank line before (and after, when `after`). */
function setIsolated(state: EditorState, lineNo: number, text: string, after: boolean): TransactionSpec {
    const l = state.doc.line(lineNo + 1);
    const prev = lineNo > 0 ? state.doc.line(lineNo).text : "";
    const next = lineNo + 2 <= state.doc.lines ? state.doc.line(lineNo + 2).text : "";
    const before = lineNo > 0 && !isBlankText(prev) ? "\n" : "";
    const tail = after && lineNo + 2 <= state.doc.lines && !isBlankText(next) ? "\n" : "";
    return {
        changes: { from: l.from, to: l.to, insert: before + text + tail },
        selection: { anchor: l.from + before.length + text.length },
        userEvent: "input.intention",
    };
}

/** Line ranges of scenes: heading line through the line before the next heading/section. */
function sceneRanges(state: EditorState): Array<{ start: number; end: number }> {
    const lines = linesOf(state);
    const out: Array<{ start: number; end: number }> = [];
    for (let i = 0; i < lines.length; i++) {
        const t = typeOf(lines[i]);
        if (t === "scene_heading") {
            // The scene's hidden [[id:…]] marker sits just above its heading (blanks allowed,
            // as in sceneIdFor): it belongs to this scene, so it moves with it.
            let start = i;
            for (let j = i - 1; j >= 0 && j >= i - 3; j--) {
                const tj = typeOf(lines[j]);
                if (tj === "marker") {
                    start = j;
                    break;
                }
                if (state.doc.line(j + 1).text.trim()) break;
            }
            if (out.length && out[out.length - 1].end < 0) out[out.length - 1].end = start - 1;
            out.push({ start, end: -1 });
        } else if (t === "section" && out.length && out[out.length - 1].end < 0) {
            out[out.length - 1].end = i - 1;
        }
    }
    if (out.length && out[out.length - 1].end < 0) out[out.length - 1].end = state.doc.lines - 1;
    return out;
}

/* ---------- inspections ---------- */

const ACTION_CHARS_PER_LINE = 60; // 6" action column at Courier 12
const ACTION_MAX_LINES = 4;

/**
 * Craft problems over the whole script. The caret's line is skipped by default so
 * nothing nags while you type; Alt+Enter and the context menu pass skipCursor = false
 * to get the fixes for the line you are on.
 */
export function inspect(state: EditorState, cast: string[], skipCursor = true, targetPages = 0, includeTargets: string[] | null = null): Problem[] {
    const lines = linesOf(state);
    const doc = state.doc;
    const cursorLine = skipCursor ? doc.lineAt(state.selection.main.head).number - 1 : -2;
    const problems: Problem[] = [];

    // Cue frequency, for typo detection.
    const freq = new Map<string, number>();
    for (const l of lines) if (l.type === "character") freq.set(cueName(l.raw), (freq.get(cueName(l.raw)) ?? 0) + 1);
    const trusted = new Set<string>(cast.map((c) => c.toUpperCase()));
    for (const [n, c] of freq) if (c >= 2) trusted.add(n);

    let lastSpeaker: string | null = null; // speaker of the previous dialogue block in this scene
    let actionSince = false;

    for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        const t = typeOf(l);
        const line = doc.line(i + 1);
        const text = line.text;
        const lead = text.length - text.trimStart().length;
        const from = line.from + lead;
        const to = line.to;
        if (to <= from) continue;

        const inc = includeTargets && i !== cursorLine ? INCLUDE_LINE.exec(text) : null;
        if (inc && !includeTargets!.some((t) => t.trim().toLowerCase() === inc[1].replace(/\.fountain$/i, "").trim().toLowerCase())) {
            const want = inc[1].trim().toLowerCase();
            const near = includeTargets!.filter((t) => distance(t.toLowerCase(), want) <= Math.max(2, Math.floor(want.length / 4))).slice(0, 3);
            problems.push({
                line: i, from, to, severity: "warn",
                message: `No screenplay called "${inc[1]}" in this project, so the preview and exports leave a note here.`,
                fixes: near.map((t) => ({ label: `Include "${t}"`, apply: (st) => setLine(st, i, `*include: ${t}`) })),
            });
        }

        if (text.trimStart().startsWith("[[MERGE CONFLICT")) {
            problems.push({ line: i, from, to, severity: "warn", message: "Merge conflict: both copies changed this. Keep one version, then delete the merge notes.", fixes: [] });
        }

        if (t === "scene_heading") {
            lastSpeaker = null;
            actionSince = false;
            if (i !== cursorLine && HEADING_PREFIX.test(text.trim()) && !/\s[-–—]\s*\S/.test(text) && !/#.+#\s*$/.test(text.trim())) {
                problems.push({
                    line: i, from, to, severity: "hint",
                    message: "No time of day in this scene heading.",
                    fixes: ["DAY", "NIGHT", "CONTINUOUS"].map((tod) => ({
                        label: `Add "- ${tod}"`,
                        apply: (s) => setLine(s, i, `${s.doc.line(i + 1).text.trimEnd()} - ${tod}`),
                    })),
                });
            }
        } else if (t === "action") {
            if (lastSpeaker) actionSince = true;
            // Measure the whole paragraph once, at its first line.
            if (typeOf(lines[i - 1]) !== "action") {
                let j = i;
                let est = 0;
                while (typeOf(lines[j]) === "action" && j < lines.length) {
                    est += Math.max(1, Math.ceil(doc.line(j + 1).text.length / ACTION_CHARS_PER_LINE));
                    j++;
                }
                if (est > ACTION_MAX_LINES && !(cursorLine >= i && cursorLine < j)) {
                    const endLine = doc.line(j);
                    const split = splitPoint(doc.sliceString(doc.line(i + 1).from, endLine.to), ACTION_MAX_LINES * ACTION_CHARS_PER_LINE);
                    const base = doc.line(i + 1).from;
                    problems.push({
                        line: i, from, to, severity: "hint",
                        message: `This action block runs about ${est} lines. Keeping blocks to ${ACTION_MAX_LINES} or fewer keeps the read fast.`,
                        fixes: split < 0 ? [] : [{
                            label: "Break the block after a sentence",
                            apply: (s) => {
                                const at = base + split;
                                return { changes: { from: at, to: s.doc.sliceString(at, at + 1) === " " ? at + 1 : at, insert: "\n\n" }, userEvent: "input.intention" };
                            },
                        }],
                    });
                }
            }
        } else if (t === "character") {
            const name = cueName(text);
            const cuePart = text.replace(/\^\s*$/, "").trim();
            // Probable typo of a known name.
            if (name && !trusted.has(name) && (freq.get(name) ?? 0) <= 1 && i !== cursorLine) {
                const max = name.length >= 5 ? 2 : 1;
                const near = [...trusted].filter((n) => n !== name && distance(n, name) <= max);
                if (near.length) {
                    problems.push({
                        line: i, from, to, severity: "warn",
                        message: `"${name}" appears only here. Did you mean ${near.slice(0, 3).join(" or ")}?`,
                        fixes: near.slice(0, 3).map((n) => ({
                            label: `Rename to ${n}`,
                            apply: (s) => setLine(s, i, s.doc.line(i + 1).text.replace(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), n)),
                        })),
                    });
                }
            }
            // A cue with nothing under it.
            const next = typeOf(lines[i + 1]);
            if (i !== cursorLine && i + 1 !== cursorLine && next !== "dialogue" && next !== "parenthetical" && next !== "lyrics") {
                problems.push({
                    line: i, from, to, severity: "warn",
                    message: "This character cue has no dialogue under it.",
                    fixes: [
                        { label: "Write a line of dialogue", apply: (s) => ({ changes: { from: s.doc.line(i + 1).to, insert: "\n" }, selection: { anchor: s.doc.line(i + 1).to + 1 } }) },
                        { label: "Make it action (!)", apply: (s) => setLine(s, i, `!${s.doc.line(i + 1).text}`) },
                    ],
                });
            }
            // Same speaker continues after action without (CONT'D).
            if (name && lastSpeaker === name && actionSince && !/\(CONT'?D\)|\(CONTINUED\)/i.test(cuePart) && i !== cursorLine) {
                problems.push({
                    line: i, from, to, severity: "hint",
                    message: `${name} keeps talking after action. Most scripts mark this (CONT'D).`,
                    fixes: [{ label: "Add (CONT'D)", apply: (s) => setLine(s, i, addExtension(s.doc.line(i + 1).text, "CONT'D")) }],
                });
            }
            lastSpeaker = name;
            actionSince = false;
        } else if (t === "transition" || t === "section") {
            lastSpeaker = null;
            actionSince = false;
        }
    }
    problems.push(
        ...introductions(state, lines, freq, cursorLine),
        ...locationSpellings(state, lines, cursorLine),
        ...monologuesAndEmptyScenes(state, lines, cursorLine),
        ...parentheticals(state, lines, cursorLine),
        ...lengths(state, lines, cursorLine, targetPages),
    );
    return problems;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A character's first mention in action should be in CAPS (the introduction). */
function introductions(state: EditorState, lines: FountainLine[], freq: Map<string, number>, cursorLine: number): Problem[] {
    const out: Problem[] = [];
    const names = [...freq.keys()].filter((n) => n.length >= 3 && /^[A-Z][A-Z .'-]*$/.test(n));
    if (!names.length) return out;
    const pending = new Set(names);
    const res = names.map((n) => [n, new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(n)}(?![\\p{L}\\p{N}])`, "iu")] as const);
    for (let i = 0; i < lines.length && pending.size; i++) {
        const t = typeOf(lines[i]);
        if (t === "character") pending.delete(cueName(lines[i].raw)); // spoke before any action mention: not our call
        if (t !== "action") continue;
        const line = state.doc.line(i + 1);
        for (const [n, re] of res) {
            if (!pending.has(n)) continue;
            const m = line.text.match(re);
            if (!m || m.index === undefined) continue;
            pending.delete(n);
            const word = m[0];
            const titleCase = word[0] === word[0].toUpperCase() && word.slice(1) !== word.slice(1).toUpperCase();
            if (word === n || !titleCase || i === cursorLine) continue;
            const from = line.from + m.index;
            out.push({
                line: i, from, to: from + word.length, severity: "hint",
                message: `First time ${n} appears. Screenplays put a character's introduction in CAPS.`,
                fixes: [{ label: `Capitalize ${n}'s introduction`, apply: () => ({ changes: { from, to: from + word.length, insert: n }, userEvent: "input.intention" }) }],
            });
        }
    }
    return out;
}

/** The place part of a heading, its offset in the line, or null. */
function headingPlace(text: string): { place: string; at: number } | null {
    const m = text.match(/^(\s*\.?(?:INT\.?\/EXT\.?|I\/E\.?|INT\.?|EXT\.?|EST\.?)\s+)(.+?)(\s+[-–—]\s+.*)?(\s*#[^#]+#)?\s*$/i);
    if (!m) return null;
    return { place: m[2].trim(), at: m[1].length };
}

const placeKey = (p: string) => p.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/** "JOHN'S HOUSE" vs "JOHNS HOUSE": flag the less common spelling of the same place. */
function locationSpellings(state: EditorState, lines: FountainLine[], cursorLine: number): Problem[] {
    const seen = new Map<string, Map<string, number>>();
    const hits: Array<{ i: number; place: string; at: number }> = [];
    for (let i = 0; i < lines.length; i++) {
        if (typeOf(lines[i]) !== "scene_heading") continue;
        const h = headingPlace(state.doc.line(i + 1).text);
        if (!h) continue;
        hits.push({ i, ...h });
        const k = placeKey(h.place);
        const m = seen.get(k) ?? new Map<string, number>();
        m.set(h.place, (m.get(h.place) ?? 0) + 1);
        seen.set(k, m);
    }
    const out: Problem[] = [];
    for (const h of hits) {
        const spellings = seen.get(placeKey(h.place))!;
        if (spellings.size < 2 || h.i === cursorLine) continue;
        const [best, bestCount] = [...spellings].sort((a, b) => b[1] - a[1])[0];
        if (best === h.place || (spellings.get(h.place) ?? 0) >= bestCount) continue;
        const from = state.doc.line(h.i + 1).from + h.at;
        out.push({
            line: h.i, from, to: from + h.place.length, severity: "warn",
            message: `Elsewhere this place is spelled "${best}". Different spellings split it into two locations in reports and schedules.`,
            fixes: [{ label: `Use "${best}"`, apply: () => ({ changes: { from, to: from + h.place.length, insert: best }, userEvent: "input.intention" }) }],
        });
    }
    return out;
}

const DIALOGUE_CHARS_PER_LINE = 35;
const MONOLOGUE_LINES = 12;

/** Long speeches (soft hint) and scenes with nothing in them. */
function monologuesAndEmptyScenes(state: EditorState, lines: FountainLine[], cursorLine: number): Problem[] {
    const out: Problem[] = [];
    for (let i = 0; i < lines.length; i++) {
        const t = typeOf(lines[i]);
        if (t === "character") {
            let j = i + 1;
            let est = 0;
            while (j < lines.length && ["dialogue", "parenthetical", "lyrics"].includes(typeOf(lines[j]))) {
                if (typeOf(lines[j]) === "dialogue") est += Math.max(1, Math.ceil(state.doc.line(j + 1).text.length / DIALOGUE_CHARS_PER_LINE));
                j++;
            }
            if (est > MONOLOGUE_LINES && !(cursorLine >= i && cursorLine < j)) {
                const line = state.doc.line(i + 1);
                out.push({
                    line: i, from: line.from, to: line.to, severity: "hint",
                    message: `${cueName(line.text)} talks for about ${est} lines without a break. If it isn't meant as a monologue, an action beat or a reply would let it breathe.`,
                    fixes: [],
                });
            }
        } else if (t === "scene_heading" && i !== cursorLine) {
            let j = i + 1;
            while (j < lines.length && typeOf(lines[j]) === "blank") j++;
            const next = typeOf(lines[j]);
            if (j < lines.length && (next === "scene_heading" || next === "section")) {
                const line = state.doc.line(i + 1);
                out.push({
                    line: i, from: line.from, to: line.to, severity: "hint",
                    message: "This scene is empty.",
                    fixes: [{ label: "Write the first action line", apply: (s) => ({ changes: { from: s.doc.line(i + 1).to, insert: "\n\n" }, selection: { anchor: s.doc.line(i + 1).to + 2 } }) }],
                });
            }
        }
    }
    return out;
}

/* ---------- parentheticals ---------- */

/** Stage business a speaker does, not how a line is said: the first word of a parenthetical that is really action. */
const BUSINESS_VERBS = new Set(
    "enters exits leaves crosses walks runs sits stands rises kneels picks grabs takes hands gives puts places throws tosses opens closes slams pours drinks eats lights hugs kisses slaps punches hits shoves pushes pulls drops lifts climbs jumps dances drives pockets unlocks locks".split(" "),
);

const parenInner = (text: string) => text.trim().replace(/^\(\s*/, "").replace(/\s*\)$/, "");
const titleCase = (name: string) => name.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase());
/** "Bob nods." from BOB + "nods"; the text as it is when it already has a subject ("he picks up…", "Ann…"). */
const parenAsAction = (name: string, inner: string) =>
    sentence(/^(he|she|they|we|i|you|it|his|her|their)\b/i.test(inner) || /^\p{Lu}/u.test(inner) ? inner : `${titleCase(name)} ${inner}`);
const sentence = (s: string) => {
    const t = s.trim();
    if (!t) return t;
    return t[0].toUpperCase() + t.slice(1) + (/[.!?…]$/.test(t) ? "" : ".");
};

/**
 * Speeches that are only a parenthetical, parentheticals that are really action (more than
 * four words, or stage business like "crosses to the door"), and a bracketed line with no
 * speaker above it.
 */
function parentheticals(state: EditorState, lines: FountainLine[], cursorLine: number): Problem[] {
    const out: Problem[] = [];
    const doc = state.doc;
    for (let i = 0; i < lines.length; i++) {
        const t = typeOf(lines[i]);
        if (t === "character") {
            let j = i + 1;
            const parens: number[] = [];
            let spoken = false;
            while (j < lines.length && ["dialogue", "parenthetical", "lyrics"].includes(typeOf(lines[j]))) {
                if (typeOf(lines[j]) === "parenthetical") parens.push(j);
                else if (doc.line(j + 1).text.trim()) spoken = true;
                j++;
            }
            const name = cueName(doc.line(i + 1).text);
            const inBlock = cursorLine >= i && cursorLine < j;
            if (parens.length && !spoken) {
                if (inBlock) continue;
                const cue = doc.line(i + 1);
                const what = parens.map((k) => parenInner(doc.line(k + 1).text)).join(", ");
                const blockEnd = doc.line(j).to;
                out.push({
                    line: i, from: cue.from, to: cue.to, severity: "warn",
                    message: `${name} has only a parenthetical here, no dialogue. Give ${name} a line, or make it action.`,
                    fixes: [
                        { label: "Write a line of dialogue", apply: (s) => ({ changes: { from: s.doc.line(j).to, insert: "\n" }, selection: { anchor: s.doc.line(j).to + 1 } }) },
                        { label: `Make it action ("${parenAsAction(name, what).slice(0, 40)}")`, apply: () => ({ changes: { from: cue.from, to: blockEnd, insert: parenAsAction(name, what) }, userEvent: "input.intention" }) },
                    ],
                });
                continue;
            }
            if (!spoken) continue;
            for (const k of parens) {
                if (k === cursorLine) continue;
                const line = doc.line(k + 1);
                const inner = parenInner(line.text);
                const words = inner.split(/\s+/).filter(Boolean);
                const first = (words[0] ?? "").toLowerCase().replace(/[^a-z]/g, "");
                const long = words.length > 4;
                const business = BUSINESS_VERBS.has(first);
                if (!long && !business) continue;
                const before = typeOf(lines[k - 1]) !== "character";
                const after = k + 1 < j && lines.slice(k + 1, j).some((l, n) => typeOf(l) !== "parenthetical" && doc.line(k + 2 + n).text.trim());
                const act = parenAsAction(name, inner);
                const cueText = doc.line(i + 1).text.trim();
                out.push({
                    line: k, from: line.from + (line.text.length - line.text.trimStart().length), to: line.to, severity: "hint",
                    message: long
                        ? `This parenthetical runs ${words.length} words. Parentheticals say how a line is spoken; longer business usually reads better as action.`
                        : `"${words[0]}" is something ${name} does, not how the line is said. It usually reads better as action.`,
                    fixes: [{
                        label: "Move it out as action",
                        apply: (s) => {
                            const ln = s.doc.line(k + 1);
                            if (!before) {
                                // First thing under the cue: the action goes above the cue.
                                const cue = s.doc.line(i + 1);
                                return { changes: { from: cue.from, to: ln.to, insert: `${act}\n\n${cueText}` }, userEvent: "input.intention" };
                            }
                            const cont = /\(CONT'?D\)/i.test(cueText) ? cueText : addExtension(cueText.replace(/\s*\^\s*$/, ""), "CONT'D");
                            return { changes: { from: ln.from, to: ln.to, insert: after ? `\n${act}\n\n${cont}` : `\n${act}` }, userEvent: "input.intention" };
                        },
                    }],
                });
            }
        } else if (t === "action" && i !== cursorLine) {
            // "(He walks away.)" alone, with no speaker: the parser reads it as action anyway.
            const line = doc.line(i + 1);
            const text = line.text.trim();
            if (!/^\(.*\)$/.test(text) || typeOf(lines[i - 1]) !== "blank" && i > 0) continue;
            const from = line.from + (line.text.length - line.text.trimStart().length);
            out.push({
                line: i, from, to: line.to, severity: "hint",
                message: "A parenthetical with no character cue above it prints as action. Drop the brackets, or add the speaker.",
                fixes: [{ label: "Drop the brackets", apply: () => ({ changes: { from, to: line.to, insert: sentence(parenInner(text)) }, userEvent: "input.intention" }) }],
            });
        }
    }
    return out;
}

/* ---------- lengths ---------- */

const LONG_SCENE_PAGES = 3;
/** Share of the script each act usually takes: three acts 1/4, 1/2, 1/4, otherwise even. */
const actShares = (n: number) => (n === 3 ? [0.25, 0.5, 0.25] : Array.from({ length: n }, () => 1 / n));

/**
 * Scenes over ~3 pages, and acts (top-level # sections) whose page count drifts from their
 * share of the target length. An act that runs short is only flagged once a later act has
 * pages in it, so a draft in progress doesn't nag about acts not written yet.
 */
function lengths(state: EditorState, lines: FountainLine[], cursorLine: number, targetPages: number): Problem[] {
    const out: Problem[] = [];
    const parsed = state.field(parsedField);
    const scenes = buildScenes(parsed, {});
    if (!scenes.length) return out;
    const len = sceneLengths(parsed, scenes);
    scenes.forEach((sc, k) => {
        if (len[k] / LINES_PER_PAGE <= LONG_SCENE_PAGES || sc.line === cursorLine) return;
        const line = state.doc.line(sc.line + 1);
        out.push({
            line: sc.line, from: line.from, to: line.to, severity: "hint",
            message: `This scene runs about ${formatEighths(len[k])} pages. Long scenes can work, but past ${LONG_SCENE_PAGES} pages it's worth checking that it still turns.`,
            fixes: [],
        });
    });
    if (!(targetPages > 0)) return out;
    const acts: Array<{ line: number; title: string; lines: number }> = [];
    for (let i = 0; i < lines.length; i++) {
        if (typeOf(lines[i]) === "section" && (lines[i].depth ?? 1) === 1) acts.push({ line: i, title: (lines[i].text ?? "").trim() || "This act", lines: 0 });
    }
    if (acts.length < 2) return out;
    scenes.forEach((sc, k) => {
        let a = -1;
        while (a + 1 < acts.length && acts[a + 1].line < sc.line) a++;
        if (a >= 0) acts[a].lines += len[k];
    });
    const shares = actShares(acts.length);
    acts.forEach((act, a) => {
        if (act.line === cursorLine) return;
        const pages = act.lines / LINES_PER_PAGE;
        const expected = targetPages * shares[a];
        const diff = pages - expected;
        const tolerance = Math.max(5, expected * 0.15);
        if (Math.abs(diff) <= tolerance) return;
        if (diff < 0 && !acts.slice(a + 1).some((x) => x.lines > 0)) return;
        const line = state.doc.line(act.line + 1);
        const r = (x: number) => Math.round(x);
        out.push({
            line: act.line, from: line.from, to: line.to, severity: "hint",
            message: `${act.title} runs about ${r(pages)} ${r(pages) === 1 ? "page" : "pages"}. For a ${targetPages}-page script it would usually be about ${r(expected)} (${diff > 0 ? "+" : "−"}${r(Math.abs(diff))}). Target length is in Settings → Editor.`,
            fixes: [],
        });
    });
    return out;
}

/** Offset of a sentence end closest to (and before) `limit` characters, or -1. */
function splitPoint(text: string, limit: number): number {
    let best = -1;
    const re = /[.!?]["')\]]?(?=\s+\S)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
        const end = m.index + m[0].length;
        if (end > limit && best > 0) break;
        if (end >= 40) best = end;
    }
    return best;
}

/* ---------- cue extensions ---------- */

export function addExtension(line: string, ext: string): string {
    const dual = /\^\s*$/.test(line);
    const base = line.replace(/\s*\^\s*$/, "").trimEnd();
    return `${base} (${ext})${dual ? " ^" : ""}`;
}

function removeExtension(line: string, ext: string): string {
    const re = new RegExp(`\\s*\\(${ext.replace(/[.'/]/g, (c) => `\\${c}`)}\\)`, "i");
    return line.replace(re, "");
}

const hasExtension = (line: string, ext: string) => line.toUpperCase().includes(`(${ext})`);

/* ---------- intentions (Alt+Enter) ---------- */

export function intentionsAt(state: EditorState, problems: Problem[], options: IntentionOptions): Fix[] {
    const lineNo = state.doc.lineAt(state.selection.main.head).number - 1;
    const text = state.doc.line(lineNo + 1).text;
    const trimmed = text.trim();
    const type = typeOf(linesOf(state)[lineNo]);
    const out: Fix[] = problems.filter((p) => p.line === lineNo).flatMap((p) => p.fixes);
    if (!trimmed) return out;

    const asAction: Fix = { label: "Make it action (!)", apply: (s) => setLine(s, lineNo, `!${trimmed.replace(/^[.!>@~]/, "")}`) };

    if (type === "action") {
        const upper = trimmed.toUpperCase();
        out.push(
            { label: "Make it a scene heading", apply: (s) => setIsolated(s, lineNo, HEADING_PREFIX.test(upper) ? upper : `INT. ${upper}`, true) },
            { label: "Make it a character cue", apply: (s) => setIsolated(s, lineNo, upper.replace(/^!/, ""), false) },
            { label: "Make it a transition", apply: (s) => setIsolated(s, lineNo, /TO:$/.test(upper) ? upper : `> ${upper}`, true) },
            { label: "Center it", apply: (s) => setLine(s, lineNo, `> ${trimmed} <`) },
            { label: "Turn into a note [[ ]]", apply: (s) => setLine(s, lineNo, `[[${trimmed}]]`) },
            { label: "Make it a lyric (~)", apply: (s) => setLine(s, lineNo, `~${trimmed}`) },
        );
    } else if (type === "scene_heading") {
        const m = trimmed.match(HEADING_PREFIX);
        const current = m ? m[1].toUpperCase().replace(/\.$/, "") : "";
        const rest = m ? trimmed.slice(m[0].length) : trimmed.replace(/^\./, "");
        for (const p of ["INT.", "EXT.", "INT./EXT."]) {
            if (p.replace(/\.$/, "") === current) continue;
            out.push({ label: `Switch to ${p}`, apply: (s) => setLine(s, lineNo, `${p} ${rest}`) });
        }
        const dash = rest.search(/\s[-–—]\s*[^-–—]*$/);
        const place = dash >= 0 ? rest.slice(0, dash) : rest.replace(/\s*#.+#\s*$/, "");
        const num = rest.match(/\s*#.+#\s*$/)?.[0] ?? "";
        const prefix = m ? `${m[1].toUpperCase()} ` : trimmed.startsWith(".") ? "." : "";
        for (const tod of TIMES.slice(0, 5)) {
            if (new RegExp(`[-–—]\\s*${tod}\\s*(#.*#)?$`, "i").test(rest)) continue;
            out.push({ label: `Time: ${tod}`, apply: (s) => setLine(s, lineNo, `${prefix}${place.trim()} - ${tod}${num}`) });
        }
        if (!num) {
            const ordinal = sceneRanges(state).findIndex((r) => r.start === lineNo) + 1;
            out.push({ label: `Number this scene #${ordinal}#`, apply: (s) => setLine(s, lineNo, `${text.trimEnd()} #${ordinal}#`) });
        }
        out.push(asAction);
    } else if (type === "character") {
        for (const ext of ["V.O.", "O.S.", "CONT'D"]) {
            out.push(
                hasExtension(text, ext)
                    ? { label: `Remove (${ext})`, apply: (s) => setLine(s, lineNo, removeExtension(s.doc.line(lineNo + 1).text, ext)) }
                    : { label: `Add (${ext})`, apply: (s) => setLine(s, lineNo, addExtension(s.doc.line(lineNo + 1).text, ext)) },
            );
        }
        out.push(
            /\^\s*$/.test(text)
                ? { label: "Undo dual dialogue", apply: (s) => setLine(s, lineNo, text.replace(/\s*\^\s*$/, "")) }
                : { label: "Make dual dialogue (^)", apply: (s) => setLine(s, lineNo, `${text.trimEnd()} ^`) },
            {
                label: `Find usages of ${cueName(text)} (Alt+F7)`,
                apply: (s) => {
                    options.findUsages?.(cueName(text));
                    return { selection: s.selection };
                },
            },
            {
                label: `Rename ${cueName(text)} everywhere… (Shift+F6)`,
                apply: (s) => {
                    options.renameCharacter(cueName(text));
                    return { selection: s.selection };
                },
            },
            {
                label: `Open ${cueName(text)}`,
                apply: (s) => {
                    options.openCharacter(cueName(text), lineNo);
                    return { selection: s.selection };
                },
            },
            asAction,
        );
    } else if (type === "dialogue") {
        out.push(
            {
                label: "Add a parenthetical above",
                apply: (s) => {
                    const l = s.doc.line(lineNo + 1);
                    return { changes: { from: l.from, insert: "(beat)\n" }, selection: EditorSelection.range(l.from + 1, l.from + 5), userEvent: "input.intention" };
                },
            },
            { label: "Make it a lyric (~)", apply: (s) => setLine(s, lineNo, `~${trimmed}`) },
        );
    } else if (type === "transition" || type === "centered" || type === "lyrics") {
        out.push(asAction);
    }
    return out;
}

/* ---------- the popup ---------- */

let openMenu: { el: HTMLElement; close: () => void } | null = null;

function showMenu(view: EditorView, fixes: Fix[]) {
    openMenu?.close();
    if (!fixes.length) return;
    const pos = view.state.selection.main.head;
    const at = view.coordsAtPos(pos) ?? view.coordsAtPos(view.state.doc.lineAt(pos).from);
    const el = document.createElement("div");
    el.className = "sf-intentions";
    el.setAttribute("role", "menu");
    let index = 0;
    const items = fixes.map((f, i) => {
        const item = document.createElement("div");
        item.className = "sf-intentions__item";
        item.setAttribute("role", "menuitem");
        item.textContent = f.label;
        item.addEventListener("mousedown", (e) => {
            e.preventDefault();
            run(i);
        });
        item.addEventListener("mousemove", () => select(i));
        el.appendChild(item);
        return item;
    });
    const select = (i: number) => {
        index = (i + items.length) % items.length;
        items.forEach((it, k) => it.classList.toggle("is-selected", k === index));
        items[index].scrollIntoView({ block: "nearest" });
    };
    const run = (i: number) => {
        close();
        const spec = fixes[i].apply(view.state);
        view.dispatch(spec);
        view.focus();
    };
    const onKey = (e: KeyboardEvent) => {
        if (e.key === "ArrowDown") select(index + 1);
        else if (e.key === "ArrowUp") select(index - 1);
        else if (e.key === "Enter" || e.key === "Tab") run(index);
        else if (e.key === "Escape") close();
        else if (/^[1-9]$/.test(e.key) && Number(e.key) <= items.length) run(Number(e.key) - 1);
        else return close();
        e.preventDefault();
        e.stopPropagation();
    };
    const onDown = (e: MouseEvent) => {
        if (!el.contains(e.target as Node)) close();
    };
    const close = () => {
        window.removeEventListener("keydown", onKey, true);
        window.removeEventListener("mousedown", onDown, true);
        view.scrollDOM.removeEventListener("scroll", close);
        el.remove();
        if (openMenu?.el === el) openMenu = null;
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("mousedown", onDown, true);
    view.scrollDOM.addEventListener("scroll", close);
    document.body.appendChild(el);
    const left = Math.min((at?.left ?? 100) , window.innerWidth - el.offsetWidth - 8);
    const below = (at?.bottom ?? 100) + 4;
    const top = below + el.offsetHeight > window.innerHeight ? Math.max(8, (at?.top ?? 100) - el.offsetHeight - 4) : below;
    el.style.left = `${Math.max(8, left)}px`;
    el.style.top = `${top}px`;
    select(0);
    openMenu = { el, close };
}

/* ---------- structural commands ---------- */

export function moveScene(view: EditorView, dir: -1 | 1): boolean {
    const { state } = view;
    const cur = state.doc.lineAt(state.selection.main.head).number - 1;
    const ranges = sceneRanges(state);
    const k = ranges.findIndex((r) => cur >= r.start && cur <= r.end);
    // Swallow the key inside the script even when there's nothing to move, so the
    // default Mod-Shift-Arrow (select to document start/end) doesn't fire instead.
    if (k < 0) return ranges.length > 0;
    const a = dir < 0 ? ranges[k - 1] : ranges[k];
    const b = dir < 0 ? ranges[k] : ranges[k + 1];
    if (!a || !b) return true; // first/last scene: nothing to swap with
    // Two chunks next to each other get swapped. Normally they are the two scenes;
    // when a section line (# ACT TWO) sits between them, the scene hops over the
    // section header instead, so it becomes the last scene of the previous section
    // (moving up) or the first scene of the next one (moving down).
    const gap = a.end + 1 < b.start ? { start: a.end + 1, end: b.start - 1 } : null;
    const first = gap && dir < 0 ? gap : a;
    const second = gap && dir > 0 ? gap : b;
    const moving = dir < 0 ? b : a;
    const from = state.doc.line(first.start + 1).from;
    const to = state.doc.line(second.end + 1).to;
    const region = state.doc.sliceString(from, to);
    const trailing = region.length - region.replace(/\n+$/, "").length;
    const strip = (r: { start: number; end: number }) => state.doc.sliceString(state.doc.line(r.start + 1).from, state.doc.line(r.end + 1).to).replace(/\n+$/, "");
    const A = strip(first);
    const B = strip(second);
    const insert = `${B}\n\n${A}${"\n".repeat(trailing)}`;
    // Keep the cursor on the same spot of the scene it was in.
    const offset = state.selection.main.head - state.doc.line(moving.start + 1).from;
    const movingIsSecond = moving === second;
    const newStart = movingIsSecond ? from : from + B.length + 2;
    view.dispatch({
        changes: { from, to, insert },
        selection: { anchor: newStart + Math.min(offset, (movingIsSecond ? B : A).length) },
        scrollIntoView: true,
        userEvent: "move.scene",
    });
    return true;
}

/**
 * Drag-and-drop reorder (Outline): move the scene that starts at `line` step by step
 * (moveScene, so section headers are hopped the same way) until it is scene number
 * `target`, and return the whole move as one change, i.e. one undo. Null if nothing moves.
 */
export function moveSceneToSpec(start: EditorState, line: number, target: number): { changes: { from: number; to: number; insert: string }; selection: { anchor: number } } | null {
    let st = start.update({ selection: { anchor: start.doc.line(Math.min(start.doc.lines, line + 1)).from } }).state;
    // moveScene only reads view.state and calls view.dispatch, so step a scratch state.
    const scratch = { get state() { return st; }, dispatch: (spec: TransactionSpec) => { st = st.update(spec).state; } } as unknown as EditorView;
    const indexAt = () => {
        const ln = st.doc.lineAt(st.selection.main.head).number - 1;
        const scenes = st.field(parsedField).scenes;
        let k = -1;
        for (let i = 0; i < scenes.length && scenes[i].line <= ln; i++) k = i;
        return k;
    };
    for (let guard = 0; guard < 2000; guard++) {
        const k = indexAt();
        if (k === target || k < 0) break;
        const before = st.doc;
        moveScene(scratch, k < target ? 1 : -1);
        if (st.doc === before) break;
    }
    const a = start.doc.toString();
    const b = st.doc.toString();
    if (a === b) return null;
    let from = 0;
    while (from < a.length && from < b.length && a[from] === b[from]) from++;
    let ea = a.length;
    let eb = b.length;
    while (ea > from && eb > from && a[ea - 1] === b[eb - 1]) {
        ea--;
        eb--;
    }
    return { changes: { from, to: ea, insert: b.slice(from, eb) }, selection: { anchor: st.selection.main.head } };
}

// Extend / shrink selection: a stack of the selections we expanded from.
const selectionStack = new WeakMap<EditorView, Array<{ anchor: number; head: number }>>();

function expandCandidates(state: EditorState, from: number, to: number): Array<[number, number]> {
    const doc = state.doc;
    const out: Array<[number, number]> = [];
    const word = state.wordAt(from);
    if (word) out.push([word.from, word.to]);
    const l1 = doc.lineAt(from);
    const l2 = doc.lineAt(to);
    const lead = l1.text.length - l1.text.trimStart().length;
    out.push([l1.from + lead, l2.to]);
    // Block: contiguous non-blank lines (a dialogue block includes its cue).
    let s = l1.number;
    let e = l2.number;
    while (s > 1 && doc.line(s - 1).text.trim()) s--;
    while (e < doc.lines && doc.line(e + 1).text.trim()) e++;
    out.push([doc.line(s).from, doc.line(e).to]);
    const lines = linesOf(state);
    // Scene.
    const scene = sceneRanges(state).find((r) => l1.number - 1 >= r.start && l2.number - 1 <= r.end);
    if (scene) {
        let end = scene.end;
        while (end > scene.start && !doc.line(end + 1).text.trim()) end--;
        out.push([doc.line(scene.start + 1).from, doc.line(end + 1).to]);
    }
    // Enclosing sections, innermost first.
    let depthLimit = Infinity;
    for (let i = l1.number - 1; i >= 0; i--) {
        const l = lines[i];
        if (l?.type !== "section") continue;
        const depth = l.depth ?? 1;
        if (depth >= depthLimit) continue;
        depthLimit = depth;
        let j = i + 1;
        while (j < lines.length && !(lines[j]?.type === "section" && (lines[j].depth ?? 1) <= depth)) j++;
        let end = j - 1;
        while (end > i && !doc.line(end + 1).text.trim()) end--;
        out.push([doc.line(i + 1).from, doc.line(end + 1).to]);
        if (depth <= 1) break;
    }
    out.push([0, doc.length]);
    return out;
}

export function extendSelection(view: EditorView): boolean {
    const { state } = view;
    const sel = state.selection.main;
    const next = expandCandidates(state, sel.from, sel.to).find(([f, t]) => f <= sel.from && t >= sel.to && t - f > sel.to - sel.from);
    if (!next) return true;
    const stack = selectionStack.get(view) ?? [];
    stack.push({ anchor: sel.anchor, head: sel.head });
    selectionStack.set(view, stack);
    view.dispatch({ selection: EditorSelection.range(next[0], next[1]), userEvent: "select.extend" });
    return true;
}

export function shrinkSelection(view: EditorView): boolean {
    const stack = selectionStack.get(view);
    const prev = stack?.pop();
    if (!prev) return true;
    view.dispatch({ selection: EditorSelection.range(prev.anchor, prev.head), userEvent: "select.extend" });
    return true;
}

/** The character on a cue line, or the cast name under the cursor. */
function nameAtCursor(v: EditorView, options: IntentionOptions): string | null {
    const pos = v.state.selection.main.head;
    const line = v.state.doc.lineAt(pos);
    if (typeOf(linesOf(v.state)[line.number - 1]) === "character") return cueName(line.text) || null;
    const w = v.state.wordAt(pos);
    const word = w ? v.state.sliceDoc(w.from, w.to).toUpperCase() : "";
    return word && options.cast().some((c) => c.toUpperCase() === word) ? word : null;
}

/** The location of the scene heading under the caret, if the caret is on one. */
export function locationAtCursor(v: EditorView): string | null {
    const line = v.state.doc.lineAt(v.state.selection.main.head).number - 1;
    const scene = v.state.field(parsedField).scenes.find((s) => s.line === line);
    return scene?.location?.trim() ? scene.location.trim().toUpperCase() : null;
}

/** Every inspection hit in the script, the caret's line included (the Problems window). */
export function problemsOf(view: EditorView): Problem[] {
    const r = registry.get(view);
    return r && r.options.inspections() ? inspect(view.state, r.options.cast(), false, r.options.targetPages?.() ?? 0, r.options.includeTargets?.() ?? null) : [];
}

/* ---------- extension ---------- */

/** Re-run the inspections now (after the setting or the cast changed). */
const recheck = StateEffect.define<null>();
export const recheckInspections = (view: EditorView) => view.dispatch({ effects: recheck.of(null) });
/** Idle time after the last edit before inspections re-run over the script. */
const INSPECT_DELAY = 400;

/** Each editor's problems field and options, for the right-click menu. */
const registry = new WeakMap<EditorView, { problems: () => Problem[]; options: IntentionOptions }>();

/** The Alt+Enter list for the caret's line (fixes first, then context actions). */
export function fixesAt(view: EditorView): Fix[] {
    const r = registry.get(view);
    return r ? intentionsAt(view.state, freshProblems(view.state, r.options), r.options) : [];
}

/** Problems computed now, including the caret's line (Alt+Enter, right-click). */
function freshProblems(state: EditorState, options: IntentionOptions): Problem[] {
    return options.inspections() ? inspect(state, options.cast(), false, options.targetPages?.() ?? 0, options.includeTargets?.() ?? null) : [];
}

/** The character under the caret: a cue, or a cast name in the text. */
export function contextNameAt(view: EditorView): string | null {
    const r = registry.get(view);
    return r ? nameAtCursor(view, r.options) : null;
}

const insMark = (severity: Problem["severity"], message: string) =>
    Decoration.mark({ class: `sf-insp sf-insp--${severity}`, attributes: { title: `${message}  (Alt+Enter to fix)` } });

export function intentions(options: IntentionOptions): Extension {
    // Inspections run over the whole script. Measured on a synthetic ~150-page script
    // (9,100 lines): ~7 ms per run after warm-up, against ~15-30 ms for the re-parse each
    // edit already costs. So typing only maps the existing marks through the change and
    // the full run waits until typing pauses (INSPECT_DELAY); moving to another line
    // without editing, a reconfigure, or recheckInspections run it straight away.
    const run = (state: EditorState) => (options.inspections() ? inspect(state, options.cast(), true, options.targetPages?.() ?? 0, options.includeTargets?.() ?? null) : []);
    const problemsField = StateField.define<Problem[]>({
        create: run,
        update: (value, tr) => {
            if (tr.reconfigured || tr.effects.some((e) => e.is(recheck))) return run(tr.state);
            if (tr.docChanged) {
                return value
                    .map((p) => {
                        const from = tr.changes.mapPos(p.from, 1);
                        const to = Math.max(from, tr.changes.mapPos(p.to, -1));
                        return { ...p, from, to, line: tr.state.doc.lineAt(from).number - 1 };
                    })
                    .filter((p) => p.to > p.from);
            }
            const lineMoved = tr.selection && tr.state.doc.lineAt(tr.state.selection.main.head).number !== tr.startState.doc.lineAt(tr.startState.selection.main.head).number;
            return lineMoved ? run(tr.state) : value;
        },
        provide: (f) =>
            EditorView.decorations.from(f, (problems): DecorationSet => {
                const b = new RangeSetBuilder<Decoration>();
                for (const p of [...problems].sort((x, y) => x.from - y.from)) b.add(p.from, p.to, insMark(p.severity, p.message));
                return b.finish();
            }),
    });

    // Selections changed by anything but extend/shrink reset the stack.
    const resetStack = EditorView.updateListener.of((u) => {
        if (!u.selectionSet) return;
        if (u.transactions.some((t) => t.isUserEvent("select.extend"))) return;
        selectionStack.delete(u.view);
    });

    const register = ViewPlugin.define((view) => {
        registry.set(view, { problems: () => view.state.field(problemsField), options });
        let timer: ReturnType<typeof setTimeout> | null = null;
        return {
            update(u) {
                if (!u.docChanged) return;
                if (timer) clearTimeout(timer);
                timer = setTimeout(() => {
                    timer = null;
                    u.view.dispatch({ effects: recheck.of(null) });
                }, INSPECT_DELAY);
            },
            destroy() {
                if (timer) clearTimeout(timer);
            },
        };
    });

    return [
        problemsField,
        resetStack,
        register,
        // High precedence: these must win over the default keymap (Mod-Shift-Arrow selects to the document edge there).
        Prec.high(keymap.of([
            { key: "Tab", run: (v) => expandTemplate(v, options.templates?.() ?? []) },
            { key: "Mod-j", run: (v) => showTemplatePicker(v, options.templates?.() ?? []), preventDefault: true },
            { key: "Alt-Enter", run: (v) => (showMenu(v, intentionsAt(v.state, freshProblems(v.state, options), options)), true) },
            { key: "Mod-Shift-ArrowUp", run: (v) => moveScene(v, -1), preventDefault: true },
            { key: "Mod-Shift-ArrowDown", run: (v) => moveScene(v, 1), preventDefault: true },
            // Alternative for systems that keep Ctrl/Cmd+Shift+Arrow for themselves.
            { key: "Alt-Shift-PageUp", run: (v) => moveScene(v, -1), preventDefault: true },
            { key: "Alt-Shift-PageDown", run: (v) => moveScene(v, 1), preventDefault: true },
            { key: "Alt-Shift-ArrowUp", run: extendSelection, preventDefault: true },
            { key: "Alt-Shift-ArrowDown", run: shrinkSelection, preventDefault: true },
            {
                key: "Shift-F6",
                run: (v) => {
                    const name = nameAtCursor(v, options);
                    if (name) options.renameCharacter(name);
                    return true;
                },
            },
            {
                key: "Alt-F7",
                run: (v) => {
                    const loc = locationAtCursor(v);
                    if (loc) options.findLocationUsages?.(loc);
                    else {
                        const name = nameAtCursor(v, options);
                        if (name) options.findUsages?.(name);
                    }
                    return true;
                },
            },
        ])),
    ];
}
