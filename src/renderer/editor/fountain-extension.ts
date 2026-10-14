// src/renderer/editor/fountain-extension.ts
//
// CodeMirror 6 support for Fountain, driven entirely by the Sceneform parser.
// Replaces the old hand-rolled contenteditable, which rebuilt the whole
// editor's innerHTML on every parse and lost the caret, selection and undo.
// Here the text buffer is CodeMirror's; the parser only ever adds decorations.

import { EditorState, RangeSetBuilder, StateField, type Extension, type Range } from "@codemirror/state";
import {
    Decoration,
    EditorView,
    ViewPlugin,
    WidgetType,
    hoverTooltip,
    type ViewUpdate,
    keymap,
    type DecorationSet,
} from "@codemirror/view";
import {
    autocompletion,
    type Completion,
    type CompletionContext,
    type CompletionResult,
} from "@codemirror/autocomplete";

import { FOUNTAIN_DOCS, type FountainDoc } from "../lib/fountain-docs";
import { contextMenuIsOpen } from "./context-menu-state";
import { TITLE_PAGE_KEYS, formatDraftDate, isKnownTitleKey, isoDate, normalizeTitleKey } from "../../backend/title-page";
import { parseFountain, type FountainLineType, type FountainParserDocument } from "../lib/fountain";

/* ---------- parsed document ---------- */

export const parsedField = StateField.define<FountainParserDocument>({
    create: (state) => parseFountain(state.doc.toString()),
    update: (value, tr) => (tr.docChanged ? parseFountain(tr.state.doc.toString()) : value),
});

/** Line type at a 0-based line index, from the latest parse. */
export function lineTypeAt(state: EditorState, lineIndex: number): FountainLineType {
    return state.field(parsedField).lines[lineIndex]?.type ?? "blank";
}

/* ---------- badges ---------- */

export interface BadgeHandler {
    /** line: 0-based line of the badge's element at click time. */
    (kind: "heading" | "character", text: string, line: number): void;
}

class BadgeWidget extends WidgetType {
    constructor(
        readonly kind: "heading" | "character",
        readonly text: string,
        readonly onClick: BadgeHandler,
    ) {
        super();
    }
    eq(other: BadgeWidget) {
        return other.kind === this.kind && other.text === this.text;
    }
    toDOM(view: EditorView) {
        const el = document.createElement("button");
        el.type = "button";
        el.className = `type-badge type-badge--${this.kind}`;
        el.textContent = this.kind === "heading" ? ".heading" : "@character";
        el.title = this.kind === "heading" ? "Open this scene's page" : "Open this character's page";
        el.addEventListener("mousedown", (e) => {
            e.preventDefault();
            e.stopPropagation();
            let line = -1;
            try {
                line = view.state.doc.lineAt(view.posAtDOM(el)).number - 1;
            } catch {
                // detached widget; leave -1
            }
            this.onClick(this.kind, this.text, line);
        });
        return el;
    }
    ignoreEvent() {
        return true;
    }
}

/* ---------- decorations ---------- */

const NAMED_COLORS = new Set([
    "red", "blue", "green", "yellow", "orange", "purple", "pink", "brown", "gray", "grey", "black", "white",
    "cyan", "magenta", "teal", "lime", "indigo", "violet", "gold", "silver", "navy", "maroon", "olive", "aqua",
]);
const isColor = (s: string) => /^#[0-9a-f]{3,8}$/i.test(s) || NAMED_COLORS.has(s.trim().toLowerCase());

const lineDecoCache = new Map<string, Decoration>();
function lineDeco(cls: string, attrs?: Record<string, string>): Decoration {
    if (attrs) return Decoration.line({ class: cls, attributes: attrs });
    let d = lineDecoCache.get(cls);
    if (!d) {
        d = Decoration.line({ class: cls });
        lineDecoCache.set(cls, d);
    }
    return d;
}
const hiddenLine = Decoration.replace({ block: true });
const noteMark = Decoration.mark({ class: "cm-ft-inline-note" });
const tpKeyMark = Decoration.mark({ class: "cm-ft-tp-key" });
const tpUnknownKeyMark = Decoration.mark({ class: "cm-ft-tp-key cm-ft-tp-key--unknown", attributes: { title: "Not a standard title page key" } });
const tpValueMark = Decoration.mark({ class: "cm-ft-tp-value" });
const tpContMark = Decoration.mark({ class: "cm-ft-tp-value cm-ft-tp-value--cont" });
/** "Key:" at the start of a title-page line (continuation lines are indented). */
const TP_KEY = /^([A-Za-z][A-Za-z ]*?)(\s*:)/;
const colorMark = Decoration.mark({ class: "cm-ft-color-tag" });
/** The trailing ^ of a dual-dialogue cue: kept in the text, dimmed on screen. */
const dualCaretMark = Decoration.mark({ class: "cm-ft-dual-caret", attributes: { title: "Dual dialogue: printed side by side with the cue before" } });

