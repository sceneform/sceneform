// src/renderer/lib/project.ts
//
// The open project's document model on the renderer side: tabs, documents,
// and cross-screenplay aggregation for the character / location pages.

import type { ProjectSettings, SfpDocument, SfpDocumentKind } from "../../shared/bridge";
import { computeStats, type FountainParserDocument, type ScriptStats, type SceneView } from "./fountain";

/* ---------- tabs ---------- */

export type Tab =
    | { kind: "script"; docId: string }
    | { kind: "note"; docId: string }
    | { kind: "canvas"; docId: string }
    | { kind: "card"; docId: string; cardId: string }
    | { kind: "character"; name: string }
    | { kind: "location"; name: string }
    | { kind: "scene"; docId: string; sceneId: string }
    | { kind: "stats" }
    | { kind: "project-info" }
    | { kind: "project-settings" };

export function tabKey(t: Tab): string {
    switch (t.kind) {
        case "script":
        case "note":
        case "canvas":
            return `${t.kind}:${t.docId}`;
        case "card":
            return `card:${t.docId}:${t.cardId}`;
        case "character":
        case "location":
            return `${t.kind}:${t.name}`;
        case "scene":
            return `scene:${t.docId}:${t.sceneId}`;
        default:
            return t.kind;
    }
}

/** Does this tab belong to (or point into) a document? Used to close tabs when a document is deleted. */
export function tabDocId(t: Tab): string | null {
    return "docId" in t ? t.docId : null;
}

/* ---------- documents ---------- */

export function docsOfKind(documents: SfpDocument[], kind: SfpDocumentKind): SfpDocument[] {
    return documents.filter((d) => d.kind === kind).sort((a, b) => a.order - b.order);
}

export function newDocId(kind: SfpDocumentKind): string {
    const rand = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
    return `${kind}-${rand}`;
}

/** "Episode 3", "Notes 2"… the first free numbered name for a new document. */
export function nextDocTitle(documents: SfpDocument[], kind: SfpDocumentKind, base: string): string {
    const taken = new Set(documents.filter((d) => d.kind === kind).map((d) => d.title.toLowerCase()));
    if (!taken.has(base.toLowerCase())) return base;
    for (let n = 2; ; n++) {
        const name = `${base} ${n}`;
        if (!taken.has(name.toLowerCase())) return name;
    }
}

/* ---------- markdown helpers ---------- */

const IMAGE_RE = /!\[[^\]]*\]\((assets\/[^)\s]+)\)/;

/** First embedded project picture in a Markdown text, or null. */
export function firstImage(markdown: string | undefined): string | null {
    const m = IMAGE_RE.exec(markdown ?? "");
    return m ? m[1] : null;
}

/** Markdown with image embeds removed, for short text previews on canvas tiles. */
export function stripImages(markdown: string | undefined): string {
    return (markdown ?? "").replace(/!\[[^\]]*\]\([^)]*\)\s*/g, "").trim();
}

/* ---------- cross-screenplay aggregation ---------- */

export interface ParsedScript {
    doc: SfpDocument;
    parsed: FountainParserDocument;
    scenes: SceneView[];
    stats: ScriptStats;
}

export interface SceneRef {
    docId: string;
    docTitle: string;
    scene: SceneView;
}

export interface CharacterReport {
    name: string;
    cues: number;
    words: number;
    scenes: SceneRef[];
    first: { docId: string; docTitle: string; line: number; sceneHeading: string | null } | null;
}

export function normalizeCue(raw: string): string {
    return raw.replace(/^@/, "").replace(/\s*\(.*?\)\s*/g, "").replace(/\s*\^$/, "").trim().toUpperCase();
}

export function characterReport(scripts: ParsedScript[], name: string): CharacterReport {
    const key = name.toUpperCase();
    const report: CharacterReport = { name: key, cues: 0, words: 0, scenes: [], first: null };
    for (const s of scripts) {
        const stat = s.stats.characters.find((c) => c.name === key);
        if (!stat) continue;
        report.cues += stat.cues;
        report.words += stat.words;
        for (const scene of s.scenes) {
            if (scene.characters.some((c) => normalizeCue(c) === key)) report.scenes.push({ docId: s.doc.id, docTitle: s.doc.title, scene });
        }
        if (!report.first) {
            const sceneAt = [...s.scenes].reverse().find((sc) => sc.line <= stat.firstLine) ?? null;
            report.first = { docId: s.doc.id, docTitle: s.doc.title, line: stat.firstLine, sceneHeading: sceneAt?.heading ?? null };
        }
    }
    return report;
}

