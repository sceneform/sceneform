// chrome.tsx
//
// One titlebar for every screen (the old UI had four hand-copied versions whose
// window buttons only showed a toast), a real menubar with dropdowns, and the
// status bar fed by live numbers instead of hard-coded defaults.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, isMockBridge } from "../lib/api";
import { isMac, modKey } from "../lib/format";
import { IconWindowClose, IconWindowMaximize, IconWindowMinimize, IconWindowRestore, SceneformMark } from "./icons";

/* ---------- titlebar ---------- */

export function Titlebar({ left, center }: { left?: ReactNode; center?: ReactNode }) {
    const [maximized, setMaximized] = useState(false);

    useEffect(() => {
        void api.window.isMaximized().then(setMaximized);
        return api.window.onMaximizedChange(setMaximized);
    }, []);
    return (
        <header className={`titlebar ${isMac ? "titlebar--mac" : ""}`}>
            <div className="titlebar__title no-drag-children">
                {left ?? (
                    <>
                        <SceneformMark size={13} className="titlebar__logo-mark" />
                        sceneform
                    </>
                )}
                {isMockBridge && <span className="titlebar__mock">browser preview, nothing is saved</span>}
            </div>
            {center && <div className="titlebar__center">{center}</div>}
            {!isMac && (
                <div className="titlebar__controls">
                    <button className="titlebar__btn" onClick={() => api.window.minimize()} aria-label="Minimize">
                        <IconWindowMinimize />
                    </button>
                    <button
                        className="titlebar__btn"
                        onClick={() => api.window.toggleMaximize()}
                        aria-label={maximized ? "Restore" : "Maximize"}
                    >
                        {maximized ? <IconWindowRestore /> : <IconWindowMaximize />}
                    </button>
                    <button className="titlebar__btn close" onClick={() => api.window.close()} aria-label="Close">
                        <IconWindowClose />
                    </button>
                </div>
            )}
        </header>
    );
}

/* ---------- menubar ---------- */

export interface MenuItem {
    label: string;
    shortcut?: string;
    run?: () => void;
    disabled?: boolean;
    checked?: boolean;
    separator?: boolean;
    title?: string;
}

export interface Menu {
    label: string;
    items: MenuItem[];
}

export function Menubar({ menus, right }: { menus: Menu[]; right?: ReactNode }) {
    const [open, setOpen] = useState<number | null>(null);
    const root = useRef<HTMLElement>(null);

    useEffect(() => {
        if (open === null) return;
        const close = (e: MouseEvent) => {
            if (!root.current?.contains(e.target as Node)) setOpen(null);
        };
        const esc = (e: KeyboardEvent) => {
            if (e.key === "Escape") setOpen(null);
        };
        window.addEventListener("mousedown", close);
        window.addEventListener("keydown", esc);
        return () => {
            window.removeEventListener("mousedown", close);
            window.removeEventListener("keydown", esc);
        };
    }, [open]);

    return (
        <nav className="menubar" aria-label="Application menu" ref={root}>
            {menus.map((menu, i) => (
                <div className="menubar__menu" key={menu.label}>
                    <button
                        className={`menubar__item ${open === i ? "is-open" : ""}`}
                        aria-haspopup="menu"
                        aria-expanded={open === i}
                        onMouseDown={(e) => {
                            e.preventDefault();
                            setOpen(open === i ? null : i);
                        }}
                        onMouseEnter={() => open !== null && setOpen(i)}
                    >
                        {menu.label}
                    </button>
                    {open === i && (
                        <div className="menu-dropdown" role="menu">
                            {menu.items.map((item, j) =>
                                item.separator ? (
                                    <div className="menu-dropdown__sep" key={`sep-${j}`} />
                                ) : (
                                    <button
                                        key={`${item.label}-${j}`}
                                        role="menuitem"
                                        className="menu-dropdown__item"
                                        disabled={item.disabled}
                                        title={item.title}
                                        onClick={() => {
                                            setOpen(null);
                                            item.run?.();
                                        }}
                                    >
                                        <span className="menu-dropdown__check">{item.checked ? "✓" : ""}</span>
                                        <span className="menu-dropdown__label">{item.label}</span>
                                        {item.shortcut && <span className="menu-dropdown__shortcut">{item.shortcut}</span>}
                                    </button>
                                ),
                            )}
                        </div>
                    )}
                </div>
            ))}
            <div className="menubar__spacer" />
            {right}
        </nav>
    );
}

/* ---------- save state ---------- */

export type SaveState = "saved" | "dirty" | "saving" | "error";

export const SAVE_LABEL: Record<SaveState, string> = {
    saved: "Saved",
    dirty: "Unsaved changes",
    saving: "Saving…",
    error: "Not saved",
};

export function SaveIndicator({ state, autosave }: { state: SaveState; autosave: boolean }) {
    const label = state === "dirty" && autosave ? "Saving soon…" : SAVE_LABEL[state];
    return (
        <span className={`save-state is-${state}`} title={state === "error" ? "The last save failed. Your text is still here." : undefined}>
            <span className="status-dot" />
            {label}
        </span>
    );
}

/* ---------- statusbar ---------- */

export function Statusbar(props: {
    scenes: number;
    pages: number;
    words: number;
    element: string;
    line: number;
    col: number;
    selection: number;
    zoom: number;
    timeSpent: string;
    onZoom: (zoom: number) => void;
}) {
    return (
        <footer className="statusbar">
            <div className="statusbar__group">
                <span className="statusbar__item">
                    {props.scenes} {props.scenes === 1 ? "scene" : "scenes"}
                </span>
                <span className="statusbar__item">{props.pages} {props.pages === 1 ? "page" : "pages"} (est.)</span>
                <span className="statusbar__item">{props.words.toLocaleString()} words</span>
            </div>
            <div className="statusbar__group">
                <span className="statusbar__item">{props.element}</span>
                <span className="statusbar__item mono">
                    Ln {props.line + 1}, Col {props.col}
                    {props.selection > 0 ? ` (${props.selection} selected)` : ""}
                </span>
            </div>
            <div className="statusbar__group">
                <span className="statusbar__item" title="Active writing time, idle time excluded">{props.timeSpent} writing</span>
                <button className="statusbar__item statusbar__btn" onClick={() => props.onZoom(props.zoom - 10)} aria-label="Zoom out">−</button>
                <button className="statusbar__item statusbar__btn mono" onClick={() => props.onZoom(100)} title={`Reset zoom (${modKey}+0)`}>
                    {props.zoom}%
                </button>
                <button className="statusbar__item statusbar__btn" onClick={() => props.onZoom(props.zoom + 10)} aria-label="Zoom in">+</button>
            </div>
        </footer>
    );
}
