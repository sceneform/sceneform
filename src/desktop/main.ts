// src/desktop/main.ts
//
// Electron main process for Sceneform. Owns the window, the filesystem, and
// every native dialog. The renderer talks to it only through the preload
// bridge (src/desktop/preload.ts) using the channels in src/shared/bridge.ts.

import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, shell } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createProfileService } from "../backend/project-profile.js";
import { createProjectService } from "../backend/project-service.js";
import {
    ASSET_TYPES,
    MAX_ASSET_BYTES,
    addAssetToArchive,
    assetMime,
    isSafeAssetPath,
    readAssetFromArchive,
    readProjectArchive,
    readProjectZip,
} from "../backend/sfp-archive.js";
import { ok, err } from "../backend/result.js";
import type { PdfExportOptions } from "../backend/pdf-export.js";
import type { SfpProjectData, TitlePageDefaults } from "../backend/sfp-archive.js";
import {
    ASSET_PROTOCOL,
    CHANNELS,
    DEFAULT_SETTINGS,
    type AppSettings,
    type ProjectListing,
} from "../shared/bridge.js";
import { fdxToFountain, osfToFountain } from "../shared/fdx.js";
import JSZip from "jszip";
import { createLocalHistory, type HistoryDoc } from "./local-history.js";
import { buildInfo } from "./build-info.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged && Boolean(process.env.SCENEFORM_DEV_URL);
const isMac = process.platform === "darwin";

let mainWindow: BrowserWindow | null = null;
let allowClose = false;

/* ---------- picture assets ---------- */

