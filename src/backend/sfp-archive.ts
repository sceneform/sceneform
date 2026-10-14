// sfp-archive.ts
//
// The .sfp project container: a ZIP archive.
//
// Format v2 (current) layout:
//
//   manifest.json                 { format: "sfp", version: 2, createdAt, updatedAt }
//   project.json                  ProjectSummary (title, author, totals, accent color…)
//   documents.json                [{ id, kind, title, order, file }]  the document index
//   scripts/<id>.fountain         one per screenplay (episode)
//   notes/<id>.md                 one per notes document (Markdown)
//   canvases/<id>.json            { cards: CanvasCard[] } one per canvas
//   entities.json                 { characters, locations, scenes }  see types/entities.ts
//   title-page.json               project title-page defaults { "<lowercase key>": value }
//   project-settings.json         ProjectSettings
//   authorship.json               SfpAuthorship: who last wrote each script line (blame view), optional
//   assets/<name>                 binary files (pictures) referenced from Markdown/entities
//
//   script.fountain               legacy copy of the first screenplay  } so builds that only
//   meta.json                     legacy { scenes, cards } of the first } know v1 still open
//   notes/scene-notes.md          legacy copy of the first notes doc    } something useful
//
// Format v1 (script.fountain + meta.json + notes/scene-notes.md) is still read:
// it opens as one screenplay "Screenplay", one note "Notes" and one canvas "Canvas".
//
// Assets are carried over on every write and are never deleted automatically,
// even when nothing references them any more.

import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import type { CanvasCard } from "./types/canvas.js";
import type { ProjectSummary } from "./types/project.js";
import type { SceneItem } from "./types/screenplay.js";
import type { SceneEntity, SfpEntities } from "./types/entities.js";
import { buildTitlePageTemplate, type TitlePageDefaults } from "./title-page.js";
import { DEFAULT_PROJECT_SETTINGS, type ProjectSettings } from "./project-defaults.js";

export { DEFAULT_PROJECT_SETTINGS } from "./project-defaults.js";
export type { ProjectSettings, ProjectType } from "./project-defaults.js";

export type { SfpEntities } from "./types/entities.js";
export type { TitlePageDefaults } from "./title-page.js";

/* Data models representing the internal structured contents of an .sfp zip archive container. */
export interface SfpManifest {
    format: "sfp";
    version: number;
    createdAt: string;
    updatedAt: string;
}

/** v1 meta.json. Still written as a legacy copy of the first screenplay/canvas. */
export interface SfpMetaJson {
    scenes: Record<string, SceneEntity>;
    cards: CanvasCard[];
}

export type SfpDocumentKind = "script" | "note" | "canvas";

export interface SfpDocument {
    /** [A-Za-z0-9_-]+, unique inside the project. Also the file stem inside the archive. */
    id: string;
    kind: SfpDocumentKind;
    title: string;
    /** Sort order inside its kind (explorer order). */
    order: number;
    /** Fountain text for scripts, Markdown for notes. */
    content?: string;
    /** Cards for canvases. */
    cards?: CanvasCard[];
}

/**
 * Blame data per screenplay document id: `lines[i]` is [index into `authors`,
 * ISO time] for line i of that script, or null when unknown (written before
 * authorship tracking, or edited outside Sceneform).
 */
export interface SfpDocAuthorship {
    authors: string[];
    lines: Array<[number, string] | null>;
}
export type SfpAuthorship = Record<string, SfpDocAuthorship>;

export interface SfpProjectData {
    manifest: SfpManifest;
    project: ProjectSummary;
    documents: SfpDocument[];
    entities: SfpEntities;
    titlePageDefaults: TitlePageDefaults;
    projectSettings: ProjectSettings;
    /** Per-line authorship of screenplays (format v2, optional file). */
    authorship?: SfpAuthorship;
    /** Asset paths present in the archive ("assets/<name>"). Read-only: add assets with addAssetToArchive. */
    assets: string[];
}

export const SFP_FORMAT = "sfp";
export const SFP_VERSION = 2;

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function isValidDocumentId(id: unknown): id is string {
    return typeof id === "string" && ID_RE.test(id);
}