interface FountainDecorations {
    all: DecorationSet;
    hidden: DecorationSet;
}

function buildDecorations(state: EditorState, onBadge: BadgeHandler | null): FountainDecorations {
    const parsed = state.field(parsedField);
    const doc = state.doc;
    const ranges: Range<Decoration>[] = [];
    const hidden = new RangeSetBuilder<Decoration>();
    const sceneNumbers = new Map<number, string>();
    for (const scene of parsed.scenes) sceneNumbers.set(scene.line, scene.number);

    // Lines inside a dual-dialogue pair get a side marker (left = first speaker, right = the ^ one).
    const dualSide = new Map<number, "left" | "right">();
    for (const b of parsed.blocks ?? []) if (b.dual) for (let l = b.first; l <= b.last; l++) dualSide.set(l, b.dual);

    const lineCount = Math.min(doc.lines, parsed.lines.length);
    for (let i = 0; i < lineCount; i++) {
        const info = parsed.lines[i];
        const line = doc.line(i + 1);
        const type = info.type ?? "blank";

        if (type === "marker") {
            // Internal scene identity: never visible, never editable by accident.
            ranges.push(hiddenLine.range(line.from, line.to));
            hidden.add(line.from, line.to, hiddenLine);
            continue;
        }

        if (type === "scene_heading") {
            const num = sceneNumbers.get(i) ?? "";
            ranges.push(lineDeco("cm-ft-line cm-ft-scene_heading", { "data-scene": num }).range(line.from));
            const tag = /\[\[\s*([^\]]*?)\s*\]\]\s*$/.exec(line.text);
            if (tag && isColor(tag[1])) {
                ranges.push(colorMark.range(line.from + tag.index, line.to));
            }
            if (onBadge) {
                ranges.push(
                    Decoration.widget({ widget: new BadgeWidget("heading", info.text ?? line.text, onBadge), side: 1 }).range(line.to),
                );
            }
            continue;
        }

        if (type !== "blank") {
            const side = dualSide.get(i);
            ranges.push(lineDeco(`cm-ft-line cm-ft-${type}${info.forced ? " cm-ft-forced" : ""}${side ? ` cm-ft-dual cm-ft-dual--${side}` : ""}`).range(line.from));
        }

        if (type === "character") {
            const caret = /\s*\^\s*$/.exec(line.text);
            if (caret) ranges.push(dualCaretMark.range(line.from + caret.index, line.to));
        }

        if (type === "title_page") {
            // The parser decides what is a title page; here we only split key and value.
            const km = /^[ \t]/.test(line.text) ? null : TP_KEY.exec(line.text);
            if (km) {
                const keyEnd = line.from + km[0].length;
                ranges.push((isKnownTitleKey(km[1]) ? tpKeyMark : tpUnknownKeyMark).range(line.from, keyEnd));
                if (keyEnd < line.to) ranges.push(tpValueMark.range(keyEnd, line.to));
            } else if (line.text.trim()) {
                ranges.push(tpContMark.range(line.from, line.to));
            }
            continue;
        }

        if (type === "character" && onBadge) {
            const name = (info.text ?? line.text).replace(/^@/, "").replace(/\s*\(.*?\)\s*/g, "").replace(/\s*\^$/, "").trim();
            ranges.push(Decoration.widget({ widget: new BadgeWidget("character", name, onBadge), side: 1 }).range(line.to));
        }

        // Inline [[notes]] inside other elements.
        if (type !== "note" && type !== "omit" && line.text.includes("[[")) {
            const re = /\[\[[\s\S]*?\]\]/g;
            let m: RegExpExecArray | null;
            while ((m = re.exec(line.text))) {
                ranges.push(noteMark.range(line.from + m.index, line.from + m.index + m[0].length));
            }
        }
    }

    // RangeSet requires sorted input: line decorations (point, side -) first, then marks, then widgets.
    ranges.sort((a, b) => a.from - b.from || a.value.startSide - b.value.startSide);
    const builder = new RangeSetBuilder<Decoration>();
    for (const r of ranges) builder.add(r.from, r.to, r.value);
    return { all: builder.finish(), hidden: hidden.finish() };
}

