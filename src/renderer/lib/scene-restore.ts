// src/renderer/lib/scene-restore.ts
// Restore one scene from a Local History snapshot instead of the whole script.
// A scene's block runs from its hidden [[id:…]] marker (or its heading) to just before the
// next scene, section line or end of script. Scenes are matched between the snapshot and
// the current text by marker id when both have one, otherwise by heading text and which
// occurrence of that heading it is.

import { parseFountain } from "./fountain";

const ID_CAPTURE = /^\s*(?:\[\[id:([^\]\s]+)\]\]|@@ID[:\s]+(\S+))\s*$/i;

export interface SceneBlock {
    /** Matching key: "id:…" or "h:<HEADING>#<occurrence>". */
    key: string;
    heading: string;
    /** First and last line (0-based, inclusive) of the block. */
    first: number;
    last: number;
    text: string;
}

export function sceneBlocks(text: string): SceneBlock[] {
    const doc = parseFountain(text);
    const rows = text.split("\n");
    const seen = new Map<string, number>();
    const starts = doc.scenes.map((s) => {
        let first = s.line;
        let id: string | null = null;
        for (let i = s.line - 1; i >= 0 && i >= s.line - 3; i--) {
            const raw = rows[i] ?? "";
            if (!raw.trim()) continue;
            const m = ID_CAPTURE.exec(raw);
            if (m) {
                first = i;
                id = m[1] ?? m[2];
            }
            break;
        }
        return { scene: s, first, id };
    });
    return starts.map(({ scene, first, id }, k) => {
        let last = (k + 1 < starts.length ? starts[k + 1].first : rows.length) - 1;
        for (let i = scene.line + 1; i <= last; i++) {
            if (doc.lines[i]?.type === "section") {
                last = i - 1;
                break;
            }
        }
        // Keep trailing blank lines with the scene (they separate it from the next one).
        const heading = (scene.title || rows[scene.line] || "").trim().toUpperCase();
        const n = (seen.get(heading) ?? 0) + 1;
        seen.set(heading, n);
        return { key: id ? `id:${id}` : `h:${heading}#${n}`, heading: rows[scene.line].trim(), first, last, text: rows.slice(first, last + 1).join("\n") };
    });
}

export type SceneStatus = "same" | "changed" | "missing";

/** The snapshot's scenes, each with whether it differs from the current text. */
export function compareScenes(nowText: string, snapText: string): Array<SceneBlock & { status: SceneStatus }> {
    const now = new Map(sceneBlocks(nowText).map((b) => [b.key, b]));
    return sceneBlocks(snapText).map((b) => {
        const cur = now.get(b.key);
        const status: SceneStatus = !cur ? "missing" : cur.text.trimEnd() === b.text.trimEnd() ? "same" : "changed";
        return { ...b, status };
    });
}

/**
 * The single edit (offsets in `nowText`) that puts the snapshot's version of one scene back:
 * it replaces the matching scene, or, when the scene is gone, inserts it after the nearest
 * earlier snapshot scene that still exists (or before the first scene). Null if the key is
 * not in the snapshot.
 */
export function restoreSceneEdit(nowText: string, snapText: string, key: string): { from: number; to: number; insert: string } | null {
    const snap = sceneBlocks(snapText);
    const at = snap.findIndex((b) => b.key === key);
    if (at < 0) return null;
    const block = snap[at];
    const now = sceneBlocks(nowText);
    const rows = nowText.split("\n");
    const offset = (line: number) => {
        let off = 0;
        for (let i = 0; i < line && i < rows.length; i++) off += rows[i].length + 1;
        return Math.min(off, nowText.length);
    };
    const cur = now.find((b) => b.key === key);
    if (cur) {
        const from = offset(cur.first);
        const to = cur.last + 1 >= rows.length ? nowText.length : offset(cur.last + 1) - 1;
        // Keep the current block's trailing line break layout; swap only the content.
        return { from, to, insert: block.text.replace(/\n+$/, "") + (nowText.slice(from, to).match(/\n+$/)?.[0] ?? "") };
    }
    let insertLine: number;
    for (let k = at - 1; k >= 0; k--) {
        const prev = now.find((b) => b.key === snap[k].key);
        if (prev) {
            insertLine = prev.last + 1;
            return insertAt(insertLine);
        }
    }
    insertLine = now.length ? now[0].first : rows.length;
    return insertAt(insertLine);

    function insertAt(line: number) {
        const body = block.text.replace(/\n+$/, "");
        if (line >= rows.length) {
            const sep = nowText.endsWith("\n\n") ? "" : nowText.endsWith("\n") ? "\n" : "\n\n";
            return { from: nowText.length, to: nowText.length, insert: sep + body + "\n" };
        }
        const from = offset(line);
        const prevBlank = line === 0 || !rows[line - 1].trim();
        return { from, to: from, insert: (prevBlank ? "" : "\n") + body + "\n\n" };
    }
}
