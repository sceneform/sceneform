// src/renderer/editor/revisions.ts
// Revision marks: lines added or changed since a baseline (a Local History snapshot)
// get the revision colour bar and an asterisk in the right margin, the way production
// drafts mark revised lines. Session-only for now; PDF asterisks need pdf-export support.

import { type Extension, RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";
import { lineDiff } from "../lib/diff";

export interface RevisionBaseline {
    text: string;
    /** CSS colour of the revision (Blue, Pink, Yellow…). */
    color: string;
}

export const setRevisionBaseline = StateEffect.define<RevisionBaseline | null>();

/** 1-based line numbers of the current doc that differ from the baseline. */
export function revisedLines(baseline: string, current: string): number[] {
    const out: number[] = [];
    let line = 0;
    for (const d of lineDiff(baseline, current)) {
        if (d.op === "-") continue;
        line++;
        if (d.op === "+" && d.text.trim()) out.push(line);
    }
    return out;
}

function build(view: { state: EditorView["state"] }, base: RevisionBaseline | null): DecorationSet {
    if (!base) return Decoration.none;
    const doc = view.state.doc;
    const b = new RangeSetBuilder<Decoration>();
    const deco = Decoration.line({ class: "sf-rev", attributes: { style: `--rev: ${base.color}` } });
    for (const n of revisedLines(base.text, doc.toString())) if (n <= doc.lines) b.add(doc.line(n).from, doc.line(n).from, deco);
    return b.finish();
}

export function revisions(initial: RevisionBaseline | null): Extension {
    const field = StateField.define<{ base: RevisionBaseline | null; deco: DecorationSet }>({
        create: (state) => ({ base: initial, deco: build({ state }, initial) }),
        update: (value, tr) => {
            let base = value.base;
            let changed = tr.docChanged;
            for (const e of tr.effects)
                if (e.is(setRevisionBaseline)) {
                    base = e.value;
                    changed = true;
                }
            return changed ? { base, deco: build({ state: tr.state }, base) } : value;
        },
        provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
    });
    return field;
}
