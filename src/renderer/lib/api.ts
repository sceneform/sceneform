// src/renderer/lib/api.ts
//
// The renderer's only door to the main process. Inside Electron this is the
// preload bridge. In a plain browser (vite dev without Electron) a clearly
// labelled in-memory mock stands in so the UI can be worked on; it never
// touches disk and says so in the UI.

import { buildTitlePageTemplate } from "../../backend/title-page";
import { DEFAULT_PROJECT_SETTINGS } from "../../backend/project-defaults";
import {
    DEFAULT_SETTINGS,
    type AppSettings,
    type ProjectListing,
    type SceneformAPI,
    type SfpProjectData,
} from "../../shared/bridge";

declare global {
    interface Window {
        sceneform?: SceneformAPI;
    }
}

export const isMockBridge = typeof window !== "undefined" && !window.sceneform;

const SAMPLE = `Title: THE LAST FERRY
Credit: written by
Author: Axelle
Draft date: 11 October 2026

# ACT ONE

[[id:s1a2b3]]
INT. FERRY - MAIN DECK - NIGHT [[blue]]
= Maeri waits for someone who isn't coming.

Rain streaks the windows sideways. MAERI (30s) holds a paper cup she stopped drinking an hour ago.

MAERI
(to herself)
Nine years.

A DECKHAND passes, looks at her, keeps walking.

DECKHAND
Last crossing, miss.

MAERI
I know.

CUT TO:

[[id:c4d5e6]]
EXT. HARBOUR - CONTINUOUS

The ferry pulls away. Nobody on the pier waves back.

> THE END <
`;

