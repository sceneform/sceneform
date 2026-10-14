// src/backend/project-service.ts

import fs from "node:fs/promises";
import path from "node:path";
import { BrowserWindow, dialog } from "electron";
import {
    readProjectArchive,
    writeProjectArchive,
    createDefaultSfpPayload,
    extractCleanFountain,
    type SfpProjectData,
} from "./sfp-archive.js";
import { generateScreenplayPdf, type PdfExportOptions } from "./pdf-export.js";
import { parseScreenplay } from "./screenplay.js";
import { applyTitlePageDefaults, type TitlePageDefaults } from "./title-page.js";
import { ok, err, type Result } from "./result.js";
import type { ProjectSummary } from "./types/project.js";
import type { ProfileService } from "./project-profile.js";

export interface ProjectError {
    code:
        "not-found" | "invalid-format" | "io-error" | "cancelled" | "internal";
    message: string;
}

export interface ProjectService {
    listProjects(
        projectFolder: string,
    ): Promise<Result<ProjectSummary[], ProjectError>>;
    openProject(
        filePath: string,
    ): Promise<Result<{ path: string; data: SfpProjectData }, ProjectError>>;
    saveProject(
        filePath: string,
        data: Partial<SfpProjectData>,
    ): Promise<Result<{ path: string; savedAt: string }, ProjectError>>;
    createProject(
        projectFolder: string,
        name: string,
        author: string,
        logline: string,
        script?: string,
    ): Promise<Result<{ path: string; data: SfpProjectData }, ProjectError>>;
    deleteProject(filePath: string): Promise<Result<boolean, ProjectError>>;
    renameProject(
        filePath: string,
        newTitle: string,
    ): Promise<Result<ProjectSummary, ProjectError>>;
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
    browseProjectFile(): Promise<Result<{ path: string | null }, ProjectError>>;
}

/**
 * The script as it should be exported: Sceneform's internal markers removed and
 * any title-page key the script lacks filled in from the project defaults.
 * The script's own title-page values always win.
 */
export function prepareScriptForExport(script: string, defaults?: TitlePageDefaults): string {
    const clean = extractCleanFountain(script);
    if (!defaults || Object.keys(defaults).length === 0) return clean;
    const parsed = parseScreenplay(clean);
    return applyTitlePageDefaults(clean, parsed.titleEntries, defaults);
}