export function newDocumentId(kind: SfpDocumentKind): string {
    return `${kind}-${crypto.randomUUID().slice(0, 8)}`;
}

export function emptyEntities(): SfpEntities {
    return { characters: {}, locations: {}, scenes: {} };
}

/* Strips internal Sceneform identity markers from a script string to produce a clean, portable Fountain file. */
export function extractCleanFountain(scriptWithIds: string): string {
    return scriptWithIds
        .replace(/^\s*\[\[(?:END)?ID:[^\]]*\]\]\s*\r?\n?/gim, "")
        .replace(/^\s*@@(?:END)?ID\b[^\r\n]*\r?\n?/gim, "")
        .trimStart();
}

/** Documents of one kind, in explorer order. */
export function documentsOfKind(documents: SfpDocument[], kind: SfpDocumentKind): SfpDocument[] {
    return documents.filter((d) => d.kind === kind).sort((a, b) => a.order - b.order);
}

/* Creates a fresh in-memory default project archive payload when initializing a new project. */
export function createDefaultSfpPayload(
    name: string,
    author: string,
    logline: string,
    script?: string,
): SfpProjectData {
    const timestamp = new Date().toISOString();
    const title = name.trim() || "Untitled Screenplay";
    const titlePageDefaults: TitlePageDefaults = { title, author: author.trim() || "Author" };
    const initialScript = script ?? buildTitlePageTemplate({ title, author, defaults: titlePageDefaults });

    return {
        manifest: {
            format: SFP_FORMAT,
            version: SFP_VERSION,
            createdAt: timestamp,
            updatedAt: timestamp,
        },
        project: {
            id: crypto.randomUUID(),
            title,
            author: author.trim() || "Author",
            logline: logline.trim() || "",
            updated: timestamp,
            pages: 1,
            timeSpent: "0m",
            notes: "",
            scenes: 0,
            color: "#96f550",
            screenplays: 1,
        },
        documents: [
            { id: "script-1", kind: "script", title: "Screenplay", order: 0, content: initialScript },
            { id: "note-1", kind: "note", title: "Notes", order: 0, content: `# ${title}\n` },
            { id: "canvas-1", kind: "canvas", title: "Canvas", order: 0, cards: [] },
        ],
        entities: emptyEntities(),
        titlePageDefaults,
        projectSettings: { ...DEFAULT_PROJECT_SETTINGS },
        assets: [],
    };
}

/* ---------- per-file write lock ---------- */

// Saves and asset imports both rewrite the archive. They are serialized per file
// so an asset added while a save is in flight can never be lost.
const locks = new Map<string, Promise<unknown>>();

export function withArchiveLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
    const key = path.resolve(filePath);
    const prev = locks.get(key) ?? Promise.resolve();
    const run = prev.catch(() => undefined).then(fn);
    const tail = run.catch(() => undefined);
    locks.set(key, tail);
    void tail.then(() => {
        if (locks.get(key) === tail) locks.delete(key);
    });
    return run;
}

/* ---------- reading ---------- */

async function readJson<T>(zip: JSZip, name: string): Promise<T | null> {
    const f = zip.file(name);
    if (!f) return null;
    try {
        return JSON.parse(await f.async("string")) as T;
    } catch {
        return null;
    }
}

async function readText(zip: JSZip, name: string): Promise<string | null> {
    const f = zip.file(name);
    return f ? f.async("string") : null;
}

function listAssets(zip: JSZip): string[] {
    const assets: string[] = [];
    zip.forEach((relativePath, file) => {
        if (!file.dir && relativePath.startsWith("assets/")) assets.push(relativePath);
    });
    return assets.sort();
}

interface DocumentIndexEntry {
    id: string;
    kind: SfpDocumentKind;
    title: string;
    order: number;
}

function fileFor(doc: { id: string; kind: SfpDocumentKind }): string {
    if (doc.kind === "script") return `scripts/${doc.id}.fountain`;
    if (doc.kind === "note") return `notes/${doc.id}.md`;
    return `canvases/${doc.id}.json`;
}

