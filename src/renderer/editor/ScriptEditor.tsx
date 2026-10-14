// src/renderer/editor/ScriptEditor.tsx
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { showTemplatePicker } from "./templates";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView, drawSelection, highlightActiveLine, keymap, placeholder } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, redo, undo, selectAll } from "@codemirror/commands";
import { closeSearchPanel, openSearchPanel, search, searchKeymap } from "@codemirror/search";
import { acceptCompletion, completionKeymap } from "@codemirror/autocomplete";

import { fountain, lineTypeAt, type BadgeHandler } from "./fountain-extension";
import { refreshSpellcheck, spellcheck } from "./spellcheck";
import { extendSelection, intentions, moveScene, moveSceneToSpec, problemsOf, recheckInspections, shrinkSelection } from "./intentions";
import { editorContextMenu } from "./context-menu";
import { revisions, setRevisionBaseline, type RevisionBaseline } from "./revisions";
import { authorship, fromStored, setBlameVisible, stampsOf, toStored } from "./authorship";
import type { SfpDocAuthorship } from "../../backend/sfp-archive";
import type { FountainLineType } from "../lib/fountain";

export interface CursorInfo {
    line: number; // 0-based
    col: number; // 1-based
    type: FountainLineType;
    selectionLength: number;
}

export interface ScriptEditorHandle {
    focus(): void;
    jumpToLine(line: number, select?: boolean): void;
    undo(): void;
    redo(): void;
    selectAll(): void;
    openSearch(): void;
    getText(): string;
    /** Apply non-overlapping edits in one undoable step. */
    applyEdits(edits: Array<{ from: number; to: number; insert: string }>): void;
    /** Structural editing commands, for menus and the palette (same as their keys). */
    command(name: EditorCommand): void;
    /** Every inspection hit in this script (0-based lines), for the Problems window. */
    problems(): Array<{ line: number; severity: "warn" | "hint"; message: string }>;
    /** Move the scene starting at `line` until it is scene number `target` (0-based), as one undo. */
    moveSceneTo(line: number, target: number): void;
}

export type EditorCommand = "extend-selection" | "shrink-selection" | "scene-up" | "scene-down" | "insert-template";

interface Props {
    /** Changing this replaces the document (and its undo history). */
    docKey: string;
    initialText: string;
    onChange: (text: string) => void;
    onCursor: (info: CursorInfo) => void;
    onBadge: BadgeHandler;
    characters: () => string[];
    headings: () => string[];
    locations: () => string[];
    draftDate?: () => string;
    autoContinue: boolean;
    autoFocus?: boolean;
    spellcheck?: boolean;
    /** User dictionary plus project character/location names. */
    spellWords?: () => string[];
    onAddWord?: (word: string) => void;
    /** Bump to re-run the spellcheck (dictionary or setting changed). */
    spellVersion?: string;
    /** Stored authorship of this document (read once per docKey). */
    authorship?: SfpDocAuthorship;
    /** Name stamped on lines this user writes. */
    authorName?: () => string;
    /** Show the blame gutter. */
    showBlame?: boolean;
    /** Mark lines changed since this baseline (revision marks). */
    revisionBaseline?: RevisionBaseline | null;
    /** List a character's cues and mentions (Alt+F7). */
    onFindUsages?: (name: string) => void;
    /** User live templates. */
    liveTemplates?: Array<{ abbr: string; text: string }>;
    /** Rename a character across the project (Shift+F6 / Alt+Enter on a cue). */
    onRenameCharacter?: (name: string) => void;
    /** Underline craft problems (inspections). Alt+Enter works either way. */
    inspections?: boolean;
    /** Target script length in pages for the act-length inspection (0 = off). */
    targetPages?: number;
    /** Titles of the project's screenplays (`*include` checks). */
    includeTargets?: () => string[];
    /** List every scene at a location (Alt+F7 on a scene heading). */
    onFindLocationUsages?: (location: string) => void;
    /** Open a location's page (right-click on a scene heading). */
    onOpenLocation?: (name: string) => void;
    /** Called after edits with the document's current authorship. */
    onAuthorship?: (a: SfpDocAuthorship) => void;
}

