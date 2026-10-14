// src/shared/bridge.ts
//
// The one contract between the Electron main process and the renderer.
// Channel names follow the sf:* / fountain:* contract described in
// docs/ARCHITECTURE.md.
// Everything here is type-only on the renderer side: the renderer never
// imports Node or Electron modules.

import type { Result } from "../backend/result.js";
import type {
    ProfileError,
    ProfileLockView,
    ProfileState,
    ProjectEntryView,
} from "../backend/project-profile.js";
import type { ProjectError } from "../backend/project-service.js";
import type {
    ProjectSettings,
    SfpDocument,
    SfpDocumentKind,
    SfpEntities,
    SfpProjectData,
    TitlePageDefaults,
} from "../backend/sfp-archive.js";
import type { PdfExportOptions } from "../backend/pdf-export.js";
import type { ProjectSummary } from "../backend/types/project.js";

export type {
    Result,
    ProfileError,
    ProfileLockView,
    ProfileState,
    ProjectEntryView,
    ProjectError,
    SfpProjectData,
    SfpDocument,
    SfpDocumentKind,
    SfpEntities,
    ProjectSettings,
    TitlePageDefaults,
    PdfExportOptions,
    ProjectSummary,
};

export interface HistoryDoc {
    id: string;
    kind: string;
    title: string;
    content: string;
}

export interface HistoryEntry {
    id: string;
    label?: string;
    docs: Array<{ id: string; kind: string; title: string; chars: number }>;
}

export const CHANNELS = {
    fountain: {
        open: "fountain:open",
        read: "fountain:read",
        saveFdx: "fountain:save-fdx",
    },
    profile: {
        open: "sf:profile:open",
        defaultFolder: "sf:profile:default-folder",
        pickFolder: "sf:profile:pick-folder",
        setFolder: "sf:profile:set-folder",
    },
    project: {
        list: "sf:project:list",
        recent: "sf:project:recent",
        open: "sf:project:open",
        save: "sf:project:save",
        create: "sf:project:create",
        trash: "sf:project:trash",
        rename: "sf:project:rename",
        exportPdf: "sf:project:export-pdf",
        exportFountain: "sf:project:export-fountain",
        browse: "sf:project:browse",
        reveal: "sf:project:reveal",
        backup: "sf:project:backup",
        restoreBackup: "sf:project:restore-backup",
        readCopy: "sf:project:read-copy",
    },
    settings: {
        load: "sf:settings:load",
        save: "sf:settings:save",
    },
    window: {
        minimize: "sf:window:minimize",
        toggleMaximize: "sf:window:toggle-maximize",
        close: "sf:window:close",
        isMaximized: "sf:window:is-maximized",
        maximizedChanged: "sf:window:maximized-changed",
        closeRequested: "sf:window:close-requested",
        confirmClose: "sf:window:confirm-close",
    },
    assets: {
        pick: "sf:asset:pick",
        add: "sf:asset:add",
    },
    history: {
        list: "sf:history:list",
        read: "sf:history:read",
        label: "sf:history:label",
    },
    app: {
        info: "sf:app:info",
        openExternal: "sf:app:open-external",
    },
} as const;

/** Custom protocol main registers to serve pictures straight out of an open .sfp. */
export const ASSET_PROTOCOL = "sfasset";

/** URL for an asset inside a project archive. Pure string building, safe in preload and renderer. */
export function assetUrl(projectPath: string, asset: string): string {
    return `${ASSET_PROTOCOL}://project/${asset.split("/").map(encodeURIComponent).join("/")}?p=${encodeURIComponent(projectPath)}`;
}

/** A project as the project list shows it: its summary plus where it lives on disk. */
export interface ProjectListing {
    path: string;
    summary: ProjectSummary;
}

/** What the `.bak` next to a project holds, compared with the project file itself. */
export interface BackupInfo {
    /** When the backup was written (ISO). */
    savedAt: string;
    /** Characters of text in its screenplays and notes. */
    chars: number;
    /** The same for the project file, or null when the file doesn't open. */
    currentChars: number | null;
}

export interface AppSettings {
    autosave: boolean;
    onLaunch: "projects" | "last-project";
    timeTrackingIdleMinutes: number;
    theme: "dark" | "light" | "system";
    /** Colour palette id from lib/themes.ts, or "sceneform" for the built-in look. */
    palette: string;
    /** User CSS appended after every built-in style (override any --c-* token or class). */
    customCss: string;
    uiTextSize: number;
    reduceMotion: boolean;
    liveReparse: boolean;
    showHiddenNotes: boolean;
    autoIndentation: boolean;
    syntaxIntensity: "subtle" | "vivid";
    highContrastOutlines: boolean;
    editorZoom: number;
    /** Dictionary spellcheck in the script editor. */
    spellcheck: boolean;
    /** The user's own dictionary words. */
    userWords: string[];
    /** Name stamped on lines and canvas cards this user writes (authorship / blame). */
    authorName: string;
    /** Underline craft problems in the script (Alt+Enter offers fixes). */
    inspections: boolean;
    /** Target script length in pages; acts (# sections) that drift from their share are flagged. 0 = off. */
    targetPages: number;
    /** Live templates: abbreviation alone on a line + Tab (or Ctrl/Cmd+J). `$1`, `$2`… tab stops, `$0` the final cursor, \n a new line. */
    liveTemplates: Array<{ abbr: string; text: string }>;
    /** Active revision marks per project path: the Local History snapshot they compare against. */
    activeRevisions: Record<string, { snapshotId: string; label: string; color: string }>;
    lastProjectPath: string | null;
}

