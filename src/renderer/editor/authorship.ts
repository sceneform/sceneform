// authorship.ts
//
// Git-blame-style authorship for screenplays: every line remembers who last
// wrote it and when. Stamps follow the text through edits (CodeMirror change
// mapping); the gutter shows them when the blame view is on. Stored in the
// .sfp as authorship.json (see SfpAuthorship in backend/sfp-archive.ts).

import { StateEffect, StateField, type EditorState, type Extension, type Text, type Transaction } from "@codemirror/state";
import { EditorView, GutterMarker, gutter } from "@codemirror/view";
import type { SfpDocAuthorship } from "../../backend/sfp-archive";

export interface LineStamp {
    a: string;
    t: string;
}
export type LineStamps = Array<LineStamp | null>;

export const setBlameVisible = StateEffect.define<boolean>();

/** Expand the stored form to one stamp per line, padded or cut to the document's line count. */
export function fromStored(stored: SfpDocAuthorship | undefined, lineCount: number): LineStamps {
    const out: LineStamps = [];
    for (let i = 0; i < lineCount; i++) {
        const e = stored?.lines[i];
        out.push(e && stored!.authors[e[0]] !== undefined ? { a: stored!.authors[e[0]], t: e[1] } : null);
    }
    return out;
}

export function toStored(stamps: LineStamps): SfpDocAuthorship {
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

function remap(stamps: LineStamps, tr: Transaction, author: string): LineStamps {
    const a: Text = tr.startState.doc;
    const b: Text = tr.state.doc;
    // Changed line ranges, merged where they share a line.
    // oa..ob are old lines replaced (ob < oa means a pure insert before oa); na..nb the new lines.
    const ranges: Array<{ oa: number; ob: number; na: number; nb: number }> = [];
    tr.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
        const r = { oa: a.lineAt(fromA).number, ob: a.lineAt(toA).number, na: b.lineAt(fromB).number, nb: b.lineAt(toB).number };
        const text = inserted.toString();
        if (fromA === toA && text.endsWith("\n") && fromA === a.lineAt(fromA).from) {
            // Whole lines inserted before an untouched line.
            r.ob = r.oa - 1;
            r.nb -= 1;
        } else if (fromA === toA && text.startsWith("\n") && fromA === a.lineAt(fromA).to) {
            // Whole lines appended after an untouched line.
            r.oa += 1;
            r.ob = r.oa - 1;
            r.na += 1;
        }
        const last = ranges[ranges.length - 1];
        if (last && r.oa <= last.ob && r.ob >= r.oa) {
            last.ob = Math.max(last.ob, r.ob);
            last.nb = Math.max(last.nb, r.nb);
        } else ranges.push(r);
    });
    const stamp: LineStamp = { a: author, t: new Date().toISOString() };
    const next = stamps.slice();
    for (let i = ranges.length - 1; i >= 0; i--) {
        const r = ranges[i];
        next.splice(r.oa - 1, Math.max(0, r.ob - r.oa + 1), ...Array.from({ length: Math.max(0, r.nb - r.na + 1) }, () => stamp));
    }
    // Safety net: keep the array exactly one stamp per line.
    if (next.length > b.lines) next.length = b.lines;
    while (next.length < b.lines) next.push(stamp);
    return next;
}

interface BlameState {
    stamps: LineStamps;
    visible: boolean;
}

export function authorship(opts: { initial: LineStamps; author: () => string; visible: boolean }): { extension: Extension; field: StateField<BlameState> } {
    const field = StateField.define<BlameState>({
        create: (state) => ({ stamps: opts.initial.length === state.doc.lines ? opts.initial : fromStored(toStored(opts.initial), state.doc.lines), visible: opts.visible }),
        update(value, tr) {
            let v = value;
            for (const e of tr.effects) if (e.is(setBlameVisible)) v = { ...v, visible: e.value };
            if (tr.docChanged) v = { ...v, stamps: remap(v.stamps, tr, opts.author() || "Anonymous") };
            return v;
        },
    });

    const colorFor = (name: string) => {
        let h = 0;
        for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
        return `hsl(${h % 360} 55% 60%)`;
    };

    class AuthorMarker extends GutterMarker {
        constructor(readonly stamp: LineStamp | null, readonly first: boolean) {
            super();
        }
        eq(o: AuthorMarker) {
            return o.first === this.first && o.stamp?.a === this.stamp?.a && o.stamp?.t === this.stamp?.t;
        }
        toDOM() {
            const el = document.createElement("div");
            el.className = "sf-blame";
            if (!this.stamp) {
                el.classList.add("is-unknown");
                if (this.first) el.textContent = "Unknown";
                el.title = "Unknown (written before authorship tracking)";
                return el;
            }
            el.style.setProperty("--blame-color", colorFor(this.stamp.a));
            if (this.first) {
                const d = new Date(this.stamp.t);
                el.textContent = `${this.stamp.a}, ${d.toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
            }
            el.title = `${this.stamp.a}, ${new Date(this.stamp.t).toLocaleString()}`;
            return el;
        }
    }

    const blameGutter = gutter({
        class: "sf-blame-gutter",
        lineMarker(view, line) {
            const st = view.state.field(field);
            if (!st.visible) return null;
            const n = view.state.doc.lineAt(line.from).number;
            const s = st.stamps[n - 1] ?? null;
            const prev = n > 1 ? st.stamps[n - 2] ?? null : undefined;
            const first = prev === undefined || prev?.a !== s?.a || (prev?.t ?? "").slice(0, 10) !== (s?.t ?? "").slice(0, 10);
            return new AuthorMarker(s, first);
        },
        lineMarkerChange: (u) => u.docChanged || u.transactions.some((t) => t.effects.some((e) => e.is(setBlameVisible))),
    });

    return { extension: [field, blameGutter, EditorView.editorAttributes.of((v: EditorView) => ({ class: v.state.field(field).visible ? "has-blame" : "" }))], field };
}

export const stampsOf = (state: EditorState, field: StateField<BlameState>) => state.field(field).stamps;
