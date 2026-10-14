// src/renderer/lib/fountain.ts
//
// The renderer runs the bundled Sceneform parser directly. It is pure
// JavaScript with no Node dependencies, so parsing on every keystroke never
// crosses the IPC boundary. This is the single source every view reads from:
// editor highlighting, outline, characters, locations, statistics, palette.

import * as parserModule from "../../backend/fountain-js/fountain-parser.js";
import type {
    FountainInlineRun,
    FountainLine,
    FountainLineType,
    FountainParseOptions,
    FountainParserDocument,
    FountainScene,
} from "../../backend/fountain-js/fountain-parser.js";

export type { FountainLine, FountainLineType, FountainParserDocument, FountainScene };

interface SceneformFountainModule {
    parse(content: string, options?: FountainParseOptions): FountainParserDocument;
    parseInline(content: string): FountainInlineRun[];
    serialize(document: FountainParserDocument): string;
}

// The parser is UMD. A production bundle wraps it as CommonJS (so it arrives as the
// default export); the dev server serves it as a plain script, where it attaches
// itself to `self`. Accept either.
const fromBundle = (parserModule as unknown as { default?: SceneformFountainModule }).default;
const SF: SceneformFountainModule =
    fromBundle && typeof fromBundle.parse === "function"
        ? fromBundle
        : (globalThis as unknown as { SceneformFountain: SceneformFountainModule }).SceneformFountain;

/** Sceneform's internal scene identity markers (never shown, never exported). */
export const ID_MARKERS: RegExp[] = [/^\s*\[\[(?:end)?id(?::[^\]]*)?\]\]\s*$/i, /^\s*@@(?:END)?ID\b/i];
const ID_CAPTURE = /^\s*(?:\[\[id:([^\]\s]+)\]\]|@@ID[:\s]+(\S+))\s*$/i;

export function parseFountain(text: string, caretLine?: number): FountainParserDocument {
    return SF.parse(text, { markers: ID_MARKERS, caretLine });
}

export function parseInline(text: string): FountainInlineRun[] {
    return SF.parseInline(text);
}

/* ---------- scenes ---------- */

export interface SceneMeta {
    location?: string;
    short_description?: string;
    omitted?: boolean;
    wip?: boolean;
    comments?: string[];
    inspo?: string[];
}

export interface SceneView {
    /** Stable key for meta.json: the scene's [[id:...]] marker when it has one, else its position. */
    id: string;
    index: number;
    num: string;
    heading: string;
    location: string;
    time: string;
    line: number;
    lastLine: number;
    color: string | null;
    synopsis: string;
    characters: string[];
    desc: string;
    wip: boolean;
    omitted: boolean;
    hasStableId: boolean;
}

/**
 * Scene identity. The old UI keyed meta by "scene-<index>" and rebuilt every
 * scene from scratch on each re-parse, which silently dropped WIP/omitted/
 * description edits and then autosaved the loss. Here the parsed structure and
 * the user's metadata stay separate: meta is only ever merged in, never
 * regenerated from the parse.
 */
function sceneIdFor(doc: FountainParserDocument, scene: FountainScene, position: number): { id: string; stable: boolean } {
    // A marker line directly above the heading (skipping blanks) carries the stable id.
    for (let i = scene.line - 1; i >= 0 && i >= scene.line - 3; i--) {
        const raw = doc.lines[i]?.raw ?? "";
        if (!raw.trim()) continue;
        const m = ID_CAPTURE.exec(raw);
        if (m) return { id: `id:${m[1] ?? m[2]}`, stable: true };
        break;
    }
    return { id: `scene-${position + 1}`, stable: false };
}

/**
 * Edits that give every scene without one a hidden `[[id:…]]` marker line directly above
 * its heading, so its metadata follows the scene instead of its position. Returns the
 * edits (positions in `text`) and, for each scene that got one, its old positional key
 * and the new id key, so the caller can move the metadata.
 */
