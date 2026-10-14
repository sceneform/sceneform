// src/renderer/editor/templates.ts
// Live templates, IntelliJ-style. Type an abbreviation alone on a line and press Tab, or
// press Ctrl/Cmd+J for a filterable picker. A template can hold several tab stops:
// `$1`, `$2`, … (or `${1:default text}`) are visited in order with Tab / Shift+Tab, and
// `$0` is where the cursor ends up.
// `\n` in a template starts a new line.

import { type Completion, completionStatus, snippet } from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";

export interface LiveTemplate {
    abbr: string;
    text: string;
}

export const BUILTIN_TEMPLATES: LiveTemplate[] = [
    { abbr: "int", text: "INT. ${1:LOCATION} - ${2:DAY}$0" },
    { abbr: "ext", text: "EXT. ${1:LOCATION} - ${2:DAY}$0" },
    { abbr: "ie", text: "INT./EXT. ${1:LOCATION} - ${2:DAY}$0" },
    { abbr: "intn", text: "INT. ${1:LOCATION} - NIGHT$0" },
    { abbr: "extn", text: "EXT. ${1:LOCATION} - NIGHT$0" },
    { abbr: "fi", text: "FADE IN:\n\n$0" },
    { abbr: "fo", text: "> FADE OUT.$0" },
    { abbr: "ct", text: "CUT TO:\n\n$0" },
    { abbr: "dt", text: "DISSOLVE TO:\n\n$0" },
    { abbr: "sct", text: "SMASH CUT TO:\n\n$0" },
    { abbr: "fb", text: ".FLASHBACK - $0" },
    { abbr: "eofb", text: ".END FLASHBACK$0" },
    { abbr: "mont", text: ".MONTAGE - $0" },
    { abbr: "eom", text: ".END MONTAGE$0" },
    { abbr: "beat", text: "(beat)$0" },
    { abbr: "the end", text: "> THE END <$0" },
    { abbr: "phone", text: "${1:NAME} (V.O.)\n(on phone)\n$0" },
    { abbr: "dual", text: "${1:NAME}\n$2\n\n${3:OTHER} ^\n$0" },
];

/**
 * Our template syntax becomes CodeMirror's snippet syntax: `$1` becomes `${1}`, `${1:x}` kept,
 * `$0` becomes `${0}`; every other brace is escaped. With no stop at all the cursor ends at the end.
 */
export function toCmSnippet(text: string): string {
    const body = text.replace(/\\n/g, "\n");
    let out = "";
    let hasZero = false;
    const re = /\$\{(\d+)(?::([^{}]*))?\}|\$(\d+)|[{}]/g;
    let last = 0;
    for (let m = re.exec(body); m; m = re.exec(body)) {
        out += body.slice(last, m.index);
        last = m.index + m[0].length;
        if (m[0] === "{" || m[0] === "}") {
            out += "\\" + m[0];
            continue;
        }
        const n = m[1] ?? m[3];
        if (n === "0") hasZero = true;
        out += m[2] !== undefined ? `\${${n}:${m[2]}}` : `\${${n}}`;
    }
    out += body.slice(last);
    return hasZero ? out : out + "${0}";
}

/** "abbr = text" lines (Settings and Project settings) → templates; blank or malformed lines are skipped. */
export function parseTemplates(text: string): LiveTemplate[] {
    return text
        .split("\n")
        .map((l) => l.match(/^\s*([^=]+?)\s*=\s?(.*)$/))
        .filter((m): m is RegExpMatchArray => !!m && !!m[1] && !!m[2])
        .map((m) => ({ abbr: m[1], text: m[2] }));
}

export const formatTemplates = (list: LiveTemplate[] | undefined) => (list ?? []).map((t) => `${t.abbr} = ${t.text}`).join("\n");

/** The plain text a template inserts (defaults filled in, stops removed): for previews. */
export function templatePreview(text: string): string {
    return text.replace(/\\n/g, "\n").replace(/\$\{\d+:([^{}]*)\}/g, "$1").replace(/\$\d+/g, "");
}

export function allTemplates(user: LiveTemplate[]): LiveTemplate[] {
    const seen = new Set<string>();
    return [...user, ...BUILTIN_TEMPLATES].filter((t) => {
        const k = t.abbr.trim().toLowerCase();
        if (!k || seen.has(k)) return false;
        seen.add(k);
        return true;
    });
}

function insert(view: EditorView, t: LiveTemplate, from: number, to: number) {
    snippet(toCmSnippet(t.text))(view, null as unknown as Completion, from, to);
}

