// src/renderer/EditorScreen.tsx
//
// An open project: its screenplays (episodes), notes and canvases, the pages
// for cards, characters, locations and scenes, Project information and Project
// settings, statistics, the live preview, the outline and the save pipeline.
//
// Bugs fixed from the old App.tsx, for the record:
//  - re-parsing rebuilt scenes from scratch and dropped WIP/omitted/description
//    edits, then autosaved the loss (scene meta now merges, never regenerates)
//  - the editor's innerHTML was replaced on every parse, losing caret and undo
//  - "time spent" was written as the page-count runtime estimate
//  - "updated" was saved as the literal string "Just now"
//  - outline and character clicks only showed a toast
//  - paths were built with "\\", breaking macOS and Linux
//  - a failed save could leave "Saving…" on screen forever

import { Fragment, forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type {
    AppSettings,
    PdfExportOptions,
    ProjectListing,
    SfpDocument,
    SfpDocumentKind,
    SfpEntities,
    SfpProjectData,
    TitlePageDefaults,
} from "../shared/bridge";
import type { SfpAuthorship } from "../backend/sfp-archive";
import { applyEdits, renameEdits, renameInKey } from "./lib/rename";
import { mergeProjects } from "./lib/merge";
import { hasIncludes, resolveIncludes } from "./lib/include";
import { fountainToFdx } from "../shared/fdx";
import { HistoryDialog, REVISION_COLORS } from "./components/history";
import type { BackupInfo, HistoryDoc } from "../shared/bridge";
import type { CanvasCard } from "../backend/types/canvas";
import type { CharacterEntity, LocationEntity, SceneEntity } from "../backend/types/entities";
import { DEFAULT_PROJECT_SETTINGS } from "../backend/project-defaults";
import { TITLE_PAGE_KEYS, buildTitlePageTemplate, inheritedKeys, normalizeTitleKey, parseDraftDate, setDefaults, titleKeyLabel } from "../backend/title-page";
import type { OpenProject } from "./App";
import { api } from "./lib/api";
import {
    LINE_TYPE_LABELS,
    buildScenes,
    computeStats,
    idMarkerEdits,
    parseFountain,
    parseInline,
    sceneIndexAtLine,
    sceneLengths,
    type FountainParserDocument,
    type SceneView,
} from "./lib/fountain";
import { baseName, formatTimeSpent, modKey, parseTimeSpent } from "./lib/format";
import {
    characterReport,
    docsOfKind,
    locationScenes,
    mergeStats,
    newDocId,
    nextDocTitle,
    normalizeCue,
    tabDocId,
    tabKey,
    effectiveEditorSettings,
    type ProjectSettingsX,
    type ParsedScript,
    type SceneRef,
    type Tab,
} from "./lib/project";
import { ScriptEditor, type CursorInfo, type ScriptEditorHandle } from "./editor/ScriptEditor";
import { showContextMenu } from "./editor/context-menu";
import { ToolWindow, type ToolItem } from "./components/toolwindow";
import { Menubar, SaveIndicator, Statusbar, Titlebar, type Menu, type SaveState } from "./components/chrome";
import {
    ActivityBar,
    CanvasCardListView,
    CheatSheetView,
    ExplorerView,
    InfoView,
    InspectorPane,
    OutlineView,
    type SidebarView,
} from "./components/workspace";
import { CanvasWorkspace } from "./components/canvas";
import { StatisticsView } from "./components/stats";
import { CommandPalette, ExportDialog, type PaletteItem } from "./components/dialogs";
import { CardPage, CharacterPage, LocationPage, NotePage, ProjectInfoPage, ProjectSettingsPage, ScenePage } from "./components/pages";
import { LivePreview, previewTitleEntries } from "./components/preview";
import { IconBook, IconCanvas, IconChart, IconFile, IconFocus, IconInspector, IconOutline, IconPeople, IconPin, IconPreview, IconSidebar, IconUnfocus } from "./components/icons";
import { ConfirmDialog, type ConfirmRequest, type Toast } from "./components/ui";

export interface EditorScreenHandle {
    /** Saves now if anything is unsaved. Resolves false only when saving failed. */
    flush(): Promise<boolean>;
}

interface Props {
    project: OpenProject;
    settings: AppSettings;
    active: boolean;
    onSettingsChange: (patch: Partial<AppSettings>) => void;
    onExit: () => void;
    recentProjects: ProjectListing[];
    onOpenRecent: (path: string) => void | Promise<void>;
    onOpenSettings: () => void;
    toast: (text: string, kind?: Toast["kind"]) => void;
    /** The project's .bak holds much more text than the file: offer to restore it. */
    backupNotice?: BackupInfo | null;
    onRestoreBackup?: () => void;
    onDismissBackup?: () => void;
    /** Reopen this project from disk (after a merge was saved into it). */
    onReload?: () => void;
}

const AUTOSAVE_DELAY = 1000;

export const EditorScreen = forwardRef<EditorScreenHandle, Props>(function EditorScreen(props, ref) {
    const { project, settings, toast } = props;
    const initial = project.data;
    const projectPath = project.path;

    /* ---------- document state ---------- */

    const [documents, setDocuments] = useState<SfpDocument[]>(initial.documents);
    const [entities, setEntities] = useState<SfpEntities>(initial.entities);
    // Per-line authorship of each screenplay; kept in a ref (editors report it, saves read it).
    const authorshipRef = useRef<SfpAuthorship>(initial.authorship ?? {});
    const [showBlame, setShowBlame] = useState(false);
    const [historyOpen, setHistoryOpen] = useState(false);
    // Find usages (Alt+F7): the palette shows only this character's cues and mentions.
    // Docked tool window under the script: usages of a character or location, or Problems.
    const [tool, setTool] = useState<{ kind: "usages"; name: string } | { kind: "location"; name: string } | { kind: "problems" } | null>(null);
    // Revision marks against a Local History snapshot. The choice (snapshot + colour) is kept per
    // project in app settings, so it survives a restart; the baseline text is read back from history.
    const [revMarks, setRevMarksState] = useState<{ label: string; color: string; colorName: string; docs: Record<string, string> } | null>(null);
    const setRevMarks = (next: { label: string; color: string; colorName: string; docs: Record<string, string> } | null, snapshotId?: string) => {
        setRevMarksState(next);
        const all = { ...(props.settings.activeRevisions ?? {}) };
        if (next && snapshotId) all[projectPath] = { snapshotId, label: next.label, color: next.color };
        else delete all[projectPath];
        props.onSettingsChange({ activeRevisions: all });
    };
    useEffect(() => {
        const saved = props.settings.activeRevisions?.[projectPath];
        if (!saved) return;
        let live = true;
        void api.history.read(projectPath, saved.snapshotId).then((r) => {
            if (!live || !r.ok || !r.value) return;
            setRevMarksState({
                label: saved.label,
                color: saved.color,
                colorName: REVISION_COLORS.find((c) => c.value === saved.color)?.name ?? "",
                docs: Object.fromEntries(r.value.filter((d) => d.kind === "script").map((d) => [d.id, d.content])),
            });
        });
        return () => {
            live = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [projectPath]);
    const revisionFor = useMemo(() => {
        const cache = new Map<string, { text: string; color: string }>();
        return (docId: string) => {
            if (!revMarks || revMarks.docs[docId] === undefined) return null;
            if (!cache.has(docId)) cache.set(docId, { text: revMarks.docs[docId], color: revMarks.color });
            return cache.get(docId)!;
        };
    }, [revMarks]);
    const [titleDefaults, setTitleDefaults] = useState<TitlePageDefaults>(initial.titlePageDefaults ?? {});
    const [projectSettings, setProjectSettings] = useState<ProjectSettingsX>({ ...DEFAULT_PROJECT_SETTINGS, ...initial.projectSettings });
    const editorPrefs = useMemo(() => effectiveEditorSettings(projectSettings, settings), [projectSettings, settings]);
    const [summary, setSummary] = useState(initial.project);

    const scripts = useMemo(() => docsOfKind(documents, "script"), [documents]);
    const canvases = useMemo(() => docsOfKind(documents, "canvas"), [documents]);
    const isSeries = projectSettings.type === "series";
    const scriptsLabel = isSeries ? "Episodes" : "Screenplays";

    /* ---------- ui state ---------- */

    const firstScriptId = docsOfKind(initial.documents, "script")[0]?.id ?? "script-1";
    const [tabs, setTabs] = useState<Tab[]>([{ kind: "script", docId: firstScriptId }]);
    const [activeKey, setActiveKey] = useState<string>(`script:${firstScriptId}`);
    const [activeScriptId, setActiveScriptId] = useState(firstScriptId);
    const [activeCanvasId, setActiveCanvasId] = useState<string | null>(docsOfKind(initial.documents, "canvas")[0]?.id ?? null);
    const [sidebarView, setSidebarView] = useState<SidebarView>("outline");
    const [sidebarOpen, setSidebarOpen] = useState(true);
    const [inspectorOpen, setInspectorOpen] = useState(true);
    const [inspectorTab, setInspectorTab] = useState<"scene" | "cast" | "stats">("scene");
    const [infoTab, setInfoTab] = useState<"characters" | "locations">("characters");
    const [focusMode, setFocusMode] = useState(false);
    const [previewOpen, setPreviewOpen] = useState(false);
    const [previewPaper, setPreviewPaper] = useState<"white" | "dark">("white");

    // Width-aware panels: when the window can't fit the activity bar, sidebar, editor (and preview) and the
    // inspector, close one panel. The one the user just opened stays; otherwise the inspector goes first.
    const panelsRef = useRef({ sidebar: sidebarOpen, inspector: inspectorOpen });
    useEffect(() => {
        const prev = panelsRef.current;
        const justOpened: "sidebar" | "inspector" | null =
            inspectorOpen && !prev.inspector ? "inspector" : sidebarOpen && !prev.sidebar ? "sidebar" : null;
        const fit = () => {
            const css = getComputedStyle(document.documentElement);
            const px = (name: string, fallback: number) => parseFloat(css.getPropertyValue(name)) || fallback;
            const editorMin = previewOpen ? 900 : 520;
            const need = (side: boolean, insp: boolean) => 44 + (side ? px("--sidebar-w", 240) : 0) + (insp ? px("--inspector-w", 280) : 0) + editorMin;
            const width = window.innerWidth;
            if (!sidebarOpen || !inspectorOpen || need(true, true) <= width) return;
            if (justOpened === "sidebar") setInspectorOpen(false);
            else if (justOpened === "inspector") setSidebarOpen(false);
            else setInspectorOpen(false);
        };
        fit();
        panelsRef.current = { sidebar: sidebarOpen, inspector: inspectorOpen };
        window.addEventListener("resize", fit);
        return () => window.removeEventListener("resize", fit);
    }, [sidebarOpen, inspectorOpen, previewOpen]);
    const [paletteOpen, setPaletteOpen] = useState(false);
    const [exportOpen, setExportOpen] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
    const [cursor, setCursor] = useState<CursorInfo>({ line: 0, col: 1, type: "blank", selectionLength: 0 });
    const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
    const [canvasZoom, setCanvasZoom] = useState(1);

    const activeTab: Tab = tabs.find((t) => tabKey(t) === activeKey) ?? tabs[0] ?? { kind: "script", docId: firstScriptId };
    const effectiveAutosave = projectSettings.autosave === "inherit" ? settings.autosave : projectSettings.autosave === "on";

    /* ---------- save state ---------- */

    const [saveState, setSaveState] = useState<SaveState>("saved");
    const [saveError, setSaveError] = useState<string | null>(null);
    const revision = useRef(0); // bumps on every edit
    const savedRevision = useRef(0);
    const inFlight = useRef<Promise<boolean> | null>(null);
    const editors = useRef(new Map<string, ScriptEditorHandle>());

    // Active writing time: minutes already stored + time accumulated this session.
    const baseMinutes = useRef(parseTimeSpent(initial.project.timeSpent));
    const sessionMs = useRef(0);
    const lastInput = useRef(0);
    const [minutes, setMinutes] = useState(baseMinutes.current);

    const markDirty = useCallback(() => {
        revision.current += 1;
        lastInput.current = Date.now();
        setSaveState((s) => (s === "saving" ? s : "dirty"));
    }, []);

    /* ---------- derived: parse every screenplay ---------- */

    // The editor parses on every keystroke for its own highlighting; the side panels and
    // pages re-parse on a short debounce (or on pause, when "Live outline" is off).
    const [parseSnapshot, setParseSnapshot] = useState(documents);
    useEffect(() => {
        const t = window.setTimeout(() => setParseSnapshot(documents), settings.liveReparse ? 120 : 1200);
        return () => window.clearTimeout(t);
    }, [documents, settings.liveReparse]);

    const parseCache = useRef(new Map<string, { content: string; parsed: FountainParserDocument }>());
    const parsedScripts = useMemo<ParsedScript[]>(() => {
        return docsOfKind(parseSnapshot, "script").map((doc) => {
            const content = doc.content ?? "";
            let hit = parseCache.current.get(doc.id);
            if (!hit || hit.content !== content) {
                hit = { content, parsed: parseFountain(content) };
                parseCache.current.set(doc.id, hit);
            }
            const scenes = buildScenes(hit.parsed, entities.scenes[doc.id] ?? {});
            return { doc, parsed: hit.parsed, scenes, stats: computeStats(hit.parsed, scenes) };
        });
    }, [parseSnapshot, entities.scenes]);

    const active = parsedScripts.find((p) => p.doc.id === activeScriptId) ?? parsedScripts[0];
    // The live preview shows `*include`d screenplays in place.
    const previewDoc = useMemo(() => {
        const text = active?.doc.content ?? "";
        if (!active || !hasIncludes(text)) return null;
        return parseFountain(resolveIncludes(text, scripts.map((d) => ({ id: d.id, title: d.title, content: d.content ?? "" })), active.doc.id));
    }, [active, scripts]);
    const activeDoc = scripts.find((d) => d.id === activeScriptId) ?? scripts[0];
    const scenes = active?.scenes ?? [];
    const emptyStats = useMemo(() => computeStats(parseFountain(""), []), []);
    const stats = active?.stats ?? emptyStats;
    const currentSceneIndex = sceneIndexAtLine(scenes, cursor.line);
    // Outline: section headers and per-scene page lengths of the active script.
    const outlineSections = useMemo(
        () => (active?.parsed.outline ?? []).filter((n) => n.kind === "section").map((n) => ({ line: n.line, depth: (n as { depth: number }).depth, title: (n as { title: string }).title })),
        [active?.parsed],
    );
    const sceneLens = useMemo(() => (active ? sceneLengths(active.parsed, scenes) : []), [active?.parsed, scenes]);
    const currentScene = currentSceneIndex >= 0 ? scenes[currentSceneIndex] : null;
    const multipleScripts = scripts.length > 1;

    // Breadcrumbs: the sections enclosing the cursor, its scene, and who is speaking.
    const crumbs = useMemo(() => {
        const lines = active?.parsed.lines ?? [];
        const sections: Array<{ label: string; line: number }> = [];
        let limit = Infinity;
        for (let i = Math.min(cursor.line, lines.length - 1); i >= 0; i--) {
            const l = lines[i];
            if (l?.type !== "section") continue;
            const depth = l.depth ?? 1;
            if (depth >= limit) continue;
            limit = depth;
            sections.unshift({ label: (l.text ?? l.raw).replace(/^#+\s*/, "").trim() || "Section", line: i });
            if (depth <= 1) break;
        }
        let speaker: { label: string; line: number } | null = null;
        const here = lines[cursor.line]?.type;
        if (here === "dialogue" || here === "parenthetical" || here === "lyrics" || here === "character") {
            for (let i = cursor.line; i >= 0 && i > cursor.line - 60; i--) {
                if (lines[i]?.type === "character") {
                    speaker = { label: lines[i].character?.name ?? lines[i].raw.trim(), line: i };
                    break;
                }
                if (!lines[i] || lines[i].type === "blank") break;
            }
        }
        return { sections, speaker };
    }, [active, cursor.line]);

    const activeCanvas = canvases.find((c) => c.id === activeCanvasId) ?? canvases[0] ?? null;
    const cards = activeCanvas?.cards ?? [];
    const selectedCard = cards.find((c) => c.id === selectedCardId) ?? null;

    // Completion and cross-episode lists use every screenplay: a series shares its cast.
    const characterNames = useMemo(() => [...new Set(parsedScripts.flatMap((p) => p.stats.characters.map((c) => c.name)))], [parsedScripts]);
    const headings = useMemo(() => [...new Set(parsedScripts.flatMap((p) => p.scenes.map((s) => s.heading)))], [parsedScripts]);
    const locations = useMemo(() => [...new Set(parsedScripts.flatMap((p) => p.scenes.map((s) => s.location.toUpperCase())).filter(Boolean))], [parsedScripts]);
    const completion = useRef({ characterNames, headings, locations, draftDate: titleDefaults["draft date"] ?? "" });
    completion.current = { characterNames, headings, locations, draftDate: titleDefaults["draft date"] ?? "" };

    const inherited = useMemo(() => (active ? inheritedKeys(active.parsed.titleEntries, titleDefaults) : []), [active, titleDefaults]);
    // Auto-detect Project information from the script's own title page: a known key the project has no value
    // for yet is copied over. Anything already set in Project information is never overwritten.
    useEffect(() => {
        if (!active) return;
        const t = setTimeout(() => {
            const found: Record<string, string> = {};
            for (const e of active.parsed.titleEntries) {
                const key = normalizeTitleKey(e.keyLower);
                const spec = TITLE_PAGE_KEYS.find((k) => k.key === key);
                const raw = (e.value ?? "").trim();
                if (!spec || !raw) continue;
                const value = spec.date ? parseDraftDate(raw) : raw;
                if (value) found[key] = value;
            }
            const missing = Object.entries(found).filter(([k]) => !(latest.current.titleDefaults[k] ?? "").trim());
            if (!missing.length) return;
            setTitleDefaults((d) => {
                const next = { ...d };
                for (const [k, v] of missing) if (!(next[k] ?? "").trim()) next[k] = v;
                return next;
            });
            markDirty();
        }, 1200);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [active?.parsed]);

    const previewEntries = useMemo(() => {
        if (!active) return [];
        const inh = setDefaults(titleDefaults).filter(([k]) => inherited.includes(k));
        return previewTitleEntries(active.parsed, inh);
    }, [active, titleDefaults, inherited]);

    /* ---------- saving ---------- */

    const latest = useRef({ documents, entities, titleDefaults, projectSettings, summary });
    latest.current = { documents, entities, titleDefaults, projectSettings, summary };

    const save = useCallback(async (): Promise<boolean> => {
        if (inFlight.current) {
            await inFlight.current;
            if (savedRevision.current === revision.current) return true;
        }
        const target = revision.current;
        const s = latest.current;
        const timeSpent = formatTimeSpent(baseMinutes.current + sessionMs.current / 60000);
        // Totals cover every screenplay; use the live text so nothing typed in the last debounce is missed.
        const totals = docsOfKind(s.documents, "script").reduce(
            (acc, doc) => {
                const cached = parseCache.current.get(doc.id);
                const parsed = cached && cached.content === (doc.content ?? "") ? cached.parsed : parseFountain(doc.content ?? "");
                const sc = buildScenes(parsed, s.entities.scenes[doc.id] ?? {});
                const st = computeStats(parsed, sc);
                return { pages: acc.pages + st.pages, scenes: acc.scenes + sc.length, count: acc.count + 1 };
            },
            { pages: 0, scenes: 0, count: 0 },
        );
        const payload: Partial<SfpProjectData> = {
            authorship: authorshipRef.current,
            documents: s.documents,
            entities: s.entities,
            titlePageDefaults: s.titleDefaults,
            projectSettings: s.projectSettings,
            project: {
                ...s.summary,
                updated: new Date().toISOString(),
                pages: totals.pages,
                scenes: totals.scenes,
                screenplays: totals.count,
                timeSpent,
            },
        };
        setSaveState("saving");
        const run = api.project.save(projectPath, payload).then((result) => {
            if (result.ok) {
                savedRevision.current = Math.max(savedRevision.current, target);
                setSummary((prev) => ({ ...prev, ...payload.project }));
                setSaveError(null);
                setSaveState(savedRevision.current === revision.current ? "saved" : "dirty");
                return true;
            }
            setSaveError(result.error.message);
            setSaveState("error");
            return false;
        });
        inFlight.current = run;
        try {
            return await run;
        } finally {
            inFlight.current = null;
        }
    }, [projectPath]);

    // Autosave: a second after the last edit. A failed save retries with backoff
    // and keeps showing "Not saved" until it works.
    const retryDelay = useRef(AUTOSAVE_DELAY);
    useEffect(() => {
        if (!effectiveAutosave || (saveState !== "dirty" && saveState !== "error")) return;
        const delay = saveState === "error" ? retryDelay.current : AUTOSAVE_DELAY;
        const t = window.setTimeout(async () => {
            const okSave = await save();
            retryDelay.current = okSave ? AUTOSAVE_DELAY : Math.min(retryDelay.current * 2, 30000);
        }, delay);
        return () => window.clearTimeout(t);
    }, [saveState, effectiveAutosave, save, documents, entities, titleDefaults, projectSettings, summary]);

    useImperativeHandle(ref, () => ({
        flush: async () => {
            if (savedRevision.current === revision.current && !inFlight.current) return true;
            return save();
        },
    }));

    /* ---------- time tracking ---------- */

    useEffect(() => {
        const idleMs = settings.timeTrackingIdleMinutes * 60000;
        let last = Date.now();
        const tick = window.setInterval(() => {
            const now = Date.now();
            const isActive = document.hasFocus() && props.active && now - lastInput.current < idleMs;
            if (isActive) sessionMs.current += now - last;
            last = now;
            setMinutes(baseMinutes.current + sessionMs.current / 60000);
        }, 15000);
        return () => window.clearInterval(tick);
    }, [settings.timeTrackingIdleMinutes, props.active]);

    /* ---------- window title ---------- */

    useEffect(() => {
        if (!props.active) return;
        document.title = `${saveState === "saved" ? "" : "• "}${summary.title} - Sceneform`;
        return () => {
            document.title = "Sceneform";
        };
    }, [summary.title, saveState, props.active]);

    /* ---------- navigation ---------- */

    const openTab = useCallback((t: Tab) => {
        const key = tabKey(t);
        setTabs((list) => (list.some((x) => tabKey(x) === key) ? list : [...list, t]));
        setActiveKey(key);
        if (t.kind === "script") setActiveScriptId(t.docId);
        if (t.kind === "canvas" || t.kind === "card") setActiveCanvasId(t.docId);
        if (t.kind === "card") setSelectedCardId(t.cardId);
    }, []);

    const closeActiveTab = () => {
        const t = tabs.find((x) => tabKey(x) === activeKey);
        if (t && (tabs.length > 1 || t.kind !== "script")) closeTab(t);
    };

    /** Close every tab except `keep` (with "right", only the tabs after it). */
    const closeOtherTabs = (keep: Tab, only?: "right") => {
        const key = tabKey(keep);
        const idx = tabs.findIndex((x) => tabKey(x) === key);
        const remaining = tabs.filter((x, i) => tabKey(x) === key || (only === "right" && i < idx));
        for (const x of tabs) if (x.kind === "script" && !remaining.includes(x)) editors.current.delete(x.docId);
        setTabs(remaining);
        if (!remaining.some((x) => tabKey(x) === activeKey)) openTab(keep);
    };

    const closeTab = (t: Tab) => {
        const key = tabKey(t);
        const remaining = tabs.filter((x) => tabKey(x) !== key);
        if (t.kind === "script") editors.current.delete(t.docId);
        if (remaining.length === 0) {
            const fallback: Tab = { kind: "script", docId: activeScriptId };
            setTabs([fallback]);
            setActiveKey(tabKey(fallback));
            return;
        }
        setTabs(remaining);
        if (activeKey === key) {
            const idx = tabs.findIndex((x) => tabKey(x) === key);
            openTab(remaining[Math.max(0, idx - 1)]);
        }
    };

    const jumpToLine = useCallback(
        (line: number, docId?: string, select = false) => {
            const id = docId ?? activeScriptId;
            openTab({ kind: "script", docId: id });
            // The editor may mount this frame (newly opened tab); retry for a few frames.
            let tries = 0;
            const go = () => {
                const ed = editors.current.get(id);
                if (ed) ed.jumpToLine(line, select);
                else if (tries++ < 20) requestAnimationFrame(go);
            };
            requestAnimationFrame(go);
        },
        [activeScriptId, openTab],
    );

    const jumpToScene = useCallback((scene: SceneView, docId?: string) => jumpToLine(scene.line, docId), [jumpToLine]);
    const jumpToRef = (r: SceneRef) => jumpToLine(r.scene.line, r.docId);

    const openScenePage = (scene: SceneView, docId?: string) => openTab({ kind: "scene", docId: docId ?? activeScriptId, sceneId: scene.id });
    const openCharacter = (name: string) => openTab({ kind: "character", name: normalizeCue(name) });
    // Rename a character across every screenplay, its cast entry included (Shift+F6).
    const renameInput = useRef<HTMLInputElement>(null);
    const renameHeadings = useRef<HTMLInputElement>(null);
    const renameCharacter = (oldName: string) => {
        const from = normalizeCue(oldName);
        if (!from) return;
        setConfirm({
            title: `Rename ${from}`,
            confirmLabel: "Rename everywhere",
            body: (
                <div className="field">
                    <p className="field__hint">Every cue, plus the name in action, dialogue, parentheticals, notes and synopses, in all screenplays. One undo per open script.</p>
                    <input ref={renameInput} className="input" defaultValue={from} autoFocus onFocus={(e) => e.currentTarget.select()} aria-label="New name" />
                    <label className="check" style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center" }}>
                        <input ref={renameHeadings} type="checkbox" /> Also in scene headings (e.g. {from}'S HOUSE), and move those location pages
                    </label>
                </div>
            ),
            onConfirm: () => {
                const to = normalizeCue(renameInput.current?.value ?? "");
                if (!to || to === from) return;
                const headings = !!renameHeadings.current?.checked;
                let count = 0;
                for (const d of scripts) {
                    const open = openScriptTabs.some((t) => t.docId === d.id) ? editors.current.get(d.id) : undefined;
                    const text = open ? open.getText() : d.content ?? "";
                    const edits = renameEdits(text, from, to, { headings });
                    if (!edits.length) continue;
                    count += edits.length;
                    if (open) open.applyEdits(edits);
                    else patchDoc(d.id, { content: applyEdits(text, edits) });
                }
                setEntities((e) => {
                    let next = e;
                    if (e.characters[from] && !e.characters[to]) {
                        const { [from]: moved, ...rest } = e.characters;
                        next = { ...next, characters: { ...rest, [to]: moved } };
                    }
                    if (headings) {
                        // Location pages follow their renamed headings ("JOHN'S HOUSE" → "MIKE'S HOUSE").
                        const locations = { ...next.locations };
                        for (const key of Object.keys(locations)) {
                            const renamed = renameInKey(key, from, to);
                            if (renamed && !locations[renamed]) {
                                locations[renamed] = locations[key];
                                delete locations[key];
                            }
                        }
                        next = { ...next, locations };
                    }
                    return next;
                });
                markDirty();
                toast(`Renamed ${from} to ${to} (${count} ${count === 1 ? "place" : "places"}).`, "success");
            },
        });
    };
    // Every scene at a location, across all screenplays (Alt+F7 on a heading).
    const locationUsageItems = (name: string): PaletteItem[] => {
        const key = name.trim().toUpperCase();
        const items: PaletteItem[] = [];
        for (const ps of parsedScripts) {
            const prefix = multipleScripts ? `${ps.doc.title}: ` : "";
            for (const sc of ps.scenes)
                if ((sc.location || "").trim().toUpperCase() === key) items.push({ group: "Usages", label: `${prefix}${sc.num}. ${sc.heading}`, meta: "scene", run: () => jumpToLine(sc.line, ps.doc.id) });
        }
        return items;
    };
    const usageItems = (name: string): PaletteItem[] => {
        const key = normalizeCue(name);
        const word = new RegExp(`(?<![\\p{L}\\p{N}])${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "iu");
        const items: PaletteItem[] = [];
        for (const ps of parsedScripts) {
            const prefix = multipleScripts ? `${ps.doc.title}: ` : "";
            ps.parsed.lines.forEach((l, i) => {
                const isCue = l.type === "character" && normalizeCue(l.raw) === key;
                const isMention = !isCue && (l.type === "action" || l.type === "dialogue" || l.type === "parenthetical" || l.type === "lyrics") && word.test(l.raw);
                if (!isCue && !isMention) return;
                const sc = sceneIndexAtLine(ps.scenes, i);
                const where = sc >= 0 ? `${ps.scenes[sc].num}. ${ps.scenes[sc].heading}` : "Before the first scene";
                let what = "";
                if (isMention) {
                    const t = l.raw.trim();
                    const at = t.search(word);
                    what = `${at > 30 ? "…" : ""}${t.slice(Math.max(0, at - 30), at + 50)}${at + 50 < t.length ? "…" : ""}`;
                }
                items.push({ group: "Usages", label: isCue ? `${prefix}${where}` : `${prefix}${where}, ${what}`, meta: isCue ? "cue" : (l.type ?? undefined), run: () => jumpToLine(i, ps.doc.id) });
            });
        }
        if (!items.length) items.push({ group: "Usages", label: `No usages of ${key}`, run: () => undefined });
        return items;
    };
    const openLocation = (name: string) => openTab({ kind: "location", name: name.toUpperCase() });
    const openDoc = (d: SfpDocument) => openTab({ kind: d.kind, docId: d.id } as Tab);

    const stepScene = (delta: number) => {
        if (!scenes.length) return;
        const target = currentSceneIndex < 0 ? (delta > 0 ? 0 : scenes.length - 1) : Math.min(scenes.length - 1, Math.max(0, currentSceneIndex + delta));
        jumpToScene(scenes[target]);
    };

    const showSidebar = (v: SidebarView) => {
        if (sidebarOpen && sidebarView === v) {
            setSidebarOpen(false);
            return;
        }
        setSidebarView(v);
        setSidebarOpen(true);
        if (v === "canvas" && activeCanvas) openTab({ kind: "canvas", docId: activeCanvas.id });
    };

    /* ---------- edits: documents ---------- */

    const patchDoc = useCallback(
        (id: string, patch: Partial<SfpDocument>) => {
            setDocuments((docs) => docs.map((d) => (d.id === id ? { ...d, ...patch } : d)));
            markDirty();
        },
        [markDirty],
    );

    const onScriptChange = useCallback((docId: string, text: string) => patchDoc(docId, { content: text }), [patchDoc]);

    const addDocument = (kind: SfpDocumentKind) => {
        const id = newDocId(kind);
        const order = Math.max(-1, ...documents.filter((d) => d.kind === kind).map((d) => d.order)) + 1;
        let doc: SfpDocument;
        if (kind === "script") {
            const count = documents.filter((d) => d.kind === "script").length + 1;
            const title = nextDocTitle(documents, "script", isSeries ? `Episode ${count}` : `Screenplay ${count}`);
            const base = (titleDefaults.title ?? "").trim() || summary.title;
            // The title page (and its Draft date) is written once, now; later saves never touch it.
            const content = buildTitlePageTemplate({
                title: isSeries ? `${base} - ${title}` : base,
                author: summary.author,
                defaults: titleDefaults,
            });
            doc = { id, kind, title, order, content };
        } else if (kind === "note") {
            const title = nextDocTitle(documents, "note", "Notes");
            doc = { id, kind, title, order, content: `# ${title}\n` };
        } else {
            doc = { id, kind, title: nextDocTitle(documents, "canvas", "Canvas"), order, cards: [] };
        }
        setDocuments((docs) => [...docs, doc]);
        markDirty();
        openDoc(doc);
    };

    /** File → Import screenplay…: a .fountain, .fdx or .fadein file becomes a new screenplay in this project. */
    const importScreenplay = async () => {
        const r = await api.fountain.open();
        if (!r.ok) return toast(r.error.message, "error");
        if (!r.value) return;
        const id = newDocId("script");
        const order = Math.max(-1, ...documents.filter((d) => d.kind === "script").map((d) => d.order)) + 1;
        const fileTitle = baseName(r.value.path).replace(/\.[^.]+$/, "").trim();
        const title = nextDocTitle(documents, "script", fileTitle || (isSeries ? "Imported episode" : "Imported screenplay"));
        const doc: SfpDocument = { id, kind: "script", title, order, content: r.value.text };
        setDocuments((docs) => [...docs, doc]);
        markDirty();
        openDoc(doc);
        toast(`Imported "${title}" as a new ${isSeries ? "episode" : "screenplay"}. The original file is left untouched.`, "success");
    };

    /** File → Merge another copy…: three-way merge of a collaborator's copy into this project (lib/merge.ts). */
    const mergeCopy = async () => {
        const picked = await api.project.readCopy(projectPath);
        if (!picked.ok) return toast(picked.error.message, "error");
        if (!picked.value) return;
        const copy = picked.value;
        // Let editors report their latest authorship, then save, so the merge starts from disk-equal state.
        await new Promise((r) => window.setTimeout(r, 350));
        if (!(await save())) return toast("Couldn't save this project first, so nothing was merged.", "error");
        const s = latest.current;
        const liveDocs = s.documents.map((d) => {
            const ed = d.kind === "script" ? editors.current.get(d.id) : undefined;
            return ed ? { ...d, content: ed.getText() } : d;
        });
        const copyName = baseName(copy.path).replace(/\.sfp$/i, "");
        const result = mergeProjects(
            { documents: liveDocs, entities: s.entities, authorship: authorshipRef.current },
            { documents: copy.data.documents, entities: copy.data.entities, authorship: copy.data.authorship ?? {} },
            { ours: "this copy", theirs: `the copy "${copyName}"` },
        );
        const changed = result.report.filter((r) => r.status !== "same");
        if (!changed.length && JSON.stringify(result.entities) === JSON.stringify(s.entities)) return toast(`"${copyName}" has nothing this project doesn't already have.`, "success");
        const what = (r: (typeof result.report)[number]) =>
            r.status === "added"
                ? "new, added"
                : r.kind === "canvas"
                  ? `${r.fromTheirs} card${r.fromTheirs === 1 ? "" : "s"} from the copy`
                  : `${r.fromTheirs} line${r.fromTheirs === 1 ? "" : "s"} from the copy${r.conflicts ? `, ${r.conflicts} conflict${r.conflicts === 1 ? "" : "s"}` : ""}`;
        setConfirm({
            title: `Merge "${copyName}" into this project?`,
            body: (
                <>
                    <p>Changes made only in the copy come in; changes made only here stay. Where both copies changed the same lines differently, both versions are kept between [[MERGE CONFLICT]] notes for you to choose; Problems (Ctrl/Cmd+6) lists them.</p>
                    <ul className="merge-report">
                        {changed.map((r) => (
                            <li key={`${r.kind}-${r.title}`}>
                                <b>{r.title}</b>, {what(r)}
                            </li>
                        ))}
                        {!changed.length && <li>Character, location or scene details only.</li>}
                    </ul>
                    <p className="field__hint">The current version is labelled in Local history first ("Before merging {copyName}"). Pictures inside the copy aren't brought over.</p>
                </>
            ),
            confirmLabel: result.conflicts ? `Merge (${result.conflicts} conflict${result.conflicts === 1 ? "" : "s"})` : "Merge",
            onConfirm: () =>
                void (async () => {
                    await api.history.label(
                        projectPath,
                        liveDocs.filter((d) => d.kind === "script" || d.kind === "note").map((d) => ({ id: d.id, kind: d.kind, title: d.title, content: d.content ?? "" })),
                        `Before merging ${copyName}`,
                    );
                    const saved = await api.project.save(projectPath, { documents: result.documents, entities: result.entities, authorship: result.authorship });
                    if (!saved.ok) return toast(`Merge not saved: ${saved.error.message}`, "error");
                    toast(result.conflicts ? `Merged "${copyName}" with ${result.conflicts} conflict${result.conflicts === 1 ? "" : "s"} to resolve.` : `Merged "${copyName}".`, "success");
                    props.onReload?.();
                })(),
        });
    };

    const renameDocument = (d: SfpDocument, title: string) => patchDoc(d.id, { title });

    const reorderDocuments = (kind: SfpDocumentKind, ids: string[]) => {
        setDocuments((docs) => docs.map((d) => (d.kind === kind && ids.includes(d.id) ? { ...d, order: ids.indexOf(d.id) } : d)));
        markDirty();
    };

    const deleteDocument = (d: SfpDocument) => {
        if (d.kind === "script" && scripts.length <= 1) return;
        const what = d.kind === "script" ? (isSeries ? "episode" : "screenplay") : d.kind === "note" ? "notes document" : "canvas";
        setConfirm({
            title: `Delete "${d.title}"?`,
            body: `This ${what} is removed from the project when it next saves. The project's .bak keeps the version before that save.`,
            confirmLabel: "Delete",
            danger: true,
            onConfirm: () => {
                const remainingTabs = tabs.filter((t) => tabDocId(t) !== d.id);
                setDocuments((docs) => docs.filter((x) => x.id !== d.id));
                if (d.kind === "script") {
                    editors.current.delete(d.id);
                    setEntities((e) => {
                        const nextScenes = { ...e.scenes };
                        delete nextScenes[d.id];
                        return { ...e, scenes: nextScenes };
                    });
                }
                const nextScript = scripts.find((s) => s.id !== d.id) ?? scripts[0];
                if (activeScriptId === d.id) setActiveScriptId(nextScript.id);
                if (activeCanvasId === d.id) setActiveCanvasId(canvases.find((c) => c.id !== d.id)?.id ?? null);
                const finalTabs: Tab[] = remainingTabs.length ? remainingTabs : [{ kind: "script", docId: nextScript.id }];
                setTabs(finalTabs);
                if (!finalTabs.some((t) => tabKey(t) === activeKey)) {
                    const t = finalTabs[0];
                    setActiveKey(tabKey(t));
                    if (t.kind === "script") setActiveScriptId(t.docId);
                }
                markDirty();
            },
        });
    };

    /* ---------- edits: entities ---------- */

    const updateSceneEntity = (docId: string, sceneId: string, patch: Partial<SceneEntity>) => {
        setEntities((e) => {
            const forDoc = e.scenes[docId] ?? {};
            return { ...e, scenes: { ...e.scenes, [docId]: { ...forDoc, [sceneId]: { ...(forDoc[sceneId] ?? {}), ...patch } } } };
        });
        markDirty();
    };

    /**
     * Give every scene of the active script a hidden [[id:…]] marker (one undo) and move its
     * position-keyed metadata (scene-N) to the new id, so details follow the scene when it moves.
     * Returns how many scenes got one.
     */
    const assignSceneIds = (): number => {
        const h = editors.current.get(activeScriptId);
        if (!h) return 0;
        const text = h.getText();
        const { edits, moved } = idMarkerEdits(text, parseFountain(text));
        if (!edits.length) return 0;
        h.applyEdits(edits);
        setEntities((e) => {
            const forDoc = { ...(e.scenes[activeScriptId] ?? {}) };
            let changed = false;
            for (const m of moved)
                if (forDoc[m.from]) {
                    forDoc[m.to] = forDoc[m.from];
                    delete forDoc[m.from];
                    changed = true;
                }
            return changed ? { ...e, scenes: { ...e.scenes, [activeScriptId]: forDoc } } : e;
        });
        markDirty();
        return moved.length;
    };

    const updateScene = (scene: SceneView, patch: { desc?: string; wip?: boolean; omitted?: boolean; location?: string }) => {
        const p: Partial<SceneEntity> = {};
        if (patch.desc !== undefined) p.short_description = patch.desc;
        if (patch.wip !== undefined) p.wip = patch.wip;
        if (patch.omitted !== undefined) p.omitted = patch.omitted;
        if (patch.location !== undefined) p.location = patch.location;
        updateSceneEntity(activeScriptId, scene.id, p);
    };

    const updateCharacter = (name: string, patch: Partial<CharacterEntity>) => {
        setEntities((e) => ({ ...e, characters: { ...e.characters, [name]: { ...(e.characters[name] ?? {}), ...patch } } }));
        markDirty();
    };

    const updateLocation = (name: string, patch: Partial<LocationEntity>) => {
        setEntities((e) => ({ ...e, locations: { ...e.locations, [name]: { ...(e.locations[name] ?? {}), ...patch } } }));
        markDirty();
    };

    /* ---------- edits: cards ---------- */

    // Canvas blame: new cards get createdBy, content edits (not moves or resizes) get editedBy.
    const stampCards = (prev: CanvasCard[], next: CanvasCard[]): CanvasCard[] => {
        const who = settings.authorName?.trim() || "Anonymous";
        const now = new Date().toISOString();
        const before = new Map(prev.map((c) => [c.id, c]));
        return next.map((c) => {
            const old = before.get(c.id);
            if (!old) return c.createdBy ? c : { ...c, createdBy: who, createdAt: now };
            const changed = old.title !== c.title || old.body !== c.body || old.type !== c.type || old.sceneId !== c.sceneId;
            return changed ? { ...c, editedBy: who, editedAt: now } : c;
        });
    };

    const updateCards = (canvasId: string, fn: (cards: CanvasCard[]) => CanvasCard[]) => {
        setDocuments((docs) => docs.map((d) => (d.id === canvasId ? { ...d, cards: stampCards(d.cards ?? [], fn(d.cards ?? [])) } : d)));
        markDirty();
    };

    const addCard = (at?: { x: number; y: number }) => {
        if (!activeCanvas) return;
        const id = `card-${Date.now().toString(36)}`;
        const offset = cards.length * 24;
        updateCards(activeCanvas.id, (prev) => [
            ...prev,
            { id, type: "markdown", title: "New card", body: "", x: Math.round(at?.x ?? 120 + offset), y: Math.round(at?.y ?? 120 + offset), w: 240, h: 150 },
        ]);
        setSelectedCardId(id);
        openTab({ kind: "canvas", docId: activeCanvas.id });
    };

    /** Picture cards (drop, paste or "Picture card" on the canvas): one card per picture, its body the image. */
    const addImageCards = (assets: Array<{ asset: string; name: string }>, at?: { x: number; y: number }) => {
        if (!activeCanvas || !assets.length) return;
        const base = Date.now().toString(36);
        const offset = cards.length * 24;
        const x0 = Math.round(at?.x ?? 120 + offset);
        const y0 = Math.round(at?.y ?? 120 + offset);
        const made: CanvasCard[] = assets.map((a, i) => ({ id: `card-${base}-${i}`, type: "image", title: a.name, body: `![${a.name.replace(/[[\]]/g, "")}](${a.asset})`, x: x0 + i * 28, y: y0 + i * 28, w: 260, h: 200 }));
        updateCards(activeCanvas.id, (prev) => [...prev, ...made]);
        setSelectedCardId(made[made.length - 1].id);
    };

    const updateCard = (canvasId: string, id: string, patch: Partial<CanvasCard>) =>
        updateCards(canvasId, (prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));

    const deleteCard = (canvasId: string, id: string) => {
        updateCards(canvasId, (prev) => prev.filter((c) => c.id !== id));
        if (selectedCardId === id) setSelectedCardId(null);
        const cardTab = tabs.find((t) => t.kind === "card" && t.cardId === id);
        if (cardTab) closeTab(cardTab);
    };

    /* ---------- export ---------- */

    const activeScript = activeDoc?.content ?? "";
    const exportTitle = multipleScripts ? `${summary.title} - ${activeDoc?.title ?? ""}` : summary.title;

    /** `*include` lines replaced by the screenplays they name (lib/include.ts). */
    const withIncludes = (text: string) =>
        hasIncludes(text) ? resolveIncludes(text, scripts.map((d) => ({ id: d.id, title: d.title, content: d.content ?? "" })), activeScriptId) : text;

    const scriptForExport = (sceneIds: string[] | null) => withIncludes(scriptForExportRaw(sceneIds));
    const scriptForExportRaw = (sceneIds: string[] | null) => {
        if (!sceneIds) return activeScript;
        const lines = activeScript.split(/\r?\n/);
        const firstScene = scenes[0]?.line ?? lines.length;
        const keep = new Set(sceneIds);
        const out = lines.slice(0, firstScene); // title page and anything before the first scene
        for (const s of scenes) {
            if (keep.has(s.id)) out.push(...lines.slice(s.line, s.lastLine + 1), "");
        }
        return out.join("\n");
    };

    const exportPdf = async (options: PdfExportOptions, sceneIds: string[] | null) => {
        setExporting(true);
        const result = await api.project.exportPdf(scriptForExport(sceneIds), exportTitle, {
            ...options,
            sceneNumbering: projectSettings.sceneNumbers,
            pageSize: projectSettings.pageSize,
            titlePageDefaults: titleDefaults,
        });
        setExporting(false);
        if (result.ok) {
            setExportOpen(false);
            toast(`Exported ${baseName(result.value.path)}`);
        } else if (result.error.code !== "cancelled") {
            toast(`PDF export failed: ${result.error.message}`, "error");
        }
    };

    const exportFountain = async () => {
        setExporting(true);
        const result = await api.project.exportFountain(withIncludes(activeScript), exportTitle, titleDefaults);
        setExporting(false);
        if (result.ok) {
            setExportOpen(false);
            toast(`Exported ${baseName(result.value.path)}`);
        } else if (result.error.code !== "cancelled") {
            toast(`Fountain export failed: ${result.error.message}`, "error");
        }
    };

    const exportFdx = async () => {
        setExporting(true);
        // The script's own title page wins; project defaults fill what it leaves out.
        const parsed = parseFountain(withIncludes(activeScript));
        const have = new Set(parsed.titleEntries.map((e) => e.keyLower));
        const extra = Object.entries(titleDefaults ?? {})
            .filter(([k, v]) => v && !have.has(k.toLowerCase()))
            .map(([k, v]) => ({ key: k, keyLower: k.toLowerCase(), value: String(v), line: -1, lastLine: -1 }));
        const xml = fountainToFdx({ ...parsed, titleEntries: [...parsed.titleEntries, ...extra] }, parseInline);
        const result = await api.fountain.saveFdx(xml, exportTitle);
        setExporting(false);
        if (result.ok) {
            setExportOpen(false);
            toast(`Exported ${baseName(result.value.path)}`);
        } else if (result.error.code !== "cancelled") {
            toast(`Final Draft export failed: ${result.error.message}`, "error");
        }
    };

    const saveNow = async () => {
        if (await save()) toast("Saved.", "success");
    };

    const setZoom = (z: number) => props.onSettingsChange({ editorZoom: Math.min(200, Math.max(60, Math.round(z / 10) * 10)) });

    const togglePreview = () => {
        setPreviewOpen((o) => !o);
        if (activeTab.kind !== "script") openTab({ kind: "script", docId: activeScriptId });
    };

    const openFind = () => {
        openTab({ kind: "script", docId: activeScriptId });
        requestAnimationFrame(() => editors.current.get(activeScriptId)?.openSearch());
    };

    /* ---------- keyboard ---------- */

    const keys = useRef<(e: KeyboardEvent) => void>(() => {});
    keys.current = (e: KeyboardEvent) => {
        if (!props.active) return;
        const mod = e.ctrlKey || e.metaKey;
        const k = e.key.toLowerCase();
        if (e.key === "Escape" && focusMode && !paletteOpen && !exportOpen) {
            // Let CodeMirror close its own popups first.
            if (document.querySelector(".cm-tooltip-autocomplete, .cm-search")) return;
            setFocusMode(false);
            return;
        }
        // CodeMirror handles Alt+Shift+Up/Down (selection) itself; only plain Alt+Up/Down steps scenes.
        if (e.altKey && !mod && !e.shiftKey && !e.defaultPrevented && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            stepScene(e.key === "ArrowDown" ? 1 : -1);
            return;
        }
        if (!mod) return;
        const handled = (() => {
            if (k === "s") return void saveNow(), true;
            // Ctrl/Cmd+W closes the current tab, like a browser (the last screenplay tab stays).
            if (k === "w" && !e.shiftKey && !e.altKey) return closeActiveTab(), true;
            if (k === "k" || (e.shiftKey && k === "p")) return setPaletteOpen((o) => !o), true;
            if (k === "p") return togglePreview(), true;
            if (k === "e") return setExportOpen(true), true;
            if (k === ".") return setFocusMode((f) => !f), true;
            if (k === "b" && e.altKey) return setInspectorOpen((o) => !o), true;
            if (k === "a" && e.altKey) return setShowBlame((o) => !o), true;
            if (k === "b") return setSidebarOpen((o) => !o), true;
            if (k === "1") return showSidebar("explorer"), true;
            if (k === "2") return showSidebar("outline"), true;
            if (k === "3") return showSidebar("info"), true;
            if (k === "4") return showSidebar("canvas"), true;
            if (k === "5") return openTab({ kind: "stats" }), true;
            if (k === "6") return setTool((t) => (t?.kind === "problems" ? null : { kind: "problems" })), true;
            if (k === "=" || k === "+") return setZoom(settings.editorZoom + 10), true;
            if (k === "-") return setZoom(settings.editorZoom - 10), true;
            if (k === "0") return setZoom(100), true;
            if (k === "f" && activeTab.kind !== "script") return openFind(), true;
            return false;
        })();
        if (handled) e.preventDefault();
    };
    useEffect(() => {
        const handler = (e: KeyboardEvent) => keys.current(e);
        // Double Shift opens Search Everywhere (the palette), as in IntelliJ.
        let lastShift = 0;
        let clean = false;
        const down = (e: KeyboardEvent) => {
            if (e.key !== "Shift") {
                lastShift = 0;
                clean = false;
            } else if (!e.repeat) clean = true;
        };
        const up = (e: KeyboardEvent) => {
            if (e.key !== "Shift" || !clean) return;
            const now = performance.now();
            if (now - lastShift < 350) {
                lastShift = 0;
                setPaletteOpen(true);
            } else lastShift = now;
        };
        window.addEventListener("keydown", handler);
        window.addEventListener("keydown", down, true);
        window.addEventListener("keyup", up, true);
        return () => {
            window.removeEventListener("keydown", handler);
            window.removeEventListener("keydown", down, true);
            window.removeEventListener("keyup", up, true);
        };
    }, []);

    /* ---------- menus & palette ---------- */

    const newScriptLabel = isSeries ? "New episode" : "New screenplay";
    const onScript = activeTab.kind === "script";

    const recentMenuItems: Menu["items"] = props.recentProjects.length
        ? [
              { label: "Recent files", disabled: true },
              ...props.recentProjects.map((recent) => ({
                  label: recent.summary.title,
                  title: recent.path,
                  run: () => void props.onOpenRecent(recent.path),
              })),
          ]
        : [{ label: "Recent files", disabled: true }, { label: "No recent projects", disabled: true }];

    const menus: Menu[] = [
        {
            label: "File",
            items: [
                { label: newScriptLabel, run: () => addDocument("script") },
                { label: "New notes", run: () => addDocument("note") },
                { label: "New canvas", run: () => addDocument("canvas") },
                { label: `Import ${isSeries ? "episode" : "screenplay"}… (.fountain, .fdx, .fadein)`, run: () => void importScreenplay() },
                { label: "Merge another copy…", run: () => void mergeCopy() },
                { separator: true, label: "recent-separator" },
                ...recentMenuItems,
                { separator: true, label: "-1" },
                { label: "Save", shortcut: `${modKey}+S`, run: () => void saveNow() },
                { label: "Export…", shortcut: `${modKey}+E`, run: () => setExportOpen(true) },
                { label: "Local history…", run: () => setHistoryOpen(true) },
                { label: "Show in folder", run: () => void api.project.reveal(projectPath) },
                { label: "Close tab", shortcut: `${modKey}+W`, run: closeActiveTab },
                { separator: true, label: "-2" },
                { label: "Project information", run: () => openTab({ kind: "project-info" }) },
                { label: "Project settings", run: () => openTab({ kind: "project-settings" }) },
                { separator: true, label: "-3" },
                { label: "Close project", run: props.onExit },
            ],
        },
        {
            label: "Edit",
            items: [
                { label: "Undo", shortcut: `${modKey}+Z`, run: () => editors.current.get(activeScriptId)?.undo(), disabled: !onScript },
                { label: "Redo", shortcut: `${modKey}+Shift+Z`, run: () => editors.current.get(activeScriptId)?.redo(), disabled: !onScript },
                { separator: true, label: "-" },
                { label: "Find / replace", shortcut: `${modKey}+F`, run: openFind },
                { label: "Select all", shortcut: `${modKey}+A`, run: () => editors.current.get(activeScriptId)?.selectAll(), disabled: !onScript },
                { label: "Extend selection", shortcut: "Alt+Shift+↑", run: () => editors.current.get(activeScriptId)?.command("extend-selection"), disabled: !onScript },
                { label: "Shrink selection", shortcut: "Alt+Shift+↓", run: () => editors.current.get(activeScriptId)?.command("shrink-selection"), disabled: !onScript },
                { label: "Insert live template…", shortcut: `${modKey}+J`, run: () => editors.current.get(activeScriptId)?.command("insert-template"), disabled: !onScript },
            ],
        },
        {
            label: "View",
            items: [
                { label: "Sidebar", shortcut: `${modKey}+B`, checked: sidebarOpen, run: () => setSidebarOpen((o) => !o) },
                { label: "Inspector", shortcut: `${modKey}+Alt+B`, checked: inspectorOpen, run: () => setInspectorOpen((o) => !o) },
                { label: "Authorship (blame)", shortcut: `${modKey}+Alt+A`, checked: showBlame, run: () => setShowBlame((o) => !o) },
                { label: "Live preview", shortcut: `${modKey}+P`, checked: previewOpen, run: togglePreview },
                { label: "Focus mode", shortcut: `${modKey}+.`, checked: focusMode, run: () => setFocusMode((f) => !f) },
                { separator: true, label: "-1" },
                { label: "Explorer", shortcut: `${modKey}+1`, run: () => showSidebar("explorer") },
                { label: "Outline", shortcut: `${modKey}+2`, run: () => showSidebar("outline") },
                { label: "Characters & locations", shortcut: `${modKey}+3`, run: () => showSidebar("info") },
                { label: "Canvas", shortcut: `${modKey}+4`, run: () => showSidebar("canvas") },
                { label: "Statistics", shortcut: `${modKey}+5`, run: () => openTab({ kind: "stats" }) },
                { label: "Problems", shortcut: `${modKey}+6`, checked: tool?.kind === "problems", run: () => setTool((t) => (t?.kind === "problems" ? null : { kind: "problems" })) },
                { separator: true, label: "-2" },
                { label: "Zoom in", shortcut: `${modKey}++`, run: () => setZoom(settings.editorZoom + 10) },
                { label: "Zoom out", shortcut: `${modKey}+−`, run: () => setZoom(settings.editorZoom - 10) },
                { label: "Reset zoom", shortcut: `${modKey}+0`, run: () => setZoom(100) },
            ],
        },
        {
            label: "Scene",
            items: [
                { label: "Next scene", shortcut: "Alt+↓", run: () => stepScene(1), disabled: !scenes.length },
                { label: "Previous scene", shortcut: "Alt+↑", run: () => stepScene(-1), disabled: !scenes.length },
                { label: "Move scene up", shortcut: `${modKey}+Shift+↑`, run: () => editors.current.get(activeScriptId)?.command("scene-up"), disabled: !onScript || scenes.length < 2 },
                { label: "Move scene down", shortcut: `${modKey}+Shift+↓`, run: () => editors.current.get(activeScriptId)?.command("scene-down"), disabled: !onScript || scenes.length < 2 },
                { label: "Add scene ID markers", disabled: !onScript || !scenes.some((s) => !s.hasStableId), run: () => toast(`Added ID markers to ${assignSceneIds()} scenes.`, "success") },
                { separator: true, label: "-" },
                { label: "Open scene page", disabled: !currentScene, run: () => currentScene && openScenePage(currentScene) },
                { label: "Work in progress", checked: currentScene?.wip, disabled: !currentScene, run: () => currentScene && updateScene(currentScene, { wip: !currentScene.wip }) },
                { label: "Omitted", checked: currentScene?.omitted, disabled: !currentScene, run: () => currentScene && updateScene(currentScene, { omitted: !currentScene.omitted }) },
            ],
        },
        { label: "Settings", items: [{ label: "Open settings", run: props.onOpenSettings }, { label: "Project settings", run: () => openTab({ kind: "project-settings" }) }] },
    ];

    const allStats = useMemo(() => mergeStats(parsedScripts.map((p) => p.stats)), [parsedScripts]);

    const paletteItems = useMemo<PaletteItem[]>(
        () => [
            { group: "Commands", label: "Save", meta: `${modKey}+S`, run: () => void saveNow() },
            { group: "Commands", label: "Export PDF, Fountain or Final Draft…", meta: `${modKey}+E`, run: () => setExportOpen(true) },
            { group: "Commands", label: "Local history (snapshots, restore)…", run: () => setHistoryOpen(true) },
            { group: "Commands", label: "Find / replace", meta: `${modKey}+F`, run: openFind },
            { group: "Commands", label: "Toggle live preview", meta: `${modKey}+P`, run: togglePreview },
            { group: "Commands", label: "Move scene up", meta: `${modKey}+Shift+↑`, run: () => editors.current.get(activeScriptId)?.command("scene-up") },
            { group: "Commands", label: "Move scene down", meta: `${modKey}+Shift+↓`, run: () => editors.current.get(activeScriptId)?.command("scene-down") },
            { group: "Commands", label: "Extend selection", meta: "Alt+Shift+↑", run: () => editors.current.get(activeScriptId)?.command("extend-selection") },
            { group: "Commands", label: "Insert live template", meta: `${modKey}+J`, run: () => editors.current.get(activeScriptId)?.command("insert-template") },
            { group: "Commands", label: newScriptLabel, run: () => addDocument("script") },
            { group: "Commands", label: `Import ${isSeries ? "episode" : "screenplay"} (.fountain, .fdx, .fadein)`, run: () => void importScreenplay() },
            { group: "Commands", label: "Merge another copy of this project (.sfp)", run: () => void mergeCopy() },
            { group: "Commands", label: "New notes", run: () => addDocument("note") },
            { group: "Commands", label: "New canvas", run: () => addDocument("canvas") },
            { group: "Commands", label: "Project information", run: () => openTab({ kind: "project-info" }) },
            { group: "Commands", label: "Project settings", run: () => openTab({ kind: "project-settings" }) },
            { group: "Commands", label: "Show outline", run: () => showSidebar("outline") },
            { group: "Commands", label: "Show characters & locations", run: () => showSidebar("info") },
            { group: "Commands", label: "Open statistics", run: () => openTab({ kind: "stats" }) },
            { group: "Commands", label: "Add scene ID markers (details follow moved scenes)", run: () => toast(`Added ID markers to ${assignSceneIds()} scenes.`, "success") },
            { group: "Commands", label: "Show problems (inspections)", meta: `${modKey}+6`, run: () => setTool({ kind: "problems" }) },
            { group: "Commands", label: "Toggle focus mode", meta: `${modKey}+.`, run: () => setFocusMode((f) => !f) },
            { group: "Commands", label: "Open settings", run: props.onOpenSettings },
            { group: "Commands", label: "Close project", run: props.onExit },
            ...documents.map((d) => ({
                group: "Documents" as const,
                label: d.title,
                meta: d.kind === "script" ? (isSeries ? "episode" : "screenplay") : d.kind === "note" ? "notes" : "canvas",
                run: () => openDoc(d),
            })),
            ...scenes.map((s) => ({ group: "Scenes" as const, label: s.heading, meta: `${s.num}`, run: () => jumpToScene(s) })),
            ...allStats.characters.map((c) => ({ group: "Characters" as const, label: c.name, meta: `${c.cues} ${c.cues === 1 ? "cue" : "cues"}`, run: () => openCharacter(c.name) })),
            ...allStats.locations.map((l) => ({ group: "Locations" as const, label: l.name, meta: `${l.scenes} ${l.scenes === 1 ? "scene" : "scenes"}`, run: () => openLocation(l.name) })),
        ],
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [scenes, allStats, documents, isSeries, activeScriptId],
    );

    /* ---------- tabs ---------- */

    const docTitle = (id: string) => documents.find((d) => d.id === id)?.title ?? "Missing";
    const tabLabel = (t: Tab): string => {
        switch (t.kind) {
            case "script":
            case "note":
            case "canvas":
                return docTitle(t.docId);
            case "card":
                return documents.find((d) => d.id === t.docId)?.cards?.find((c) => c.id === t.cardId)?.title || "Untitled card";
            case "character":
            case "location":
                return t.name;
            case "scene": {
                const sc = parsedScripts.find((p) => p.doc.id === t.docId)?.scenes.find((s) => s.id === t.sceneId);
                return sc ? `Scene ${sc.num}` : "Scene";
            }
            case "stats":
                return "Statistics";
            case "project-info":
                return "Project information";
            case "project-settings":
                return "Project settings";
        }
    };
    // Tab kinds are told apart by the same line icons the sidebar uses, not by
    // mono all-caps codes (SP, CHAR, LOC), which read as template chrome.
    const tabKind: Record<Tab["kind"], { icon: typeof IconFile; name: string } | null> = {
        script: { icon: IconFile, name: isSeries ? "Episode" : "Screenplay" },
        note: { icon: IconBook, name: "Notes" },
        canvas: { icon: IconCanvas, name: "Canvas" },
        card: { icon: IconCanvas, name: "Card" },
        character: { icon: IconPeople, name: "Character" },
        location: { icon: IconPin, name: "Location" },
        scene: { icon: IconOutline, name: "Scene" },
        stats: { icon: IconChart, name: "Statistics" },
        "project-info": null,
        "project-settings": null,
    };

    /* ---------- render ---------- */

    const editorStyle = { ["--editor-zoom" as string]: settings.editorZoom / 100 };
    const showInspector = inspectorOpen && (activeTab.kind === "script" || activeTab.kind === "canvas");
    const gridColumns = `44px ${sidebarOpen ? "var(--sidebar-w)" : "0px"} minmax(0, 1fr) ${showInspector ? "var(--inspector-w)" : "0px"}`;
    const openScriptTabs = tabs.filter((t): t is Extract<Tab, { kind: "script" }> => t.kind === "script" && scripts.some((s) => s.id === t.docId));
    const onError = (m: string) => toast(m, "error");

    const renderPage = () => {
        const t = activeTab;
        switch (t.kind) {
            case "note": {
                const d = documents.find((x) => x.id === t.docId);
                return d ? (
                    <NotePage key={d.id} doc={d} projectPath={projectPath} onChange={(content) => patchDoc(d.id, { content })} onRename={(title) => patchDoc(d.id, { title })} onError={onError} />
                ) : null;
            }
            case "canvas": {
                const d = documents.find((x) => x.id === t.docId);
                return d ? (
                    <CanvasWorkspace
                        title={d.title}
                        projectPath={projectPath}
                        cards={d.cards ?? []}
                        scenes={scenes}
                        selectedId={selectedCardId}
                        zoom={canvasZoom}
                        onZoom={setCanvasZoom}
                        onSelect={setSelectedCardId}
                        onAdd={addCard}
                        onAddImages={addImageCards}
                        onError={onError}
                        onChange={(id, patch) => updateCard(d.id, id, patch)}
                        onDelete={(id) => deleteCard(d.id, id)}
                        onOpenCard={(id) => openTab({ kind: "card", docId: d.id, cardId: id })}
                    />
                ) : null;
            }
            case "card": {
                const d = documents.find((x) => x.id === t.docId);
                const card = d?.cards?.find((c) => c.id === t.cardId);
                if (!d || !card) {
                    return (
                        <div className="workspace-pane">
                            <div className="page-scroll"><div className="page-column"><p className="page-subtitle">This card was deleted.</p></div></div>
                        </div>
                    );
                }
                return (
                    <CardPage
                        key={card.id}
                        card={card}
                        canvasTitle={d.title}
                        scenes={scenes}
                        projectPath={projectPath}
                        onChange={(patch) => updateCard(d.id, card.id, patch)}
                        onDelete={() => deleteCard(d.id, card.id)}
                        onOpenScene={(s) => jumpToScene(s)}
                        onBackToCanvas={() => {
                            setSelectedCardId(card.id);
                            openTab({ kind: "canvas", docId: d.id });
                        }}
                        onError={onError}
                    />
                );
            }
            case "character":
                return (
                    <CharacterPage
                        key={t.name}
                        name={t.name}
                        entity={entities.characters[t.name] ?? {}}
                        report={characterReport(parsedScripts, t.name)}
                        multipleScripts={multipleScripts}
                        projectPath={projectPath}
                        onChange={(patch) => updateCharacter(t.name, patch)}
                        onJumpScene={jumpToRef}
                        onOpenScenePage={(r) => openScenePage(r.scene, r.docId)}
                        onJumpLine={(docId, line) => jumpToLine(line, docId)}
                        onError={onError}
                    />
                );
            case "location":
                return (
                    <LocationPage
                        key={t.name}
                        name={t.name}
                        entity={entities.locations[t.name] ?? {}}
                        scenes={locationScenes(parsedScripts, t.name)}
                        multipleScripts={multipleScripts}
                        projectPath={projectPath}
                        onChange={(patch) => updateLocation(t.name, patch)}
                        onJumpScene={jumpToRef}
                        onOpenScenePage={(r) => openScenePage(r.scene, r.docId)}
                        onError={onError}
                    />
                );
            case "scene": {
                const ps = parsedScripts.find((p) => p.doc.id === t.docId);
                const sc = ps?.scenes.find((s) => s.id === t.sceneId) ?? null;
                return (
                    <ScenePage
                        key={`${t.docId}-${t.sceneId}`}
                        scene={sc}
                        docTitle={docTitle(t.docId)}
                        multipleScripts={multipleScripts}
                        entity={entities.scenes[t.docId]?.[t.sceneId] ?? {}}
                        projectPath={projectPath}
                        onChange={(patch) => updateSceneEntity(t.docId, t.sceneId, patch)}
                        onJump={() => sc && jumpToScene(sc, t.docId)}
                        onOpenLocation={openLocation}
                        onOpenCharacter={openCharacter}
                        onError={onError}
                    />
                );
            }
            case "stats":
                return active ? (
                    <StatisticsView
                        doc={active.parsed}
                        scenes={scenes}
                        scriptTitle={active.doc.title}
                        allScripts={parsedScripts}
                        seriesLabel={scriptsLabel}
                        onBack={() => openTab({ kind: "script", docId: activeScriptId })}
                        onOpenCharacter={openCharacter}
                        onOpenLocation={openLocation}
                    />
                ) : null;
            case "project-info":
                return (
                    <ProjectInfoPage
                        projectTitle={summary.title}
                        defaults={titleDefaults}
                        logline={summary.logline ?? ""}
                        genre={summary.genre ?? ""}
                        isSeries={isSeries}
                        onChange={(d) => {
                            setTitleDefaults(d);
                            markDirty();
                        }}
                        onSummary={(patch) => {
                            setSummary((s) => ({ ...s, ...patch }));
                            markDirty();
                        }}
                    />
                );
            case "project-settings":
                return (
                    <ProjectSettingsPage
                        settings={projectSettings}
                        color={summary.color}
                        banner={summary.banner}
                        projectPath={projectPath}
                        onError={onError}
                        globalAutosave={settings.autosave}
                        appInspections={settings.inspections !== false}
                        appTargetPages={settings.targetPages ?? 0}
                        screenplayCount={scripts.length}
                        onChange={(patch) => {
                            setProjectSettings((s) => ({ ...s, ...patch }));
                            markDirty();
                        }}
                        onColor={(color) => {
                            setSummary((s) => ({ ...s, color }));
                            markDirty();
                        }}
                        onBanner={(banner) => {
                            setSummary((s) => ({ ...s, banner }));
                            markDirty();
                        }}
                        onOpenInfo={() => openTab({ kind: "project-info" })}
                    />
                );
            default:
                return null;
        }
    };

    // The docked tool window's contents (recomputed only when its subject or the script changes).
    const toolView = useMemo(() => {
        if (!tool) return null;
        const plain = (items: PaletteItem[]): ToolItem[] => items.map((i) => ({ label: i.label, meta: i.meta, run: i.run }));
        if (tool.kind === "usages") return { title: `Usages of ${tool.name}`, items: plain(usageItems(tool.name)), empty: "No cues or mentions." };
        if (tool.kind === "location") return { title: `Scenes at ${tool.name}`, items: plain(locationUsageItems(tool.name)), empty: "No scenes at this location." };
        const list = editors.current.get(activeScriptId)?.problems() ?? [];
        const sc = active?.scenes ?? [];
        return {
            title: `Problems in ${docTitle(activeScriptId)}`,
            empty: !editorPrefs.inspections ? "Script inspections are off (Settings → Editor, or Project settings → Writing)." : "No problems found.",
            items: list.map((p) => {
                const at = sceneIndexAtLine(sc, p.line);
                return { label: `${at >= 0 ? `${sc[at].num}. ` : ""}${p.message}`, meta: `line ${p.line + 1}`, severity: p.severity, run: () => jumpToLine(p.line, activeScriptId) };
            }),
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tool, parsedScripts, activeScriptId, editorPrefs.inspections, editorPrefs.targetPages]);

    return (
        <div className={`editor-shell ${focusMode ? "is-focus-mode" : ""}`}>
            <Titlebar center={<span className="titlebar__project">{summary.title}{multipleScripts && activeDoc ? `: ${activeDoc.title}` : ""}</span>} />
            <Menubar
                menus={menus}
                right={
                    <>
                        <button className="menubar__icon" onClick={() => setSidebarOpen((o) => !o)} title={`Toggle sidebar (${modKey}+B)`} aria-pressed={sidebarOpen}>
                            <IconSidebar />
                        </button>
                        <button className="menubar__icon" onClick={() => setInspectorOpen((o) => !o)} title={`Toggle inspector (${modKey}+Alt+B)`} aria-pressed={inspectorOpen}>
                            <IconInspector />
                        </button>
                        <SaveIndicator state={saveState} autosave={effectiveAutosave} />
                        <button className="menubar__item menubar__palette" onClick={() => setPaletteOpen(true)} title="Command palette">
                            <kbd>{modKey}</kbd><kbd>K</kbd>
                        </button>
                    </>
                }
            />

            {saveState === "error" && saveError && (
                <div className="save-banner" role="alert">
                    <strong>Your latest changes aren't saved.</strong>
                    <span>{saveError} Sceneform keeps retrying, and your text is safe in this window.</span>
                    <button className="btn btn--secondary btn--sm" onClick={() => void save()}>Retry now</button>
                </div>
            )}

            {props.backupNotice && (
                <div className="save-banner save-banner--info" role="status">
                    <strong>This project may have lost text.</strong>
                    <span>
                        Its backup from {new Date(props.backupNotice.savedAt).toLocaleString()} has {props.backupNotice.chars.toLocaleString()} characters of script and notes; the file has{" "}
                        {(props.backupNotice.currentChars ?? 0).toLocaleString()}. Restoring keeps the current file next to it, renamed. Local history has older versions too.
                    </span>
                    <button className="btn btn--secondary btn--sm" onClick={props.onRestoreBackup}>Restore backup</button>
                    <button className="btn btn--secondary btn--sm" onClick={() => setHistoryOpen(true)}>Local history…</button>
                    <button className="btn btn--secondary btn--sm" onClick={props.onDismissBackup} aria-label="Dismiss">Keep this version</button>
                </div>
            )}

            <div className="editor-main" style={{ gridTemplateColumns: gridColumns }}>
                <ActivityBar
                    view={sidebarView}
                    statsActive={activeTab.kind === "stats"}
                    sidebarOpen={sidebarOpen}
                    onView={showSidebar}
                    onStats={() => openTab({ kind: "stats" })}
                    onSettings={props.onOpenSettings}
                />

                <aside className="sidebar" aria-hidden={!sidebarOpen}>
                    {sidebarOpen && sidebarView === "explorer" && (
                        <ExplorerView
                            title={summary.title}
                            isSeries={isSeries}
                            documents={documents}
                            activeKey={activeKey}
                            activeScriptId={activeScriptId}
                            onOpen={openDoc}
                            onAdd={addDocument}
                            onRename={renameDocument}
                            onDelete={deleteDocument}
                            onReorder={reorderDocuments}
                            onOpenInfo={() => openTab({ kind: "project-info" })}
                            onOpenProjectSettings={() => openTab({ kind: "project-settings" })}
                            onExport={() => setExportOpen(true)}
                        />
                    )}
                    {sidebarOpen && sidebarView === "outline" && (
                        <OutlineView
                            scenes={scenes}
                            currentIndex={currentSceneIndex}
                            scriptTitle={multipleScripts ? activeDoc?.title ?? null : null}
                            onSelect={(s) => jumpToScene(s)}
                            onOpenPage={(s) => openScenePage(s)}
                            sections={outlineSections}
                            lengths={sceneLens}
                            onMove={(from, to) => {
                                if (activeTab.kind !== "script") openTab({ kind: "script", docId: activeScriptId });
                                const h = editors.current.get(activeScriptId);
                                if (!h) return;
                                // Position-keyed details would stay behind; pin them to the scenes first.
                                let line = from.line;
                                if (scenes.some((s) => !s.hasStableId) && Object.keys(entities.scenes[activeScriptId] ?? {}).some((k) => k.startsWith("scene-"))) {
                                    assignSceneIds();
                                    line = parseFountain(h.getText()).scenes[from.index]?.line ?? line;
                                }
                                h.moveSceneTo(line, to.index);
                            }}
                        />
                    )}
                    {sidebarOpen && sidebarView === "info" && (
                        <InfoView
                            tab={infoTab}
                            stats={stats}
                            scope={multipleScripts ? `Listing ${activeDoc?.title ?? ""}; character and location pages cover all ${scriptsLabel.toLowerCase()}` : null}
                            onTab={setInfoTab}
                            extraCharacters={Object.keys(entities.characters)}
                            extraLocations={Object.keys(entities.locations)}
                            onOpenCharacter={openCharacter}
                            onOpenLocation={openLocation}
                            onAddCharacter={(n) => {
                                const key = normalizeCue(n);
                                if (!entities.characters[key]) updateCharacter(key, {});
                                openCharacter(key);
                            }}
                            onAddLocation={(n) => {
                                const key = n.toUpperCase();
                                if (!entities.locations[key]) updateLocation(key, {});
                                openLocation(key);
                            }}
                        />
                    )}
                    {sidebarOpen && sidebarView === "canvas" && (
                        <CanvasCardListView
                            canvasTitle={activeCanvas?.title ?? null}
                            cards={cards}
                            selectedId={selectedCardId}
                            onSelect={(id) => {
                                setSelectedCardId(id);
                                if (activeCanvas) openTab({ kind: "canvas", docId: activeCanvas.id });
                            }}
                            onOpen={(id) => activeCanvas && openTab({ kind: "card", docId: activeCanvas.id, cardId: id })}
                            onAdd={() => addCard()}
                        />
                    )}
                    {sidebarOpen && sidebarView === "cheatsheet" && <CheatSheetView />}
                </aside>

                <main className="workspace">
                    <div className="tabstrip" role="tablist">
                        <div className="tabstrip__tabs">
                            {tabs.map((t) => {
                                const key = tabKey(t);
                                const label = tabLabel(t);
                                return (
                                    <div
                                        key={key}
                                        role="tab"
                                        aria-selected={activeKey === key}
                                        className={`tab tab--${t.kind} ${activeKey === key ? "is-active" : ""}`}
                                        onClick={() => openTab(t)}
                                        onAuxClick={(e) => e.button === 1 && closeTab(t)}
                                        onContextMenu={(e) => {
                                            e.preventDefault();
                                            const idx = tabs.findIndex((x) => tabKey(x) === key);
                                            showContextMenu(e.clientX, e.clientY, [
                                                { label: "Close", shortcut: activeKey === key ? `${modKey}+W` : undefined, disabled: tabs.length === 1 && t.kind === "script", run: () => closeTab(t) },
                                                { label: "Close others", disabled: tabs.length === 1, run: () => closeOtherTabs(t) },
                                                { label: "Close tabs to the right", disabled: idx === tabs.length - 1, run: () => closeOtherTabs(t, "right") },
                                            ]);
                                        }}
                                        title={label}
                                    >
                                        {t.kind === "script" && saveState !== "saved" && t.docId === activeScriptId && <span className="tab__dot" title="Unsaved changes" />}
                                        {(() => {
                                            const k = tabKind[t.kind];
                                            if (!k) return null;
                                            const I = k.icon;
                                            return <span className="tab__kind" title={k.name}><I size={13} /><span className="sr-only">{k.name}: </span></span>;
                                        })()}
                                        <span className="tab__label">{label}</span>
                                        {(tabs.length > 1 || t.kind !== "script") && (
                                            <button
                                                className="tab__close"
                                                aria-label={`Close ${label}`}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    closeTab(t);
                                                }}
                                            >
                                                ✕
                                            </button>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                        <button
                            className={`btn btn--ghost btn--sm tabstrip__btn tabstrip__preview ${previewOpen ? "is-on" : ""}`}
                            onClick={togglePreview}
                            title={`Live preview (${modKey}+P)`}
                            aria-label="Live preview"
                            aria-pressed={previewOpen}
                        >
                            <IconPreview /> Preview
                        </button>
                        <button className="btn btn--ghost btn--sm tabstrip__btn" onClick={() => setFocusMode(true)} title={`Focus mode (${modKey}+.)`} aria-label="Focus mode">
                            <IconFocus />
                        </button>
                    </div>

                    {/* Script editors stay mounted while their tab is open: each keeps its own undo history. */}
                    {openScriptTabs.map((t) => {
                        const doc = scripts.find((s) => s.id === t.docId)!;
                        const visible = activeTab.kind === "script" && activeTab.docId === doc.id;
                        return (
                            <div key={doc.id} className="workspace-pane script-pane" style={{ display: visible ? "flex" : "none" }}>
                                {visible && inherited.length > 0 && (
                                    <div className="inherit-strip">
                                        <span>
                                            Inherited from project: <b>{inherited.map((k) => titleKeyLabel(k)).join(", ")}</b>
                                        </span>
                                        <span className="inherit-strip__note">filled in on export; the script's own value always wins</span>
                                        <button className="link-btn" onClick={() => openTab({ kind: "project-info" })}>Edit defaults</button>
                                    </div>
                                )}
                                {visible && (
                                    <nav className="crumbs" aria-label="Breadcrumbs">
                                        <button className="crumbs__item" onClick={() => editors.current.get(doc.id)?.jumpToLine(0)}>{doc.title}</button>
                                        {crumbs.sections.map((c) => (
                                            <Fragment key={c.line}>
                                                <span className="crumbs__sep">›</span>
                                                <button className="crumbs__item" onClick={() => editors.current.get(doc.id)?.jumpToLine(c.line)}>{c.label}</button>
                                            </Fragment>
                                        ))}
                                        {currentScene && (
                                            <>
                                                <span className="crumbs__sep">›</span>
                                                <button className="crumbs__item" title="Jump to the scene heading (Alt+Up/Down: previous/next scene)" onClick={() => editors.current.get(doc.id)?.jumpToLine(currentScene.line)}>
                                                    {currentScene.num}. {currentScene.heading}
                                                </button>
                                            </>
                                        )}
                                        {crumbs.speaker && (
                                            <>
                                                <span className="crumbs__sep">›</span>
                                                <button className="crumbs__item is-current" onClick={() => editors.current.get(doc.id)?.jumpToLine(crumbs.speaker!.line)}>{crumbs.speaker.label}</button>
                                            </>
                                        )}
                                        {revMarks && (
                                            <span className="crumbs__rev" style={{ ["--rev" as string]: revMarks.color }} title="Lines added or changed since this snapshot are marked">
                                                {revMarks.colorName} revision since {revMarks.label}
                                                <button onClick={() => setRevMarks(null)} aria-label="Stop marking revisions">×</button>
                                            </span>
                                        )}
                                        <span className="crumbs__hint">Alt+Enter: fixes and actions</span>
                                    </nav>
                                )}
                                <div className="script-split">
                                    <div className="editor-host" style={editorStyle}>
                                        <ScriptEditor
                                            ref={(h) => {
                                                if (h) editors.current.set(doc.id, h);
                                            }}
                                            docKey={`${projectPath}#${doc.id}`}
                                            initialText={doc.content ?? ""}
                                            onChange={(text) => onScriptChange(doc.id, text)}
                                            onCursor={(c) => {
                                                if (doc.id === activeScriptId) setCursor(c);
                                            }}
                                            onBadge={(kind, text, line) => {
                                                const ps = parsedScripts.find((p) => p.doc.id === doc.id);
                                                if (kind === "heading") {
                                                    const sc = ps?.scenes.find((s) => s.line === line) ?? ps?.scenes.find((s) => s.heading === text.trim()) ?? null;
                                                    if (sc) openScenePage(sc, doc.id);
                                                } else {
                                                    openCharacter(text);
                                                }
                                            }}
                                            characters={() => completion.current.characterNames}
                                            headings={() => completion.current.headings}
                                            locations={() => completion.current.locations}
                                            draftDate={() => completion.current.draftDate}
                                            autoContinue={settings.autoIndentation}
                                            spellcheck={settings.spellcheck !== false}
                                            spellWords={() => [...editorPrefs.words, ...completion.current.characterNames, ...completion.current.locations, ...Object.keys(entities.characters)]}
                                            spellVersion={`${editorPrefs.words.length}`}
                                            authorship={authorshipRef.current[doc.id]}
                                            authorName={() => settings.authorName ?? ""}
                                            showBlame={showBlame}
                                            inspections={editorPrefs.inspections}
                                            targetPages={editorPrefs.targetPages}
                                            includeTargets={() => scripts.filter((d) => d.id !== doc.id).map((d) => d.title)}
                                            onRenameCharacter={renameCharacter}
                                            onFindUsages={(n) => setTool({ kind: "usages", name: normalizeCue(n) })}
                                            onFindLocationUsages={(n) => setTool({ kind: "location", name: n })}
                                            onOpenLocation={openLocation}
                                            revisionBaseline={revisionFor(doc.id)}
                                            liveTemplates={editorPrefs.liveTemplates}
                                            onAuthorship={(a) => {
                                                authorshipRef.current = { ...authorshipRef.current, [doc.id]: a };
                                            }}
                                            onAddWord={(w) => {
                                                const words = settings.userWords ?? [];
                                                if (!words.some((x) => x.toLowerCase() === w.toLowerCase())) props.onSettingsChange({ userWords: [...words, w] });
                                            }}
                                        />
                                    </div>
                                    {visible && previewOpen && active && (
                                        <LivePreview
                                            doc={previewDoc ?? active.parsed}
                                            titleEntries={previewEntries}
                                            sceneNumbers={projectSettings.sceneNumbers}
                                            sceneLine={currentScene?.line ?? -1}
                                            paper={previewPaper}
                                            onPaper={setPreviewPaper}
                                            onClose={() => setPreviewOpen(false)}
                                        />
                                    )}
                                </div>
                                {visible && toolView && <ToolWindow title={toolView.title} items={toolView.items} empty={toolView.empty} onClose={() => setTool(null)} />}
                            </div>
                        );
                    })}

                    {activeTab.kind !== "script" && renderPage()}
                </main>

                <div className="inspector-slot" aria-hidden={!showInspector}>
                    {showInspector && (
                        <InspectorPane
                            mode={activeTab.kind === "canvas" ? "card" : "script"}
                            tab={inspectorTab}
                            scene={currentScene}
                            characters={entities.characters}
                            projectPath={projectPath}
                            onOpenCharacter={openCharacter}
                            card={selectedCard}
                            scenes={scenes}
                            stats={stats}
                            inherited={inherited.map((k) => titleKeyLabel(k))}
                            onTab={setInspectorTab}
                            onUpdateScene={updateScene}
                            onOpenScenePage={(s) => openScenePage(s)}
                            onUpdateCard={(patch) => selectedCard && activeCanvas && updateCard(activeCanvas.id, selectedCard.id, patch)}
                            onOpenCard={() => selectedCard && activeCanvas && openTab({ kind: "card", docId: activeCanvas.id, cardId: selectedCard.id })}
                            onDeleteCard={() => selectedCard && activeCanvas && deleteCard(activeCanvas.id, selectedCard.id)}
                            onOpenStats={() => openTab({ kind: "stats" })}
                            onJumpToScene={(s) => jumpToScene(s)}
                            onOpenInfo={() => openTab({ kind: "project-info" })}
                        />
                    )}
                </div>
            </div>

            <Statusbar
                scenes={scenes.length}
                pages={stats.pages}
                words={stats.words}
                element={onScript ? LINE_TYPE_LABELS[cursor.type] : tabLabel(activeTab)}
                line={cursor.line}
                col={cursor.col}
                selection={cursor.selectionLength}
                zoom={settings.editorZoom}
                timeSpent={formatTimeSpent(minutes)}
                onZoom={setZoom}
            />

            {focusMode && (
                <div className="focus-exit">
                    <button className="btn btn--secondary btn--sm" onClick={() => setFocusMode(false)}>
                        <IconUnfocus /> Exit focus <kbd>Esc</kbd>
                    </button>
                </div>
            )}

            <CommandPalette
                open={paletteOpen}
                items={paletteItems}
                onClose={() => setPaletteOpen(false)}
            />
            <ExportDialog
                open={exportOpen}
                busy={exporting}
                scenes={scenes}
                stats={stats}
                onClose={() => setExportOpen(false)}
                onExportPdf={(o, ids) => void exportPdf(o, ids)}
                onExportFountain={() => void exportFountain()}
                onExportFdx={() => void exportFdx()}
                footnote={
                    <>
                        Exports <b>{activeDoc?.title}</b> on {projectSettings.pageSize === "a4" ? "A4" : "US Letter"}, scene numbers{" "}
                        {projectSettings.sceneNumbers ? "on" : "off"}
                        {inherited.length > 0 && <>, fills {inherited.map((k) => titleKeyLabel(k)).join(", ")} from Project information</>}.{" "}
                        <button
                            className="link-btn"
                            onClick={() => {
                                setExportOpen(false);
                                openTab({ kind: "project-settings" });
                            }}
                        >
                            Project settings
                        </button>
                    </>
                }
            />
            <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
            <HistoryDialog
                open={historyOpen}
                projectPath={projectPath}
                onClose={() => setHistoryOpen(false)}
                current={() =>
                    documents
                        .filter((d) => d.kind === "script" || d.kind === "note")
                        .map((d) => {
                            const open = d.kind === "script" && openScriptTabs.some((t) => t.docId === d.id) ? editors.current.get(d.id) : undefined;
                            return { id: d.id, kind: d.kind, title: d.title, content: open ? open.getText() : d.content ?? "" };
                        })
                }
                onMarkRevisions={(snapshotId, label, docs, color) => {
                    setRevMarks(
                        {
                            label,
                            color,
                            colorName: REVISION_COLORS.find((c) => c.value === color)?.name ?? "",
                            docs: Object.fromEntries(docs.filter((d) => d.kind === "script").map((d) => [d.id, d.content])),
                        },
                        snapshotId,
                    );
                    setHistoryOpen(false);
                }}
                onRestoreScene={(snap, edit, heading) => {
                    const existing = documents.find((d) => d.id === snap.id);
                    if (!existing) return;
                    const open = openScriptTabs.some((t) => t.docId === existing.id) ? editors.current.get(existing.id) : undefined;
                    if (open) open.applyEdits([edit]);
                    else {
                        const text = existing.content ?? "";
                        patchDoc(existing.id, { content: text.slice(0, edit.from) + edit.insert + text.slice(edit.to) });
                    }
                    markDirty();
                    setHistoryOpen(false);
                    toast(`Restored the scene "${heading}" in "${snap.title}". Ctrl/Cmd+Z undoes it.`, "success");
                }}
                onRestore={(snap: HistoryDoc) => {
                    const existing = documents.find((d) => d.id === snap.id);
                    if (!existing) {
                        const kind = snap.kind === "note" ? "note" : "script";
                        const order = Math.max(-1, ...documents.filter((d) => d.kind === kind).map((d) => d.order)) + 1;
                        setDocuments((docs) => [...docs, { id: snap.id, kind, title: snap.title, order, content: snap.content } as SfpDocument]);
                    } else {
                        const open = existing.kind === "script" && openScriptTabs.some((t) => t.docId === existing.id) ? editors.current.get(existing.id) : undefined;
                        if (open) open.applyEdits([{ from: 0, to: open.getText().length, insert: snap.content }]);
                        else patchDoc(existing.id, { content: snap.content });
                    }
                    markDirty();
                    setHistoryOpen(false);
                    toast(`Restored "${snap.title}". The version you replaced is still in local history after your next save.`, "success");
                }}
            />
        </div>
    );
});