export const ScriptEditor = forwardRef<ScriptEditorHandle, Props>(function ScriptEditor(props, ref) {
    const host = useRef<HTMLDivElement>(null);
    const view = useRef<EditorView | null>(null);
    // Callbacks change every render; the editor reads them through a ref so it is built once per document.
    const latest = useRef(props);
    latest.current = props;

    useEffect(() => {
        if (!host.current) return;
        const reportCursor = (v: EditorView) => {
            const sel = v.state.selection.main;
            const line = v.state.doc.lineAt(sel.head);
            latest.current.onCursor({
                line: line.number - 1,
                col: sel.head - line.from + 1,
                type: lineTypeAt(v.state, line.number - 1),
                selectionLength: Math.abs(sel.to - sel.from),
            });
        };

        const blame = authorship({
            initial: fromStored(latest.current.authorship, props.initialText.split("\n").length),
            author: () => latest.current.authorName?.() ?? "",
            visible: !!latest.current.showBlame,
        });
        let authorshipTimer: ReturnType<typeof setTimeout> | null = null;
        const state = EditorState.create({
            doc: props.initialText,
            extensions: [
                history(),
                drawSelection(),
                highlightActiveLine(),
                EditorView.lineWrapping,
                placeholder("FADE IN:"),
                search({ top: true }),
                fountain({
                    completion: {
                        characters: () => latest.current.characters(),
                        headings: () => latest.current.headings(),
                        locations: () => latest.current.locations(),
                        draftDate: () => latest.current.draftDate?.() ?? "",
                    },
                    onBadge: (kind, text, line) => latest.current.onBadge(kind, text, line),
                    autoContinue: () => latest.current.autoContinue,
                }),
                spellcheck({
                    enabled: () => latest.current.spellcheck !== false,
                    extraWords: () => latest.current.spellWords?.() ?? [],
                    onAddWord: (w) => latest.current.onAddWord?.(w),
                }),
                intentions({
                    cast: () => latest.current.characters(),
                    openCharacter: (name, line) => latest.current.onBadge("character", name, line),
                    renameCharacter: (name) => latest.current.onRenameCharacter?.(name),
                    findUsages: (name) => latest.current.onFindUsages?.(name),
                    findLocationUsages: (loc) => latest.current.onFindLocationUsages?.(loc),
                    inspections: () => latest.current.inspections !== false,
                    targetPages: () => latest.current.targetPages ?? 0,
                    includeTargets: () => latest.current.includeTargets?.() ?? [],
                    templates: () => latest.current.liveTemplates ?? [],
                }),
                editorContextMenu(() => ({
                    onAddWord: (w) => {
                        latest.current.onAddWord?.(w);
                        if (view.current) refreshSpellcheck(view.current);
                    },
                    openCharacter: (name, line) => latest.current.onBadge("character", name, line),
                    openLocation: (name) => latest.current.onOpenLocation?.(name),
                    findUsages: (name) => latest.current.onFindUsages?.(name),
                    findLocationUsages: (loc) => latest.current.onFindLocationUsages?.(loc),
                    renameCharacter: (name) => latest.current.onRenameCharacter?.(name),
                })),
                keymap.of([{ key: "Tab", run: acceptCompletion }, ...completionKeymap, ...searchKeymap, ...historyKeymap, ...defaultKeymap]),
                blame.extension,
                revisions(latest.current.revisionBaseline ?? null),
                EditorView.updateListener.of((u) => {
                    if (u.docChanged) latest.current.onChange(u.state.doc.toString());
                    if (u.docChanged && latest.current.onAuthorship) {
                        if (authorshipTimer) clearTimeout(authorshipTimer);
                        const st = u.state;
                        authorshipTimer = setTimeout(() => latest.current.onAuthorship?.(toStored(stampsOf(st, blame.field))), 300);
                    }
                    if (u.docChanged || u.selectionSet) reportCursor(u.view);
                }),
                EditorView.contentAttributes.of({ spellcheck: "false", "aria-label": "Screenplay editor" }),
            ],
        });

        const v = new EditorView({ state, parent: host.current });
        view.current = v;
        reportCursor(v);
        if (latest.current.autoFocus !== false) v.focus();
        return () => {
            if (authorshipTimer) {
                clearTimeout(authorshipTimer);
                latest.current.onAuthorship?.(toStored(stampsOf(v.state, blame.field)));
            }
            v.destroy();
            view.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [props.docKey]);

    useEffect(() => {
        view.current?.dispatch({ effects: setBlameVisible.of(!!props.showBlame) });
    }, [props.showBlame]);

    useEffect(() => {
        view.current?.dispatch({ effects: setRevisionBaseline.of(props.revisionBaseline ?? null) });
    }, [props.revisionBaseline]);

    useEffect(() => {
        if (view.current) refreshSpellcheck(view.current);
    }, [props.spellcheck, props.spellVersion]);

    // Turning inspections on or off applies at once, not on the next edit.
    useEffect(() => {
        if (view.current) recheckInspections(view.current);
    }, [props.inspections, props.targetPages]);

    useImperativeHandle(ref, () => ({
        focus: () => view.current?.focus(),
        jumpToLine: (lineIndex, select = false) => {
            const v = view.current;
            if (!v) return;
            const line = v.state.doc.line(Math.min(Math.max(1, lineIndex + 1), v.state.doc.lines));
            v.dispatch({
                selection: select ? EditorSelection.range(line.from, line.to) : EditorSelection.cursor(line.from),
                effects: EditorView.scrollIntoView(line.from, { y: "start", yMargin: 80 }),
            });
            v.focus();
        },
        undo: () => view.current && undo(view.current),
        redo: () => view.current && redo(view.current),
        selectAll: () => view.current && selectAll(view.current),
        openSearch: () => {
            if (!view.current) return;
            closeSearchPanel(view.current);
            openSearchPanel(view.current);
        },
        getText: () => view.current?.state.doc.toString() ?? "",
        applyEdits: (edits) => {
            if (view.current && edits.length) view.current.dispatch({ changes: edits, userEvent: "input.rename" });
        },
        problems: () => (view.current ? problemsOf(view.current).map((p) => ({ line: p.line, severity: p.severity, message: p.message })) : []),
        moveSceneTo: (line, target) => {
            const v = view.current;
            if (!v) return;
            const spec = moveSceneToSpec(v.state, line, target);
            if (spec) v.dispatch({ ...spec, scrollIntoView: true, userEvent: "move.scene" });
            v.focus();
        },
        command: (name) => {
            const v = view.current;
            if (!v) return;
            if (name === "insert-template") return void showTemplatePicker(v, latest.current.liveTemplates ?? []);
            if (name === "extend-selection") extendSelection(v);
            else if (name === "shrink-selection") shrinkSelection(v);
            else moveScene(v, name === "scene-up" ? -1 : 1);
            v.focus();
        },
    }));

    return <div className="script-editor" ref={host} />;
});
