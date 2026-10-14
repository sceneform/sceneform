// src/renderer/lib/merge.ts
//
// Merge two copies of one .sfp project (async collaboration with no server).
// Screenplays get a three-way merge on the Fountain text. There's no stored common
// ancestor, so the authorship stamps rebuild one: a line with the same text, author and
// time in both copies was there before the copies split, and the newest such stamp
// is the split time T. Lines stamped at or before T (or never stamped) on either side
// make up the base; everything newer is an edit made in one copy. With no shared stamps
// at all, the base is just the lines both copies have (a union merge).
// A region changed in only one copy takes that copy's version; a region changed in both,
// differently, keeps both versions between [[MERGE CONFLICT…]] notes. Merged lines keep
// the stamps of the copy they came from.

import type { SfpAuthorship, SfpDocAuthorship, SfpDocument, SfpEntities } from "../../backend/sfp-archive";
import type { CanvasCard } from "../../backend/types/canvas";
import { lineDiff } from "./diff";

type Stamp = { a: string; t: string } | null;

const stampsOf = (stored: SfpDocAuthorship | undefined, n: number): Stamp[] =>
    Array.from({ length: n }, (_, i) => {
        const e = stored?.lines[i];
        return e && stored!.authors[e[0]] !== undefined ? { a: stored!.authors[e[0]], t: e[1] } : null;
    });

function storeStamps(stamps: Stamp[]): SfpDocAuthorship {
    const authors: string[] = [];
    const idx = new Map<string, number>();
    const lines = stamps.map((s) => {
        if (!s) return null;
        let i = idx.get(s.a);
        if (i === undefined) {
            i = authors.push(s.a) - 1;
            idx.set(s.a, i);
        }
        return [i, s.t] as [number, string];
    });
    return { authors, lines };
}

/** For each line of `a`, the index of its LCS partner in `b`, or -1. */
export function lcsMap(a: string[], b: string[]): number[] {
    const map = new Array<number>(a.length).fill(-1);
    let start = 0;
    while (start < a.length && start < b.length && a[start] === b[start]) map[start] = start++;
    let endA = a.length;
    let endB = b.length;
    while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) map[--endA] = --endB;
    const n = endA - start;
    const m = endB - start;
    if (n === 0 || m === 0 || n * m > 4_000_000) return map;
    const W = m + 1;
    const dp = new Uint32Array((n + 1) * W);
    for (let i = n - 1; i >= 0; i--)
        for (let j = m - 1; j >= 0; j--)
            dp[i * W + j] = a[start + i] === b[start + j] ? dp[(i + 1) * W + j + 1] + 1 : Math.max(dp[(i + 1) * W + j], dp[i * W + j + 1]);
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
        if (a[start + i] === b[start + j]) {
            map[start + i] = start + j;
            i++;
            j++;
        } else if (dp[(i + 1) * W + j] >= dp[i * W + j + 1]) i++;
        else j++;
    }
    return map;
}

export interface ScriptMergeResult {
    text: string;
    authorship: SfpDocAuthorship;
    /** Lines taken from their copy. */
    fromTheirs: number;
    conflicts: number;
}

export interface MergeLabels {
    ours: string;
    theirs: string;
}

/** The base both copies grew from, rebuilt from shared stamps (see the file comment). */
function rebuildBase(oursLines: string[], oursStamps: Stamp[], theirsLines: string[], theirsStamps: Stamp[]): string[] {
    const key = (text: string, s: Stamp) => (s ? `${s.a}\u0000${s.t}\u0000${text}` : null);
    const theirsKeys = new Map<string, number>();
    theirsLines.forEach((l, i) => {
        const k = key(l, theirsStamps[i]);
        if (k) theirsKeys.set(k, (theirsKeys.get(k) ?? 0) + 1);
    });
    let split: string | null = null;
    oursLines.forEach((l, i) => {
        const s = oursStamps[i];
        const k = key(l, s);
        if (k && theirsKeys.get(k) && (split === null || s!.t > split)) split = s!.t;
    });
    if (split === null) {
        // No shared history in the stamps: the base is what both copies have.
        const m = lcsMap(oursLines, theirsLines);
        return oursLines.filter((_, i) => m[i] >= 0);
    }
    const T: string = split;
    const old = (lines: string[], stamps: Stamp[]) => lines.filter((_, i) => !stamps[i] || stamps[i]!.t <= T);
    // Union of both copies' old lines, in order.
    return lineDiff(old(oursLines, oursStamps).join("\n"), old(theirsLines, theirsStamps).join("\n")).map((d) => d.text);
}