export const DEFAULT_SETTINGS: AppSettings = {
    autosave: true,
    onLaunch: "projects",
    timeTrackingIdleMinutes: 5,
    theme: "dark",
    palette: "sceneform",
    customCss: "",
    uiTextSize: 14,
    reduceMotion: false,
    liveReparse: true,
    showHiddenNotes: true,
    autoIndentation: true,
    syntaxIntensity: "vivid",
    highContrastOutlines: false,
    editorZoom: 100,
    spellcheck: true,
    userWords: [],
    authorName: "",
    inspections: true,
    targetPages: 0,
    liveTemplates: [],
    activeRevisions: {},
    lastProjectPath: null,
};

export interface AppInfo {
    /** package.json version, e.g. "0.80.0" */
    version: string;
    /** Version, build ID and quarter, e.g. "0.80.0+sf-9hmw Q4 2026" (shown in About and Settings). */
    build: string;
    /** Build ID generated once per build, e.g. "sf-9hmw". */
    buildId: string;
    /** ISO date the app was built. */
    buildDate: string;
    platform: "win32" | "darwin" | "linux" | string;
    electron: string;
    chrome: string;
    node: string;
}

export interface SceneformAPI {
    fountain: {
        /** Pick a .fountain or Final Draft .fdx file and return Fountain text (FDX is converted), or null when cancelled. */
        open(): Promise<Result<{ path: string; text: string } | null, ProjectError>>;
        /** Save Final Draft XML through a save dialog; cancelled is an error with code "cancelled". */
        saveFdx(xml: string, suggestedName: string): Promise<Result<{ path: string }, ProjectError>>;
    };
    profile: {
        open(): Promise<Result<ProfileState, ProfileError>>;
        defaultFolder(): Promise<Result<string, ProfileError>>;
        pickFolder(initial?: string | null): Promise<Result<{ path: string | null }, ProfileError>>;
        setFolder(folder: string): Promise<Result<ProfileState, ProfileError>>;
    };
    project: {
        list(folder: string): Promise<Result<ProjectListing[], ProjectError>>;
        recent(): Promise<Result<ProjectListing[], ProjectError>>;
        open(filePath: string): Promise<Result<{ path: string; data: SfpProjectData }, ProjectError>>;
        save(
            filePath: string,
            data: Partial<SfpProjectData>,
        ): Promise<Result<{ path: string; savedAt: string }, ProjectError>>;
        create(
            folder: string,
            name: string,
            author: string,
            logline: string,
            script?: string,
        ): Promise<Result<{ path: string; data: SfpProjectData }, ProjectError>>;
        /** Moves the project (and its .bak) to the OS trash. Never a hard delete. */
        trash(filePath: string): Promise<Result<boolean, ProjectError>>;
        rename(filePath: string, newTitle: string): Promise<Result<ProjectSummary, ProjectError>>;
        /** options.titlePageDefaults fill keys the script's own title page lacks. */
        exportPdf(
            script: string,
            defaultTitle: string,
            options?: PdfExportOptions,
        ): Promise<Result<{ path: string }, ProjectError>>;
        exportFountain(
            script: string,
            defaultTitle: string,
            titlePageDefaults?: TitlePageDefaults,
        ): Promise<Result<{ path: string }, ProjectError>>;
        browse(): Promise<Result<{ path: string | null }, ProjectError>>;
        reveal(filePath: string): Promise<void>;
        /** The project's `.bak` (the version before the last save), if it exists and opens. Read once per open. */
        backup(filePath: string): Promise<Result<BackupInfo | null, ProjectError>>;
        /** Put the `.bak` read by backup() back in place; the current file is kept as `<file>.replaced-<time>`. */
        /** Pick another .sfp (a collaborator's copy) and read it, for merging. Null when cancelled. */
        readCopy(currentPath: string): Promise<Result<{ path: string; data: SfpProjectData } | null, ProjectError>>;
        restoreBackup(filePath: string): Promise<Result<{ path: string; data: SfpProjectData; keptAs: string | null }, ProjectError>>;
    };
    settings: {
        load(): Promise<AppSettings>;
        save(settings: AppSettings): Promise<void>;
    };
    window: {
        minimize(): void;
        toggleMaximize(): void;
        close(): void;
        isMaximized(): Promise<boolean>;
        onMaximizedChange(cb: (maximized: boolean) => void): () => void;
        /** Main asks before closing so unsaved work can be flushed. */
        onCloseRequested(cb: () => void): () => void;
        confirmClose(): void;
    };
    history: {
        /** Local history snapshots of a project, newest first (kept in app data, never in the .sfp). */
        list(projectPath: string): Promise<Result<HistoryEntry[], ProjectError>>;
        read(projectPath: string, id: string): Promise<Result<HistoryDoc[] | null, ProjectError>>;
        /** Snapshot the given documents now, with a label ("Sent to producer"). */
        label(projectPath: string, docs: HistoryDoc[], label: string): Promise<Result<true, ProjectError>>;
    };
    assets: {
        /** Opens a picture chooser and copies the file into the project's assets/. Null when cancelled. */
        pick(projectPath: string): Promise<Result<{ asset: string } | null, ProjectError>>;
        /** Writes picture bytes (paste, drag and drop) into the project's assets/. */
        add(projectPath: string, fileName: string, bytes: Uint8Array): Promise<Result<{ asset: string }, ProjectError>>;
        /** Displayable URL for an asset ("assets/<name>"). */
        url(projectPath: string, asset: string): string;
    };
    app: {
        info(): Promise<AppInfo>;
        /** Opens an https:// link in the system browser. Anything else is refused. */
        openExternal(url: string): Promise<boolean>;
    };
}
