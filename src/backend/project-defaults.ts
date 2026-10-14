// src/backend/project-defaults.ts
// Per-project settings (stored in project-settings.json inside a v2 .sfp).
// Kept free of Node imports so the renderer can use the defaults too.

export type ProjectType = "film" | "series";

export interface ProjectSettings {
    type: ProjectType;
    /** Paper size for PDF export. */
    pageSize: "letter" | "a4";
    /** Print scene numbers in PDF export. */
    sceneNumbers: boolean;
    /** Per-project autosave override; "inherit" follows the global setting. */
    autosave: "inherit" | "on" | "off";
}

export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = {
    type: "film",
    pageSize: "letter",
    sceneNumbers: true,
    autosave: "inherit",
};
