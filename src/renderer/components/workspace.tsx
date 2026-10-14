// src/renderer/components/workspace.tsx
// Activity bar, the left sidebar views, and the right inspector.

import type React from "react";
import { useState } from "react";
import type { CanvasCard } from "../../backend/types/canvas";
import type { SfpDocument, SfpDocumentKind } from "../../shared/bridge";
import { formatEighths, type ScriptStats, type SceneView } from "../lib/fountain";
import { CHEAT_SHEET, FOUNTAIN_DOCS } from "../lib/fountain-docs";
import { firstImage } from "../lib/project";
import type { CharacterEntity } from "../../backend/types/entities";
import { AssetImage } from "./markdown";
import { EmptyState, Segmented, Toggle } from "./ui";
import {
    IconBook,
    IconCanvas,
    IconChart,
    IconExport,
    IconFile,
    IconGear,
    IconImage,
    IconLines,
    IconOutline,
    IconPen,
    IconPeople,
    IconPlus,
    IconFolder,
    IconTrash,
} from "./icons";

export type SidebarView = "explorer" | "outline" | "info" | "canvas" | "cheatsheet";

/* ---------- activity bar ---------- */

export function ActivityBar(props: {
    view: SidebarView;
    statsActive: boolean;
    sidebarOpen: boolean;
    onView: (v: SidebarView) => void;
    onStats: () => void;
    onSettings: () => void;
}) {
    const items: Array<{ id: SidebarView; title: string; icon: React.ReactElement }> = [
        { id: "explorer", title: "Explorer", icon: <IconFolder size={20} /> },
        { id: "outline", title: "Outline", icon: <IconOutline size={20} /> },
        { id: "info", title: "Characters & locations", icon: <IconPeople size={20} /> },
        { id: "canvas", title: "Canvas", icon: <IconCanvas size={20} /> },
        { id: "cheatsheet", title: "Fountain cheat sheet", icon: <IconBook size={20} /> },
    ];
    return (
        <nav className="activity-bar" aria-label="Views">
            {items.map((item) => (
                <button
                    key={item.id}
                    className={`activity-bar__btn ${props.sidebarOpen && props.view === item.id ? "is-active" : ""}`}
                    onClick={() => props.onView(item.id)}
                    title={item.title}
                    aria-label={item.title}
                    aria-pressed={props.sidebarOpen && props.view === item.id}
                >
                    {item.icon}
                </button>
            ))}
            <button
                className={`activity-bar__btn ${props.statsActive ? "is-active" : ""}`}
                onClick={props.onStats}
                title="Statistics"
                aria-label="Statistics"
            >
                <IconChart size={20} />
            </button>
            <div className="activity-bar__spacer" />
            <button className="activity-bar__btn" onClick={props.onSettings} title="Settings" aria-label="Settings">
                <IconGear size={20} />
            </button>
        </nav>
    );
}

/* ---------- explorer ---------- */

