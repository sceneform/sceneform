// src/desktop/local-history.ts
// IntelliJ-style Local History: every save drops a snapshot of the project's screenplays
// and notes into the user's app data folder (never inside the .sfp, so sharing a project
// never shares its drafts). Snapshots are taken at most every SNAPSHOT_EVERY_MS unless the
// text changed a lot, only when something changed, and pruned to KEEP entries.

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export interface HistoryDoc {
    id: string;
    kind: string;
    title: string;
    content: string;
}

export interface HistoryEntry {
    /** ISO time, also the snapshot id. */
    id: string;
    docs: Array<{ id: string; kind: string; title: string; chars: number }>;
    label?: string;
}

const SNAPSHOT_EVERY_MS = 3 * 60 * 1000;
const BIG_CHANGE_CHARS = 400;
const KEEP = 300;

export function createLocalHistory(root: string) {
    const dirFor = (projectPath: string) => path.join(root, crypto.createHash("sha1").update(path.resolve(projectPath)).digest("hex").slice(0, 16));
    const fileFor = (dir: string, id: string) => path.join(dir, `${id.replace(/[:.]/g, "-")}.json`);

    async function entries(projectPath: string): Promise<Array<{ file: string; id: string }>> {
        const dir = dirFor(projectPath);
        const names = await fs.readdir(dir).catch(() => [] as string[]);
        const out: Array<{ file: string; id: string }> = [];
        for (const n of names.filter((n) => n.endsWith(".json")).sort()) out.push({ file: path.join(dir, n), id: n });
        return out;
    }

    async function readSnapshot(file: string): Promise<{ id: string; label?: string; docs: HistoryDoc[] } | null> {
        try {
            return JSON.parse(await fs.readFile(file, "utf8"));
        } catch {
            return null;
        }
    }

    return {
        /** Record a snapshot after a save. `force` (a manual "put a label") always records. */
        async record(projectPath: string, docs: HistoryDoc[], options: { force?: boolean; label?: string } = {}): Promise<void> {
            const wanted = docs.filter((d) => (d.kind === "script" || d.kind === "note") && typeof d.content === "string");
            if (!wanted.length) return;
            const dir = dirFor(projectPath);
            await fs.mkdir(dir, { recursive: true });
            const list = await entries(projectPath);
            const last = list.length ? await readSnapshot(list[list.length - 1].file) : null;
            if (last && !options.force) {
                const before = new Map(last.docs.map((d) => [d.id, d.content]));
                let changed = 0;
                for (const d of wanted) {
                    const prev = before.get(d.id);
                    if (prev === undefined) changed += d.content.length;
                    else if (prev !== d.content) changed += Math.abs(prev.length - d.content.length) || 1;
                }
                if (changed === 0) return;
                const age = Date.now() - Date.parse(last.id);
                if (age < SNAPSHOT_EVERY_MS && changed < BIG_CHANGE_CHARS) return;
            }
            const id = new Date().toISOString();
            await fs.writeFile(fileFor(dir, id), JSON.stringify({ id, label: options.label, docs: wanted }), "utf8");
            const all = await entries(projectPath);
            for (const old of all.slice(0, Math.max(0, all.length - KEEP))) await fs.rm(old.file, { force: true });
        },

        async list(projectPath: string): Promise<HistoryEntry[]> {
            const out: HistoryEntry[] = [];
            for (const e of (await entries(projectPath)).reverse()) {
                const snap = await readSnapshot(e.file);
                if (!snap) continue;
                out.push({ id: snap.id, label: snap.label, docs: snap.docs.map((d) => ({ id: d.id, kind: d.kind, title: d.title, chars: d.content.length })) });
            }
            return out;
        },

        async read(projectPath: string, id: string): Promise<HistoryDoc[] | null> {
            const snap = await readSnapshot(fileFor(dirFor(projectPath), id));
            return snap?.docs ?? null;
        },
    };
}