function decorationsField(onBadge: BadgeHandler | null) {
    return StateField.define<FountainDecorations>({
        create: (state) => buildDecorations(state, onBadge),
        update: (value, tr) => (tr.docChanged ? buildDecorations(tr.state, onBadge) : value),
        provide: (f) => [
            EditorView.decorations.from(f, (v) => v.all),
            // Only the hidden ID markers are atomic; notes and tags stay editable.
            EditorView.atomicRanges.of((view) => view.state.field(f).hidden),
        ],
    });
}

/* ---------- hover documentation ---------- */

function docCard(doc: FountainDoc, literal: string): HTMLElement {
    const card = document.createElement("div");
    card.className = "doc-card doc-card--tooltip";
    const kind = document.createElement("div");
    kind.className = `doc-card__kind is-${doc.kind}`;
    kind.innerHTML = `<span class="dot"></span>`;
    kind.append(doc.kind === "sceneform" ? "Sceneform Fountain" : "Universal Fountain", `, ${doc.label}`);
    const pill = document.createElement("code");
    pill.className = `doc-card__pill is-${doc.kind}`;
    pill.textContent = literal.length > 80 ? `${literal.slice(0, 77)}…` : literal;
    const desc = document.createElement("div");
    desc.className = "doc-card__desc";
    desc.textContent = doc.desc;
    card.append(kind, pill, desc);
    if (doc.note) {
        const note = document.createElement("div");
        note.className = "doc-card__note";
        note.innerHTML = doc.note; // static, authored content only
        card.append(note);
    }
    return card;
}

const fountainHover = hoverTooltip(
    (view, pos) => {
        if (contextMenuIsOpen()) return null; // one popup at a time: the right-click menu wins
        const line = view.state.doc.lineAt(pos);
        const type = lineTypeAt(view.state, line.number - 1);
        if (type === "blank" || type === "action") return null; // action is the default; no noise
        let key: keyof typeof FOUNTAIN_DOCS = type;
        let literal = line.text.trim();
        if (type === "title_page") {
            const km = /^[ \t]/.test(line.text) ? null : TP_KEY.exec(line.text);
            if (km && !isKnownTitleKey(km[1])) key = "title-key-unknown";
        }
        const inNote = /\[\[[\s\S]*?\]\]/g;
        let m: RegExpExecArray | null;
        while ((m = inNote.exec(line.text))) {
            const from = line.from + m.index;
            if (pos >= from && pos <= from + m[0].length) {
                key = type === "scene_heading" && isColor(m[0].slice(2, -2).trim()) ? "scene-color" : "inline-note";
                literal = m[0];
            }
        }
        const doc = FOUNTAIN_DOCS[key];
        if (!doc) return null;
        return {
            pos: line.from,
            end: line.to,
            above: false,
            create: () => ({ dom: docCard(doc, literal) }),
        };
    },
    { hoverTime: 450 },
);

/* ---------- autocomplete ---------- */

export interface CompletionData {
    characters: () => string[];
    headings: () => string[];
    locations: () => string[];
    /** Project default draft date (ISO) or "". */
    draftDate?: () => string;
}

const PREFIXES = ["INT.", "EXT.", "EST.", "INT./EXT.", "I/E."];
const HEAD_START = /^(INT|EXT|EST|INT\.?\/EXT|I\/E)[. ]/i;
const TRANSITIONS = ["CUT TO:", "FADE IN:", "FADE OUT.", "FADE TO:", "DISSOLVE TO:", "SMASH CUT TO:", "MATCH CUT TO:", "JUMP CUT TO:", "FADE TO BLACK."];
const TITLE_PAGE_ORDER = ["title", "credit", "author", "source", "draft date", "contact", "copyright", "notes"];

