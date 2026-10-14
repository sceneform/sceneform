// src/renderer/lib/diff.ts
// Line diff for Local History: common prefix/suffix trimmed, LCS on the middle.

export interface DiffLine {
    op: " " | "+" | "-";
    text: string;
}

const MAX_CELLS = 4_000_000;

export function lineDiff(before: string, after: string): DiffLine[] {
    const a = before.split("\n");
    const b = after.split("\n");
    let start = 0;
    while (start < a.length && start < b.length && a[start] === b[start]) start++;
    let endA = a.length;
    let endB = b.length;
    while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
        endA--;
        endB--;
    }
    const head = a.slice(0, start).map((text) => ({ op: " " as const, text }));
    const tail = a.slice(endA).map((text) => ({ op: " " as const, text }));
    const ma = a.slice(start, endA);
    const mb = b.slice(start, endB);
    let middle: DiffLine[];
    if (ma.length * mb.length > MAX_CELLS) {
        // Too big to align: show it as a block replace.
        middle = [...ma.map((text) => ({ op: "-" as const, text })), ...mb.map((text) => ({ op: "+" as const, text }))];
    } else {
        const n = ma.length;
        const m = mb.length;
        const dp = new Uint32Array((n + 1) * (m + 1));
        for (let i = n - 1; i >= 0; i--)
            for (let j = m - 1; j >= 0; j--)
                dp[i * (m + 1) + j] = ma[i] === mb[j] ? dp[(i + 1) * (m + 1) + j + 1] + 1 : Math.max(dp[(i + 1) * (m + 1) + j], dp[i * (m + 1) + j + 1]);
        middle = [];
        let i = 0;
        let j = 0;
        while (i < n && j < m) {
            if (ma[i] === mb[j]) {
                middle.push({ op: " ", text: ma[i] });
                i++;
                j++;
            } else if (dp[(i + 1) * (m + 1) + j] >= dp[i * (m + 1) + j + 1]) middle.push({ op: "-", text: ma[i++] });
            else middle.push({ op: "+", text: mb[j++] });
        }
        while (i < n) middle.push({ op: "-", text: ma[i++] });
        while (j < m) middle.push({ op: "+", text: mb[j++] });
    }
    return [...head, ...middle, ...tail];
}

/** Collapse unchanged runs to `context` lines around changes; null marks a gap. */
export function withContext(lines: DiffLine[], context = 3): Array<DiffLine | null> {
    const keep = new Uint8Array(lines.length);
    lines.forEach((l, i) => {
        if (l.op === " ") return;
        for (let k = Math.max(0, i - context); k <= Math.min(lines.length - 1, i + context); k++) keep[k] = 1;
    });
    const out: Array<DiffLine | null> = [];
    let gap = false;
    lines.forEach((l, i) => {
        if (keep[i]) {
            out.push(l);
            gap = false;
        } else if (!gap) {
            out.push(null);
            gap = true;
        }
    });
    return out;
}

/* ---------- side by side ---------- */

export interface SideCell {
    /** 1-based line number on that side. */
    n: number;
    text: string;
    /** "-" only on the left, "+" only on the right, "~" changed (paired), " " same. */
    op: " " | "+" | "-" | "~";
}

export interface SideRow {
    left: SideCell | null;
    right: SideCell | null;
}

/**
 * Turn a unified line diff into side-by-side rows: unchanged lines sit level, and a run of
 * removed lines followed by added lines is paired row by row (shown as changed); the
 * longer side's rest gets an empty cell opposite. Left is the diff's "before".
 */
export function sideBySide(lines: DiffLine[]): SideRow[] {
    const rows: SideRow[] = [];
    let ln = 0;
    let rn = 0;
    let i = 0;
    while (i < lines.length) {
        if (lines[i].op === " ") {
            rows.push({ left: { n: ++ln, text: lines[i].text, op: " " }, right: { n: ++rn, text: lines[i].text, op: " " } });
            i++;
            continue;
        }
        const del: string[] = [];
        const add: string[] = [];
        while (i < lines.length && lines[i].op !== " ") {
            (lines[i].op === "-" ? del : add).push(lines[i].text);
            i++;
        }
        const both = Math.min(del.length, add.length);
        for (let k = 0; k < Math.max(del.length, add.length); k++) {
            rows.push({
                left: k < del.length ? { n: ++ln, text: del[k], op: k < both ? "~" : "-" } : null,
                right: k < add.length ? { n: ++rn, text: add[k], op: k < both ? "~" : "+" } : null,
            });
        }
    }
    return rows;
}

/** Collapse unchanged side-by-side rows to `context` rows around changes; null marks a gap. */
export function rowsWithContext(rows: SideRow[], context = 3): Array<SideRow | null> {
    const changed = (r: SideRow) => r.left?.op !== " " || r.right?.op !== " ";
    const keep = new Uint8Array(rows.length);
    rows.forEach((r, i) => {
        if (!changed(r)) return;
        for (let k = Math.max(0, i - context); k <= Math.min(rows.length - 1, i + context); k++) keep[k] = 1;
    });
    const out: Array<SideRow | null> = [];
    let gap = false;
    rows.forEach((r, i) => {
        if (keep[i]) {
            out.push(r);
            gap = false;
        } else if (!gap) {
            out.push(null);
            gap = true;
        }
    });
    return out;
}
