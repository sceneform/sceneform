// src/renderer/components/history.tsx
// Local History (IntelliJ's): browse snapshots taken on save, diff a screenplay or note
// against what's in the editor now, restore it (one undo), or label the current version.

import { useEffect, useMemo, useState } from "react";
import type { HistoryDoc, HistoryEntry } from "../../shared/bridge";
import { api } from "../lib/api";
import { lineDiff, rowsWithContext, sideBySide, withContext } from "../lib/diff";
import { compareScenes, restoreSceneEdit } from "../lib/scene-restore";
import { Modal, Segmented } from "./ui";

/** The WGA revision colour sequence (after the white draft). */
export const REVISION_COLORS = [
    { name: "White", value: "#c8c8c8" },
    { name: "Blue", value: "#4f8ff7" },
    { name: "Pink", value: "#f06bb0" },
    { name: "Yellow", value: "#e6c229" },
    { name: "Green", value: "#45b36b" },
    { name: "Goldenrod", value: "#d4a017" },
    { name: "Buff", value: "#d8b48a" },
    { name: "Salmon", value: "#f08a6c" },
    { name: "Cherry", value: "#d2335c" },
];

const snapTime = (id: string) => {
    const d = new Date(id);
    return Number.isNaN(d.getTime()) ? id : d.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
};