export function idMarkerEdits(
    text: string,
    doc: FountainParserDocument,
    makeId: () => string = () => Math.random().toString(36).slice(2, 10),
): { edits: Array<{ from: number; to: number; insert: string }>; moved: Array<{ from: string; to: string }> } {
    const starts: number[] = [];
    let off = 0;
    for (const row of text.split("\n")) {
        starts.push(off);
        off += row.length + 1;
    }
    const edits: Array<{ from: number; to: number; insert: string }> = [];
    const moved: Array<{ from: string; to: string }> = [];
    doc.scenes.forEach((scene, position) => {
        if (sceneIdFor(doc, scene, position).stable) return;
        const id = makeId();
        edits.push({ from: starts[scene.line], to: starts[scene.line], insert: `[[id:${id}]]\n` });
        moved.push({ from: `scene-${position + 1}`, to: `id:${id}` });
    });
    return { edits, moved };
}

export function buildScenes(doc: FountainParserDocument, meta: Record<string, SceneMeta>): SceneView[] {
    return doc.scenes.map((scene, position) => {
        const { id, stable } = sceneIdFor(doc, scene, position);
        const m = meta[id] ?? {};
        return {
            id,
            index: scene.index,
            num: scene.number || String(position + 1),
            heading: scene.title || "SCENE",
            location: m.location || scene.location || "",
            time: scene.time || "",
            line: scene.line,
            lastLine: scene.lastLine,
            color: scene.color,
            synopsis: scene.synopsis.join(" "),
            characters: scene.characters,
            desc: m.short_description ?? "",
            wip: Boolean(m.wip),
            omitted: Boolean(m.omitted),
            hasStableId: stable,
        };
    });
}

/* ---------- statistics ---------- */

export interface CharacterStat {
    name: string;
    cues: number;
    words: number;
    scenes: number;
    firstLine: number;
}

export interface LocationStat {
    name: string;
    scenes: number;
    firstLine: number;
}

export interface ScriptStats {
    pages: number;
    scenes: number;
    words: number;
    dialogueWords: number;
    actionWords: number;
    dialoguePercent: number;
    runtimeMinutes: number;
    characters: CharacterStat[];
    locations: LocationStat[];
}

const countWords = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);

// Printed widths (characters per line in 12pt Courier) used for the page estimate,
// matching the margins in src/backend/pdf-export.ts.
const WRAP: Partial<Record<FountainLineType, number>> = {
    scene_heading: 61,
    action: 61,
    shot: 61,
    character: 38,
    parenthetical: 30,
    dialogue: 35,
    lyrics: 35,
    transition: 20,
    centered: 61,
};
export const LINES_PER_PAGE = 55;

/**
 * Statistics come from the parser, not from regexes. The old heuristic counted
 * any all-caps line as a character, so transitions and shouted action became
 * "characters", and pages were estimated from raw line counts.
 */