// Must happen before "ready": lets <img src="sfasset://..."> load like a normal URL.
protocol.registerSchemesAsPrivileged([
    { scheme: ASSET_PROTOCOL, privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

// Assets are only ever served from, and written into, projects this session opened.
const knownProjects = new Set<string>();
const remember = (file: string) => knownProjects.add(path.resolve(file));
const isKnownProject = (file: unknown): file is string =>
    typeof file === "string" && file.toLowerCase().endsWith(".sfp") && knownProjects.has(path.resolve(file));

function registerAssetProtocol(): void {
    protocol.handle(ASSET_PROTOCOL, async (request) => {
        try {
            const url = new URL(request.url);
            const project = url.searchParams.get("p");
            const asset = url.pathname.replace(/^\/+/, "").split("/").map(decodeURIComponent).join("/");
            if (!isKnownProject(project) || !isSafeAssetPath(asset)) return new Response("Forbidden", { status: 403 });
            const bytes = await readAssetFromArchive(project, asset);
            if (!bytes) return new Response("Not found", { status: 404 });
            return new Response(Buffer.from(bytes), {
                headers: { "content-type": assetMime(asset), "cache-control": "private, max-age=31536000, immutable" },
            });
        } catch {
            return new Response("Error", { status: 500 });
        }
    });
}

/* ---------- single instance ---------- */

if (!app.requestSingleInstanceLock()) {
    app.quit();
}

app.on("second-instance", () => {
    if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
    }
});

/* ---------- app icon ---------- */

// build/ ships inside the package (forge only ignores src, site, etc.), so this works in dev and packaged.
function appIconPath(): string {
    return path.join(app.getAppPath(), "build", process.platform === "win32" ? "icon.ico" : "icon.png");
}

/* ---------- settings persistence ---------- */

const settingsFile = () => path.join(app.getPath("userData"), "settings.json");
const recentProjectsFile = () => path.join(app.getPath("userData"), "recent-projects.json");
const MAX_RECENT_PROJECTS = 12;
let recentWriteQueue = Promise.resolve();

async function readRecentPaths(): Promise<string[]> {
    try {
        const raw: unknown = JSON.parse(await fs.readFile(recentProjectsFile(), "utf8"));
        if (!Array.isArray(raw)) return [];
        return raw
            .filter((entry): entry is string => typeof entry === "string" && path.isAbsolute(entry) && entry.toLowerCase().endsWith(".sfp"))
            .map((entry) => path.resolve(entry))
            .slice(0, MAX_RECENT_PROJECTS);
    } catch {
        return [];
    }
}

function rememberRecentProject(filePath: string): Promise<void> {
    const resolved = path.resolve(filePath);
    recentWriteQueue = recentWriteQueue.catch(() => undefined).then(async () => {
        const recent = [resolved, ...(await readRecentPaths()).filter((item) => item !== resolved)].slice(0, MAX_RECENT_PROJECTS);
        const file = recentProjectsFile();
        const tmp = `${file}.${process.pid}.tmp`;
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(tmp, JSON.stringify(recent, null, 2), "utf8");
        await fs.rename(tmp, file);
    });
    return recentWriteQueue;
}

async function loadSettings(): Promise<AppSettings> {
    try {
        const raw = JSON.parse(await fs.readFile(settingsFile(), "utf8"));
        return { ...DEFAULT_SETTINGS, ...(raw && typeof raw === "object" ? raw : {}) };
    } catch {
        return { ...DEFAULT_SETTINGS };
    }
}

async function saveSettings(settings: AppSettings): Promise<void> {
    const file = settingsFile();
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(tmp, JSON.stringify({ ...DEFAULT_SETTINGS, ...settings }, null, 2), "utf8");
    await fs.rename(tmp, file);
}

/* ---------- window ---------- */

function createWindow(): void {
    const win = new BrowserWindow({
        width: 1320,
        height: 860,
        minWidth: 960,
        minHeight: 600,
        show: false,
        backgroundColor: "#04030f",
        title: "Sceneform",
        icon: appIconPath(),
        // Custom titlebar everywhere; macOS keeps its native traffic lights.
        frame: isMac,
        titleBarStyle: isMac ? "hiddenInset" : "hidden",
        trafficLightPosition: isMac ? { x: 14, y: 11 } : undefined,
        webPreferences: {
            preload: path.join(here, "preload.cjs"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            spellcheck: false,
        },
    });

    mainWindow = win;

    // Start maximized (the whole screen minus the OS taskbar/dock); F11 still toggles true fullscreen.
    win.once("ready-to-show", () => {
        win.maximize();
        win.show();
    });
    win.webContents.on("before-input-event", (event, input) => {
        if (input.type === "keyDown" && input.key === "F11" && !input.control && !input.alt && !input.meta) {
            event.preventDefault();
            win.setFullScreen(!win.isFullScreen());
            return;
        }
        // DevTools: unpackaged builds only (npm run dev / npm start), Ctrl/Cmd+Shift+I or F12.
        // Packaged Windows/Linux builds have no menu, so there is no DevTools shortcut there.
        if (
            !app.isPackaged &&
            input.type === "keyDown" &&
            (input.key === "F12" || ((input.control || input.meta) && input.shift && input.key.toLowerCase() === "i"))
        ) {
            event.preventDefault();
            win.webContents.toggleDevTools();
        }
    });
    win.on("maximize", () => win.webContents.send(CHANNELS.window.maximizedChanged, true));
    win.on("unmaximize", () => win.webContents.send(CHANNELS.window.maximizedChanged, false));

    // Give the renderer a chance to flush unsaved work before the window goes away.
    win.on("close", (event) => {
        if (allowClose) return;
        event.preventDefault();
        win.webContents.send(CHANNELS.window.closeRequested);
        // If the renderer is hung, do not trap the user.
        setTimeout(() => {
            if (!win.isDestroyed()) {
                allowClose = true;
                win.close();
            }
        }, 5000);
    });

    win.on("closed", () => {
        mainWindow = null;
    });

    // Links never open inside the app.
    win.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https?:/i.test(url)) void shell.openExternal(url);
        return { action: "deny" };
    });
    win.webContents.on("will-navigate", (event, url) => {
        if (isDev && url.startsWith(process.env.SCENEFORM_DEV_URL!)) return;
        event.preventDefault();
    });

    if (isDev) {
        void win.loadURL(process.env.SCENEFORM_DEV_URL!);
    } else {
        void win.loadFile(path.join(here, "..", "dist-renderer", "index.html"));
    }
}

/* ---------- IPC ---------- */

function message(error: unknown, fallback: string): string {
    return error instanceof Error ? error.message : fallback;
}