export function mergeScript(
    ours: { text: string; authorship?: SfpDocAuthorship },
    theirs: { text: string; authorship?: SfpDocAuthorship },
    labels: MergeLabels,
): ScriptMergeResult {
    const O = ours.text.split("\n");
    const Tl = theirs.text.split("\n");
    const os = stampsOf(ours.authorship, O.length);
    const ts = stampsOf(theirs.authorship, Tl.length);
    if (ours.text === theirs.text) return { text: ours.text, authorship: storeStamps(os), fromTheirs: 0, conflicts: 0 };
    return diff3(rebuildBase(O, os, Tl, ts), O, os, Tl, ts, labels);
}

/** Plain-text three-way merge (notes, or when the caller has a real base). */
export function mergeText(base: string | null, ours: string, theirs: string, labels: MergeLabels): ScriptMergeResult {
    const O = ours.split("\n");
    const Tl = theirs.split("\n");
    const none = (n: number) => Array.from({ length: n }, () => null as Stamp);
    if (ours === theirs) return { text: ours, authorship: storeStamps(none(O.length)), fromTheirs: 0, conflicts: 0 };
    const B = base !== null ? base.split("\n") : rebuildBase(O, none(O.length), Tl, none(Tl.length));
    return diff3(B, O, none(O.length), Tl, none(Tl.length), labels);
}

function diff3(B: string[], O: string[], os: Stamp[], Tl: string[], ts: Stamp[], labels: MergeLabels): ScriptMergeResult {
    const mo = lcsMap(B, O);
    const mt = lcsMap(B, Tl);
    const outText: string[] = [];
    const outStamps: Stamp[] = [];
    let fromTheirs = 0;
    let conflicts = 0;
    const emit = (lines: string[], stamps: Stamp[]) => {
        outText.push(...lines);
        outStamps.push(...stamps);
    };
    const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
    let i = 0;
    let j = 0;
    let k = 0;
    for (;;) {
        while (i < B.length && mo[i] === j && mt[i] === k) {
            emit([O[j]], [os[j]]);
            i++;
            j++;
            k++;
        }
        if (i >= B.length && j >= O.length && k >= Tl.length) break;
        let s = i;
        while (s < B.length && (mo[s] < 0 || mt[s] < 0)) s++;
        const oEnd = s < B.length ? mo[s] : O.length;
        const tEnd = s < B.length ? mt[s] : Tl.length;
        const b = B.slice(i, s);
        const o = O.slice(j, oEnd);
        const t = Tl.slice(k, tEnd);
        const oursChanged = !same(b, o);
        const theirsChanged = !same(b, t);
        if (!theirsChanged || same(o, t)) emit(o, os.slice(j, oEnd));
        else if (!oursChanged) {
            emit(t, ts.slice(k, tEnd));
            fromTheirs += t.length;
        } else {
            // Both copies changed this region: line by line, a conflict only where both
            // insert or rewrite at the same place.
            const r = refine(b, o, os.slice(j, oEnd), t, ts.slice(k, tEnd));
            for (const part of r) {
                if (part.kind === "line") emit([part.text], [part.stamp]);
                else if (part.kind === "theirs") {
                    emit(part.lines, part.stamps);
                    fromTheirs += part.lines.length;
                } else if (part.kind === "ours") emit(part.lines, part.stamps);
                else if (part.kind === "conflict") {
                    conflicts++;
                    emit([`[[MERGE CONFLICT: ${labels.ours} wrote this…]]`], [null]);
                    emit(part.o.lines, part.o.stamps);
                    emit([`[[…and ${labels.theirs} wrote this. Keep one version, then delete these merge notes.]]`], [null]);
                    emit(part.t.lines, part.t.stamps);
                    emit(["[[END MERGE CONFLICT]]"], [null]);
                    fromTheirs += part.t.lines.length;
                }
            }
        }
        i = s;
        j = oEnd;
        k = tEnd;
    }
    return { text: outText.join("\n"), authorship: storeStamps(outStamps), fromTheirs, conflicts };
}