/** Tab after an abbreviation alone on a line. */
export function expandTemplate(view: EditorView, user: LiveTemplate[]): boolean {
    const { state } = view;
    if (completionStatus(state) === "active") return false;
    const sel = state.selection.main;
    if (!sel.empty) return false;
    const line = state.doc.lineAt(sel.head);
    if (sel.head !== line.to) return false;
    const typed = line.text.trim().toLowerCase();
    if (!typed) return false;
    const t = allTemplates(user).find((x) => x.abbr.trim().toLowerCase() === typed);
    if (!t) return false;
    const from = line.from + (line.text.length - line.text.trimStart().length);
    insert(view, t, from, line.to);
    return true;
}

let openPicker: { close: () => void } | null = null;

/**
 * Ctrl/Cmd+J: a filterable list of every template. When the text before the cursor is the
 * start of an abbreviation, it seeds the filter and is replaced on insert.
 */
export function showTemplatePicker(view: EditorView, user: LiveTemplate[]): boolean {
    openPicker?.close();
    const all = allTemplates(user);
    const { state } = view;
    const sel = state.selection.main;
    const line = state.doc.lineAt(sel.head);
    const before = line.text.slice(0, sel.head - line.from);
    const word = sel.empty ? (/(\S[^\n]*)$/.exec(before.trimStart())?.[1] ?? "") : "";
    const seed = word && all.some((t) => t.abbr.toLowerCase().startsWith(word.toLowerCase())) ? word : "";
    const replaceFrom = seed ? sel.head - seed.length : sel.from;

    const at = view.coordsAtPos(sel.head);
    const el = document.createElement("div");
    el.className = "sf-intentions sf-templates";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-label", "Insert live template");
    const input = document.createElement("input");
    input.className = "sf-templates__filter";
    input.placeholder = "Live template…";
    input.value = seed;
    input.spellcheck = false;
    const list = document.createElement("div");
    list.setAttribute("role", "listbox");
    list.className = "sf-templates__list";
    el.append(input, list);

    let shown: LiveTemplate[] = [];
    let index = 0;
    const render = () => {
        const q = input.value.trim().toLowerCase();
        shown = all.filter((t) => !q || t.abbr.toLowerCase().includes(q) || templatePreview(t.text).toLowerCase().includes(q));
        shown.sort((a, b) => Number(!a.abbr.toLowerCase().startsWith(q)) - Number(!b.abbr.toLowerCase().startsWith(q)));
        list.replaceChildren(
            ...shown.map((t, i) => {
                const item = document.createElement("div");
                item.className = "sf-intentions__item sf-templates__item";
                item.setAttribute("role", "option");
                const abbr = document.createElement("span");
                abbr.className = "sf-templates__abbr";
                abbr.textContent = t.abbr;
                const prev = document.createElement("span");
                prev.className = "sf-templates__preview";
                prev.textContent = templatePreview(t.text).replace(/\n/g, " ⏎ ");
                item.append(abbr, prev);
                item.addEventListener("mousedown", (e) => {
                    e.preventDefault();
                    run(i);
                });
                item.addEventListener("mousemove", () => select(i));
                return item;
            }),
        );
        if (!shown.length) {
            const none = document.createElement("div");
            none.className = "sf-templates__none";
            none.textContent = "No template matches";
            list.append(none);
        }
        select(0);
    };
    const select = (i: number) => {
        if (!shown.length) return;
        index = (i + shown.length) % shown.length;
        [...list.children].forEach((it, k) => it.classList.toggle("is-selected", k === index));
        list.children[index]?.scrollIntoView({ block: "nearest" });
    };
    const run = (i: number) => {
        const t = shown[i];
        close();
        if (!t) return;
        view.focus();
        insert(view, t, replaceFrom, sel.to);
    };
    const onKey = (e: KeyboardEvent) => {
        if (e.key === "ArrowDown") select(index + 1);
        else if (e.key === "ArrowUp") select(index - 1);
        else if (e.key === "Enter" || e.key === "Tab") run(index);
        else if (e.key === "Escape") {
            close();
            view.focus();
        } else return;
        e.preventDefault();
        e.stopPropagation();
    };
    const onDown = (e: MouseEvent) => {
        if (!el.contains(e.target as Node)) close();
    };
    const close = () => {
        input.removeEventListener("keydown", onKey);
        window.removeEventListener("mousedown", onDown, true);
        el.remove();
        if (openPicker?.close === close) openPicker = null;
    };
    input.addEventListener("keydown", onKey);
    input.addEventListener("input", render);
    window.addEventListener("mousedown", onDown, true);
    document.body.appendChild(el);
    render();
    const left = Math.min(at?.left ?? 100, window.innerWidth - el.offsetWidth - 8);
    const below = (at?.bottom ?? 100) + 4;
    const top = below + el.offsetHeight > window.innerHeight ? Math.max(8, (at?.top ?? 100) - el.offsetHeight - 4) : below;
    el.style.left = `${Math.max(8, left)}px`;
    el.style.top = `${top}px`;
    input.focus();
    openPicker = { close };
    return true;
}