function normalizeEntities(raw: Partial<SfpEntities> | null): SfpEntities {
    return {
        characters: raw?.characters && typeof raw.characters === "object" ? raw.characters : {},
        locations: raw?.locations && typeof raw.locations === "object" ? raw.locations : {},
        scenes: raw?.scenes && typeof raw.scenes === "object" ? raw.scenes : {},
    };
}

/* Reads and unpacks an .sfp container archive from disk into structured project data. */
export async function readProjectArchive(filePath: string): Promise<SfpProjectData> {
    const buffer = await fs.readFile(filePath);
    const zip = await JSZip.loadAsync(buffer);
    return readProjectZip(zip, filePath);
}

export async function readProjectZip(zip: JSZip, filePath: string): Promise<SfpProjectData> {
    const now = new Date().toISOString();
    const manifest: SfpManifest = (await readJson<SfpManifest>(zip, "manifest.json")) ?? {
        format: SFP_FORMAT,
        version: 1,
        createdAt: now,
        updatedAt: now,
    };

    const stem = path.basename(filePath, ".sfp");
    const project: ProjectSummary = (await readJson<ProjectSummary>(zip, "project.json")) ?? {
        id: stem,
        title: stem,
        author: "Unknown",
        logline: "",
        updated: "Recently",
        pages: 1,
        timeSpent: "0m",
        notes: "",
        scenes: 1,
        color: "var(--c-blue-bright)",
    };

    const index = await readJson<DocumentIndexEntry[]>(zip, "documents.json");
    const assets = listAssets(zip);

    if (manifest.version >= 2 && Array.isArray(index)) {
        const documents: SfpDocument[] = [];
        for (const entry of index) {
            if (!entry || !isValidDocumentId(entry.id)) continue;
            if (entry.kind !== "script" && entry.kind !== "note" && entry.kind !== "canvas") continue;
            const doc: SfpDocument = {
                id: entry.id,
                kind: entry.kind,
                title: typeof entry.title === "string" && entry.title ? entry.title : entry.kind,
                order: Number.isFinite(entry.order) ? entry.order : documents.length,
            };
            if (entry.kind === "canvas") {
                const c = await readJson<{ cards?: CanvasCard[] }>(zip, fileFor(entry));
                doc.cards = Array.isArray(c?.cards) ? c!.cards : [];
            } else {
                doc.content = (await readText(zip, fileFor(entry))) ?? "";
            }
            documents.push(doc);
        }
        if (!documents.some((d) => d.kind === "script")) {
            documents.push({ id: "script-1", kind: "script", title: "Screenplay", order: 0, content: (await readText(zip, "script.fountain")) ?? "" });
        }
        return {
            manifest,
            project,
            documents,
            entities: normalizeEntities(await readJson<Partial<SfpEntities>>(zip, "entities.json")),
            titlePageDefaults: (await readJson<TitlePageDefaults>(zip, "title-page.json")) ?? {},
            projectSettings: {
                ...DEFAULT_PROJECT_SETTINGS,
                ...((await readJson<Partial<ProjectSettings>>(zip, "project-settings.json")) ?? {}),
            },
            authorship: (await readJson<SfpAuthorship>(zip, "authorship.json")) ?? {},
            assets,
        };
    }

    /* ---- v1 migration (read-only until the next save writes v2) ---- */
    const script = (await readText(zip, "script.fountain")) ?? `Title: ${project.title}\nAuthor: ${project.author}\n\n`;
    const meta: Partial<SfpMetaJson> = (await readJson<Partial<SfpMetaJson>>(zip, "meta.json")) ?? {};
    const notes = (await readText(zip, "notes/scene-notes.md")) ?? `# ${project.title}\n\nCompanion document.`;
    const entities = emptyEntities();
    if (meta.scenes && typeof meta.scenes === "object") entities.scenes["script-1"] = meta.scenes;

    return {
        manifest,
        project: { ...project, screenplays: 1 },
        documents: [
            { id: "script-1", kind: "script", title: "Screenplay", order: 0, content: script },
            { id: "note-1", kind: "note", title: "Notes", order: 0, content: notes },
            { id: "canvas-1", kind: "canvas", title: "Canvas", order: 0, cards: Array.isArray(meta.cards) ? meta.cards : [] },
        ],
        entities,
        titlePageDefaults: {},
        projectSettings: { ...DEFAULT_PROJECT_SETTINGS },
        assets,
    };
}