export function createProjectService(
    profileService: ProfileService,
    getWindow: () => BrowserWindow | null,
): ProjectService {
    return {
        async listProjects(
            projectFolder: string,
        ): Promise<Result<ProjectSummary[], ProjectError>> {
            try {
                const entries = await fs.readdir(projectFolder, {
                    withFileTypes: true,
                });
                const summaries: ProjectSummary[] = [];

                for (const entry of entries) {
                    if (
                        entry.isFile() &&
                        entry.name.toLowerCase().endsWith(".sfp")
                    ) {
                        const fullPath = path.join(projectFolder, entry.name);
                        try {
                            const archive = await readProjectArchive(fullPath);
                            summaries.push({
                                ...archive.project,
                                id: entry.name.replace(/\.sfp$/i, ""),
                            });
                        } catch {
                            summaries.push({
                                id: entry.name.replace(/\.sfp$/i, ""),
                                title: entry.name.replace(/\.sfp$/i, ""),
                                author: "Unknown",
                                logline: "",
                                updated: "Unknown",
                                pages: 1,
                                timeSpent: "0m",
                                notes: "",
                                scenes: 1,
                                color: "var(--c-blue-bright)",
                            });
                        }
                    }
                }

                return ok(summaries);
            } catch (error) {
                return err({
                    code: "io-error",
                    message:
                        error instanceof Error
                            ? error.message
                            : "Failed to read project directory",
                });
            }
        },

        async openProject(
            filePath: string,
        ): Promise<
            Result<{ path: string; data: SfpProjectData }, ProjectError>
        > {
            try {
                const data = await readProjectArchive(filePath);
                return ok({ path: filePath, data });
            } catch (error) {
                return err({
                    code: "invalid-format",
                    message:
                        error instanceof Error
                            ? error.message
                            : "Could not open .sfp project container",
                });
            }
        },

        async saveProject(
            filePath: string,
            data: Partial<SfpProjectData>,
        ): Promise<Result<{ path: string; savedAt: string }, ProjectError>> {
            try {
                await writeProjectArchive(filePath, data, true);
                return ok({
                    path: filePath,
                    savedAt: new Date().toISOString(),
                });
            } catch (error) {
                return err({
                    code: "io-error",
                    message:
                        error instanceof Error
                            ? error.message
                            : "Failed to save project archive",
                });
            }
        },

        async createProject(
            projectFolder: string,
            name: string,
            author: string,
            logline: string,
            script?: string,
        ): Promise<
            Result<{ path: string; data: SfpProjectData }, ProjectError>
        > {
            try {
                const pathResult = await profileService.newProjectPath(name);
                if (!pathResult.ok) {
                    return err({
                        code: "invalid-format",
                        message: pathResult.error.message,
                    });
                }

                const projectPath = pathResult.value.path;
                const initialData = createDefaultSfpPayload(
                    name,
                    author,
                    logline,
                    script,
                );
                await writeProjectArchive(projectPath, initialData, false);
                await profileService.registerProject(
                    pathResult.value.location,
                    name,
                );

                return ok({ path: projectPath, data: initialData });
            } catch (error) {
                return err({
                    code: "io-error",
                    message:
                        error instanceof Error
                            ? error.message
                            : "Failed to create new project archive",
                });
            }
        },

        async deleteProject(
            filePath: string,
        ): Promise<Result<boolean, ProjectError>> {
            try {
                await fs.unlink(filePath);
                try {
                    await fs.unlink(`${filePath}.bak`);
                } catch {
                    // Backup file deletion failure is non-fatal when no backup exists yet
                }
                return ok(true);
            } catch (error) {
                return err({
                    code: "io-error",
                    message:
                        error instanceof Error
                            ? error.message
                            : "Failed to delete project archive",
                });
            }
        },

        async renameProject(
            filePath: string,
            newTitle: string,
        ): Promise<Result<ProjectSummary, ProjectError>> {
            try {
                const archive = await readProjectArchive(filePath);
                const updatedProject: ProjectSummary = {
                    ...archive.project,
                    title: newTitle.trim() || archive.project.title,
                    updated: "Just now",
                };
                await writeProjectArchive(
                    filePath,
                    { project: updatedProject },
                    true,
                );
                return ok(updatedProject);
            } catch (error) {
                return err({
                    code: "io-error",
                    message:
                        error instanceof Error
                            ? error.message
                            : "Failed to rename project",
                });
            }
        },

        async exportPdf(
            script: string,
            defaultTitle: string,
            options?: PdfExportOptions,
        ): Promise<Result<{ path: string }, ProjectError>> {
            try {
                const win = getWindow();
                const saveDialogOptions = {
                    title: "Export Screenplay to Industry PDF",
                    defaultPath: `${defaultTitle.toLowerCase().replace(/[^a-z0-9_-]/g, "-") || "screenplay"}.pdf`,
                    filters: [{ name: "PDF Document", extensions: ["pdf"] }],
                };

                const result = win
                    ? await dialog.showSaveDialog(win, saveDialogOptions)
                    : await dialog.showSaveDialog(saveDialogOptions);

                if (result.canceled || !result.filePath) {
                    return err({
                        code: "cancelled",
                        message: "PDF export was cancelled",
                    });
                }

                const pdfBytes = await generateScreenplayPdf(
                    prepareScriptForExport(script, options?.titlePageDefaults),
                    options,
                );
                await fs.writeFile(result.filePath, Buffer.from(pdfBytes));

                return ok({ path: result.filePath });
            } catch (error) {
                return err({
                    code: "io-error",
                    message:
                        error instanceof Error
                            ? error.message
                            : "Failed to export PDF",
                });
            }
        },

        async exportFountain(
            script: string,
            defaultTitle: string,
            titlePageDefaults?: TitlePageDefaults,
        ): Promise<Result<{ path: string }, ProjectError>> {
            try {
                const win = getWindow();
                const cleanScript = prepareScriptForExport(script, titlePageDefaults);
                const saveDialogOptions = {
                    title: "Export Screenplay to Portable Fountain",
                    defaultPath: `${defaultTitle.toLowerCase().replace(/[^a-z0-9_-]/g, "-") || "screenplay"}.fountain`,
                    filters: [
                        {
                            name: "Fountain Script",
                            extensions: ["fountain", "spmd", "txt"],
                        },
                    ],
                };

                const result = win
                    ? await dialog.showSaveDialog(win, saveDialogOptions)
                    : await dialog.showSaveDialog(saveDialogOptions);

                if (result.canceled || !result.filePath) {
                    return err({
                        code: "cancelled",
                        message: "Fountain export was cancelled",
                    });
                }

                await fs.writeFile(result.filePath, cleanScript, "utf-8");
                return ok({ path: result.filePath });
            } catch (error) {
                return err({
                    code: "io-error",
                    message:
                        error instanceof Error
                            ? error.message
                            : "Failed to export Fountain file",
                });
            }
        },

        async browseProjectFile(): Promise<
            Result<{ path: string | null }, ProjectError>
        > {
            try {
                const win = getWindow();
                const openOptions = {
                    title: "Open Sceneform Project Package",
                    properties: ["openFile"] as Array<"openFile">,
                    filters: [
                        {
                            name: "Sceneform Project Package",
                            extensions: ["sfp"],
                        },
                        { name: "All Files", extensions: ["*"] },
                    ],
                };

                const result = win
                    ? await dialog.showOpenDialog(win, openOptions)
                    : await dialog.showOpenDialog(openOptions);

                return ok({
                    path:
                        result.canceled || result.filePaths.length === 0
                            ? null
                            : result.filePaths[0],
                });
            } catch (error) {
                return err({
                    code: "internal",
                    message:
                        error instanceof Error
                            ? error.message
                            : "Failed to open file browser",
                });
            }
        },
    };
}
