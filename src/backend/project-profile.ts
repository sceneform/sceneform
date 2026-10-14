// project-profile.ts

import crypto from "node:crypto";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";

import { ok, err, Result } from "./result.js";

export const LOCK_NAME = "profile-lock.sfc";
export const LOCK_FORMAT = "sceneform-profile-lock";
export const LOCK_VERSION = "1.0.0-sflock / 0.1.0-sf";
const SUPPORTED_LOCK_MAJOR = 1;

export const PROJECT_EXT = ".sfp";
const CONFIG_NAME = "config.json";
const APP_DIR = "Sceneform";
const MAX_NAME_LENGTH = 100;

export interface ProjectEntry {
    id: string;
    name: string;
    /** Path relative to the project folder, forward slashes, e.g. "CLASS.sfp". */
    location: string;
    fileType?: string;
    createdAt: string;
}

export interface ProfileLock {
    format: typeof LOCK_FORMAT;
    version: string;
    profileId: string;
    createdAt: string;
    updatedAt: string;
    projects: ProjectEntry[];
}

/** What the UI receives: the lock plus a runtime-only `missing` flag that is never written to disk. */
export type ProjectEntryView = ProjectEntry & { missing: boolean };
export type ProfileLockView = Omit<ProfileLock, "projects"> & {
    projects: ProjectEntryView[];
};

export interface ProfileWarning {
    code: string;
    message: string;
    location?: string;
}

export interface ProfileState {
    projectFolder: string;
    existingProfile: boolean;
    lock: ProfileLockView;
    warnings: ProfileWarning[];
}

export type ProfileErrorCode =
    | "no-folder"
    | "folder-missing"
    | "folder-unusable"
    | "lock-newer"
    | "bad-path"
    | "file-missing"
    | "already-registered"
    | "write-failed"
    | "internal";

export interface ProfileError {
    code: ProfileErrorCode;
    message: string;
    folder?: string;
    version?: string;
}

function now(): string {
    return new Date().toISOString();
}

function newLock(): ProfileLock {
    const timestamp = now();

    return {
        format: LOCK_FORMAT,
        version: LOCK_VERSION,
        profileId: crypto.randomUUID(),
        createdAt: timestamp,
        updatedAt: timestamp,
        projects: [],
    };
}

export function defaultProjectFolder(): string {
    return path.join(os.homedir(), "Documents", "Sceneform Projects");
}