/* ---------- writing ---------- */

async function atomicWrite(filePath: string, buffer: Buffer, keepBackup: boolean): Promise<void> {
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    if (keepBackup) {
        try {
            await fs.copyFile(filePath, `${filePath}.bak`);
        } catch {
            // Ignored if file does not exist yet
        }
    }
    await fs.writeFile(tempPath, buffer);
    await fs.rename(tempPath, filePath);
}

async function loadExistingZip(filePath: string): Promise<JSZip | null> {
    try {
        return await JSZip.loadAsync(await fs.readFile(filePath));
    } catch {
        return null;
    }
}

/** Copies every assets/ entry of `from` into `to`, byte for byte. */
async function carryAssets(from: JSZip | null, to: JSZip): Promise<void> {
    if (!from) return;
    const names = listAssets(from);
    for (const name of names) {
        const bytes = await from.file(name)!.async("uint8array");
        to.file(name, bytes, { binary: true });
    }
}

/* Bundles and writes a complete .sfp zip archive to disk atomically with a backup snapshot. */
export function writeProjectArchive(
    filePath: string,
    data: Partial<SfpProjectData>,
    keepBackup = true,
): Promise<void> {
    return withArchiveLock(filePath, async () => {
        const existingZip = await loadExistingZip(filePath);
        let currentData: SfpProjectData;
        try {
            currentData = existingZip ? await readProjectZip(existingZip, filePath) : createDefaultSfpPayload("Untitled", "Author", "");
        } catch {
            currentData = createDefaultSfpPayload("Untitled", "Author", "");
        }

        const documents = (data.documents ?? currentData.documents).filter((d) => isValidDocumentId(d.id));
        const merged: SfpProjectData = {
            manifest: {
                ...currentData.manifest,
                ...(data.manifest || {}),
                format: SFP_FORMAT,
                version: SFP_VERSION,
                updatedAt: new Date().toISOString(),
            },
            project: { ...currentData.project, ...(data.project || {}) },
            documents,
            entities: normalizeEntities(data.entities ?? currentData.entities),
            titlePageDefaults: data.titlePageDefaults ?? currentData.titlePageDefaults,
            projectSettings: { ...DEFAULT_PROJECT_SETTINGS, ...currentData.projectSettings, ...(data.projectSettings || {}) },
            authorship: data.authorship ?? currentData.authorship,
            assets: currentData.assets,
        };

        const zip = new JSZip();
        zip.file("manifest.json", JSON.stringify(merged.manifest, null, 2));
        zip.file("project.json", JSON.stringify(merged.project, null, 2));

        const index: Array<DocumentIndexEntry & { file: string }> = [];
        for (const doc of merged.documents) {
            const file = fileFor(doc);
            index.push({ id: doc.id, kind: doc.kind, title: doc.title, order: doc.order, file });
            if (doc.kind === "canvas") zip.file(file, JSON.stringify({ cards: doc.cards ?? [] }, null, 2));
            else zip.file(file, doc.content ?? "");
        }
        zip.file("documents.json", JSON.stringify(index, null, 2));
        zip.file("entities.json", JSON.stringify(merged.entities, null, 2));
        zip.file("title-page.json", JSON.stringify(merged.titlePageDefaults, null, 2));
        zip.file("project-settings.json", JSON.stringify(merged.projectSettings, null, 2));
        if (merged.authorship) {
            // Drop entries for documents that no longer exist.
            const live = new Set(documents.map((d) => d.id));
            const kept = Object.fromEntries(Object.entries(merged.authorship).filter(([id]) => live.has(id)));
            if (Object.keys(kept).length) zip.file("authorship.json", JSON.stringify(kept));
        }

        // Legacy copies for builds that only read v1.
        const firstScript = documentsOfKind(merged.documents, "script")[0];
        const firstNote = documentsOfKind(merged.documents, "note")[0];
        const firstCanvas = documentsOfKind(merged.documents, "canvas")[0];
        zip.file("script.fountain", firstScript?.content ?? "");
        const legacyMeta: SfpMetaJson = {
            scenes: (firstScript && merged.entities.scenes[firstScript.id]) || {},
            cards: firstCanvas?.cards ?? [],
        };
        zip.file("meta.json", JSON.stringify(legacyMeta, null, 2));
        zip.file("notes/scene-notes.md", firstNote?.content ?? "");

        await carryAssets(existingZip, zip);

        const archiveBuffer = await zip.generateAsync({
            type: "nodebuffer",
            compression: "DEFLATE",
            compressionOptions: { level: 6 },
        });
        await atomicWrite(filePath, archiveBuffer, keepBackup);
    });
}