type Run = { lines: string[]; stamps: Stamp[] };
type Part =
    | { kind: "line"; text: string; stamp: Stamp }
    | { kind: "ours"; lines: string[]; stamps: Stamp[] }
    | { kind: "theirs"; lines: string[]; stamps: Stamp[] }
    | { kind: "conflict"; o: Run; t: Run };

/**
 * One side's edits to a base region: which base lines it kept, and what it inserted in
 * each gap (gap g is before base line g; gap b.length is the end). Lines that replace
 * deleted base lines go in the gap after those lines, so "B → B2" is "drop B, insert B2
 * after it" and doesn't collide with the other side inserting before B.
 */
function sideEdits(b: string[], side: string[], stamps: Stamp[]): { keep: boolean[]; ins: Run[]; keptStamp: Stamp[] } {
    const m = lcsMap(b, side);
    const keep = m.map((x) => x >= 0);
    const ins: Run[] = Array.from({ length: b.length + 1 }, () => ({ lines: [], stamps: [] }));
    const keptStamp: Stamp[] = m.map((x) => (x >= 0 ? stamps[x] : null));
    let pos = 0; // next side line not yet placed
    let g = 0;
    while (g <= b.length) {
        // Skip deleted base lines: their replacement goes after them.
        let h = g;
        while (h < b.length && !keep[h]) h++;
        const until = h < b.length ? m[h] : side.length;
        ins[h].lines.push(...side.slice(pos, until));
        ins[h].stamps.push(...stamps.slice(pos, until));
        pos = until + 1;
        g = h + 1;
    }
    return { keep, ins, keptStamp };
}

function refine(b: string[], o: string[], os: Stamp[], t: string[], ts: Stamp[]): Part[] {
    const eo = sideEdits(b, o, os);
    const et = sideEdits(b, t, ts);
    const out: Part[] = [];
    const sameRun = (x: Run, y: Run) => x.lines.length === y.lines.length && x.lines.every((l, i) => l === y.lines[i]);
    for (let g = 0; g <= b.length; g++) {
        const io = eo.ins[g];
        const it = et.ins[g];
        if (io.lines.length && it.lines.length && !sameRun(io, it)) out.push({ kind: "conflict", o: io, t: it });
        else if (io.lines.length) out.push({ kind: "ours", ...io });
        else if (it.lines.length) out.push({ kind: "theirs", ...it });
        if (g < b.length && eo.keep[g] && et.keep[g]) out.push({ kind: "line", text: b[g], stamp: eo.keptStamp[g] });
    }
    return out;
}

/* ---------- whole projects ---------- */

export interface MergeInput {
    documents: SfpDocument[];
    entities: SfpEntities;
    authorship: SfpAuthorship;
}

export interface MergeReportRow {
    title: string;
    kind: SfpDocument["kind"];
    status: "same" | "merged" | "added" | "conflicts";
    fromTheirs: number;
    conflicts: number;
}

export interface ProjectMergeResult extends MergeInput {
    report: MergeReportRow[];
    conflicts: number;
}

/** The person who made most of the newest stamps in a copy, for conflict notes. */
export function mainAuthor(authorship: SfpAuthorship, fallback: string): string {
    const count = new Map<string, number>();
    for (const doc of Object.values(authorship ?? {}))
        for (const e of doc?.lines ?? []) {
            const a = e ? doc.authors[e[0]] : undefined;
            if (a) count.set(a, (count.get(a) ?? 0) + 1);
        }
    return [...count].sort((x, y) => y[1] - x[1])[0]?.[0] ?? fallback;
}

