// src/renderer/lib/shortcuts.ts
// The shortcuts list is the same table the key handler reads, so the reference
// can't list a shortcut that doesn't work (the old list had several).
import { modKey } from "./format";

export interface Shortcut {
    description: string;
    keys: string[];
}

export const SHORTCUTS: Shortcut[] = [
    { description: "Save", keys: [modKey, "S"] },
    { description: "Close tab", keys: [modKey, "W"] },
    { description: "Extend / shrink selection", keys: ["Alt", "Shift", "↑ ↓"] },
    { description: "Command palette", keys: [modKey, "K"] },
    { description: "Command palette (alt)", keys: [modKey, "Shift", "P"] },
    { description: "Find / replace", keys: [modKey, "F"] },
    { description: "Export", keys: [modKey, "E"] },
    { description: "Explorer", keys: [modKey, "1"] },
    { description: "Outline", keys: [modKey, "2"] },
    { description: "Characters & locations", keys: [modKey, "3"] },
    { description: "Canvas", keys: [modKey, "4"] },
    { description: "Statistics", keys: [modKey, "5"] },
    { description: "Problems (inspections)", keys: [modKey, "6"] },
    { description: "Find usages (cue, name or scene heading)", keys: ["Alt", "F7"] },
    { description: "Toggle sidebar", keys: [modKey, "B"] },
    { description: "Toggle inspector", keys: [modKey, "Alt", "B"] },
    { description: "Live preview", keys: [modKey, "P"] },
    { description: "Focus mode", keys: [modKey, "."] },
    { description: "Exit focus mode", keys: ["Esc"] },
    { description: "Zoom in / out / reset", keys: [modKey, "+ − 0"] },
    { description: "Next / previous scene", keys: ["Alt", "↓ ↑"] },
    { description: "Move scene up / down", keys: [modKey, "Shift", "↑ ↓"] },
    { description: "Move scene up / down (alt)", keys: ["Alt", "Shift", "PgUp PgDn"] },
    { description: "Expand live template (abbreviation alone on a line)", keys: ["Tab"] },
    { description: "Insert live template (picker)", keys: [modKey, "J"] },
    { description: "Next / previous template field", keys: ["Tab", "Shift+Tab"] },
    { description: "Character name", keys: ["@", "Tab"] },
    { description: "Reuse scene heading", keys: ["!", "Tab"] },
    { description: "Scene heading builder", keys: ["INT", "Tab"] },
];
