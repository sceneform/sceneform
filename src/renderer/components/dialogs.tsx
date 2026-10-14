// src/renderer/components/dialogs.tsx
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { PdfExportOptions } from "../../shared/bridge";
import type { SceneView, ScriptStats } from "../lib/fountain";
import { IconSearch } from "./icons";
import { Modal, Segmented, Toggle } from "./ui";

/* ---------- command palette ---------- */

export interface PaletteItem {
    group: "Commands" | "Documents" | "Scenes" | "Characters" | "Locations" | "Usages";
    label: string;
    meta?: string;
    run: () => void;
}

export function CommandPalette({ open, items, onClose }: { open: boolean; items: PaletteItem[]; onClose: () => void }) {
    const [query, setQuery] = useState("");
    const [index, setIndex] = useState(0);
    const list = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (open) {
            setQuery("");
            setIndex(0);
        }
    }, [open]);

    const results = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return items.filter((i) => i.group === "Commands" || i.group === "Documents" || i.group === "Scenes" || i.group === "Usages").slice(0, 300);
        const score = (label: string) => {
            const l = label.toLowerCase();
            if (l.startsWith(q)) return 0;
            if (l.includes(q)) return 1;
            // loose subsequence match ("intkit" -> "INT. KITCHEN")
            let p = 0;
            for (const ch of l) if (ch === q[p]) p++;
            return p === q.length ? 2 : -1;
        };
        return items
            .map((item) => ({ item, s: score(item.label) }))
            .filter((x) => x.s >= 0)
            .sort((a, b) => a.s - b.s)
            .map((x) => x.item)
            .slice(0, 300);
    }, [items, query]);
    // One heading per group: the best-matching group comes first, and its items
    // stay together (scoring alone used to split "Commands" into two runs).
    const grouped = useMemo(() => {
        const order: string[] = [];
        const by = new Map<string, PaletteItem[]>();
        for (const it of results) {
            if (!by.has(it.group)) {
                by.set(it.group, []);
                order.push(it.group);
            }
            by.get(it.group)!.push(it);
        }
        return order.flatMap((g) => by.get(g)!);
    }, [results]);

    useEffect(() => {
        list.current?.querySelector(".is-selected")?.scrollIntoView({ block: "nearest" });
    }, [index]);

    if (!open) return null;
    const run = (item: PaletteItem | undefined) => {
        if (!item) return;
        onClose();
        item.run();
    };

    let lastGroup = "";
    return (
        <div className="palette-scrim is-open" onMouseDown={onClose}>
            <div className="palette" role="dialog" aria-label="Command palette" onMouseDown={(e) => e.stopPropagation()}>
                <div className="palette__input-row">
                    <IconSearch size={16} />
                    <input
                        className="palette__input"
                        autoFocus
                        placeholder="Go to a scene, character or location, or run a command…"
                        value={query}
                        onChange={(e) => {
                            setQuery(e.target.value);
                            setIndex(0);
                        }}
                        onKeyDown={(e) => {
                            if (e.key === "ArrowDown") {
                                e.preventDefault();
                                setIndex((i) => Math.min(grouped.length - 1, i + 1));
                            } else if (e.key === "ArrowUp") {
                                e.preventDefault();
                                setIndex((i) => Math.max(0, i - 1));
                            } else if (e.key === "Enter") {
                                e.preventDefault();
                                run(grouped[index]);
                            } else if (e.key === "Escape") {
                                e.preventDefault();
                                onClose();
                            }
                        }}
                    />
                    <kbd>Esc</kbd>
                </div>
                <div className="palette__results" ref={list} role="listbox">
                    {grouped.length === 0 ? (
                        <div className="empty-state" style={{ padding: "var(--sp-8) 0" }}><p className="empty-state__body">No matches.</p></div>
                    ) : (
                        grouped.map((item, i) => {
                            const header = item.group !== lastGroup ? item.group : null;
                            lastGroup = item.group;
                            return (
                                <div key={`${item.group}-${item.label}-${i}`}>
                                    {header && <div className="palette__group-label" role="presentation">{header}</div>}
                                    <div
                                        role="option"
                                        aria-selected={i === index}
                                        className={`palette__item ${i === index ? "is-selected" : ""}`}
                                        onMouseEnter={() => setIndex(i)}
                                        onMouseDown={(e) => {
                                            e.preventDefault();
                                            run(item);
                                        }}
                                    >
                                        {item.group === "Scenes" && item.meta && <span className="palette__num">{item.meta}</span>}
                                        <span className={`palette__label${item.group === "Scenes" || item.group === "Characters" || item.group === "Locations" ? " palette__label--script" : ""}`}>{item.label}</span>
                                        {item.meta && item.group !== "Scenes" && <span className="palette__item-meta">{item.meta}</span>}
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            </div>
        </div>
    );
}

/* ---------- export ---------- */

const EXPORT_FORMATS: Array<{ value: "pdf" | "fountain" | "fdx"; name: string; desc: string }> = [
    { value: "pdf", name: "PDF", desc: "Industry format, ready to print or send" },
    { value: "fountain", name: "Fountain", desc: "Plain text for other Fountain apps" },
    { value: "fdx", name: "Final Draft", desc: ".fdx for Final Draft, Fade In, WriterDuet, Highland" },
];

export function ExportDialog(props: {
    open: boolean;
    busy: boolean;
    scenes: SceneView[];
    stats: ScriptStats;
    onClose: () => void;
    /** sceneIds: only these scenes (plus the title page), or null for the whole script. */
    onExportPdf: (options: PdfExportOptions, sceneIds: string[] | null) => void;
    onExportFountain: () => void;
    onExportFdx: () => void;
    /** Which screenplay is exported and the project settings that apply. */
    footnote?: ReactNode;
}) {
    const [format, setFormat] = useState<"pdf" | "fountain" | "fdx">("pdf");
    const [titlePage, setTitlePage] = useState(true);
    const [notes, setNotes] = useState(false);
    const [filter, setFilter] = useState<"all" | "scenes" | "characters">("all");
    const [sceneIds, setSceneIds] = useState<string[]>([]);
    const [characters, setCharacters] = useState<string[]>([]);

    const toggle = (list: string[], value: string) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
    const filterEmpty = (filter === "scenes" && sceneIds.length === 0) || (filter === "characters" && characters.length === 0);

    return (
        <Modal open={props.open} onClose={props.onClose} labelledBy="exportTitle" className="export-modal">
            <h2 className="modal__title" id="exportTitle">Export</h2>
            <div className="export-formats" role="radiogroup" aria-label="Format">
                {EXPORT_FORMATS.map((f) => (
                    <label key={f.value} className={`export-format${format === f.value ? " is-active" : ""}`}>
                        <input type="radio" name="exportFormat" value={f.value} checked={format === f.value} onChange={() => setFormat(f.value)} />
                        <span className="export-format__name">{f.name}</span>
                        <span className="export-format__desc">{f.desc}</span>
                    </label>
                ))}
            </div>

            {format === "pdf" ? (
                <>
                    <div className="setting-row setting-row--compact">
                        <div className="setting-row__text"><div className="setting-row__label">Title page</div></div>
                        <Toggle label="Title page" checked={titlePage} onChange={setTitlePage} />
                    </div>
                    <div className="setting-row setting-row--compact">
                        <div className="setting-row__text"><div className="setting-row__label">Include [[notes]]</div></div>
                        <Toggle label="Include notes" checked={notes} onChange={setNotes} />
                    </div>
                    <div className="field" style={{ marginTop: "var(--sp-3)" }}>
                        <label className="field__label">Pages to include</label>
                        <Segmented
                            value={filter}
                            onChange={setFilter}
                            options={[
                                { value: "all", label: "Whole script" },
                                { value: "scenes", label: "Some scenes" },
                                { value: "characters", label: "By character" },
                            ]}
                        />
                    </div>
                    {filter === "scenes" && (
                        <div className="export-modal__picker">
                            {props.scenes.map((s) => (
                                <label key={s.id} className="check-row">
                                    <input type="checkbox" checked={sceneIds.includes(s.id)} onChange={() => setSceneIds(toggle(sceneIds, s.id))} />
                                    <span className="check-row__num">{s.num}</span> <span className="check-row__slug">{s.heading}</span>
                                </label>
                            ))}
                        </div>
                    )}
                    {filter === "characters" && (
                        <div className="export-modal__picker">
                            {props.stats.characters.map((c) => (
                                <label key={c.name} className="check-row">
                                    <input type="checkbox" checked={characters.includes(c.name)} onChange={() => setCharacters(toggle(characters, c.name))} />
                                    <span className="check-row__slug">{c.name}</span> <span className="check-row__meta">{c.scenes} {c.scenes === 1 ? "scene" : "scenes"}</span>
                                </label>
                            ))}
                        </div>
                    )}
                </>
            ) : format === "fdx" ? (
                <p className="modal__body">
                    Opens in Final Draft, Fade In, WriterDuet and Highland. Headings (with scene numbers), action, cues, dialogue, dual dialogue, transitions, page breaks, acts and bold/italic/underline carry over. Notes, synopses and the boneyard stay behind.
                </p>
            ) : (
                <p className="modal__body">
                    A clean copy for other Fountain apps. Sceneform's internal scene markers are removed; your text is otherwise untouched.
                </p>
            )}

            {props.footnote && <p className="field__hint export-modal__footnote">{props.footnote}</p>}
            <div className="modal__actions">
                <button className="btn btn--ghost" onClick={props.onClose}>Cancel</button>
                <button
                    className="btn btn--primary"
                    disabled={props.busy || (format === "pdf" && filterEmpty)}
                    onClick={() =>
                        format === "pdf"
                            ? props.onExportPdf(
                                  { includeTitlePage: titlePage, notesIncluded: notes },
                                  filter === "scenes"
                                      ? sceneIds
                                      : filter === "characters"
                                        ? props.scenes.filter((sc) => sc.characters.some((c) => characters.includes(c.toUpperCase()))).map((sc) => sc.id)
                                        : null,
                              )
                            : format === "fdx"
                              ? props.onExportFdx()
                              : props.onExportFountain()
                    }
                >
                    {props.busy ? "Exporting…" : `Export ${EXPORT_FORMATS.find((f) => f.value === format)?.name ?? ""}…`}
                </button>
            </div>
        </Modal>
    );
}