const fillEmpty = <T extends object>(ours: T, theirs: T): T => {
    const out: Record<string, unknown> = { ...(ours as Record<string, unknown>) };
    for (const [k, v] of Object.entries(theirs as Record<string, unknown>)) {
        const cur = out[k];
        if (cur === undefined || cur === "" || (Array.isArray(cur) && cur.length === 0)) out[k] = v;
    }
    return out as T;
};

function mergeRecords<T extends object>(ours: Record<string, T>, theirs: Record<string, T>): Record<string, T> {
    const out = { ...ours };
    for (const [k, v] of Object.entries(theirs ?? {})) out[k] = out[k] ? fillEmpty(out[k], v) : v;
    return out;
}

function mergeCards(ours: CanvasCard[], theirs: CanvasCard[]): { cards: CanvasCard[]; changed: number } {
    const byId = new Map(ours.map((c) => [c.id, c]));
    let changed = 0;
    for (const c of theirs) {
        const cur = byId.get(c.id);
        if (!cur) {
            byId.set(c.id, c);
            changed++;
        } else if ((c.editedAt ?? c.createdAt ?? "") > (cur.editedAt ?? cur.createdAt ?? "")) {
            byId.set(c.id, c);
            changed++;
        }
    }
    return { cards: [...byId.values()], changed };
}

export function mergeProjects(ours: MergeInput, theirs: MergeInput, labels: MergeLabels): ProjectMergeResult {
    const documents: SfpDocument[] = [];
    const authorship: SfpAuthorship = { ...ours.authorship };
    const report: MergeReportRow[] = [];
    let conflicts = 0;
    const theirsById = new Map(theirs.documents.map((d) => [d.id, d]));
    for (const d of ours.documents) {
        const t = theirsById.get(d.id);
        if (!t || t.kind !== d.kind) {
            documents.push(d);
            continue;
        }
        if (d.kind === "canvas") {
            const m = mergeCards(d.cards ?? [], t.cards ?? []);
            documents.push({ ...d, cards: m.cards });
            report.push({ title: d.title, kind: d.kind, status: m.changed ? "merged" : "same", fromTheirs: m.changed, conflicts: 0 });
            continue;
        }
        const m =
            d.kind === "script"
                ? mergeScript({ text: d.content ?? "", authorship: ours.authorship[d.id] }, { text: t.content ?? "", authorship: theirs.authorship[t.id] }, labels)
                : mergeText(null, d.content ?? "", t.content ?? "", labels);
        documents.push({ ...d, content: m.text });
        if (d.kind === "script") authorship[d.id] = m.authorship;
        conflicts += m.conflicts;
        report.push({ title: d.title, kind: d.kind, status: m.conflicts ? "conflicts" : m.text === (d.content ?? "") ? "same" : "merged", fromTheirs: m.fromTheirs, conflicts: m.conflicts });
    }
    // Documents only their copy has.
    const ids = new Set(ours.documents.map((d) => d.id));
    for (const t of theirs.documents) {
        if (ids.has(t.id)) continue;
        const order = Math.max(-1, ...documents.filter((d) => d.kind === t.kind).map((d) => d.order)) + 1;
        documents.push({ ...t, order });
        if (t.kind === "script" && theirs.authorship[t.id]) authorship[t.id] = theirs.authorship[t.id];
        report.push({ title: t.title, kind: t.kind, status: "added", fromTheirs: (t.content ?? "").split("\n").length, conflicts: 0 });
    }
    const scenes: SfpEntities["scenes"] = { ...ours.entities.scenes };
    for (const [doc, rec] of Object.entries(theirs.entities.scenes ?? {})) scenes[doc] = mergeRecords(scenes[doc] ?? {}, rec);
    const entities: SfpEntities = {
        characters: mergeRecords(ours.entities.characters, theirs.entities.characters),
        locations: mergeRecords(ours.entities.locations, theirs.entities.locations),
        scenes,
    };
    return { documents, entities, authorship, report, conflicts };
}
