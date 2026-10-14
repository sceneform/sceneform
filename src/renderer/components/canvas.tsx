// src/renderer/components/canvas.tsx
//
// Planning canvas. Fixes from the old version: the minimap reflects the real
// card bounds and viewport (it was hard-coded), cards can be deleted and
// resized, Ctrl+wheel zooms around the pointer, double-click adds a card where
// you clicked, and dragging no longer marks the project dirty on every pixel.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CanvasCard } from "../../backend/types/canvas";
import type { SceneView } from "../lib/fountain";
import { firstImage, stripImages } from "../lib/project";
import { AssetImage, addImageFiles, pickImage } from "./markdown";
import { IconFile, IconImage, IconLines, IconMinus, IconPlus } from "./icons";

const MIN_ZOOM = 0.4;
const MAX_ZOOM = 2;
const WORLD_PAD = 600;

export function CanvasWorkspace(props: {
    title: string;
    projectPath: string;
    cards: CanvasCard[];
    scenes: SceneView[];
    selectedId: string | null;
    zoom: number;
    onZoom: (zoom: number) => void;
    onSelect: (id: string | null) => void;
    onAdd: (at?: { x: number; y: number }) => void;
    /** Picture cards: assets already copied into the project, placed at `at` (world coordinates). */
    onAddImages: (assets: Array<{ asset: string; name: string }>, at?: { x: number; y: number }) => void;
    onError: (msg: string) => void;
    onChange: (id: string, patch: Partial<CanvasCard>) => void;
    onDelete: (id: string) => void;
    /** Opens the card as its own page (double-click). */
    onOpenCard: (id: string) => void;
}) {
    const viewport = useRef<HTMLDivElement>(null);
    const [view, setView] = useState({ left: 0, top: 0, width: 1, height: 1 });
    const [drag, setDrag] = useState<null | { id: string; x: number; y: number; w: number; h: number }>(null);

    const world = {
        w: Math.max(1600, ...props.cards.map((c) => c.x + c.w + WORLD_PAD)),
        h: Math.max(1000, ...props.cards.map((c) => c.y + c.h + WORLD_PAD)),
    };

    const syncView = () => {
        const v = viewport.current;
        if (!v) return;
        setView({ left: v.scrollLeft / props.zoom, top: v.scrollTop / props.zoom, width: v.clientWidth / props.zoom, height: v.clientHeight / props.zoom });
    };
    useLayoutEffect(syncView, [props.zoom, props.cards.length]);

    useEffect(() => {
        const v = viewport.current;
        if (!v) return;
        const onWheel = (e: WheelEvent) => {
            if (!(e.ctrlKey || e.metaKey)) return;
            e.preventDefault();
            const rect = v.getBoundingClientRect();
            const px = e.clientX - rect.left;
            const py = e.clientY - rect.top;
            const worldX = (v.scrollLeft + px) / props.zoom;
            const worldY = (v.scrollTop + py) / props.zoom;
            const next = clampZoom(props.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
            props.onZoom(next);
            requestAnimationFrame(() => {
                v.scrollLeft = worldX * next - px;
                v.scrollTop = worldY * next - py;
            });
        };
        v.addEventListener("wheel", onWheel, { passive: false });
        return () => v.removeEventListener("wheel", onWheel);
    }, [props.zoom, props.onZoom]);

    const toWorld = (clientX: number, clientY: number) => {
        const v = viewport.current!;
        const rect = v.getBoundingClientRect();
        return { x: (v.scrollLeft + clientX - rect.left) / props.zoom, y: (v.scrollTop + clientY - rect.top) / props.zoom };
    };

    const panStart = (e: React.MouseEvent) => {
        if (e.button !== 0 && e.button !== 1) return;
        if ((e.target as HTMLElement).closest(".canvas-card")) return;
        props.onSelect(null);
        const v = viewport.current!;
        const sx = e.clientX;
        const sy = e.clientY;
        const sl = v.scrollLeft;
        const st = v.scrollTop;
        v.classList.add("is-panning");
        const move = (m: MouseEvent) => {
            v.scrollLeft = sl - (m.clientX - sx);
            v.scrollTop = st - (m.clientY - sy);
        };
        const up = () => {
            v.classList.remove("is-panning");
            window.removeEventListener("mousemove", move);
            window.removeEventListener("mouseup", up);
        };
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
    };

    // Drag and resize keep a local preview and commit once on mouseup.
    const gesture = (card: CanvasCard, mode: "move" | "resize", e: React.MouseEvent) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        e.preventDefault();
        props.onSelect(card.id);
        const sx = e.clientX;
        const sy = e.clientY;
        let current = { id: card.id, x: card.x, y: card.y, w: card.w, h: card.h };
        const move = (m: MouseEvent) => {
            const dx = (m.clientX - sx) / props.zoom;
            const dy = (m.clientY - sy) / props.zoom;
            current =
                mode === "move"
                    ? { ...current, x: Math.max(0, Math.round(card.x + dx)), y: Math.max(0, Math.round(card.y + dy)) }
                    : { ...current, w: Math.max(140, Math.round(card.w + dx)), h: Math.max(80, Math.round(card.h + dy)) };
            setDrag(current);
        };
        const up = () => {
            window.removeEventListener("mousemove", move);
            window.removeEventListener("mouseup", up);
            setDrag(null);
            if (current.x !== card.x || current.y !== card.y || current.w !== card.w || current.h !== card.h) {
                props.onChange(card.id, { x: current.x, y: current.y, w: current.w, h: current.h });
            }
        };
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
    };

    const scale = Math.min(140 / world.w, 90 / world.h);

    const addPictures = async (files: File[], at?: { x: number; y: number }) => {
        const named = files.map((f) => ({ f, name: (f.name || "Picture").replace(/\.[^.]+$/, "") }));
        const assets = await addImageFiles(props.projectPath, files, props.onError);
        if (assets.length) props.onAddImages(assets.map((asset, i) => ({ asset, name: named[i]?.name ?? "Picture" })), at);
    };

    return (
        <div className="workspace-pane">
            <div className="toolbar">
                <span>{props.title}</span>
                <span className="toolbar__note">Planning only, it never changes your script. Double-click a card to open it.</span>
                <div className="toolbar__spacer" />
                <button className="btn btn--icon btn--ghost btn--sm" onClick={() => props.onZoom(clampZoom(props.zoom - 0.1))} aria-label="Zoom out"><IconMinus /></button>
                <button className="toolbar__zoom" onClick={() => props.onZoom(1)} title="Reset zoom">{Math.round(props.zoom * 100)}%</button>
                <button className="btn btn--icon btn--ghost btn--sm" onClick={() => props.onZoom(clampZoom(props.zoom + 0.1))} aria-label="Zoom in"><IconPlus /></button>
                <div className="toolbar__sep" />
                <button
                    className="btn btn--secondary btn--sm"
                    title="A card that is a picture (you can also drop or paste pictures onto the canvas)"
                    onClick={() =>
                        void pickImage(props.projectPath, props.onError).then((asset) => {
                            if (asset) props.onAddImages([{ asset, name: asset.replace(/^assets\//, "").replace(/-[a-z0-9]{8}\.[^.]+$/i, "").replace(/\.[^.]+$/, "") }]);
                        })
                    }
                >
                    <IconImage /> Picture card
                </button>
                <button className="btn btn--secondary btn--sm" onClick={() => props.onAdd()}><IconPlus /> New card</button>
            </div>

            <div
                className="canvas-viewport"
                ref={viewport}
                onMouseDown={panStart}
                onScroll={syncView}
                onDoubleClick={(e) => {
                    if ((e.target as HTMLElement).closest(".canvas-card")) return;
                    props.onAdd(toWorld(e.clientX, e.clientY));
                }}
                onDragOver={(e) => {
                    if ([...e.dataTransfer.items].some((i) => i.kind === "file")) {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "copy";
                    }
                }}
                onDrop={(e) => {
                    const files = [...e.dataTransfer.files];
                    if (!files.length) return;
                    e.preventDefault();
                    const at = toWorld(e.clientX, e.clientY);
                    void addPictures(files, at);
                }}
                onPaste={(e) => {
                    if ((e.target as HTMLElement).closest("input, textarea")) return;
                    const files = [...e.clipboardData.files];
                    if (!files.length) return;
                    e.preventDefault();
                    void addPictures(files);
                }}
                tabIndex={0}
                onKeyDown={(e) => {
                    if ((e.key === "Delete" || e.key === "Backspace") && props.selectedId && !(e.target as HTMLElement).closest("input, textarea")) {
                        e.preventDefault();
                        props.onDelete(props.selectedId);
                    }
                }}
            >
                <div className="canvas-world" style={{ width: world.w * props.zoom, height: world.h * props.zoom }}>
                    <div className="canvas-layer" style={{ width: world.w, height: world.h, transform: `scale(${props.zoom})` }}>
                        {props.cards.map((card) => {
                            const live = drag?.id === card.id ? { ...card, ...drag } : card;
                            const ref = card.sceneId ? props.scenes.find((s) => s.id === card.sceneId) : null;
                            const thumb = firstImage(card.body);
                            return (
                                <div
                                    key={card.id}
                                    className={`canvas-card canvas-card--${card.type} ${card.id === props.selectedId ? "is-selected" : ""}`}
                                    style={{ left: live.x, top: live.y, width: live.w, height: live.h }}
                                    onMouseDown={(e) => gesture(card, "move", e)}
                                    onDoubleClick={(e) => {
                                        e.stopPropagation();
                                        props.onOpenCard(card.id);
                                    }}
                                    title="Double-click to open"
                                >
                                    <div className="canvas-card__title">
                                        {card.type === "scene-ref" ? <IconFile size={13} /> : card.type === "image" ? <IconImage size={13} /> : <IconLines size={13} />}
                                        <span>{card.title || "Untitled card"}</span>
                                    </div>
                                    {card.type === "image" ? (
                                        thumb ? <AssetImage projectPath={props.projectPath} asset={thumb} className="canvas-card__picture" /> : <div className="canvas-card__body">No picture</div>
                                    ) : (
                                        thumb && <AssetImage projectPath={props.projectPath} asset={thumb} className="canvas-card__thumb" />
                                    )}
                                    {card.type === "markdown" && <div className="canvas-card__body">{stripImages(card.body)}</div>}
                                    {card.type === "scene-ref" && (
                                        <div className="canvas-card__scene-tag">
                                            {ref ? `${ref.num}. ${ref.heading}` : card.sceneId ? "Scene no longer exists" : "No scene chosen"}
                                        </div>
                                    )}
                                    <span className="canvas-card__resize" onMouseDown={(e) => gesture(card, "resize", e)} aria-hidden="true" />
                                </div>
                            );
                        })}
                    </div>
                </div>

                {props.cards.length > 0 && (
                    <div className="canvas-minimap" style={{ width: world.w * scale + 8, height: world.h * scale + 8 }} aria-hidden="true">
                        {props.cards.map((c) => (
                            <div
                                key={c.id}
                                className="canvas-minimap__dot"
                                style={{
                                    left: 4 + c.x * scale,
                                    top: 4 + c.y * scale,
                                    width: Math.max(3, c.w * scale),
                                    height: Math.max(2, c.h * scale),
                                    background: c.id === props.selectedId ? "var(--c-accent)" : "var(--c-text-faint)",
                                }}
                            />
                        ))}
                        <div
                            className="canvas-minimap__viewport"
                            style={{ left: 4 + view.left * scale, top: 4 + view.top * scale, width: view.width * scale, height: view.height * scale }}
                        />
                    </div>
                )}
            </div>
        </div>
    );
}

function clampZoom(z: number): number {
    return Math.round(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z)) * 100) / 100;
}