function registerIpc(): void {
    const profile = createProfileService({
        configDir: app.getPath("userData"),
        defaultFolder: path.join(app.getPath("documents"), "Sceneform Projects"),
    });
    const projects = createProjectService(profile, () => mainWindow);

    /* fountain */
    ipcMain.handle(CHANNELS.fountain.open, async () => {
        try {
            const options = {
                title: "Import a screenplay",
                properties: ["openFile"] as Array<"openFile">,
                filters: [
                    { name: "Screenplays", extensions: ["fountain", "spmd", "txt", "fdx", "fadein"] },
                    { name: "Fountain screenplay", extensions: ["fountain", "spmd", "txt"] },
                    { name: "Final Draft", extensions: ["fdx"] },
                    { name: "Fade In", extensions: ["fadein"] },
                    { name: "All files", extensions: ["*"] },
                ],
            };
            const picked = mainWindow
                ? await dialog.showOpenDialog(mainWindow, options)
                : await dialog.showOpenDialog(options);
            if (picked.canceled || picked.filePaths.length === 0) return ok(null);
            const file = picked.filePaths[0];
            if (/\.fadein$/i.test(file)) {
                try {
                    const zip = await JSZip.loadAsync(await fs.readFile(file));
                    const entry = zip.file("document.xml") ?? zip.file(/\.xml$/i)[0];
                    if (!entry) throw new Error("That Fade In file has no document inside.");
                    return ok({ path: file, text: osfToFountain(await entry.async("string")).fountain });
                } catch (e) {
                    return err({ code: "invalid-format" as const, message: message(e, "Could not read that Fade In file.") });
                }
            }
            const raw = await fs.readFile(file, "utf8");
            if (/\.fdx$/i.test(file)) {
                try {
                    return ok({ path: file, text: fdxToFountain(raw).fountain });
                } catch (e) {
                    return err({ code: "invalid-format" as const, message: message(e, "Could not read that Final Draft file.") });
                }
            }
            return ok({ path: file, text: raw });
        } catch (e) {
            return err({ code: "io-error" as const, message: message(e, "Could not read that file.") });
        }
    });

    ipcMain.handle(CHANNELS.fountain.saveFdx, async (_e, xml: unknown, suggestedName: unknown) => {
        if (typeof xml !== "string") return err({ code: "invalid-format" as const, message: "Nothing to export." });
        try {
            const name = (typeof suggestedName === "string" && suggestedName.trim() ? suggestedName.trim() : "Screenplay").replace(/[\\/:*?"<>|]+/g, "-");
            const options = {
                title: "Export for Final Draft",
                defaultPath: path.join(app.getPath("documents"), `${name}.fdx`),
                filters: [{ name: "Final Draft", extensions: ["fdx"] }],
            };
            const picked = mainWindow ? await dialog.showSaveDialog(mainWindow, options) : await dialog.showSaveDialog(options);
            if (picked.canceled || !picked.filePath) return err({ code: "cancelled" as const, message: "Cancelled." });
            const target = /\.fdx$/i.test(picked.filePath) ? picked.filePath : `${picked.filePath}.fdx`;
            await fs.writeFile(target, xml, "utf8");
            return ok({ path: target });
        } catch (e) {
            return err({ code: "io-error" as const, message: message(e, "Could not write that file.") });
        }
    });

    ipcMain.handle(CHANNELS.fountain.read, async (_e, file: unknown) => {
        if (typeof file !== "string") return err({ code: "invalid-format" as const, message: "Bad path." });
        try {
            return ok(await fs.readFile(file, "utf8"));
        } catch (e) {
            return err({ code: "io-error" as const, message: message(e, "Could not read that file.") });
        }
    });

    /* profile */
    ipcMain.handle(CHANNELS.profile.open, () => profile.openProfile());
    ipcMain.handle(CHANNELS.profile.defaultFolder, () => ok(profile.defaultProjectFolder()));
    ipcMain.handle(CHANNELS.profile.setFolder, async (_e, folder: unknown) => {
        // First run offers the suggested default folder, which usually doesn't exist yet.
        // Create only that one; any other folder came from the picker and already exists.
        if (typeof folder === "string" && folder === profile.defaultProjectFolder()) {
            await fs.mkdir(folder, { recursive: true }).catch(() => undefined);
        }
        return profile.setProjectFolder(folder);
    });
    ipcMain.handle(CHANNELS.profile.pickFolder, async (_e, initial?: unknown) => {
        try {
            const options = {
                title: "Choose where Sceneform keeps your projects",
                properties: ["openDirectory", "createDirectory"] as Array<"openDirectory" | "createDirectory">,
                ...(typeof initial === "string" && initial ? { defaultPath: initial } : {}),
            };
            const result = mainWindow
                ? await dialog.showOpenDialog(mainWindow, options)
                : await dialog.showOpenDialog(options);
            return ok({ path: result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0] });
        } catch (e) {
            return err({ code: "internal" as const, message: message(e, "Could not open the folder picker.") });
        }
    });

    /* projects */
    ipcMain.handle(CHANNELS.project.list, async (_e, folder: unknown) => {
        if (typeof folder !== "string" || !folder) {
            return err({ code: "not-found" as const, message: "No project folder is set." });
        }
        const listed = await projects.listProjects(folder);
        if (!listed.ok) return listed;
        // listProjects names each summary after its file stem; pair it with the real path
        // here so the renderer never has to build OS paths itself.
        const listing: ProjectListing[] = listed.value.map((summary) => ({
            path: path.join(folder, `${summary.id}.sfp`),
            summary,
        }));
        // Listed projects may serve their banner image through sfasset:// (read-only).
        for (const l of listing) if (l.summary.banner) remember(l.path);
        return ok(listing);
    });

    ipcMain.handle(CHANNELS.project.recent, async () => {
        await recentWriteQueue;
        const paths = await readRecentPaths();
        const entries = await Promise.all(paths.map(async (file) => {
            try {
                const summary = (await readProjectArchive(file)).project;
                return { path: file, summary: { ...summary, id: path.basename(file, path.extname(file)) } } satisfies ProjectListing;
            } catch {
                return null;
            }
        }));
        const valid = entries.filter((entry): entry is ProjectListing => entry !== null);
        for (const l of valid) if (l.summary.banner) remember(l.path);
        if (valid.length !== paths.length) {
            const file = recentProjectsFile();
            const tmp = `${file}.${process.pid}.tmp`;
            await fs.mkdir(path.dirname(file), { recursive: true });
            await fs.writeFile(tmp, JSON.stringify(valid.map((entry) => entry.path), null, 2), "utf8");
            await fs.rename(tmp, file);
        }
        return ok(valid);
    });

    ipcMain.handle(CHANNELS.project.open, async (_e, file: string) => {
        const opened = await projects.openProject(file);
        if (opened.ok) {
            remember(opened.value.path);
            await rememberRecentProject(opened.value.path).catch((error) => console.error("Could not save recent project:", error));
        }
        return opened;
    });

    const history = createLocalHistory(path.join(app.getPath("userData"), "local-history"));
    const asHistoryDocs = (docs: unknown): HistoryDoc[] =>
        Array.isArray(docs)
            ? docs
                  .filter((d) => d && typeof d.id === "string" && typeof d.content === "string")
                  .map((d) => ({ id: d.id, kind: String(d.kind), title: String(d.title ?? d.id), content: d.content }))
            : [];

    ipcMain.handle(CHANNELS.project.save, async (_e, file: string, data: Partial<SfpProjectData>) => {
        const saved = await projects.saveProject(file, data);
        // Local history never blocks or fails a save.
        if (saved.ok) void history.record(file, asHistoryDocs(data?.documents)).catch(() => undefined);
        return saved;
    });

    ipcMain.handle(CHANNELS.history.list, async (_e, project: unknown) => {
        if (!isKnownProject(project)) return err({ code: "not-found" as const, message: "That project is not open." });
        try {
            return ok(await history.list(project));
        } catch (e) {
            return err({ code: "io-error" as const, message: message(e, "Could not read local history.") });
        }
    });

    ipcMain.handle(CHANNELS.history.read, async (_e, project: unknown, id: unknown) => {
        if (!isKnownProject(project) || typeof id !== "string") return err({ code: "not-found" as const, message: "That project is not open." });
        try {
            return ok(await history.read(project, id));
        } catch (e) {
            return err({ code: "io-error" as const, message: message(e, "Could not read that snapshot.") });
        }
    });

    ipcMain.handle(CHANNELS.history.label, async (_e, project: unknown, docs: unknown, label: unknown) => {
        if (!isKnownProject(project)) return err({ code: "not-found" as const, message: "That project is not open." });
        try {
            await history.record(project, asHistoryDocs(docs), { force: true, label: typeof label === "string" ? label.slice(0, 120) : undefined });
            return ok(true as const);
        } catch (e) {
            return err({ code: "io-error" as const, message: message(e, "Could not save that snapshot.") });
        }
    });

    ipcMain.handle(
        CHANNELS.project.create,
        async (_e, folder: string, name: string, author: string, logline: string, script?: unknown) => {
            // Imported Fountain becomes the first screenplay of the fresh archive.
            const created = await projects.createProject(
                folder,
                name,
                author,
                logline,
                typeof script === "string" && script ? script : undefined,
            );
            if (created.ok) {
                remember(created.value.path);
                await rememberRecentProject(created.value.path).catch((error) => console.error("Could not save recent project:", error));
            }
            return created;
        },
    );

    ipcMain.handle(CHANNELS.project.trash, async (_e, file: unknown) => {
        if (typeof file !== "string" || !file.toLowerCase().endsWith(".sfp")) {
            return err({ code: "invalid-format" as const, message: "That is not a Sceneform project." });
        }
        try {
            // Make sure it really is an archive before touching it.
            await readProjectArchive(file);
            await shell.trashItem(file);
            try {
                await fs.access(`${file}.bak`);
                await shell.trashItem(`${file}.bak`);
            } catch {
                // no backup yet
            }
            return ok(true);
        } catch (e) {
            return err({ code: "io-error" as const, message: message(e, "Could not move the project to the trash.") });
        }
    });

    ipcMain.handle(CHANNELS.project.rename, (_e, file: string, title: string) => projects.renameProject(file, title));

    ipcMain.handle(
        CHANNELS.project.exportPdf,
        (_e, script: string, title: string, options?: PdfExportOptions) => projects.exportPdf(script, title, options),
    );

    ipcMain.handle(CHANNELS.project.exportFountain, (_e, script: string, title: string, defaults?: TitlePageDefaults | null) =>
        projects.exportFountain(script, title, defaults ?? undefined),
    );

    /* assets */
    ipcMain.handle(CHANNELS.assets.pick, async (_e, project: unknown) => {
        if (!isKnownProject(project)) return err({ code: "not-found" as const, message: "That project is not open." });
        try {
            const options = {
                title: "Add a picture",
                properties: ["openFile"] as Array<"openFile">,
                filters: [{ name: "Pictures", extensions: Object.keys(ASSET_TYPES) }],
            };
            const picked = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
            if (picked.canceled || picked.filePaths.length === 0) return ok(null);
            const file = picked.filePaths[0];
            const stat = await fs.stat(file);
            if (stat.size > MAX_ASSET_BYTES) return err({ code: "invalid-format" as const, message: "That picture is larger than 25 MB." });
            const asset = await addAssetToArchive(project, path.basename(file), new Uint8Array(await fs.readFile(file)));
            return ok({ asset });
        } catch (e) {
            return err({ code: "io-error" as const, message: message(e, "Could not add that picture.") });
        }
    });

    ipcMain.handle(CHANNELS.assets.add, async (_e, project: unknown, fileName: unknown, bytes: unknown) => {
        if (!isKnownProject(project)) return err({ code: "not-found" as const, message: "That project is not open." });
        if (typeof fileName !== "string" || !(bytes instanceof Uint8Array)) {
            return err({ code: "invalid-format" as const, message: "That is not a picture." });
        }
        try {
            const asset = await addAssetToArchive(project, path.basename(fileName), bytes);
            return ok({ asset });
        } catch (e) {
            return err({ code: "io-error" as const, message: message(e, "Could not add that picture.") });
        }
    });

    ipcMain.handle(CHANNELS.project.browse, () => projects.browseProjectFile());

    /* .bak recovery. Every save copies the previous file to <file>.bak first, so the backup
       is one save behind. It is read once when the project is opened (before this session
       can overwrite it) and kept in memory, so "Restore backup" still means that version
       after autosave has replaced the .bak on disk. */
    const backupsAtOpen = new Map<string, Buffer>();
    const textChars = (d: SfpProjectData) => d.documents.reduce((n, x) => n + (x.content?.length ?? 0), 0);

    ipcMain.handle(CHANNELS.project.backup, async (_e, file: unknown) => {
        if (typeof file !== "string" || !/\.sfp$/i.test(file)) return err({ code: "invalid-format" as const, message: "Not a project file." });
        const bak = `${file}.bak`;
        try {
            const [buffer, stat] = await Promise.all([fs.readFile(bak), fs.stat(bak)]);
            const data = await readProjectZip(await JSZip.loadAsync(buffer), file);
            let currentChars: number | null = null;
            try {
                currentChars = textChars(await readProjectArchive(file));
            } catch {
                // the project file itself doesn't open
            }
            backupsAtOpen.set(path.resolve(file), buffer);
            return ok({ savedAt: stat.mtime.toISOString(), chars: textChars(data), currentChars });
        } catch {
            return ok(null); // no backup, or it doesn't open either
        }
    });

    ipcMain.handle(CHANNELS.project.restoreBackup, async (_e, file: unknown) => {
        if (typeof file !== "string" || !/\.sfp$/i.test(file)) return err({ code: "invalid-format" as const, message: "Not a project file." });
        const buffer = backupsAtOpen.get(path.resolve(file));
        if (!buffer) return err({ code: "not-found" as const, message: "There is no backup to restore." });
        try {
            let keptAs: string | null = null;
            try {
                await fs.access(file);
                keptAs = `${file}.replaced-${new Date().toISOString().replace(/[:.]/g, "-")}`;
                await fs.copyFile(file, keptAs);
            } catch {
                keptAs = null;
            }
            const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
            await fs.writeFile(temp, buffer);
            await fs.rename(temp, file);
            backupsAtOpen.delete(path.resolve(file));
            const opened = await projects.openProject(file);
            if (!opened.ok) return opened;
            remember(opened.value.path);
            return ok({ path: opened.value.path, data: opened.value.data, keptAs });
        } catch (e) {
            return err({ code: "io-error" as const, message: message(e, "Could not restore the backup.") });
        }
    });

    /* Merge: read a collaborator's copy of the project (read-only; the merge runs in the renderer). */
    ipcMain.handle(CHANNELS.project.readCopy, async (_e, current: unknown) => {
        try {
            const options = {
                title: "Merge another copy of this project",
                properties: ["openFile"] as Array<"openFile">,
                filters: [{ name: "Sceneform project", extensions: ["sfp"] }],
            };
            const picked = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
            if (picked.canceled || picked.filePaths.length === 0) return ok(null);
            const file = picked.filePaths[0];
            if (typeof current === "string" && path.resolve(file) === path.resolve(current))
                return err({ code: "invalid-format" as const, message: "That's this project itself. Pick the other copy." });
            return ok({ path: file, data: await readProjectArchive(file) });
        } catch (e) {
            return err({ code: "io-error" as const, message: message(e, "Could not read that project.") });
        }
    });

    ipcMain.handle(CHANNELS.project.reveal, (_e, file: unknown) => {
        if (typeof file === "string" && file) shell.showItemInFolder(file);
    });

    /* settings */
    ipcMain.handle(CHANNELS.settings.load, () => loadSettings());
    ipcMain.handle(CHANNELS.settings.save, (_e, settings: AppSettings) => saveSettings(settings));

    /* window */
    ipcMain.on(CHANNELS.window.minimize, () => mainWindow?.minimize());
    ipcMain.on(CHANNELS.window.toggleMaximize, () => {
        if (!mainWindow) return;
        if (mainWindow.isMaximized()) mainWindow.unmaximize();
        else mainWindow.maximize();
    });
    ipcMain.on(CHANNELS.window.close, () => mainWindow?.close());
    ipcMain.handle(CHANNELS.window.isMaximized, () => mainWindow?.isMaximized() ?? false);
    ipcMain.on(CHANNELS.window.confirmClose, () => {
        allowClose = true;
        mainWindow?.close();
    });

    /* app */
    ipcMain.handle(CHANNELS.app.openExternal, async (_e, url: unknown) => {
        // Only plain https links leave the app; never file:, javascript: or custom schemes.
        if (typeof url !== "string") return false;
        try {
            const parsed = new URL(url);
            if (parsed.protocol !== "https:") return false;
            await shell.openExternal(parsed.toString());
            return true;
        } catch {
            return false;
        }
    });
    ipcMain.handle(CHANNELS.app.info, () => {
        const version = app.getVersion();
        const b = buildInfo(version);
        return {
            version,
            build: b.label,
            buildId: b.buildId,
            buildDate: b.buildDate,
            platform: process.platform,
            electron: process.versions.electron,
            chrome: process.versions.chrome,
            node: process.versions.node,
        };
    });
}

app.whenReady().then(() => {
    // The renderer owns its shortcuts (Ctrl/Cmd+W closes the current tab, Ctrl+R is free).
    // Electron's default menu would close the window or reload on those, so replace it:
    // no menu on Windows/Linux (frameless, our own titlebar), a minimal one on macOS
    // that keeps the app/edit roles but has no Close Window or Reload accelerators.
    Menu.setApplicationMenu(
        isMac
            ? Menu.buildFromTemplate([
                  { role: "appMenu" },
                  { role: "editMenu" },
                  { label: "View", submenu: [{ role: "toggleDevTools" }, { role: "togglefullscreen" }] },
                  { label: "Window", submenu: [{ role: "minimize" }, { role: "zoom" }] },
              ])
            : null,
    );
    registerAssetProtocol();
    registerIpc();
    if (isMac) app.dock?.setIcon(appIconPath());
    createWindow();

    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            allowClose = false;
            createWindow();
        }
    });
});

app.on("window-all-closed", () => {
    if (!isMac) app.quit();
});