/** True while every line above `lineNumber` is a title-page "Key: value" or indented continuation line. */
function atTitlePageTop(state: EditorState, lineNumber: number): boolean {
    if (lineNumber > 40) return false;
    for (let n = 1; n < lineNumber; n++) {
        const t = state.doc.line(n).text;
        if (!t.trim()) return false;
        if (!/^[^:\s][^:]*:/.test(t) && !/^(\s{2,}|\t)/.test(t)) return false;
    }
    return true;
}

const TIMES = ["DAY", "NIGHT", "DAWN", "DUSK", "MORNING", "EVENING", "CONTINUOUS", "LATER", "MOMENTS LATER"];

function options(labels: string[], type: string, detail?: string): Completion[] {
    return labels.map((label, i) => ({ label, type, detail, boost: -i / 1000 }));
}

function fountainCompletions(data: CompletionData) {
    return (ctx: CompletionContext): CompletionResult | null => {
        const line = ctx.state.doc.lineAt(ctx.pos);
        const before = line.text.slice(0, ctx.pos - line.from);

        // "Draft date:" / "Date:" on the title page: offer today and the project default, formatted.
        const dateKey = /^((?:draft\s+)?date\s*:\s*)(.*)$/i.exec(before);
        if (dateKey && lineTypeAt(ctx.state, line.number - 1) === "title_page") {
            const today = formatDraftDate(isoDate());
            const def = data.draftDate?.() ?? "";
            const opts: Completion[] = [{ label: today, detail: "today", type: "date" }];
            if (def && formatDraftDate(def) !== today) opts.push({ label: formatDraftDate(def), detail: "project default", type: "date" });
            if (!dateKey[2] && !ctx.explicit && !/:\s$/.test(before)) return null;
            return { from: line.from + dateKey[1].length, options: opts, filter: false };
        }

        const lineType = lineTypeAt(ctx.state, line.number - 1);
        const prevBlank = line.number === 1 || !ctx.state.doc.line(line.number - 1).text.trim();

        // Title page, in order: while the script opens with title-page lines, offer the keys it doesn't have yet,
        // the conventional next one first (Title, Credit, Author, Source, Draft date, Contact, ...).
        if (/^[A-Za-z][A-Za-z ]*$|^$/.test(before) && !/^[A-Z]{2}/.test(before) && (ctx.explicit || before.length > 0) && atTitlePageTop(ctx.state, line.number)) {
            const present = new Set<string>();
            for (let n = 1; n < line.number; n++) {
                const m = /^([^:\s][^:]*):/.exec(ctx.state.doc.line(n).text);
                if (m) present.add(normalizeTitleKey(m[1]));
            }
            const ordered = TITLE_PAGE_ORDER.filter((k) => !present.has(k));
            if (ordered.length) {
                return {
                    from: line.from,
                    options: ordered.map((k, i) => {
                        const spec = TITLE_PAGE_KEYS.find((t) => t.key === k);
                        return { label: `${spec?.label ?? k}: `, displayLabel: spec?.label ?? k, detail: i === 0 ? "next" : undefined, info: spec?.hint, type: "keyword", boost: 99 - i };
                    }),
                    validFor: /^[A-Za-z ]*$/,
                };
            }
        }

        // @ — character names. At line start the @ stays (it forces a character cue); mid-line it's a mention
        // trigger and is replaced by the name.
        const at = /@([\p{L}\p{N} .'-]*)$/u.exec(before);
        if (at) {
            const names = data.characters();
            if (!names.length) return null;
            const keepAt = at.index === 0;
            return {
                from: line.from + at.index,
                options: names.map((name, i) => ({ label: `@${name}`, displayLabel: name, apply: keepAt ? `@${name}` : name, type: "character", boost: -i / 1000 })),
                validFor: /^@[\p{L}\p{N} .'-]*$/u,
            };
        }

        // # mid-line — mention a location (or a full scene heading). At line start # stays a Fountain section.
        const hash = /(?<=\S.*)#([\p{L}\p{N} .'/-]*)$/u.exec(before);
        if (hash) {
            const locs = data.locations();
            const heads = data.headings();
            if (!locs.length && !heads.length) return null;
            return {
                from: line.from + hash.index,
                options: [
                    ...locs.map((l, i) => ({ label: `#${l}`, displayLabel: l, apply: l, detail: "location", type: "place", boost: -i / 1000 })),
                    ...heads.map((h, i) => ({ label: `#${h}`, displayLabel: h, apply: h, detail: "scene", type: "heading", boost: -1 - i / 1000 })),
                ],
                validFor: /^#[\p{L}\p{N} .'/-]*$/u,
            };
        }

        // . at line start — force/reuse a scene heading (Fountain's own forced-heading marker).
        const dot = /^\.(?!\.)([^]*)$/.exec(before);
        if (dot && prevBlank) {
            const headings = data.headings();
            if (!headings.length) return null;
            return {
                from: line.from,
                options: headings.map((h, i) => ({ label: `.${h}`, displayLabel: h, apply: HEAD_START.test(h) ? h : `.${h}`, type: "heading", boost: -i / 1000 })),
                filter: true,
            };
        }

        // Character cue: an all-caps word on a line after a blank line.
        const cue = /^([\p{Lu}][\p{Lu}\p{N} .'-]*)$/u.exec(before);
        if (cue && prevBlank && lineType !== "title_page" && !HEAD_START.test(before)) {
            const names = data.characters().filter((n) => n.toUpperCase().startsWith(cue[1].toUpperCase()) && n.toUpperCase() !== cue[1].toUpperCase());
            if (names.length) return { from: line.from, options: options(names, "character", "character"), validFor: /^[\p{Lu}\p{N} .'-]*$/u };
        }
        // Extensions after a cue: "MAERI (" -> V.O., O.S., CONT'D.
        const ext = /^([\p{Lu}][\p{Lu}\p{N} .'-]*?)\s*\(([A-Z.']*)$/u.exec(before);
        if (ext && prevBlank) {
            return { from: ctx.pos - ext[2].length, options: options(["V.O.)", "O.S.)", "O.C.)", "CONT'D)"], "keyword", "extension"), validFor: /^[A-Z.']*$/ };
        }

        // Transitions: "CUT" -> "CUT TO:" etc., only on their own line after a blank line.
        const tr = /^([A-Z][A-Z ]*)$/.exec(before);
        if (tr && prevBlank && tr[1].length >= 2) {
            const hits = TRANSITIONS.filter((t) => t.startsWith(tr[1]) && t !== tr[1]);
            if (hits.length) return { from: line.from, options: options(hits, "keyword", "transition") };
        }

        // Scene heading builder: prefix -> place -> time of day.
        if (/^(INT|EXT|EST|I\/E?)$/i.test(before) && prevBlank) {
            return { from: line.from, options: options(PREFIXES, "prefix", "scene type").map((o) => ({ ...o, apply: `${o.label} ` })) };
        }
        const place = /^(INT\.\/EXT\.|INT\.|EXT\.|EST\.|I\/E\.?)\s+([^-]*)$/i.exec(before);
        if (place) {
            const locs = data.locations();
            if (!locs.length) return null;
            return {
                from: ctx.pos - place[2].length,
                options: options(locs, "place", "location").map((o) => ({ ...o, apply: `${o.label} - ` })),
                validFor: /^[^-]*$/,
            };
        }
        const time = /^(INT\.\/EXT\.|INT\.|EXT\.|EST\.|I\/E\.?)\s+.+\s-\s*([A-Za-z ]*)$/i.exec(before);
        if (time) {
            return { from: ctx.pos - time[2].length, options: options(TIMES, "time", "time of day"), validFor: /^[A-Za-z ]*$/ };
        }
        return null;
    };
}

/* ---------- line continuation ---------- */

/**
 * Auto-continuation (the design's "auto-indentation"): Enter at the end of a
 * scene heading or transition adds the blank line Fountain needs after it.
 * It never inserts words for you.
 */
function continuationKeymap(enabled: () => boolean) {
    return keymap.of([
        {
            key: "Enter",
            run: (view) => {
                if (!enabled()) return false;
                const { state } = view;
                const sel = state.selection.main;
                if (!sel.empty) return false;
                const line = state.doc.lineAt(sel.head);
                if (sel.head !== line.to || !line.text.trim()) return false;
                const type = lineTypeAt(state, line.number - 1);
                if (type !== "scene_heading" && type !== "transition") return false;
                view.dispatch({
                    changes: { from: sel.head, insert: "\n\n" },
                    selection: { anchor: sel.head + 2 },
                    scrollIntoView: true,
                    userEvent: "input",
                });
                return true;
            },
        },
    ]);
}

/* ---------- theme ---------- */

const fountainTheme = EditorView.theme({
    "&": { height: "100%", backgroundColor: "transparent", color: "var(--c-text)" },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": {
        fontFamily: "var(--font-editor)",
        lineHeight: "1.9",
        overflow: "auto",
    },
    // The side padding is the scene-number margin (the numbers sit at +-44px
    // outside each heading line). It has to live inside .cm-content: with only
    // auto margins, a pane narrower than the page width (Preview open, small
    // window) left the text flush against the edge and clipped the numbers.
    ".cm-content": {
        boxSizing: "border-box",
        maxWidth: "calc(var(--editor-page-width) + 2 * var(--editor-side-pad))",
        margin: "0 auto",
        padding: "var(--sp-10) var(--editor-side-pad) 40vh",
        caretColor: "var(--c-accent)",
    },
    ".cm-line": { position: "relative", padding: "0 96px 0 0" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--c-accent)", borderLeftWidth: "2px" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
        backgroundColor: "color-mix(in srgb, var(--c-accent) 18%, transparent) !important",
    },
    ".cm-activeLine": { backgroundColor: "rgba(240, 239, 244, 0.025)" },
    ".cm-gutters": { display: "none" },
});

/* ---------- character names in action lines ---------- */

const escapeRe = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Marks every known character name mentioned in an action line (case-insensitive,
 * whole words). Ctrl/Cmd+click on one opens that character's page.
 */
function actionNames(characters: () => string[], onBadge: BadgeHandler | null): Extension {
    const mark = Decoration.mark({ class: "sf-name", attributes: { title: "Ctrl/Cmd+click to open this character" } });
    const build = (view: EditorView): DecorationSet => {
        const names = characters().filter((n) => n.length > 1);
        if (!names.length) return Decoration.none;
        const re = new RegExp(`(?<![\\p{L}\\p{N}])(${names.sort((a, b) => b.length - a.length).map(escapeRe).join("|")})(?![\\p{L}\\p{N}])`, "giu");
        const parsed = view.state.field(parsedField);
        const b = new RangeSetBuilder<Decoration>();
        for (const { from, to } of view.visibleRanges) {
            let line = view.state.doc.lineAt(from);
            for (;;) {
                if (parsed.lines[line.number - 1]?.type === "action") {
                    re.lastIndex = 0;
                    for (let m; (m = re.exec(line.text)); ) b.add(line.from + m.index, line.from + m.index + m[0].length, mark);
                }
                if (line.to >= to || line.number >= view.state.doc.lines) break;
                line = view.state.doc.line(line.number + 1);
            }
        }
        return b.finish();
    };
    return ViewPlugin.fromClass(
        class {
            decorations: DecorationSet;
            constructor(view: EditorView) {
                this.decorations = build(view);
            }
            update(u: ViewUpdate) {
                if (u.docChanged || u.viewportChanged) this.decorations = build(u.view);
            }
        },
        {
            decorations: (v) => v.decorations,
            eventHandlers: {
                mousedown(e, view) {
                    if (!onBadge || !(e.ctrlKey || e.metaKey)) return false;
                    const el = (e.target as HTMLElement).closest(".sf-name");
                    if (!el) return false;
                    e.preventDefault();
                    const pos = view.posAtDOM(el);
                    onBadge("character", (el.textContent ?? "").toUpperCase(), view.state.doc.lineAt(pos).number - 1);
                    return true;
                },
            },
        },
    );
}

/* ---------- assembly ---------- */

export interface FountainExtensionOptions {
    completion: CompletionData;
    onBadge: BadgeHandler | null;
    autoContinue: () => boolean;
}

export function fountain(options: FountainExtensionOptions): Extension {
    return [
        parsedField,
        decorationsField(options.onBadge),
        actionNames(options.completion.characters, options.onBadge),
        fountainHover,
        continuationKeymap(options.autoContinue),
        autocompletion({
            override: [fountainCompletions(options.completion)],
            activateOnTyping: true,
            icons: false,
            closeOnBlur: true,
            maxRenderedOptions: 40,
            optionClass: () => "sf-ac-option",
            tooltipClass: () => "sf-ac",
        }),
        fountainTheme,
    ];
}
