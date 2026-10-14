// context-menu.ts
//
// Right-click menus. `showContextMenu` draws a small menu in the Alt+Enter
// popup's look (`.sf-intentions`) at a screen point; the tab strip uses it too.
// `editorContextMenu` is the script editor's menu: spelling suggestions, cut /
// copy / paste, the character or location under the pointer (find usages,
// rename, open its page), and the Alt+Enter actions for the line.

import { EditorSelection, type Extension } from "@codemirror/state";
import { EditorView, closeHoverTooltips } from "@codemirror/view";
import { parsedField } from "./fountain-extension";
import { misspellingAt, suggest } from "./spellcheck";
import { contextNameAt, fixesAt } from "./intentions";
import { modKey } from "../lib/format";
import { setContextMenuOpen } from "./context-menu-state";

export type ContextItem = { label: string; shortcut?: string; run: () => void; disabled?: boolean; heading?: false } | { separator: true } | { heading: true; label: string };

let open: (() => void) | null = null;

/** Opens a menu at (x, y) in viewport pixels. Escape, a click outside or scrolling closes it. */
export function showContextMenu(x: number, y: number, items: ContextItem[], onClose?: () => void): void {
    open?.();
    // Drop leading, trailing and doubled separators.
    const clean: ContextItem[] = [];
    for (const it of items) {
        if ("separator" in it && (!clean.length || "separator" in clean[clean.length - 1])) continue;
        clean.push(it);
    }
    while (clean.length && "separator" in clean[clean.length - 1]) clean.pop();
    if (!clean.length) return;

    const el = document.createElement("div");
    el.className = "sf-intentions sf-context";
    el.setAttribute("role", "menu");
    const runnable: Array<{ node: HTMLElement; run: () => void }> = [];
    let index = -1;
    const select = (i: number) => {
        if (!runnable.length) return;
        index = (i + runnable.length) % runnable.length;
        runnable.forEach((r, k) => r.node.classList.toggle("is-selected", k === index));
    };
    for (const it of clean) {
        if ("separator" in it) {
            const sep = document.createElement("div");
            sep.className = "sf-context__sep";
            el.appendChild(sep);
            continue;
        }
        if (it.heading) {
            const h = document.createElement("div");
            h.className = "sf-context__heading";
            h.textContent = it.label;
            el.appendChild(h);
            continue;
        }
        const node = document.createElement("div");
        node.className = `sf-intentions__item sf-context__item${it.disabled ? " is-disabled" : ""}`;
        node.setAttribute("role", "menuitem");
        const label = document.createElement("span");
        label.textContent = it.label;
        node.appendChild(label);
        if (it.shortcut) {
            const kbd = document.createElement("span");
            kbd.className = "sf-context__key";
            kbd.textContent = it.shortcut;
            node.appendChild(kbd);
        }
        el.appendChild(node);
        if (it.disabled) continue;
        const k = runnable.length;
        const run = () => {
            close();
            it.run();
        };
        runnable.push({ node, run });
        node.addEventListener("mousedown", (e) => {
            e.preventDefault();
            e.stopPropagation();
        });
        node.addEventListener("click", run);
        node.addEventListener("mousemove", () => select(k));
    }
    const onKey = (e: KeyboardEvent) => {
        if (e.key === "ArrowDown") select(index + 1);
        else if (e.key === "ArrowUp") select(index - 1);
        else if (e.key === "Enter" && index >= 0) runnable[index].run();
        else if (e.key === "Escape") close();
        else return;
        e.preventDefault();
        e.stopPropagation();
    };
    const onDown = (e: MouseEvent) => {
        if (!el.contains(e.target as Node)) close();
    };
    const close = () => {
        window.removeEventListener("keydown", onKey, true);
        window.removeEventListener("mousedown", onDown, true);
        window.removeEventListener("blur", close);
        window.removeEventListener("wheel", close, true);
        el.remove();
        if (open === close) {
            open = null;
            setContextMenuOpen(false);
        }
        onClose?.();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("blur", close);
    window.addEventListener("wheel", close, true);
    document.body.appendChild(el);
    el.style.maxHeight = `${Math.max(160, window.innerHeight - 16)}px`;
    const left = x + el.offsetWidth > window.innerWidth - 8 ? Math.max(8, x - el.offsetWidth) : x;
    const top = y + el.offsetHeight > window.innerHeight - 8 ? Math.max(8, window.innerHeight - el.offsetHeight - 8) : y;
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    open = close;
    setContextMenuOpen(true);
}

export interface EditorMenuOptions {
    onAddWord: (word: string) => void;
    openCharacter: (name: string, line: number) => void;
    openLocation: (name: string) => void;
    findUsages: (name: string) => void;
    findLocationUsages: (location: string) => void;
    renameCharacter: (name: string) => void;
}

async function paste(view: EditorView) {
    try {
        const text = await navigator.clipboard.readText();
        if (text) view.dispatch(view.state.replaceSelection(text), { userEvent: "input.paste", scrollIntoView: true });
    } catch {
        document.execCommand("paste");
    }
    view.focus();
}

function copy(view: EditorView, cut: boolean) {
    const sel = view.state.selection.main;
    if (sel.empty) return;
    const text = view.state.sliceDoc(sel.from, sel.to);
    void navigator.clipboard.writeText(text).catch(() => document.execCommand(cut ? "cut" : "copy"));
    if (cut) view.dispatch({ changes: { from: sel.from, to: sel.to }, userEvent: "delete.cut" });
    view.focus();
}

/** The items for a right-click at document position `pos` (exported for tests). */
export function editorMenuItems(view: EditorView, pos: number, opts: EditorMenuOptions): ContextItem[] {
    const items: ContextItem[] = [];
    const state = view.state;

    const miss = misspellingAt(view, pos);
    if (miss) {
        const suggestions = suggest(miss.word);
        if (!suggestions.length) items.push({ heading: true, label: "No suggestions" });
        for (const s of suggestions)
            items.push({ label: s, run: () => view.dispatch({ changes: { from: miss.from, to: miss.to, insert: s }, userEvent: "input.spell" }) });
        items.push({ label: `Add “${miss.word}” to dictionary`, run: () => opts.onAddWord(miss.word) });
        items.push({ separator: true });
    }

    const empty = state.selection.main.empty;
    items.push(
        { label: "Cut", shortcut: `${modKey}+X`, disabled: empty, run: () => copy(view, true) },
        { label: "Copy", shortcut: `${modKey}+C`, disabled: empty, run: () => copy(view, false) },
        { label: "Paste", shortcut: `${modKey}+V`, run: () => void paste(view) },
        { separator: true },
    );

    const fixes = fixesAt(view);
    const labels = new Set(fixes.map((f) => f.label));
    const lineNo = state.doc.lineAt(pos).number - 1;
    const name = contextNameAt(view);
    if (name) {
        const has = (prefix: string) => [...labels].some((l) => l.startsWith(prefix));
        if (!has("Find usages")) items.push({ label: `Find usages of ${name}`, shortcut: "Alt+F7", run: () => opts.findUsages(name) });
        if (!has("Rename")) items.push({ label: `Rename ${name} everywhere…`, shortcut: "Shift+F6", run: () => opts.renameCharacter(name) });
        if (!has("Open")) items.push({ label: `Go to ${name}'s page`, run: () => opts.openCharacter(name, lineNo) });
    }
    const scene = state.field(parsedField).scenes.find((s) => s.line === lineNo);
    if (scene?.location) {
        const loc = scene.location.trim();
        items.push({ label: `Find scenes at ${loc.toUpperCase()}`, shortcut: "Alt+F7", run: () => opts.findLocationUsages(loc.toUpperCase()) });
        items.push({ label: `Go to location page: ${loc.toUpperCase()}`, run: () => opts.openLocation(loc) });
    }
    if (fixes.length) {
        items.push({ separator: true }, { heading: true, label: "Line actions (Alt+Enter)" });
        for (const f of fixes)
            items.push({
                label: f.label,
                run: () => {
                    view.dispatch(f.apply(view.state));
                    view.focus();
                },
            });
    }
    return items;
}

/** Right-click in the script: move the caret there (unless inside the selection), then show the menu. */
export function editorContextMenu(opts: () => EditorMenuOptions): Extension {
    return EditorView.domEventHandlers({
        contextmenu: (e, view) => {
            const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
            if (pos == null) return false;
            const sel = view.state.selection.main;
            // One popup at a time: a hover card (Fountain syntax, spelling) closes when the menu opens.
            if (pos < sel.from || pos > sel.to || sel.empty) view.dispatch({ selection: EditorSelection.cursor(pos), effects: closeHoverTooltips });
            else view.dispatch({ effects: closeHoverTooltips });
            e.preventDefault();
            // ...and again on close, so a card that was mid-delay when the menu opened can't appear after it.
            showContextMenu(e.clientX, e.clientY, editorMenuItems(view, pos, opts()), () => {
                if (view.dom.isConnected) view.dispatch({ effects: closeHoverTooltips });
            });
            return true;
        },
    });
}
