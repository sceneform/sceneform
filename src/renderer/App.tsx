// src/renderer/App.tsx
//
// Startup, screens, settings and the project list. Everything about an open
// project lives in EditorScreen.

import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_SETTINGS, type AppInfo, type BackupInfo, type AppSettings, type ProjectListing, type SfpProjectData } from "../shared/bridge";
import { applyPalette } from "./lib/themes";
import { api } from "./lib/api";
import { baseName } from "./lib/format";
import { EditorScreen, type EditorScreenHandle } from "./EditorScreen";
import { FirstTimeSetupScreen, SplashScreen, StartupErrorScreen } from "./components/startup";
import { ProjectNewScreen, ProjectSelectScreen } from "./components/projects";
import { SettingsScreen } from "./components/settings";
import { ConfirmDialog, ToastRegion, type ConfirmRequest, type Toast } from "./components/ui";

type Boot =
    | { kind: "splash" }
    | { kind: "folder"; reason: "first-run" | "folder-missing" | "folder-unusable"; previous: string | null; suggested: string }
    | { kind: "error"; message: string }
    | { kind: "ready" };

type Screen = "projects" | "new" | "settings" | "editor";

export interface OpenProject {
    path: string;
    data: SfpProjectData;
    /** Bumped when the same path is reloaded (restored from its backup), so the editor remounts. */
    generation?: number;
}

/** A backup with much more text than the project file: likely something was lost. */
const backupLooksBetter = (b: BackupInfo) => b.currentChars !== null && b.chars - b.currentChars >= 1500 && b.currentChars < b.chars * 0.5;

