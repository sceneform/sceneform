// src/renderer/lib/rename.ts
// Rename a character across a script (IntelliJ's Shift+F6 for screenplays): every cue,
// and the name as written in action, dialogue, parentheticals, lyrics, notes and synopses,
// in both ALL CAPS (an intro) and Title Case. Scene headings are left alone unless asked
// (`headings: true`), since "INT. JOHN'S HOUSE" is a location; the caller then moves the
// matching location entries too (renameInKey). The title page is never touched.

import { parseFountain } from "./fountain";

export interface TextEdit {
    from: number;
    to: number;
    insert: string;
}

const title = (s: string) => s.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_m, a: string, b: string) => a + b.toUpperCase());
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const TOUCH = new Set(["action", "dialogue", "parenthetical", "lyrics", "centered", "note", "synopsis"]);

export interface RenameOptions {
    /** Also rename inside scene headings ("INT. JOHN'S HOUSE" → "INT. MIKE'S HOUSE"). */
    headings?: boolean;
}

/** The name replaced as a whole word inside an upper-case key (a location name); null if absent. */
export function renameInKey(key: string, oldName: string, newName: string): string | null {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escape(oldName.trim().toUpperCase())}(?![\\p{L}\\p{N}])`, "gu");
    const next = key.replace(re, newName.trim().toUpperCase());
    return next === key ? null : next;
}

export function renameEdits(text: string, oldName: string, newName: string, opts: RenameOptions = {}): TextEdit[] {
    const from = oldName.trim().toUpperCase();
    const to = newName.trim().toUpperCase();
    if (!from || !to || from === to) return [];
    const parsed = parseFountain(text);
    const variants: Array<[RegExp, string]> = [
        [new RegExp(`(?<![\\p{L}\\p{N}])${escape(from)}(?![\\p{L}\\p{N}])`, "gu"), to],
        [new RegExp(`(?<![\\p{L}\\p{N}])${escape(title(from))}(?![\\p{L}\\p{N}])`, "gu"), title(to)],
    ];
    const edits: TextEdit[] = [];
    const rows = text.split("\n");
    let offset = 0;
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const type = parsed.lines[i]?.type ?? "blank";
        if (type === "character") {
            const m = row.match(new RegExp(`^(\\s*@?)(${escape(from)})(?=\\s*(\\(|\\^|$))`, "i"));
            if (m) edits.push({ from: offset + m[1].length, to: offset + m[1].length + m[2].length, insert: m[2] === m[2].toUpperCase() ? to : title(to) });
        } else if (TOUCH.has(type) || (opts.headings && type === "scene_heading")) {
            const hits: TextEdit[] = [];
            for (const [re, rep] of variants) {
                re.lastIndex = 0;
                let m: RegExpExecArray | null;
                while ((m = re.exec(row))) hits.push({ from: offset + m.index, to: offset + m.index + m[0].length, insert: rep });
            }
            edits.push(...hits.sort((a, b) => a.from - b.from));
        }
        offset += row.length + 1;
    }
    return edits;
}

export function applyEdits(text: string, edits: TextEdit[]): string {
    let out = "";
    let pos = 0;
    for (const e of edits) {
        out += text.slice(pos, e.from) + e.insert;
        pos = e.to;
    }
    return out + text.slice(pos);
}
