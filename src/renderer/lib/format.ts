// src/renderer/lib/format.ts

/** "updated" is stored as ISO; older archives hold free text like "Just now". */
export function relativeTime(value: string, now = Date.now()): string {
    const t = Date.parse(value);
    if (Number.isNaN(t)) return value || "Unknown";
    const s = Math.round((now - t) / 1000);
    if (s < 45) return "just now";
    const m = Math.round(s / 60);
    if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.round(h / 24);
    if (d < 7) return d === 1 ? "yesterday" : `${d} days ago`;
    return new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** Parses "1h 12m", "45m" or "2h" into minutes. Anything else counts as 0. */
export function parseTimeSpent(value: string | undefined): number {
    if (!value) return 0;
    const h = /(\d+)\s*h/i.exec(value);
    const m = /(\d+)\s*m/i.exec(value);
    return (h ? Number(h[1]) * 60 : 0) + (m ? Number(m[1]) : 0);
}

export function formatTimeSpent(minutes: number): string {
    const total = Math.max(0, Math.floor(minutes));
    const h = Math.floor(total / 60);
    const m = total % 60;
    return h ? `${h}h ${m}m` : `${m}m`;
}

export function formatRuntime(minutes: number): string {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h ? `~${h}h ${m}m` : `~${m}m`;
}

/** The file name a user sees for a path, without folders. */
export function baseName(path: string): string {
    return path.split(/[\\/]/).pop() || path;
}

export const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);
export const modKey = isMac ? "⌘" : "Ctrl";