export function App() {
    const [boot, setBoot] = useState<Boot>({ kind: "splash" });
    const [screen, setScreen] = useState<Screen>("projects");
    const [settingsReturn, setSettingsReturn] = useState<Screen>("projects");
    const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
    const [info, setInfo] = useState<AppInfo | null>(null);
    const [folder, setFolder] = useState("");
    const [projects, setProjects] = useState<ProjectListing[]>([]);
    const [recentProjects, setRecentProjects] = useState<ProjectListing[]>([]);
    const [loadingProjects, setLoadingProjects] = useState(true);
    const [busy, setBusy] = useState(false);
    const [formError, setFormError] = useState<string | null>(null);
    const [openProject, setOpenProject] = useState<OpenProject | null>(null);
    const [importDraft, setImportDraft] = useState<{ path: string; text: string } | null>(null);
    const [toasts, setToasts] = useState<Toast[]>([]);
    const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
    const [backupNotice, setBackupNotice] = useState<(BackupInfo & { path: string }) | null>(null);
    const editorRef = useRef<EditorScreenHandle>(null);

    /* ---------- toasts ---------- */

    const toast = useCallback((text: string, kind: Toast["kind"] = "success") => {
        const id = Date.now() + Math.random();
        setToasts((t) => [...t.slice(-3), { id, text, kind }]);
        window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 7000 : 3200);
    }, []);

    /* ---------- settings ---------- */

    const updateSettings = useCallback((patch: Partial<AppSettings>) => {
        setSettings((prev) => {
            const next = { ...prev, ...patch };
            void api.settings.save(next);
            return next;
        });
    }, []);

    useEffect(() => {
        const root = document.documentElement;
        root.style.fontSize = `${settings.uiTextSize / 14 * 16}px`;
        root.classList.toggle("reduce-motion", settings.reduceMotion);
        root.classList.toggle("high-contrast-focus", settings.highContrastOutlines);
        root.classList.toggle("syntax-subtle", settings.syntaxIntensity === "subtle");
        root.classList.toggle("hide-notes", !settings.showHiddenNotes);
        const forced = applyPalette(settings.palette ?? "sceneform", settings.customCss ?? "");
        const applyTheme = () => {
            const dark = forced ? forced === "dark" : settings.theme === "system" ? window.matchMedia("(prefers-color-scheme: dark)").matches : settings.theme !== "light";
            root.dataset.theme = dark ? "dark" : "light";
        };
        applyTheme();
        if (settings.theme !== "system") return;
        const mq = window.matchMedia("(prefers-color-scheme: dark)");
        mq.addEventListener("change", applyTheme);
        return () => mq.removeEventListener("change", applyTheme);
    }, [settings]);

    /* ---------- projects ---------- */

    const refreshProjects = useCallback(async (projectFolder: string) => {
        setLoadingProjects(true);
        const listed = await api.project.list(projectFolder);
        setLoadingProjects(false);
        if (listed.ok) setProjects(listed.value);
        else toast(`Couldn't read your project folder: ${listed.error.message}`, "error");
    }, [toast]);

    const refreshRecentProjects = useCallback(async () => {
        const recent = await api.project.recent();
        if (recent.ok) setRecentProjects(recent.value);
    }, []);

    const restoreBackup = useCallback(
        async (path: string) => {
            // Save what's open first, so nothing pending lands on top of the restored file.
            if (editorRef.current && !(await editorRef.current.flush())) {
                toast("Couldn't save the open project first, so the backup wasn't restored.", "error");
                return false;
            }
            setBusy(true);
            const r = await api.project.restoreBackup(path);
            setBusy(false);
            if (!r.ok) {
                toast(`Couldn't restore the backup: ${r.error.message}`, "error");
                return false;
            }
            setBackupNotice(null);
            await refreshRecentProjects();
            setOpenProject((prev) => ({ path: r.value.path, data: r.value.data, generation: (prev?.generation ?? 0) + 1 }));
            setScreen("editor");
            updateSettings({ lastProjectPath: r.value.path });
            toast(r.value.keptAs ? `Restored the backup. The version it replaced is kept as ${baseName(r.value.keptAs)}.` : "Restored the backup.", "success");
            return true;
        },
        [toast, updateSettings, refreshRecentProjects],
    );

    /** Reopen the open project from disk (after a merge was saved into it); the editor remounts. */
    const reloadProject = useCallback(
        async (path: string) => {
            const opened = await api.project.open(path);
            if (!opened.ok) return toast(`Couldn't reopen ${baseName(path)}: ${opened.error.message}`, "error");
            await api.project.backup(path); // the .bak is now the pre-merge version
            setOpenProject((prev) => ({ path: opened.value.path, data: opened.value.data, generation: (prev?.generation ?? 0) + 1 }));
        },
        [toast],
    );

    const openPath = useCallback(
        async (path: string, quiet = false) => {
            setBusy(true);
            const opened = await api.project.open(path);
            // The .bak is read now, before this session's first save replaces it.
            const backup = await api.project.backup(path);
            setBusy(false);
            const b = backup.ok ? backup.value : null;
            if (!opened.ok) {
                if (b) {
                    setConfirm({
                        title: `Restore ${baseName(path)} from its backup?`,
                        body: `It doesn't open (${opened.error.message}). Its backup from ${new Date(b.savedAt).toLocaleString()} opens fine. Restoring keeps the damaged file next to it, renamed.`,
                        confirmLabel: "Restore backup",
                        onConfirm: () => void restoreBackup(path),
                    });
                } else if (!quiet) toast(`Couldn't open ${baseName(path)}: ${opened.error.message}`, "error");
                return false;
            }
            setBackupNotice(b && backupLooksBetter(b) ? { ...b, path: opened.value.path } : null);
            await refreshRecentProjects();
            setOpenProject({ path: opened.value.path, data: opened.value.data });
            setScreen("editor");
            updateSettings({ lastProjectPath: opened.value.path });
            return true;
        },
        [toast, updateSettings, refreshRecentProjects, restoreBackup],
    );

    const openRecentPath = useCallback(async (path: string) => {
        if (screen === "editor" && editorRef.current && !(await editorRef.current.flush())) {
            setConfirm({
                title: "Open another project without saving?",
                body: "The last save failed. If you switch projects, your latest changes will be lost.",
                confirmLabel: "Open project",
                danger: true,
                onConfirm: () => void openPath(path),
            });
            return;
        }
        await openPath(path);
    }, [openPath, screen]);

    /* ---------- boot ---------- */

    const start = useCallback(async () => {
        setBoot({ kind: "splash" });
        const minimum = new Promise((r) => setTimeout(r, 350)); // avoid a one-frame flash, nothing more
        const [loaded, appInfo, profile] = await Promise.all([api.settings.load(), api.app.info(), api.profile.open(), refreshRecentProjects()]);
        setSettings(loaded);
        setInfo(appInfo);
        await minimum;

        if (profile.ok) {
            setFolder(profile.value.projectFolder);
            for (const w of profile.value.warnings) toast(w.message, "info");
            await refreshProjects(profile.value.projectFolder);
            setBoot({ kind: "ready" });
            if (loaded.onLaunch === "last-project" && loaded.lastProjectPath) {
                await openPath(loaded.lastProjectPath, true);
            }
            return;
        }

        const code = profile.error.code;
        if (code === "no-folder" || code === "folder-missing" || code === "folder-unusable") {
            const suggested = await api.profile.defaultFolder();
            setBoot({
                kind: "folder",
                reason: code === "no-folder" ? "first-run" : code,
                previous: profile.error.folder ?? null,
                suggested: suggested.ok ? suggested.value : "",
            });
        } else {
            setBoot({ kind: "error", message: profile.error.message });
        }
    }, [openPath, refreshProjects, refreshRecentProjects, toast]);

    useEffect(() => {
        void start();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const applyFolder = async (chosen: string) => {
        setBusy(true);
        setFormError(null);
        const result = await api.profile.setFolder(chosen);
        setBusy(false);
        if (!result.ok) {
            setFormError(result.error.message);
            return false;
        }
        setFolder(result.value.projectFolder);
        await refreshProjects(result.value.projectFolder);
        setBoot({ kind: "ready" });
        return true;
    };

    const pickFolder = async () => {
        const picked = await api.profile.pickFolder(folder || null);
        if (!picked.ok) {
            setFormError(picked.error.message);
            return false;
        }
        if (!picked.value.path) return false;
        const changed = await applyFolder(picked.value.path);
        if (changed && boot.kind === "ready") toast("Project folder changed.");
        return changed;
    };

    /* ---------- window close ---------- */

    useEffect(
        () =>
            api.window.onCloseRequested(async () => {
                const saved = editorRef.current ? await editorRef.current.flush() : true;
                if (saved) {
                    api.window.confirmClose();
                    return;
                }
                setConfirm({
                    title: "Close without saving?",
                    body: "Sceneform couldn't save your latest changes. If you close now, they will be lost.",
                    confirmLabel: "Close anyway",
                    danger: true,
                    onConfirm: () => api.window.confirmClose(),
                });
            }),
        [],
    );

    /* ---------- actions ---------- */

    const leaveEditor = async (to: Screen) => {
        if (editorRef.current && !(await editorRef.current.flush())) {
            setConfirm({
                title: "Leave without saving?",
                body: "The last save failed. If you leave the editor, your latest changes will be lost.",
                confirmLabel: "Leave anyway",
                danger: true,
                onConfirm: () => {
                    setOpenProject(null);
                    setScreen(to);
                    void refreshProjects(folder);
                },
            });
            return;
        }
        setOpenProject(null);
        setScreen(to);
        void refreshProjects(folder);
    };

    const createProject = async (name: string, author: string, logline: string) => {
        setBusy(true);
        setFormError(null);
        const created = await api.project.create(folder, name, author, logline, importDraft?.text);
        setBusy(false);
        if (!created.ok) {
            setFormError(created.error.message);
            return;
        }
        setImportDraft(null);
        void refreshProjects(folder);
        await refreshRecentProjects();
        setOpenProject({ path: created.value.path, data: created.value.data });
        setScreen("editor");
        updateSettings({ lastProjectPath: created.value.path });
    };

    const importFountain = async () => {
        const picked = await api.fountain.open();
        if (!picked.ok) {
            toast(picked.error.message, "error");
            return;
        }
        if (!picked.value) return;
        setImportDraft(picked.value);
        setFormError(null);
        setScreen("new");
    };

    const browseProject = async () => {
        const picked = await api.project.browse();
        if (picked.ok && picked.value.path) await openPath(picked.value.path);
        else if (!picked.ok) toast(picked.error.message, "error");
    };

    const renameProject = async (path: string, title: string) => {
        const renamed = await api.project.rename(path, title);
        if (!renamed.ok) toast(`Couldn't rename: ${renamed.error.message}`, "error");
        await refreshProjects(folder);
        await refreshRecentProjects();
    };

    const updateNotes = async (path: string, notes: string) => {
        const listing = projects.find((p) => p.path === path);
        if (!listing) return;
        const saved = await api.project.save(path, { project: { ...listing.summary, notes } });
        if (!saved.ok) toast(`Couldn't save notes: ${saved.error.message}`, "error");
        else setProjects((list) => list.map((p) => (p.path === path ? { ...p, summary: { ...p.summary, notes } } : p)));
    };

    const trashProject = (listing: ProjectListing) =>
        setConfirm({
            title: `Move "${listing.summary.title}" to the trash?`,
            body: (
                <>
                    <span className="mono">{baseName(listing.path)}</span> and its backup go to your system trash, so you can still restore them from there.
                </>
            ),
            confirmLabel: "Move to trash",
            danger: true,
            onConfirm: async () => {
                const result = await api.project.trash(listing.path);
                if (!result.ok) toast(`Couldn't move it to the trash: ${result.error.message}`, "error");
                else toast(`Moved "${listing.summary.title}" to the trash.`, "info");
                await refreshProjects(folder);
                await refreshRecentProjects();
            },
        });

    const openSettings = (from: Screen) => {
        setSettingsReturn(from);
        setScreen("settings");
    };

    /* ---------- render ---------- */

    let body: React.ReactElement;
    if (boot.kind === "splash") {
        body = <SplashScreen version={info?.version ?? ""} />;
    } else if (boot.kind === "error") {
        body = <StartupErrorScreen message={boot.message} onRetry={() => void start()} />;
    } else if (boot.kind === "folder") {
        body = (
            <FirstTimeSetupScreen
                busy={busy}
                error={formError}
                reason={boot.reason}
                previousFolder={boot.previous}
                suggestedFolder={boot.suggested}
                onUseSuggested={() => void applyFolder(boot.suggested)}
                onChoose={() => void pickFolder()}
            />
        );
    } else if (screen === "settings") {
        body = (
            <SettingsScreen
                settings={settings}
                info={info}
                projectFolder={folder}
                backLabel={settingsReturn === "editor" ? "Back to script" : "Back to projects"}
                onChange={updateSettings}
                onReset={() => updateSettings({ ...DEFAULT_SETTINGS, lastProjectPath: settings.lastProjectPath })}
                onChangeFolder={() => void pickFolder()}
                onBack={() => setScreen(settingsReturn === "editor" && openProject ? "editor" : "projects")}
            />
        );
    } else if (screen === "new") {
        body = (
            <ProjectNewScreen
                key={importDraft?.path ?? "blank"}
                busy={busy}
                error={formError}
                folder={folder}
                defaultAuthor={projects[0]?.summary.author && projects[0].summary.author !== "Author" ? projects[0].summary.author : ""}
                importedFrom={importDraft?.path ?? null}
                onCancel={() => {
                    setImportDraft(null);
                    setFormError(null);
                    setScreen("projects");
                }}
                onCreate={(n, a, l) => void createProject(n, a, l)}
                onChangeFolder={() => void pickFolder()}
            />
        );
    } else if (screen === "editor" && openProject) {
        body = <></>;
    } else {
        body = (
            <ProjectSelectScreen
                projects={projects}
                recentProjects={recentProjects}
                loading={loadingProjects}
                folder={folder}
                onOpen={(p) => void openPath(p)}
                onOpenRecent={(p) => void openRecentPath(p)}
                onNew={() => {
                    setImportDraft(null);
                    setFormError(null);
                    setScreen("new");
                }}
                onImportFountain={() => void importFountain()}
                onBrowse={() => void browseProject()}
                onSettings={() => openSettings("projects")}
                onRename={(p, t) => void renameProject(p, t)}
                onUpdateNotes={(p, n) => void updateNotes(p, n)}
                onTrash={trashProject}
                onReveal={(p) => void api.project.reveal(p)}
            />
        );
    }

    return (
        <>
            {body}
            {/* The editor stays mounted while Settings is open so its undo history and caret survive. */}
            {openProject && boot.kind === "ready" && (screen === "editor" || screen === "settings") && (
                <div style={{ display: screen === "editor" ? "contents" : "none" }}>
                    <EditorScreen
                        ref={editorRef}
                        key={`${openProject.path}#${openProject.generation ?? 0}`}
                        project={openProject}
                        settings={settings}
                        active={screen === "editor"}
                        onSettingsChange={updateSettings}
                        onExit={() => void leaveEditor("projects")}
                        recentProjects={recentProjects}
                        onOpenRecent={openRecentPath}
                        onOpenSettings={() => openSettings("editor")}
                        toast={toast}
                        backupNotice={backupNotice && backupNotice.path === openProject.path ? backupNotice : null}
                        onRestoreBackup={() => void restoreBackup(openProject.path)}
                        onDismissBackup={() => setBackupNotice(null)}
                        onReload={() => void reloadProject(openProject.path)}
                    />
                </div>
            )}
            <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
            <ToastRegion toasts={toasts} onDismiss={(id) => setToasts((t) => t.filter((x) => x.id !== id))} />
        </>
    );
}