function mockApi(): SceneformAPI {
    const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value });
    const now = () => new Date().toISOString();
    const folder = "/mock/Sceneform Projects";
    const store = new Map<string, SfpProjectData>();
    // Pictures live in memory as data URLs, keyed by project path then asset path.
    const assets = new Map<string, Map<string, string>>();
    const make = (title: string, script: string): SfpProjectData => ({
        manifest: { format: "sfp", version: 2, createdAt: now(), updatedAt: now() },
        project: {
            id: title,
            title,
            author: "Axelle",
            logline: "A woman waits on the last ferry for someone who promised to come back.",
            updated: now(),
            pages: 1,
            timeSpent: "1h 12m",
            notes: "",
            scenes: 2,
            color: "#96f550",
            screenplays: 1,
        },
        documents: [
            { id: "script-1", kind: "script", title: "Screenplay", order: 0, content: script },
            { id: "note-1", kind: "note", title: "Notes", order: 0, content: `# ${title}\n\nCompanion notes.` },
            { id: "canvas-1", kind: "canvas", title: "Canvas", order: 0, cards: [] },
        ],
        entities: { characters: {}, locations: {}, scenes: { "script-1": { "id:s1a2b3": { wip: true } } } },
        titlePageDefaults: { author: "Axelle", contact: "axelle@example.com" },
        projectSettings: { ...DEFAULT_PROJECT_SETTINGS },
        assets: [],
    });
    const addAsset = (path: string, fileName: string, dataUrl: string) => {
        const ext = (fileName.split(".").pop() || "png").toLowerCase();
        const name = `assets/${fileName.replace(/\.[^.]*$/, "").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").slice(0, 40) || "picture"}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
        if (!assets.has(path)) assets.set(path, new Map());
        assets.get(path)!.set(name, dataUrl);
        store.get(path)?.assets.push(name);
        return name;
    };
    const toDataUrl = (bytes: Uint8Array, fileName: string) => {
        const ext = (fileName.split(".").pop() || "png").toLowerCase();
        const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext}`;
        let bin = "";
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return `data:${mime};base64,${btoa(bin)}`;
    };
    store.set(`${folder}/The Last Ferry.sfp`, make("The Last Ferry", SAMPLE));
    let profileFolder: string | null = folder;

    const profileState = () => ({
        projectFolder: profileFolder ?? "",
        existingProfile: true,
        lock: {
            format: "sceneform-profile-lock" as const,
            version: "mock",
            profileId: "mock",
            createdAt: now(),
            updatedAt: now(),
            projects: [],
        },
        warnings: [],
    });

    return {
        fountain: { open: () => ok(null), saveFdx: () => ok({ path: "/mock/export.fdx" }) },
        profile: {
            open: () =>
                profileFolder
                    ? ok(profileState())
                    : Promise.resolve({ ok: false as const, error: { code: "no-folder" as const, message: "No folder yet." } }),
            defaultFolder: () => ok(folder),
            pickFolder: () => ok({ path: folder }),
            setFolder: (f) => {
                profileFolder = f;
                return ok(profileState());
            },
        },
        project: {
            list: () => {
                const list: ProjectListing[] = [...store.entries()].map(([path, d]) => ({ path, summary: d.project }));
                return ok(list);
            },
            recent: () => {
                const paths = JSON.parse(localStorage.getItem("sf-recent-projects") || "[]") as string[];
                const list = paths.flatMap((path) => {
                    const data = store.get(path);
                    return data ? [{ path, summary: data.project }] : [];
                });
                return ok(list);
            },
            open: (path) => {
                const d = store.get(path);
                if (!d) return Promise.resolve({ ok: false as const, error: { code: "not-found" as const, message: "Not found" } });
                const recent = JSON.parse(localStorage.getItem("sf-recent-projects") || "[]") as string[];
                localStorage.setItem("sf-recent-projects", JSON.stringify([path, ...recent.filter((p) => p !== path)].slice(0, 12)));
                return ok({ path, data: structuredClone(d) });
            },
            save: (path, data) => {
                const cur = store.get(path);
                if (cur) store.set(path, structuredClone({ ...cur, ...data, assets: cur.assets, project: { ...cur.project, ...(data.project ?? {}) } }));
                return ok({ path, savedAt: now() });
            },
            create: (f, name, author, logline, script) => {
                const path = `${f}/${name}.sfp`;
                const d = make(name, script || buildTitlePageTemplate({ title: name, author, defaults: { title: name, author: author || "Author" } }));
                d.project.author = author || "Author";
                d.project.logline = logline;
                d.project.timeSpent = "0m";
                d.entities.scenes = {};
                d.titlePageDefaults = { title: name, author: author || "Author" };
                store.set(path, d);
                const recent = JSON.parse(localStorage.getItem("sf-recent-projects") || "[]") as string[];
                localStorage.setItem("sf-recent-projects", JSON.stringify([path, ...recent.filter((p) => p !== path)].slice(0, 12)));
                return ok({ path, data: structuredClone(d) });
            },
            trash: (path) => {
                store.delete(path);
                return ok(true);
            },
            rename: (path, title) => {
                const d = store.get(path)!;
                d.project.title = title;
                return ok(d.project);
            },
            exportPdf: () => ok({ path: "/mock/export.pdf" }),
            exportFountain: () => ok({ path: "/mock/export.fountain" }),
            browse: () => ok({ path: null }),
            reveal: () => Promise.resolve(),
            backup: () => ok(null),
            readCopy: () => ok(null),
            restoreBackup: () => Promise.resolve({ ok: false as const, error: { code: "not-found" as const, message: "The browser preview keeps no backups." } }),
        },
        settings: {
            load: async () => ({ ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem("sf-settings") || "{}") }),
            save: async (s: AppSettings) => localStorage.setItem("sf-settings", JSON.stringify(s)),
        },
        window: {
            minimize: () => {},
            toggleMaximize: () => {},
            close: () => {},
            isMaximized: () => Promise.resolve(false),
            onMaximizedChange: () => () => {},
            onCloseRequested: () => () => {},
            confirmClose: () => {},
        },
        history: { list: () => ok([]), read: () => ok(null), label: () => ok(true as const) },
        assets: {
            pick: (path) =>
                new Promise((resolve) => {
                    const input = document.createElement("input");
                    input.type = "file";
                    input.accept = "image/png,image/jpeg,image/gif,image/webp,image/avif,image/bmp";
                    input.onchange = async () => {
                        const f = input.files?.[0];
                        if (!f) return resolve({ ok: true, value: null });
                        resolve({ ok: true, value: { asset: addAsset(path, f.name, toDataUrl(new Uint8Array(await f.arrayBuffer()), f.name)) } });
                    };
                    input.click();
                }),
            add: (path, fileName, bytes) => ok({ asset: addAsset(path, fileName, toDataUrl(bytes, fileName)) }),
            url: (path, asset) => assets.get(path)?.get(asset) ?? "",
        },
        app: {
            info: () => Promise.resolve({ version: "dev", build: "dev+sf-mock", buildId: "sf-mock", buildDate: new Date().toISOString(), platform: "browser", electron: "-", chrome: "-", node: "-" }),
            openExternal: async (url) => {
                if (!/^https:\/\//i.test(url)) return false;
                window.open(url, "_blank", "noopener");
                return true;
            },
        },
    };
}

export const api: SceneformAPI = typeof window !== "undefined" && window.sceneform ? window.sceneform : mockApi();