function ExplorerSection(props: {
    title: string;
    kind: SfpDocumentKind;
    docs: SfpDocument[];
    activeKey: string;
    activeScriptId: string;
    icon: (d: SfpDocument) => React.ReactElement;
    hint: (d: SfpDocument) => string;
    addLabel: string;
    canDelete: (d: SfpDocument) => boolean;
    onOpen: (d: SfpDocument) => void;
    onAdd: () => void;
    onRename: (d: SfpDocument, title: string) => void;
    onDelete: (d: SfpDocument) => void;
    onReorder: (ids: string[]) => void;
}) {
    const [editing, setEditing] = useState<string | null>(null);
    const [draft, setDraft] = useState("");
    const [dragId, setDragId] = useState<string | null>(null);
    const [overId, setOverId] = useState<string | null>(null);
    const commit = (d: SfpDocument) => {
        const t = draft.trim();
        if (t && t !== d.title) props.onRename(d, t);
        setEditing(null);
    };
    return (
        <div className="explorer-section" data-kind={props.kind}>
            <div className="panel-heading panel-heading--row">
                <span>{props.title}</span>
                <button className="icon-btn icon-btn--sm" title={props.addLabel} aria-label={props.addLabel} onClick={props.onAdd}>
                    <IconPlus />
                </button>
            </div>
            {props.docs.map((d) => {
                const key = `${d.kind}:${d.id}`;
                const isActive = props.activeKey === key;
                return (
                    <div
                        key={d.id}
                        className={`tree-row ${isActive ? "is-active" : ""} ${d.kind === "script" && d.id === props.activeScriptId ? "is-current-script" : ""} ${overId === d.id && dragId && dragId !== d.id ? "is-drop-target" : ""}`}
                        draggable={editing !== d.id && props.docs.length > 1}
                        onDragStart={(e) => {
                            setDragId(d.id);
                            e.dataTransfer.effectAllowed = "move";
                            e.dataTransfer.setData("text/x-sceneform-doc", d.id);
                        }}
                        onDragOver={(e) => {
                            if (!dragId) return;
                            e.preventDefault();
                            setOverId(d.id);
                        }}
                        onDragEnd={() => {
                            setDragId(null);
                            setOverId(null);
                        }}
                        onDrop={(e) => {
                            e.preventDefault();
                            if (dragId && dragId !== d.id) {
                                const ids = props.docs.map((x) => x.id).filter((id) => id !== dragId);
                                ids.splice(ids.indexOf(d.id), 0, dragId);
                                props.onReorder(ids);
                            }
                            setDragId(null);
                            setOverId(null);
                        }}
                        onContextMenu={(e) => {
                            e.preventDefault();
                            setDraft(d.title);
                            setEditing(d.id);
                        }}
                    >
                        {editing === d.id ? (
                            <input
                                className="input input--inline"
                                autoFocus
                                aria-label={`Rename ${d.title}`}
                                value={draft}
                                onChange={(e) => setDraft(e.target.value)}
                                onBlur={() => commit(d)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") commit(d);
                                    if (e.key === "Escape") setEditing(null);
                                }}
                            />
                        ) : (
                            <button className={`tree-item ${isActive ? "is-active" : ""}`} onClick={() => props.onOpen(d)} onDoubleClick={() => { setDraft(d.title); setEditing(d.id); }} title={`${d.title}, ${props.hint(d)}`}>
                                {props.icon(d)}
                                <span className="tree-item__label">{d.title}</span>
                                <span className="tree-item__hint">{props.hint(d)}</span>
                            </button>
                        )}
                        {editing !== d.id && (
                            <span className="tree-row__actions">
                                <button className="icon-btn icon-btn--sm" title="Rename" aria-label={`Rename ${d.title}`} onClick={() => { setDraft(d.title); setEditing(d.id); }}>
                                    <IconPen size={12} />
                                </button>
                                {props.canDelete(d) && (
                                    <button className="icon-btn icon-btn--sm icon-btn--danger" title="Delete" aria-label={`Delete ${d.title}`} onClick={() => props.onDelete(d)}>
                                        <IconTrash size={12} />
                                    </button>
                                )}
                            </span>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

export function ExplorerView(props: {
    title: string;
    isSeries: boolean;
    documents: SfpDocument[];
    activeKey: string;
    activeScriptId: string;
    onOpen: (d: SfpDocument) => void;
    onAdd: (kind: SfpDocumentKind) => void;
    onRename: (d: SfpDocument, title: string) => void;
    onDelete: (d: SfpDocument) => void;
    onReorder: (kind: SfpDocumentKind, ids: string[]) => void;
    onOpenInfo: () => void;
    onOpenProjectSettings: () => void;
    onExport: () => void;
}) {
    const of = (k: SfpDocumentKind) => props.documents.filter((d) => d.kind === k).sort((a, b) => a.order - b.order);
    const scripts = of("script");
    const common = {
        activeKey: props.activeKey,
        activeScriptId: props.activeScriptId,
        onOpen: props.onOpen,
        onRename: props.onRename,
        onDelete: props.onDelete,
    };
    return (
        <div className="sidebar__view is-active">
            <div className="panel-heading">{props.title || "Project"}</div>
            <div className="sidebar__scroll">
                <ExplorerSection
                    {...common}
                    title={props.isSeries ? "Episodes" : "Screenplays"}
                    kind="script"
                    docs={scripts}
                    addLabel={props.isSeries ? "New episode" : "New screenplay"}
                    icon={() => <IconFile size={15} />}
                    hint={() => "Fountain"}
                    canDelete={() => scripts.length > 1}
                    onAdd={() => props.onAdd("script")}
                    onReorder={(ids) => props.onReorder("script", ids)}
                />
                <ExplorerSection
                    {...common}
                    title="Notes"
                    kind="note"
                    docs={of("note")}
                    addLabel="New notes"
                    icon={() => <IconBook size={15} />}
                    hint={() => "Markdown"}
                    canDelete={() => true}
                    onAdd={() => props.onAdd("note")}
                    onReorder={(ids) => props.onReorder("note", ids)}
                />
                <ExplorerSection
                    {...common}
                    title="Canvases"
                    kind="canvas"
                    docs={of("canvas")}
                    addLabel="New canvas"
                    icon={() => <IconCanvas size={15} />}
                    hint={(d) => `${d.cards?.length ?? 0} cards`}
                    canDelete={() => true}
                    onAdd={() => props.onAdd("canvas")}
                    onReorder={(ids) => props.onReorder("canvas", ids)}
                />
                <div className="panel-heading" style={{ marginTop: "var(--sp-4)" }}>Project</div>
                <button className={`tree-item ${props.activeKey === "project-info" ? "is-active" : ""}`} onClick={props.onOpenInfo}>
                    <IconBook size={15} />
                    <span className="tree-item__label">Project information</span>
                </button>
                <button className={`tree-item ${props.activeKey === "project-settings" ? "is-active" : ""}`} onClick={props.onOpenProjectSettings}>
                    <IconGear size={15} />
                    <span className="tree-item__label">Project settings</span>
                </button>
                <button className="tree-item" onClick={props.onExport}>
                    <IconExport size={15} />
                    <span className="tree-item__label">Export PDF or Fountain…</span>
                </button>
            </div>
        </div>
    );
}

/* ---------- outline ---------- */

export function OutlineView(props: {
    scenes: SceneView[];
    currentIndex: number;
    scriptTitle: string | null;
    /** Section lines (# ACT ONE, ## Sequence) of the active script, in order. */
    sections?: Array<{ line: number; depth: number; title: string }>;
    /** Printed lines per scene (sceneLengths), for the page and minute estimates. */
    lengths?: number[];
    onSelect: (scene: SceneView) => void;
    onOpenPage: (scene: SceneView) => void;
    /** Drag a scene onto another: it takes that scene's place (moveScene under the hood). */
    onMove?: (from: SceneView, to: SceneView) => void;
}) {
    const [dragging, setDragging] = useState<number | null>(null);
    const [over, setOver] = useState<number | null>(null);
    const lengths = props.lengths ?? [];
    const total = lengths.reduce((a, b) => a + b, 0);
    // Interleave section headers with scenes, each section with its page total.
    type Row = { kind: "section"; line: number; depth: number; title: string; lines: number } | { kind: "scene"; i: number };
    const rows: Row[] = [];
    const sections = props.sections ?? [];
    let si = 0;
    props.scenes.forEach((s, i) => {
        while (si < sections.length && sections[si].line < s.line) rows.push({ kind: "section", ...sections[si++], lines: 0 });
        rows.push({ kind: "scene", i });
    });
    while (si < sections.length) rows.push({ kind: "section", ...sections[si++], lines: 0 });
    rows.forEach((r, k) => {
        if (r.kind !== "section") return;
        for (let j = k + 1; j < rows.length; j++) {
            const n = rows[j];
            if (n.kind === "section" && n.depth <= r.depth) break;
            if (n.kind === "scene") r.lines += lengths[n.i] ?? 0;
        }
    });
    const minutes = (lines: number) => Math.max(1, Math.round(lines / 55));
    return (
        <div className="sidebar__view is-active">
            <div className="panel-heading">
                Outline
                <span className="panel-heading__sub">
                    {props.scenes.length} {props.scenes.length === 1 ? "scene" : "scenes"}
                    {total > 0 && <>, about {formatEighths(total)} pp, {minutes(total)} min</>}
                </span>
                {props.scriptTitle && <span className="panel-heading__sub">{props.scriptTitle}</span>}
            </div>
            <div className="sidebar__scroll">
                {props.scenes.length === 0 ? (
                    <EmptyState body="Write a scene heading like INT. KITCHEN - DAY and it shows up here." />
                ) : (
                    rows.map((r) => {
                        if (r.kind === "section")
                            return (
                                <div key={`sec-${r.line}`} className={`outline-section outline-section--d${Math.min(3, r.depth)}`} title={`${r.title}, about ${formatEighths(r.lines)} pages`}>
                                    <span className="outline-section__title">{r.title || "Untitled section"}</span>
                                    {r.lines > 0 && <span className="outline-section__len">{formatEighths(r.lines)} pp, {minutes(r.lines)}′</span>}
                                </div>
                            );
                        const i = r.i;
                        const s = props.scenes[i];
                        return (
                            <div
                                key={`${s.id}-${s.line}`}
                                className={`outline-row ${i === props.currentIndex ? "is-active" : ""} ${s.omitted ? "is-omitted" : ""} ${over === i && dragging !== null && dragging !== i ? (dragging < i ? "is-drop-after" : "is-drop-before") : ""}`}
                                style={s.color ? { ["--scene-color" as string]: s.color } : undefined}
                                draggable={!!props.onMove}
                                onDragStart={(e) => {
                                    setDragging(i);
                                    e.dataTransfer.effectAllowed = "move";
                                    e.dataTransfer.setData("text/plain", s.heading);
                                }}
                                onDragOver={(e) => {
                                    if (dragging === null) return;
                                    e.preventDefault();
                                    setOver(i);
                                }}
                                onDragLeave={() => setOver((o) => (o === i ? null : o))}
                                onDrop={(e) => {
                                    e.preventDefault();
                                    if (dragging !== null && dragging !== i) props.onMove?.(props.scenes[dragging], s);
                                    setDragging(null);
                                    setOver(null);
                                }}
                                onDragEnd={() => {
                                    setDragging(null);
                                    setOver(null);
                                }}
                            >
                                <button
                                    className="outline-row__main"
                                    onClick={() => props.onSelect(s)}
                                    onDoubleClick={() => props.onOpenPage(s)}
                                    title={`${s.synopsis || s.desc || s.heading}\nClick: go to scene. Double-click: open scene page.${props.onMove ? " Drag: reorder." : ""}`}
                                >
                                    <span className="outline-row__num">{s.num}</span>
                                    <span className="outline-row__body">
                                        <span className="outline-row__heading">{s.heading}</span>
                                        {(s.desc || s.synopsis) && <span className="outline-row__desc">{s.desc || s.synopsis}</span>}
                                    </span>
                                    <span className="outline-row__flags">
                                        {lengths[i] !== undefined && <span className="outline-row__len" title="Estimated length in pages (eighths)">{formatEighths(lengths[i])}</span>}
                                        {s.color && <span className="flag-dot flag-dot--color" title={`Tagged ${s.color}`} />}
                                        {s.wip && <span className="flag-dot flag-dot--wip" title="Work in progress" />}
                                        {s.omitted && <span className="flag-dot flag-dot--omitted" title="Omitted" />}
                                    </span>
                                </button>
                                <button className="outline-row__page" onClick={() => props.onOpenPage(s)} title="Open scene page" aria-label={`Open scene page for ${s.heading}`}>
                                    <IconFile size={12} />
                                </button>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
}

/* ---------- characters & locations ---------- */

export function InfoView(props: {
    tab: "characters" | "locations";
    stats: ScriptStats;
    scope: string | null;
    /** Names the writer added by hand (entities.json) that may not be in the script yet. */
    extraCharacters?: string[];
    extraLocations?: string[];
    onTab: (t: "characters" | "locations") => void;
    onOpenCharacter: (name: string) => void;
    onOpenLocation: (name: string) => void;
    onAddCharacter?: (name: string) => void;
    onAddLocation?: (name: string) => void;
}) {
    const [adding, setAdding] = useState(false);
    const [name, setName] = useState("");
    const isChars = props.tab === "characters";
    type Row = { name: string; meta: string; inScript: boolean };
    const rows: Row[] = isChars
        ? props.stats.characters.map((c) => ({ name: c.name, meta: `${c.cues} ${c.cues === 1 ? "cue" : "cues"}, ${c.scenes} sc`, inScript: true }))
        : props.stats.locations.map((l) => ({ name: l.name, meta: `${l.scenes} sc`, inScript: true }));
    const known = new Set(rows.map((r) => r.name.toUpperCase()));
    for (const extra of (isChars ? props.extraCharacters : props.extraLocations) ?? []) {
        if (!known.has(extra.toUpperCase())) rows.push({ name: extra, meta: "not in script yet", inScript: false });
    }
    const submit = () => {
        const n = name.trim().toUpperCase();
        if (n) (isChars ? props.onAddCharacter : props.onAddLocation)?.(n);
        setName("");
        setAdding(false);
    };
    return (
        <div className="sidebar__view is-active">
            <div className="sidebar__tabs" role="tablist">
                <button role="tab" aria-selected={isChars} className={`sidebar__tab ${isChars ? "is-active" : ""}`} onClick={() => props.onTab("characters")}>
                    Characters ({props.stats.characters.length})
                </button>
                <button role="tab" aria-selected={!isChars} className={`sidebar__tab ${!isChars ? "is-active" : ""}`} onClick={() => props.onTab("locations")}>
                    Locations ({props.stats.locations.length})
                </button>
            </div>
            {props.scope && <div className="panel-heading panel-heading--note">{props.scope}</div>}
            <div className="sidebar__scroll">
                {rows.length === 0 ? (
                    <EmptyState body={isChars ? "No characters yet. Write a cue or add one below." : "No locations yet. Write a scene heading or add one below."} />
                ) : (
                    <div className="info-list">
                        {rows.map((r) => (
                            <button
                                key={r.name}
                                className={`info-list__row ${r.inScript ? "" : "is-unused"}`}
                                onClick={() => (isChars ? props.onOpenCharacter : props.onOpenLocation)(r.name)}
                                title={isChars ? "Open character page" : "Open location page"}
                            >
                                <span className={`chip chip--cue${isChars ? "" : " chip--slug"}`}>{r.name}</span>
                                <span className="info-list__meta">{r.meta}</span>
                            </button>
                        ))}
                    </div>
                )}
            </div>
            <div className="sidebar__footer">
                {adding ? (
                    <input
                        className="input"
                        autoFocus
                        placeholder={isChars ? "Character name" : "Location, e.g. FERRY - DECK"}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") submit();
                            if (e.key === "Escape") {
                                setName("");
                                setAdding(false);
                            }
                        }}
                        onBlur={submit}
                    />
                ) : (
                    <button className="btn btn--secondary btn--sm btn--full" onClick={() => setAdding(true)}>
                        <IconPlus /> {isChars ? "Add character" : "Add location"}
                    </button>
                )}
            </div>
        </div>
    );
}

/* ---------- cast inspector ---------- */

function CastInspector(props: {
    scene: SceneView | null;
    stats: ScriptStats;
    characters: Record<string, CharacterEntity>;
    projectPath: string;
    onOpen: (name: string) => void;
}) {
    const names = props.scene ? [...new Set(props.scene.characters.map((c) => c.toUpperCase()))] : [];
    if (!props.scene) return <EmptyState body="Put the cursor in a scene to see who's in it." />;
    if (!names.length) return <EmptyState body="Nobody speaks in this scene yet." />;
    return (
        <div className="cast-list">
            <div className="inspector__section-title">In this scene ({names.length})</div>
            {names.map((n) => {
                const e = props.characters[n] ?? {};
                const st = props.stats.characters.find((c) => c.name.toUpperCase() === n);
                const role = e.role === "custom" ? e.roleCustom : e.role;
                return (
                    <button key={n} className="cast-list__row" onClick={() => props.onOpen(n)} title="Open character page">
                        {e.portrait && props.projectPath ? (
                            <AssetImage projectPath={props.projectPath} asset={e.portrait} alt="" className="cast-list__portrait" />
                        ) : (
                            <span className="cast-list__portrait cast-list__portrait--empty">{n.slice(0, 1)}</span>
                        )}
                        <span className="cast-list__text">
                            <span className="cast-list__name">{n}</span>
                            <span className="cast-list__meta">
                                {[role, e.age, st ? `${st.cues} cues` : null].filter(Boolean).join(", ")}
                            </span>
                            {e.description && <span className="cast-list__desc">{e.description}</span>}
                        </span>
                    </button>
                );
            })}
        </div>
    );
}

/* ---------- canvas card list ---------- */

export function CanvasCardListView(props: {
    canvasTitle: string | null;
    cards: CanvasCard[];
    selectedId: string | null;
    onSelect: (id: string) => void;
    onOpen: (id: string) => void;
    onAdd: () => void;
}) {
    return (
        <div className="sidebar__view is-active">
            <div className="panel-heading">
                Cards ({props.cards.length})
                {props.canvasTitle && <span className="panel-heading__sub">{props.canvasTitle}</span>}
            </div>
            <div className="sidebar__scroll">
                {props.cards.length === 0 && <EmptyState body="The canvas is a free planning space. It never changes your script." />}
                {props.cards.map((c) => (
                    <button
                        key={c.id}
                        className={`tree-item ${c.id === props.selectedId ? "is-active" : ""}`}
                        onClick={() => props.onOpen(c.id)}
                        title="Open card page"
                    >
                        {c.type === "scene-ref" ? <IconFile size={15} /> : firstImage(c.body) ? <IconImage size={15} /> : <IconLines size={15} />}
                        <span className="tree-item__label">{c.title || "Untitled card"}</span>
                    </button>
                ))}
            </div>
            <div className="sidebar__footer">
                <button className="btn btn--secondary btn--sm btn--full" onClick={props.onAdd} disabled={!props.canvasTitle}>
                    <IconPlus /> New card
                </button>
            </div>
        </div>
    );
}

/* ---------- cheat sheet ---------- */

export function CheatSheetView() {
    return (
        <div className="sidebar__view is-active">
            <div className="panel-heading">Fountain quick reference</div>
            <div className="sidebar__scroll sidebar__scroll--padded">
                {CHEAT_SHEET.map(([key, example]) => {
                    const doc = FOUNTAIN_DOCS[key];
                    if (!doc) return null;
                    return (
                        <div className="doc-card doc-card--inline" key={key}>
                            <div className={`doc-card__kind is-${doc.kind}`}>
                                <span className="dot" />
                                {doc.label}
                            </div>
                            <code className={`doc-card__pill is-${doc.kind}`}>{example}</code>
                            <div className="doc-card__desc">{doc.desc}</div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

/* ---------- inspector ---------- */

export function InspectorPane(props: {
    mode: "script" | "card";
    tab: "scene" | "cast" | "stats";
    scene: SceneView | null;
    /** Character entities (entities.json), for the Cast tab. */
    characters?: Record<string, CharacterEntity>;
    projectPath?: string;
    onOpenCharacter?: (name: string) => void;
    card: CanvasCard | null;
    scenes: SceneView[];
    stats: ScriptStats;
    inherited: string[];
    onTab: (t: "scene" | "cast" | "stats") => void;
    onUpdateScene: (scene: SceneView, patch: { desc?: string; wip?: boolean; omitted?: boolean; location?: string }) => void;
    onOpenScenePage: (scene: SceneView) => void;
    onUpdateCard: (patch: Partial<CanvasCard>) => void;
    onOpenCard: () => void;
    onDeleteCard: () => void;
    onOpenStats: () => void;
    onJumpToScene: (scene: SceneView) => void;
    onOpenInfo: () => void;
}) {
    const showCard = props.mode === "card";
    return (
        <aside className="inspector" aria-label="Inspector">
            <div className="inspector__header">
                {showCard ? (
                    <div className="inspector__title">Card</div>
                ) : (
                    <Segmented
                        value={props.tab}
                        onChange={props.onTab}
                        options={[
                            { value: "scene", label: "Scene" },
                            { value: "cast", label: "Cast" },
                            { value: "stats", label: "Statistics" },
                        ]}
                    />
                )}
            </div>
            <div className="inspector__body">
                {showCard ? (
                    props.card ? (
                        <CardInspector card={props.card} scenes={props.scenes} onUpdate={props.onUpdateCard} onOpen={props.onOpenCard} onDelete={props.onDeleteCard} />
                    ) : (
                        <EmptyState body="Select a card to see its quick properties. Double-click a card to open its page; double-click empty canvas to add one." />
                    )
                ) : props.tab === "stats" ? (
                    <StatsInspector stats={props.stats} onOpen={props.onOpenStats} />
                ) : props.tab === "cast" ? (
                    <CastInspector
                        scene={props.scene}
                        stats={props.stats}
                        characters={props.characters ?? {}}
                        projectPath={props.projectPath ?? ""}
                        onOpen={(n) => props.onOpenCharacter?.(n)}
                    />
                ) : props.scene ? (
                    <SceneInspector
                        scene={props.scene}
                        onUpdate={(patch) => props.onUpdateScene(props.scene!, patch)}
                        onJump={() => props.onJumpToScene(props.scene!)}
                        onOpenPage={() => props.onOpenScenePage(props.scene!)}
                    />
                ) : (
                    <EmptyState body="Put the cursor in a scene to see its details here." />
                )}
                {!showCard && props.inherited.length > 0 && (
                    <div className="inspector__inherited">
                        <div className="inspector__section-title">TITLE PAGE</div>
                        <p className="field__hint">
                            Inherited from project: {props.inherited.join(", ")}.{" "}
                            <button className="link-btn" onClick={props.onOpenInfo}>Project information</button>
                        </p>
                    </div>
                )}
            </div>
        </aside>
    );
}

function SceneInspector({
    scene,
    onUpdate,
    onJump,
    onOpenPage,
}: {
    scene: SceneView;
    onUpdate: (patch: { desc?: string; wip?: boolean; omitted?: boolean; location?: string }) => void;
    onJump: () => void;
    onOpenPage: () => void;
}) {
    return (
        <div>
            <div className="inspector__section-title">Scene {scene.num}</div>
            <button className="inspector__heading" onClick={onJump} title="Go to scene">{scene.heading}</button>
            {scene.synopsis && <p className="inspector__synopsis">{scene.synopsis}</p>}
            <button className="btn btn--secondary btn--sm btn--full inspector__page-btn" onClick={onOpenPage}>
                <IconFile size={12} /> Open scene page
            </button>
            <div className="field inspector__field">
                <label className="field__label" htmlFor="sceneDesc">Short description</label>
                <textarea id="sceneDesc" className="input textarea" style={{ minHeight: 64 }} value={scene.desc} placeholder="What happens here, in a line." onChange={(e) => onUpdate({ desc: e.target.value })} />
            </div>
            <div className="setting-row setting-row--compact">
                <div className="setting-row__text"><div className="setting-row__label">Work in progress</div></div>
                <Toggle label="Work in progress" checked={scene.wip} onChange={(v) => onUpdate({ wip: v })} />
            </div>
            <div className="setting-row setting-row--compact">
                <div className="setting-row__text"><div className="setting-row__label">Omitted</div></div>
                <Toggle label="Omitted" checked={scene.omitted} onChange={(v) => onUpdate({ omitted: v })} />
            </div>
            {scene.characters.length > 0 && (
                <>
                    <div className="inspector__section-title" style={{ marginTop: "var(--sp-4)" }}>In this scene</div>
                    <div className="chip-list chip-list--flush">
                        {[...new Set(scene.characters.map((c) => c.toUpperCase()))].map((c) => <span key={c} className="chip chip--cue">{c}</span>)}
                    </div>
                </>
            )}
            {!scene.hasStableId && (
                <p className="field__hint inspector__hint">
                    This scene has no ID marker yet, so its details follow its position. Reordering scenes may shift them. The Scene menu's Add scene ID markers pins them (dragging in the Outline does it for you).
                </p>
            )}
        </div>
    );
}

function StatsInspector({ stats, onOpen }: { stats: ScriptStats; onOpen: () => void }) {
    const top = stats.characters.slice(0, 5);
    const max = top[0]?.cues || 1;
    return (
        <div>
            <div className="inspector__section-title">OVERVIEW</div>
            <div className="mini-metric"><span>Pages (est.)</span><b>{stats.pages}</b></div>
            <div className="mini-metric"><span>Scenes</span><b>{stats.scenes}</b></div>
            <div className="mini-metric"><span>Words</span><b>{stats.words.toLocaleString()}</b></div>
            <div className="mini-metric"><span>Dialogue</span><b>{stats.dialoguePercent}%</b></div>
            <div className="inspector__section-title" style={{ marginTop: "var(--sp-4)" }}>MOST CUES</div>
            {top.length === 0 ? (
                <p className="field__hint">No speaking characters yet.</p>
            ) : (
                top.map((c) => (
                    <div className="bar-row bar-row--compact" key={c.name}>
                        <span className="bar-row__label">{c.name}</span>
                        <span className="bar-row__track"><span className="bar-row__fill" style={{ width: `${(c.cues / max) * 100}%` }} /></span>
                        <span className="bar-row__value">{c.cues}</span>
                    </div>
                ))
            )}
            <button className="btn btn--secondary btn--sm btn--full" style={{ marginTop: "var(--sp-4)" }} onClick={onOpen}>
                Open full statistics
            </button>
        </div>
    );
}

/** Quick props only; the card's text and pictures live on its own page. */
function CardInspector({
    card,
    scenes,
    onUpdate,
    onOpen,
    onDelete,
}: {
    card: CanvasCard;
    scenes: SceneView[];
    onUpdate: (patch: Partial<CanvasCard>) => void;
    onOpen: () => void;
    onDelete: () => void;
}) {
    const ref = card.sceneId ? scenes.find((s) => s.id === card.sceneId) : null;
    return (
        <div>
            {(card.createdBy || card.editedBy) && (
                <p className="field__hint card-blame">
                    {card.createdBy && <>Created by <b>{card.createdBy}</b>{card.createdAt ? ` on ${new Date(card.createdAt).toLocaleDateString()}` : ""}</>}
                    {card.editedBy && <>{card.createdBy ? ". " : ""}Last edited by <b>{card.editedBy}</b>{card.editedAt ? ` on ${new Date(card.editedAt).toLocaleString()}` : ""}</>}
                </p>
            )}
            <div className="field inspector__field">
                <label className="field__label" htmlFor="cardTitle">Title</label>
                <input id="cardTitle" className="input" value={card.title} onChange={(e) => onUpdate({ title: e.target.value })} />
            </div>
            <div className="field inspector__field">
                <label className="field__label" htmlFor="cardType">Type</label>
                <select id="cardType" className="select" value={card.type === "image" ? "markdown" : card.type} onChange={(e) => onUpdate({ type: e.target.value as CanvasCard["type"] })}>
                    <option value="markdown">Note</option>
                    <option value="scene-ref">Scene reference</option>
                </select>
            </div>
            {card.type === "scene-ref" && (
                <div className="field inspector__field">
                    <label className="field__label" htmlFor="cardScene">Scene</label>
                    <select id="cardScene" className="select" value={card.sceneId ?? ""} onChange={(e) => onUpdate({ sceneId: e.target.value || undefined })}>
                        <option value="">Choose a scene…</option>
                        {scenes.map((s) => (
                            <option key={s.id} value={s.id}>{s.num}. {s.heading}</option>
                        ))}
                    </select>
                    {card.sceneId && !ref && <p className="field__error">That scene no longer exists.</p>}
                </div>
            )}
            <button className="btn btn--secondary btn--sm btn--full" onClick={onOpen} style={{ marginBottom: "var(--sp-3)" }}>
                <IconFile size={12} /> Open card page
            </button>
            <button className="btn btn--ghost btn--danger-text btn--sm" onClick={onDelete}>
                <IconTrash /> Delete card
            </button>
        </div>
    );
}