export function HistoryDialog(props: {
    open: boolean;
    projectPath: string;
    /** Current text of each screenplay and note (live editor text where open). */
    current: () => HistoryDoc[];
    onRestore: (doc: HistoryDoc) => void;
    /** Put one scene back: a single edit in the document's current text. */
    onRestoreScene: (doc: HistoryDoc, edit: { from: number; to: number; insert: string }, heading: string) => void;
    /** Mark everything changed since this snapshot, in a revision colour. */
    onMarkRevisions: (snapshotId: string, label: string, docs: HistoryDoc[], color: string) => void;
    onClose: () => void;
}) {
    const [entries, setEntries] = useState<HistoryEntry[]>([]);
    const [selected, setSelected] = useState<string | null>(null);
    const [docs, setDocs] = useState<HistoryDoc[] | null>(null);
    const [docId, setDocId] = useState<string | null>(null);
    const [label, setLabel] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [current, setCurrent] = useState<HistoryDoc[]>([]);
    const [revColor, setRevColor] = useState(REVISION_COLORS[1].value);
    const [layout, setLayout] = useState<"unified" | "split">(() => (localStorage.getItem("sf.historyLayout") === "split" ? "split" : "unified"));
    const [sceneKey, setSceneKey] = useState<string>("");

    const refresh = async () => {
        const r = await api.history.list(props.projectPath);
        if (!r.ok) return setError(r.error.message);
        setEntries(r.value);
        setSelected((s) => s ?? r.value[0]?.id ?? null);
    };

    useEffect(() => {
        if (!props.open) return;
        setError(null);
        setCurrent(props.current());
        void refresh();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [props.open, props.projectPath]);

    useEffect(() => {
        if (!selected) return setDocs(null);
        void api.history.read(props.projectPath, selected).then((r) => {
            if (!r.ok) return setError(r.error.message);
            setDocs(r.value);
            setDocId((d) => (r.value?.some((x) => x.id === d) ? d : (r.value?.find((x) => x.kind === "script") ?? r.value?.[0])?.id ?? null));
        });
    }, [selected, props.projectPath]);

    const snapDoc = docs?.find((d) => d.id === docId) ?? null;
    const nowDoc = current.find((d) => d.id === docId) ?? null;
    const diff = useMemo(() => (snapDoc ? withContext(lineDiff(nowDoc?.content ?? "", snapDoc.content)) : []), [snapDoc, nowDoc]);
    const changes = diff.filter((l) => l && l.op !== " ").length;
    const rows = useMemo(() => (snapDoc && layout === "split" ? rowsWithContext(sideBySide(lineDiff(nowDoc?.content ?? "", snapDoc.content))) : []), [snapDoc, nowDoc, layout]);
    // Scenes of the snapshot that differ from now (script documents that still exist only).
    const scenes = useMemo(() => {
        if (!snapDoc || !nowDoc || snapDoc.kind !== "script") return [];
        try {
            return compareScenes(nowDoc.content, snapDoc.content).filter((s) => s.status !== "same");
        } catch {
            return [];
        }
    }, [snapDoc, nowDoc]);
    useEffect(() => {
        setSceneKey((k) => (scenes.some((s) => s.key === k) ? k : scenes[0]?.key ?? ""));
    }, [scenes]);
    const setLayoutSaved = (l: "unified" | "split") => {
        setLayout(l);
        localStorage.setItem("sf.historyLayout", l);
    };
    const restoreScene = () => {
        if (!snapDoc || !nowDoc || !sceneKey) return;
        const edit = restoreSceneEdit(nowDoc.content, snapDoc.content, sceneKey);
        const scene = scenes.find((s) => s.key === sceneKey);
        if (edit && scene) props.onRestoreScene(snapDoc, edit, scene.heading);
    };

    const saveLabel = async () => {
        const text = label.trim();
        if (!text) return;
        const r = await api.history.label(props.projectPath, current, text);
        if (!r.ok) return setError(r.error.message);
        setLabel("");
        setSelected(null);
        await refresh();
    };

    return (
        <Modal open={props.open} onClose={props.onClose} labelledBy="historyTitle" className="history-modal">
            <h2 className="modal__title" id="historyTitle">Local history</h2>
            <p className="field__hint">Snapshots are taken when you save (every few minutes at most) and kept on this computer only, never inside the project file.</p>
            {error && <p className="field__error">{error}</p>}
            <div className="history">
                <div className="history__side">
                <div className="history__list" role="listbox" aria-label="Snapshots">
                    {entries.length === 0 && <p className="field__hint">Nothing yet. Snapshots start with your next save.</p>}
                    {entries.map((e) => (
                        <button key={e.id} role="option" aria-selected={e.id === selected} className={`history__item${e.id === selected ? " is-selected" : ""}`} onClick={() => setSelected(e.id)}>
                            <span className="history__time">{snapTime(e.id)}</span>
                            {e.label && <span className="history__label">{e.label}</span>}
                        </button>
                    ))}
                </div>
                <form
                    className="history__label-form"
                    onSubmit={(e) => {
                        e.preventDefault();
                        void saveLabel();
                    }}
                >
                    <label className="field__label" htmlFor="historyLabel">Label the current version</label>
                    <div className="input-group">
                        <input id="historyLabel" className="input" placeholder="e.g. Sent to producer" value={label} onChange={(e) => setLabel(e.target.value)} />
                        <button type="submit" className="btn btn--secondary btn--sm" disabled={!label.trim()}>Label</button>
                    </div>
                </form>
                </div>
                <div className="history__body">
                    {!selected && entries.length > 0 && <p className="history__empty">Pick a snapshot to compare it with the script as it is now.</p>}
                    {docs && (
                        <div className="history__docs">
                            <div className="history__doc-tabs" role="tablist" aria-label="Document">
                                {docs.map((d) => (
                                    <button key={d.id} role="tab" aria-selected={d.id === docId} className={`history__doc-tab${d.id === docId ? " is-active" : ""}`} onClick={() => setDocId(d.id)}>
                                        {d.title}
                                    </button>
                                ))}
                            </div>
                            <Segmented
                                value={layout}
                                onChange={setLayoutSaved}
                                options={[
                                    { value: "unified", label: "Unified" },
                                    { value: "split", label: "Side by side" },
                                ]}
                            />
                        </div>
                    )}
                    {snapDoc && (
                        <>
                            <p className="field__hint">
                                {nowDoc ? (changes ? `${changes} changed ${changes === 1 ? "line" : "lines"} between now (−) and this snapshot (+).` : "") : "This document no longer exists. Restoring brings it back."}
                            </p>
                            {scenes.length > 0 && (
                                <div className="history__scene">
                                    <select className="select" value={sceneKey} onChange={(e) => setSceneKey(e.target.value)} aria-label="Scene to restore">
                                        {scenes.map((s) => (
                                            <option key={s.key} value={s.key}>
                                                {s.heading} {s.status === "missing" ? "(deleted since)" : "(changed)"}
                                            </option>
                                        ))}
                                    </select>
                                    <button className="btn btn--secondary" disabled={!sceneKey} onClick={restoreScene} title="Put back this scene as it was in the snapshot, leaving the rest of the script alone">
                                        Restore this scene
                                    </button>
                                </div>
                            )}
                            {nowDoc && changes === 0 ? (
                                <p className="history__empty">This snapshot matches {nowDoc.title} as it is now. Nothing to restore.</p>
                            ) : layout === "unified" ? (
                                <pre className="history__diff">
                                    {diff.map((l, i) =>
                                        l === null ? (
                                            <div key={i} className="history__gap">⋯</div>
                                        ) : (
                                            <div key={i} className={`history__line history__line--${l.op === "+" ? "add" : l.op === "-" ? "del" : "same"}`}>
                                                {l.op} {l.text || " "}
                                            </div>
                                        ),
                                    )}
                                </pre>
                            ) : (
                                <div className="history__diff history__split" role="table" aria-label="Side-by-side diff">
                                    <div className="history__split-head">Now</div>
                                    <div className="history__split-head">Snapshot</div>
                                    {rows.map((r, i) =>
                                        r === null ? (
                                            <div key={i} className="history__gap history__split-gap">⋯</div>
                                        ) : (
                                            [r.left, r.right].map((c, side) => (
                                                <div
                                                    key={`${i}-${side}`}
                                                    className={`history__cell${!c ? " history__cell--empty" : c.op === " " ? " history__line--same" : c.op === "~" ? " history__cell--changed" : side === 0 ? " history__line--del" : " history__line--add"}`}
                                                >
                                                    {c && <span className="history__ln">{c.n}</span>}
                                                    {c ? c.text || " " : ""}
                                                </div>
                                            ))
                                        ),
                                    )}
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>
            <div className="modal__actions history__actions">
                <select className="select" value={revColor} onChange={(e) => setRevColor(e.target.value)} aria-label="Revision colour" title="Revision colour">
                    {REVISION_COLORS.map((c) => (
                        <option key={c.name} value={c.value}>{c.name} revision</option>
                    ))}
                </select>
                <button
                    className="btn btn--secondary"
                    disabled={!docs || !selected}
                    title="Mark every line added or changed since this snapshot, in the chosen colour"
                    onClick={() => {
                        const e = entries.find((x) => x.id === selected);
                        if (docs && selected) props.onMarkRevisions(selected, e?.label ?? snapTime(selected), docs, revColor);
                    }}
                >
                    Mark changes since
                </button>
                <span className="history__actions-gap" />
                <button className="btn btn--ghost" onClick={props.onClose}>Close</button>
                <button className="btn btn--primary" disabled={!snapDoc || (!!nowDoc && changes === 0)} onClick={() => snapDoc && props.onRestore(snapDoc)}>
                    Restore this {snapDoc?.kind === "note" ? "note" : "screenplay"}
                </button>
            </div>
        </Modal>
    );
}