/* ---------- assets ---------- */

export const ASSET_TYPES: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    avif: "image/avif",
    bmp: "image/bmp",
};

export const MAX_ASSET_BYTES = 25 * 1024 * 1024;

/** Validates an asset path from the renderer: "assets/<name>" with no traversal. */
export function isSafeAssetPath(asset: unknown): asset is string {
    return typeof asset === "string" && /^assets\/[A-Za-z0-9._-]{1,160}$/.test(asset) && !asset.includes("..");
}

export function assetMime(asset: string): string {
    const ext = asset.split(".").pop()?.toLowerCase() ?? "";
    return ASSET_TYPES[ext] ?? "application/octet-stream";
}

/** Writes a picture into the archive's assets/ and returns its path ("assets/<name>"). */
export function addAssetToArchive(filePath: string, fileName: string, bytes: Uint8Array): Promise<string> {
    return withArchiveLock(filePath, async () => {
        const ext = (fileName.split(".").pop() ?? "").toLowerCase();
        if (!ASSET_TYPES[ext]) throw new Error(`Unsupported picture type ".${ext}". Use PNG, JPEG, GIF, WebP, AVIF or BMP.`);
        if (bytes.byteLength === 0) throw new Error("That picture is empty.");
        if (bytes.byteLength > MAX_ASSET_BYTES) throw new Error("That picture is larger than 25 MB.");
        const zip = await loadExistingZip(filePath);
        if (!zip) throw new Error("The project file could not be read.");
        const stem =
            fileName
                .replace(/\.[^.]*$/, "")
                .toLowerCase()
                .replace(/[^a-z0-9_-]+/g, "-")
                .replace(/^-+|-+$/g, "")
                .slice(0, 48) || "picture";
        let name = "";
        do {
            name = `assets/${stem}-${crypto.randomUUID().slice(0, 8)}.${ext === "jpeg" ? "jpg" : ext}`;
        } while (zip.file(name));
        zip.file(name, bytes, { binary: true });
        const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
        await atomicWrite(filePath, buffer, false);
        return name;
    });
}

/** Reads one asset's bytes, or null when the archive has no such entry. */
export async function readAssetFromArchive(filePath: string, asset: string): Promise<Uint8Array | null> {
    if (!isSafeAssetPath(asset)) return null;
    const zip = await loadExistingZip(filePath);
    const f = zip?.file(asset);
    return f ? f.async("uint8array") : null;
}

/* Synchronizes scene outlines and editor data with the persistent scene metadata (v1 helper). */
export function syncScenesToMeta(scenes: SceneItem[], existingMeta: SfpMetaJson): SfpMetaJson {
    const updatedScenes = { ...(existingMeta.scenes || {}) };

    for (const scene of scenes) {
        updatedScenes[scene.id] = {
            ...(updatedScenes[scene.id] || {}),
            location: scene.location,
            short_description: scene.desc,
            omitted: scene.omitted,
            wip: scene.wip,
        };
    }

    return {
        ...existingMeta,
        scenes: updatedScenes,
    };
}