export function locationScenes(scripts: ParsedScript[], name: string): SceneRef[] {
    const key = name.toUpperCase();
    const out: SceneRef[] = [];
    for (const s of scripts) {
        for (const scene of s.scenes) if (scene.location.toUpperCase() === key) out.push({ docId: s.doc.id, docTitle: s.doc.title, scene });
    }
    return out;
}

/** All characters / locations across every screenplay, for lists that span the project. */
export function allCharacterNames(scripts: ParsedScript[]): string[] {
    const set = new Set<string>();
    for (const s of scripts) for (const c of s.stats.characters) set.add(c.name);
    return [...set].sort();
}

/** Statistics over several screenplays: totals add up, characters and locations merge by name. */
export function mergeStats(list: ScriptStats[]): ScriptStats {
    const chars = new Map<string, { cues: number; words: number; scenes: number; firstLine: number }>();
    const locs = new Map<string, { scenes: number; firstLine: number }>();
    let pages = 0, scenes = 0, words = 0, dialogueWords = 0, actionWords = 0, runtime = 0;
    for (const s of list) {
        pages += s.pages;
        scenes += s.scenes;
        words += s.words;
        dialogueWords += s.dialogueWords;
        actionWords += s.actionWords;
        runtime += s.runtimeMinutes;
        for (const c of s.characters) {
            const e = chars.get(c.name) ?? { cues: 0, words: 0, scenes: 0, firstLine: c.firstLine };
            e.cues += c.cues;
            e.words += c.words;
            e.scenes += c.scenes;
            chars.set(c.name, e);
        }
        for (const l of s.locations) {
            const e = locs.get(l.name) ?? { scenes: 0, firstLine: l.firstLine };
            e.scenes += l.scenes;
            locs.set(l.name, e);
        }
    }
    const content = Math.max(1, dialogueWords + actionWords);
    return {
        pages,
        scenes,
        words,
        dialogueWords,
        actionWords,
        dialoguePercent: Math.round((dialogueWords / content) * 100),
        runtimeMinutes: runtime,
        characters: [...chars.entries()].map(([name, c]) => ({ name, ...c })).sort((a, b) => b.cues - a.cues || a.name.localeCompare(b.name)),
        locations: [...locs.entries()].map(([name, l]) => ({ name, ...l })).sort((a, b) => b.scenes - a.scenes || a.name.localeCompare(b.name)),
    };
}

export function statsFor(parsed: FountainParserDocument, scenes: SceneView[], excludeOmitted = false): ScriptStats {
    return computeStats(parsed, scenes, { excludeOmitted });
}

/* ---------- accent color ---------- */

/** Older archives store a CSS variable as the project color; the picker needs a hex value. */
export function colorToHex(color: string | undefined): string {
    if (color && /^#[0-9a-f]{6}$/i.test(color)) return color;
    const vars: Record<string, string> = {
        "var(--c-accent)": "#96f550",
        "var(--c-blue-bright)": "#6fa8dc",
        "var(--c-crimson-bright)": "#e8546f",
        "var(--c-dialogue)": "#e8c468",
    };
    return (color && vars[color]) || "#96f550";
}

/* ---------- per-project editor settings ---------- */

/**
 * Editor settings a project can carry for itself, stored next to the backend's keys in
 * project-settings.json (the archive keeps unknown keys). Absent means "use the app setting".
 */
export interface ProjectEditorSettings {
    /** Script inspections for this project; "inherit" follows Settings. */
    inspections?: "inherit" | "on" | "off";
    /** Target length in pages for the act-length check; undefined follows Settings, 0 is off. */
    targetPages?: number;
    /** Live templates for this project, on top of (and winning over) the user's own. */
    liveTemplates?: Array<{ abbr: string; text: string }>;
    /** Words the spellchecker accepts in this project only (names, invented terms). */
    words?: string[];
}

export type ProjectSettingsX = ProjectSettings & ProjectEditorSettings;

/** What the editor uses: the project's value where it has one, else the app setting. */
export function effectiveEditorSettings(
    project: ProjectEditorSettings,
    app: { inspections?: boolean; targetPages?: number; liveTemplates?: Array<{ abbr: string; text: string }>; userWords?: string[] },
) {
    return {
        inspections: project.inspections === "on" ? true : project.inspections === "off" ? false : app.inspections !== false,
        targetPages: typeof project.targetPages === "number" ? project.targetPages : app.targetPages ?? 0,
        liveTemplates: [...(project.liveTemplates ?? []), ...(app.liveTemplates ?? [])],
        words: [...(app.userWords ?? []), ...(project.words ?? [])],
    };
}