export function computeStats(
    doc: FountainParserDocument,
    scenes: SceneView[],
    options: { excludeOmitted?: boolean } = {},
): ScriptStats {
    const omittedRanges = options.excludeOmitted
        ? scenes.filter((s) => s.omitted).map((s) => [s.line, s.lastLine] as const)
        : [];
    const isOmitted = (line: number) => omittedRanges.some(([a, b]) => line >= a && line <= b);

    let words = 0;
    let dialogueWords = 0;
    let actionWords = 0;
    let printedLines = 0;
    let currentCue: string | null = null;
    let currentScene = -1;

    const chars = new Map<string, { cues: number; words: number; scenes: Set<number>; firstLine: number }>();
    const locs = new Map<string, { scenes: number; firstLine: number }>();

    for (const line of doc.lines) {
        const type = line.type ?? "blank";
        if (type === "blank") {
            if (currentCue === null) printedLines += 1;
            currentCue = null;
            continue;
        }
        if (type === "title_page" || type === "note" || type === "omit" || type === "marker" || type === "section" || type === "synopsis") {
            continue;
        }
        if (isOmitted(line.index)) continue;

        const text = (line.text ?? line.raw).trim();
        const n = countWords(text);
        const width = WRAP[type];
        if (width) printedLines += Math.max(1, Math.ceil(text.length / width));
        if (type === "page_break") printedLines = Math.ceil(printedLines / LINES_PER_PAGE) * LINES_PER_PAGE;

        if (type === "scene_heading") {
            currentScene += 1;
            const scene = scenes[currentScene];
            const name = (scene?.location || "").toUpperCase();
            if (name) {
                const entry = locs.get(name) ?? { scenes: 0, firstLine: line.index };
                entry.scenes += 1;
                locs.set(name, entry);
            }
            currentCue = null;
            words += n;
            continue;
        }

        if (type === "character") {
            const name = text.replace(/^@/, "").replace(/\s*\(.*?\)\s*/g, "").replace(/\s*\^$/, "").trim().toUpperCase();
            if (name) {
                const entry = chars.get(name) ?? { cues: 0, words: 0, scenes: new Set<number>(), firstLine: line.index };
                entry.cues += 1;
                entry.scenes.add(currentScene);
                chars.set(name, entry);
                currentCue = name;
            }
            continue;
        }

        words += n;
        if (type === "dialogue" || type === "lyrics") {
            dialogueWords += n;
            if (currentCue) {
                const entry = chars.get(currentCue);
                if (entry) entry.words += n;
            }
        } else if (type !== "parenthetical") {
            actionWords += n;
            currentCue = null;
        }
    }

    const content = Math.max(1, dialogueWords + actionWords);
    const pages = Math.max(1, Math.round((printedLines / LINES_PER_PAGE) * 10) / 10);
    const activeScenes = options.excludeOmitted ? scenes.filter((s) => !s.omitted) : scenes;

    return {
        pages: Math.max(1, Math.ceil(pages)),
        scenes: activeScenes.length,
        words,
        dialogueWords,
        actionWords,
        dialoguePercent: Math.round((dialogueWords / content) * 100),
        runtimeMinutes: Math.max(1, Math.round(pages)),
        characters: [...chars.entries()]
            .map(([name, c]) => ({ name, cues: c.cues, words: c.words, scenes: c.scenes.size, firstLine: c.firstLine }))
            .sort((a, b) => b.cues - a.cues || a.name.localeCompare(b.name)),
        locations: [...locs.entries()]
            .map(([name, l]) => ({ name, scenes: l.scenes, firstLine: l.firstLine }))
            .sort((a, b) => b.scenes - a.scenes || a.name.localeCompare(b.name)),
    };
}

/** Scene index (into SceneView[]) that contains a given line, or -1 before the first scene. */
/** Printed lines per scene (same estimate as computeStats), for page lengths in eighths. */
export function sceneLengths(doc: FountainParserDocument, scenes: SceneView[]): number[] {
    const out = scenes.map(() => 0);
    let k = -1;
    let inSpeech = false;
    for (const line of doc.lines) {
        while (k + 1 < scenes.length && line.index >= scenes[k + 1].line) k++;
        if (k < 0) continue;
        const type = line.type ?? "blank";
        if (type === "blank") {
            if (!inSpeech) out[k] += 1;
            inSpeech = false;
            continue;
        }
        if (type === "character") inSpeech = true;
        const width = WRAP[type];
        if (width) out[k] += Math.max(1, Math.ceil((line.text ?? line.raw).trim().length / width));
    }
    return out;
}

/** A length in printed lines as pages and eighths, the way production boards write it ("1 3/8"). */
export function formatEighths(lines: number): string {
    const eighths = Math.max(1, Math.round((lines / LINES_PER_PAGE) * 8));
    const whole = Math.floor(eighths / 8);
    const rest = eighths % 8;
    return [whole ? String(whole) : "", rest ? `${rest}/8` : ""].filter(Boolean).join(" ");
}

export function sceneIndexAtLine(scenes: SceneView[], line: number): number {
    let lo = 0;
    let hi = scenes.length - 1;
    let found = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (scenes[mid].line <= line) {
            found = mid;
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }
    return found;
}

export const LINE_TYPE_LABELS: Record<FountainLineType, string> = {
    blank: "Blank",
    title_page: "Title Page",
    scene_heading: "Scene Heading",
    action: "Action",
    shot: "Shot",
    character: "Character",
    parenthetical: "Parenthetical",
    dialogue: "Dialogue",
    lyrics: "Lyrics",
    transition: "Transition",
    centered: "Centered",
    section: "Section",
    synopsis: "Synopsis",
    page_break: "Page Break",
    special_page: "Special Page",
    note: "Note",
    omit: "Boneyard",
    marker: "Scene ID",
};
