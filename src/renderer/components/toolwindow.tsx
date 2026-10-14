// toolwindow.tsx
//
// A docked tool window under the script, like IntelliJ's: Find usages (Alt+F7, for a
// character or a location) and Problems (every inspection hit in the script, Ctrl/Cmd+6).
// A filter box narrows the list; Enter or a click jumps to the line.

import { useEffect, useMemo, useRef, useState } from "react";

export interface ToolItem {
    label: string;
    /** Small text on the right (line type, line number). */
    meta?: string;
    /** Problems: warning or hint dot. */
    severity?: "warn" | "hint";
    run: () => void;
}

export function ToolWindow(props: { title: string; items: ToolItem[]; empty: string; onClose: () => void }) {
    const [query, setQuery] = useState("");
    const [index, setIndex] = useState(0);
    const list = useRef<HTMLDivElement>(null);
    useEffect(() => {
        setQuery("");
        setIndex(0);
    }, [props.title]);
    const shown = useMemo(() => {
        const q = query.trim().toLowerCase();
        return q ? props.items.filter((i) => `${i.label} ${i.meta ?? ""}`.toLowerCase().includes(q)) : props.items;
    }, [props.items, query]);
    useEffect(() => {
        list.current?.querySelector<HTMLElement>(".toolwin__row.is-selected")?.scrollIntoView({ block: "nearest" });
    }, [index]);
    return (
        <section className="toolwin" aria-label={props.title}>
            <div className="toolwin__bar">
                <span className="toolwin__title">{props.title}</span>
                <span className="toolwin__count">{shown.length}</span>
                <input
                    className="input toolwin__filter"
                    placeholder="Filter"
                    value={query}
                    onChange={(e) => {
                        setQuery(e.target.value);
                        setIndex(0);
                    }}
                    onKeyDown={(e) => {
                        if (e.key === "ArrowDown") setIndex((i) => Math.min(shown.length - 1, i + 1));
                        else if (e.key === "ArrowUp") setIndex((i) => Math.max(0, i - 1));
                        else if (e.key === "Enter") shown[index]?.run();
                        else if (e.key === "Escape") props.onClose();
                        else return;
                        e.preventDefault();
                    }}
                    aria-label={`Filter ${props.title}`}
                />
                <button className="btn btn--ghost btn--sm" onClick={props.onClose} aria-label={`Close ${props.title}`} title="Close (Esc in the filter)">
                    ✕
                </button>
            </div>
            <div className="toolwin__list" ref={list} role="listbox">
                {shown.length === 0 && <div className="toolwin__empty">{props.items.length ? "Nothing matches the filter." : props.empty}</div>}
                {shown.map((it, i) => (
                    <div
                        key={i}
                        role="option"
                        aria-selected={i === index}
                        className={`toolwin__row ${i === index ? "is-selected" : ""}`}
                        onMouseMove={() => setIndex(i)}
                        onClick={() => it.run()}
                    >
                        {it.severity && <span className={`toolwin__dot toolwin__dot--${it.severity}`} />}
                        <span className="toolwin__label">{it.label}</span>
                        {it.meta && <span className="toolwin__meta">{it.meta}</span>}
                    </div>
                ))}
            </div>
        </section>
    );
}