function keyOf(location: string): string {
    return location.replaceAll("\\", "/").toLowerCase();
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

function errnoCode(e: unknown): string | undefined {
    return (e as NodeJS.ErrnoException | undefined)?.code;
}

class ProfileFailure extends Error {
    constructor(
        readonly code: ProfileErrorCode,
        message: string,
        readonly extra: { folder?: string; version?: string } = {},
    ) {
        super(message);
    }
}

function fail(
    code: ProfileErrorCode,
    message: string,
    extra: { folder?: string; version?: string } = {},
): never {
    throw new ProfileFailure(code, message, extra);
}

const ILLEGAL = /[<>:"/\\|?*\x00-\x1f]/g;
const RESERVED = new Set(["CON", "PRN", "AUX", "NUL"]);

for (let i = 1; i <= 9; i++) {
    RESERVED.add(`COM${i}`);
    RESERVED.add(`LPT${i}`);
}

export function sanitizeName(name: unknown): Result<string, string> {
    if (typeof name !== "string") {
        return err(`Expected filename to be a string, received ${typeof name}`);
    }

    let sanitized = name
        .replace(ILLEGAL, "")
        .replace(/\s+/g, " ")
        .replace(/^[. ]+/, "")
        .slice(0, MAX_NAME_LENGTH)
        .replace(/[. ]+$/, "");

    if (sanitized === "") {
        return ok("Untitled");
    }

    const baseName = sanitized.split(".")[0].toUpperCase();

    if (RESERVED.has(baseName)) {
        sanitized = `_${sanitized}`;
    }

    return ok(sanitized);
}

export function safeRelative(file: unknown): Result<string, string> {
    if (typeof file !== "string" || !file.trim()) {
        return err("Project path must be a non-empty string.");
    }

    const normalized = file
        .trim()
        .replaceAll("\\", "/")
        .replace(/\/{2,}/g, "/");

    if (
        path.win32.isAbsolute(normalized) ||
        path.posix.isAbsolute(normalized) ||
        normalized.startsWith("/")
    ) {
        return err("Project path must be relative.");
    }

    const parts = normalized.split("/");

    if (parts.some((part) => part === "" || part === "." || part === "..")) {
        return err(
            "Project path cannot contain empty, '.' or '..' path segments.",
        );
    }

    if (
        parts.some(
            (part) => /[<>:"|?*\x00-\x1f]/.test(part) || /[. ]$/.test(part),
        )
    ) {
        return err("Project path contains characters Windows does not allow.");
    }

    if (!normalized.toLowerCase().endsWith(PROJECT_EXT)) {
        return err(`Project path must end with ${PROJECT_EXT}.`);
    }

    return ok(normalized);
}

export function resolveInside(folder: string, location: string): string {
    const full = path.resolve(folder, ...location.split("/"));
    const rel = path.relative(folder, full);

    if (
        rel === "" ||
        rel === ".." ||
        rel.startsWith(`..${path.sep}`) ||
        path.isAbsolute(rel)
    ) {
        fail("bad-path", "Project files must live inside the project folder.");
    }

    return full;
}

// ------------------------------------------------------------------ atomic JSON

async function renameWithRetry(from: string, to: string): Promise<void> {
    for (let attempt = 0; ; attempt++) {
        try {
            await fs.rename(from, to);
            return;
        } catch (e) {
            const transient = ["EPERM", "EBUSY", "EACCES"].includes(
                errnoCode(e) ?? "",
            );

            if (!transient || attempt >= 5) {
                throw e;
            }

            await sleep(25 * (attempt + 1));
        }
    }
}

export async function atomicWriteJson(
    filePath: string,
    data: unknown,
    keepBackup = false,
): Promise<Result<void, string>> {
    const tempPath = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
    let json: string;

    try {
        json = JSON.stringify(data, null, 4) + "\n";
    } catch (e) {
        return err(`Could not serialize data: ${errorMessage(e)}`);
    }

    try {
        const handle = await fs.open(tempPath, "w");

        try {
            await handle.writeFile(json, "utf8");
            await handle.sync();
        } finally {
            await handle.close();
        }

        if (keepBackup) {
            try {
                await fs.copyFile(filePath, `${filePath}.bak`);
            } catch (e) {
                if (errnoCode(e) !== "ENOENT") {
                    throw e;
                }
            }
        }

        await renameWithRetry(tempPath, filePath);
        return ok(undefined);
    } catch (e) {
        await fs.rm(tempPath, { force: true }).catch(() => undefined);
        return err(errorMessage(e));
    }
}

class NotALock extends Error {}

function lockMajor(version: unknown): number | null {
    if (typeof version !== "string") {
        return null;
    }

    const match = /^\s*(\d+)\.\d+\.\d+-sflock\b/.exec(version);
    return match ? Number(match[1]) : null;
}

function cleanLock(data: unknown, warnings: ProfileWarning[]): ProfileLock {
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
        throw new NotALock();
    }

    const raw = data as Record<string, unknown>;

    if (raw.format !== LOCK_FORMAT || !Array.isArray(raw.projects)) {
        throw new NotALock();
    }

    const major = lockMajor(raw.version);

    if (major === null) {
        throw new NotALock();
    }

    if (major > SUPPORTED_LOCK_MAJOR) {
        fail(
            "lock-newer",
            "This profile was made by a newer version of Sceneform. Update Sceneform (nothing was changed).",
            { version: String(raw.version) },
        );
    }

    const createdAt = typeof raw.createdAt === "string" ? raw.createdAt : now();
    const lock = {
        ...raw,
        format: LOCK_FORMAT,
        version: raw.version as string,
        profileId:
            typeof raw.profileId === "string" && raw.profileId
                ? raw.profileId
                : crypto.randomUUID(),
        createdAt,
        updatedAt:
            typeof raw.updatedAt === "string" ? raw.updatedAt : createdAt,
        projects: [] as ProjectEntry[],
    } as ProfileLock;

    const seenLocations = new Set<string>();
    const seenIds = new Set<string>();

    for (const item of raw.projects) {
        const candidate =
            typeof item === "object" && item !== null && !Array.isArray(item)
                ? (item as Record<string, unknown>)
                : null;
        const rel = candidate
            ? safeRelative(candidate.location)
            : err("Project entry is not an object.");

        if (!candidate || !rel.ok) {
            const reason = rel.ok ? "" : rel.error;
            const shown =
                candidate && typeof candidate.location === "string"
                    ? candidate.location
                    : undefined;

            warnings.push({
                code: "entry-dropped",
                message: `Ignored an invalid project entry: ${reason}`,
                ...(shown !== undefined ? { location: shown } : {}),
            });
            continue;
        }

        if (seenLocations.has(keyOf(rel.value))) {
            warnings.push({
                code: "entry-duplicate",
                message: `Ignored a duplicate entry for ${rel.value}.`,
                location: rel.value,
            });
            continue;
        }

        const { missing: _runtimeOnly, ...rest } = candidate;
        const entry = {
            ...rest,
            id:
                typeof rest.id === "string" && rest.id && !seenIds.has(rest.id)
                    ? rest.id
                    : crypto.randomUUID(),
            name:
                typeof rest.name === "string" && rest.name.trim()
                    ? rest.name
                    : path.posix.basename(rel.value, PROJECT_EXT),
            location: rel.value,
            createdAt:
                typeof rest.createdAt === "string" ? rest.createdAt : now(),
        } as ProjectEntry;

        if (
            entry.fileType !== undefined &&
            typeof entry.fileType !== "string"
        ) {
            delete entry.fileType;
        }

        seenLocations.add(keyOf(rel.value));
        seenIds.add(entry.id);
        lock.projects.push(entry);
    }

    return lock;
}

async function scanProjects(folder: string): Promise<string[]> {
    const items = await fs.readdir(folder, { withFileTypes: true });

    return items
        .filter(
            (d) =>
                d.isFile() &&
                d.name.toLowerCase().endsWith(PROJECT_EXT) &&
                !d.name.startsWith(".") &&
                !d.name.startsWith("~"),
        )
        .map((d) => d.name)
        .sort();
}

function adoptStrays(
    names: string[],
    lock: ProfileLock,
    warnings: ProfileWarning[],
): boolean {
    const known = new Set(lock.projects.map((p) => keyOf(p.location)));
    let changed = false;

    for (const name of names) {
        if (!known.has(keyOf(name))) {
            lock.projects.push({
                id: crypto.randomUUID(),
                name: path.posix.basename(name, PROJECT_EXT),
                location: name,
                createdAt: now(),
            });
            warnings.push({
                code: "project-adopted",
                message: `Found ${name} in the folder and added it.`,
                location: name,
            });
            changed = true;
        }
    }

    return changed;
}

async function moveAside(file: string): Promise<string> {
    const stamp = now()
        .replace(/[-:]/g, "")
        .replace(/\..*$/, "")
        .replace("T", "-");

    for (let i = 0; ; i++) {
        const target = `${file}.corrupt-${stamp}${i ? `-${i}` : ""}`;

        try {
            await fs.access(target);
        } catch {
            await fs.rename(file, target);
            return target;
        }
    }
}

function parseLockText(text: string, warnings: ProfileWarning[]): ProfileLock {
    const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    let parsed: unknown;

    try {
        parsed = JSON.parse(body);
    } catch {
        throw new NotALock();
    }

    return cleanLock(parsed, warnings);
}

async function loadLock(
    folder: string,
    warnings: ProfileWarning[],
): Promise<{ lock: ProfileLock; existed: boolean; dirty: boolean }> {
    const lockPath = path.join(folder, LOCK_NAME);
    let text: string;

    try {
        text = await fs.readFile(lockPath, "utf8");
    } catch (e) {
        if (errnoCode(e) === "ENOENT") {
            return { lock: newLock(), existed: false, dirty: true };
        }

        fail("folder-unusable", `Sceneform cannot read ${LOCK_NAME}.`, {
            folder,
        });
    }

    try {
        return {
            lock: parseLockText(text, warnings),
            existed: true,
            dirty: false,
        };
    } catch (e) {
        if (!(e instanceof NotALock)) {
            throw e;
        }
    }

    let quarantined: string;

    try {
        quarantined = path.basename(await moveAside(lockPath));
    } catch {
        fail(
            "folder-unusable",
            `${LOCK_NAME} is damaged and could not be moved aside.`,
            { folder },
        );
    }

    try {
        const backup = parseLockText(
            await fs.readFile(`${lockPath}.bak`, "utf8"),
            warnings,
        );

        warnings.push({
            code: "lock-restored-from-backup",
            message: `${LOCK_NAME} was damaged; restored the previous copy. The damaged file was kept as ${quarantined}.`,
        });
        return { lock: backup, existed: true, dirty: true };
    } catch (e) {
        if (e instanceof ProfileFailure) {
            throw e;
        }
    }

    warnings.push({
        code: "lock-rebuilt",
        message: `${LOCK_NAME} was damaged; rebuilt it from the projects in the folder. The damaged file was kept as ${quarantined}.`,
    });
    return { lock: newLock(), existed: true, dirty: true };
}

async function saveLock(folder: string, lock: ProfileLock): Promise<void> {
    lock.updatedAt = now();

    const written = await atomicWriteJson(
        path.join(folder, LOCK_NAME),
        lock,
        true,
    );

    if (!written.ok) {
        fail(
            "write-failed",
            `Sceneform could not write ${LOCK_NAME}: ${written.error}`,
            { folder },
        );
    }
}

async function viewOf(
    folder: string,
    lock: ProfileLock,
): Promise<ProfileLockView> {
    const projects = await Promise.all(
        lock.projects.map(async (p): Promise<ProjectEntryView> => {
            const present = await fs
                .stat(resolveInside(folder, p.location))
                .then(
                    (s) => s.isFile(),
                    () => false,
                );
            return { ...p, missing: !present };
        }),
    );

    return { ...lock, projects };
}

async function checkFolder(raw: unknown): Promise<string> {
    if (typeof raw !== "string" || !raw.trim()) {
        fail("folder-unusable", "No folder was given.");
    }

    const given = raw.trim();

    if (!path.isAbsolute(given)) {
        fail("folder-unusable", "The project folder must be a full path.", {
            folder: given,
        });
    }

    const folder = path.resolve(given);
    let isDir: boolean;

    try {
        isDir = (await fs.stat(folder)).isDirectory();
    } catch (e) {
        if (errnoCode(e) === "ENOENT" || errnoCode(e) === "ENOTDIR") {
            fail("folder-missing", `The folder does not exist: ${folder}`, {
                folder,
            });
        }

        fail("folder-unusable", `Sceneform cannot open: ${folder}`, { folder });
    }

    if (!isDir) {
        fail("folder-unusable", `That path is not a folder: ${folder}`, {
            folder,
        });
    }

    const probe = path.join(
        folder,
        `.sf-write-test-${crypto.randomBytes(4).toString("hex")}`,
    );

    try {
        const handle = await fs.open(probe, "wx");
        await handle.close();
        await fs.rm(probe, { force: true });
    } catch {
        fail("folder-unusable", `Sceneform cannot write to: ${folder}`, {
            folder,
        });
    }

    return folder;
}

async function readConfig(configDir: string): Promise<Record<string, unknown>> {
    try {
        const parsed: unknown = JSON.parse(
            await fs.readFile(path.join(configDir, CONFIG_NAME), "utf8"),
        );
        return typeof parsed === "object" &&
            parsed !== null &&
            !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : {};
    } catch {
        return {};
    }
}

async function writeConfig(
    configDir: string,
    cfg: Record<string, unknown>,
): Promise<void> {
    try {
        await fs.mkdir(configDir, { recursive: true });
    } catch (e) {
        fail(
            "write-failed",
            `Sceneform could not save its settings: ${errorMessage(e)}`,
        );
    }

    const written = await atomicWriteJson(
        path.join(configDir, CONFIG_NAME),
        cfg,
    );

    if (!written.ok) {
        fail(
            "write-failed",
            `Sceneform could not save its settings: ${written.error}`,
        );
    }
}

export interface ProfileServiceOptions {
    /** Electron: app.getPath("userData"). */
    configDir?: string;
    /** Suggested folder for first run. Electron: path.join(app.getPath("documents"), "Sceneform Projects"). */
    defaultFolder?: string;
}

export interface ProfileService {
    defaultProjectFolder(): string;
    getConfig(): Promise<
        Result<{ projectFolder: string | null }, ProfileError>
    >;
    openProfile(): Promise<Result<ProfileState, ProfileError>>;
    setProjectFolder(
        folder: unknown,
    ): Promise<Result<ProfileState, ProfileError>>;
    newProjectPath(
        name: unknown,
    ): Promise<Result<{ location: string; path: string }, ProfileError>>;
    registerProject(
        location: unknown,
        name?: unknown,
    ): Promise<
        Result<{ entry: ProjectEntryView; lock: ProfileLockView }, ProfileError>
    >;
}

export function createProfileService(
    options: ProfileServiceOptions = {},
): ProfileService {
    const configDir =
        options.configDir ??
        path.join(
            process.env.APPDATA ??
                path.join(os.homedir(), "AppData", "Roaming"),
            APP_DIR,
        );
    const suggested = options.defaultFolder ?? defaultProjectFolder();

    let tail: Promise<unknown> = Promise.resolve();

    function guard<T>(fn: () => Promise<T>): Promise<Result<T, ProfileError>> {
        const run = tail.then(async (): Promise<Result<T, ProfileError>> => {
            try {
                return ok(await fn());
            } catch (e) {
                if (e instanceof ProfileFailure) {
                    return err({
                        code: e.code,
                        message: e.message,
                        ...e.extra,
                    });
                }

                return err({ code: "internal", message: errorMessage(e) });
            }
        });

        tail = run;
        return run;
    }

    async function configuredFolder(): Promise<string> {
        const folder = (await readConfig(configDir)).projectFolder;

        if (typeof folder !== "string" || !folder.trim()) {
            fail("no-folder", "No project folder has been chosen yet.");
        }

        return folder;
    }

    async function openAt(folderRaw: unknown): Promise<ProfileState> {
        const folder = await checkFolder(folderRaw);
        const warnings: ProfileWarning[] = [];
        const loaded = await loadLock(folder, warnings);
        let dirty = loaded.dirty;

        if (adoptStrays(await scanProjects(folder), loaded.lock, warnings)) {
            dirty = true;
        }

        if (dirty) {
            await saveLock(folder, loaded.lock);
        }

        const lock = await viewOf(folder, loaded.lock);

        for (const p of lock.projects) {
            if (p.missing) {
                warnings.push({
                    code: "project-missing",
                    message: `${p.location} is listed but not in the folder.`,
                    location: p.location,
                });
            }
        }

        return {
            projectFolder: folder,
            existingProfile: loaded.existed,
            lock,
            warnings,
        };
    }

    return {
        defaultProjectFolder: () => suggested,

        getConfig: () =>
            guard(async () => {
                const folder = (await readConfig(configDir)).projectFolder;
                return {
                    projectFolder:
                        typeof folder === "string" && folder.trim()
                            ? folder
                            : null,
                };
            }),

        openProfile: () =>
            guard(async () => {
                const folder = await configuredFolder();

                try {
                    return await openAt(folder);
                } catch (e) {
                    if (
                        e instanceof ProfileFailure &&
                        (e.code === "folder-missing" ||
                            e.code === "folder-unusable")
                    ) {
                        e.extra.folder ??= folder;
                    }

                    throw e;
                }
            }),

        setProjectFolder: (folder) =>
            guard(async () => {
                const state = await openAt(folder);

                await writeConfig(configDir, {
                    ...(await readConfig(configDir)),
                    projectFolder: state.projectFolder,
                });
                return state;
            }),

        newProjectPath: (name) =>
            guard(async () => {
                const folder = await checkFolder(await configuredFolder());
                const warnings: ProfileWarning[] = [];
                const { lock } = await loadLock(folder, warnings);
                const taken = new Set(
                    lock.projects.map((p) => keyOf(p.location)),
                );

                for (const entry of await fs.readdir(folder)) {
                    taken.add(entry.toLowerCase());
                }

                const stemResult = sanitizeName(name);
                const stem = stemResult.ok ? stemResult.value : "Untitled";

                for (let n = 1; ; n++) {
                    const location = `${stem}${n === 1 ? "" : ` (${n})`}${PROJECT_EXT}`;

                    if (!taken.has(keyOf(location))) {
                        return { location, path: path.join(folder, location) };
                    }
                }
            }),

        registerProject: (location, name) =>
            guard(async () => {
                const folder = await checkFolder(await configuredFolder());
                const rel = safeRelative(location);

                if (!rel.ok) {
                    fail("bad-path", rel.error);
                }

                const warnings: ProfileWarning[] = [];
                const { lock } = await loadLock(folder, warnings);

                if (
                    lock.projects.some(
                        (p) => keyOf(p.location) === keyOf(rel.value),
                    )
                ) {
                    fail(
                        "already-registered",
                        `${rel.value} is already in this profile.`,
                    );
                }

                const onDisk = await fs
                    .stat(resolveInside(folder, rel.value))
                    .then(
                        (s) => s.isFile(),
                        () => false,
                    );

                if (!onDisk) {
                    fail(
                        "file-missing",
                        `${rel.value} does not exist yet. Write the project file first.`,
                    );
                }

                const trimmed = typeof name === "string" ? name.trim() : "";
                const entry: ProjectEntry = {
                    id: crypto.randomUUID(),
                    name:
                        trimmed || path.posix.basename(rel.value, PROJECT_EXT),
                    location: rel.value,
                    createdAt: now(),
                };

                lock.projects.push(entry);
                await saveLock(folder, lock);

                return {
                    entry: { ...entry, missing: false },
                    lock: await viewOf(folder, lock),
                };
            }),
    };
}
