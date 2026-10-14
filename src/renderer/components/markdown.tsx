// src/renderer/components/markdown.tsx
//
// Markdown for notes, cards and entity pages: a small, safe renderer (it builds
// React elements, never HTML strings), an editor with a live rendered view, and
// picture embedding. Pictures are copied into the project's assets/ through the
// bridge and referenced as ![](assets/<name>).

import { Fragment, useRef, useState, type ReactNode } from "react";
import { api } from "../lib/api";
import { Segmented } from "./ui";
import { IconImage, IconTrash } from "./icons";

/* ---------- assets ---------- */

const IMAGE_TYPES = /^image\/(png|jpe?g|gif|webp|avif|bmp)$/i;

function extFor(file: File): string {
    const fromName = /\.([a-z0-9]+)$/i.exec(file.name)?.[1];
    if (fromName) return file.name;
    const sub = file.type.split("/")[1] || "png";
    return `pasted-picture.${sub === "jpeg" ? "jpg" : sub}`;
}

/** Copies dropped / pasted picture files into the project. Returns the asset paths that worked. */
export async function addImageFiles(projectPath: string, files: File[], onError: (msg: string) => void): Promise<string[]> {
    const out: string[] = [];
    for (const file of files) {
        if (!IMAGE_TYPES.test(file.type)) {
            onError(`${file.name || "That file"} is not a picture Sceneform can embed (PNG, JPEG, GIF, WebP, AVIF, BMP).`);
            continue;
        }
        const bytes = new Uint8Array(await file.arrayBuffer());
        const result = await api.assets.add(projectPath, extFor(file), bytes);
        if (result.ok) out.push(result.value.asset);
        else onError(`Couldn't add the picture: ${result.error.message}`);
    }
    return out;
}

export async function pickImage(projectPath: string, onError: (msg: string) => void): Promise<string | null> {
    const result = await api.assets.pick(projectPath);
    if (!result.ok) {
        onError(`Couldn't add the picture: ${result.error.message}`);
        return null;
    }
    return result.value?.asset ?? null;
}

function imageFilesFrom(list: DataTransferItemList | FileList | null | undefined): File[] {
    if (!list) return [];
    const files: File[] = [];
    if ("length" in list && list.length && list[0] instanceof File) {
        for (const f of Array.from(list as FileList)) if (f.type.startsWith("image/")) files.push(f);
        return files;
    }
    for (const item of Array.from(list as DataTransferItemList)) {
        if (item.kind === "file") {
            const f = item.getAsFile();
            if (f && f.type.startsWith("image/")) files.push(f);
        }
    }
    return files;
}

export function AssetImage({ projectPath, asset, alt, className }: { projectPath: string; asset: string; alt?: string; className?: string }) {
    const [broken, setBroken] = useState(false);
    if (broken) return <span className={`asset-missing ${className ?? ""}`}>Missing picture: {asset}</span>;
    return <img className={className} src={api.assets.url(projectPath, asset)} alt={alt ?? ""} onError={() => setBroken(true)} draggable={false} />;
}

/* ---------- rendering ---------- */

function openLink(href: string) {
    if (/^https:\/\//i.test(href)) void api.app.openExternal(href);
}

function inline(text: string, projectPath: string, keyBase: string): ReactNode[] {
    const out: ReactNode[] = [];
    const re = /!\[([^\]]*)\]\(([^)\s]+)\)|\[([^\]]+)\]\(([^)\s]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\s][^*]*)\*|_([^_\s][^_]*)_/g;
    let last = 0;
    let m: RegExpExecArray | null;
    let n = 0;
    while ((m = re.exec(text))) {
        if (m.index > last) out.push(text.slice(last, m.index));
        const k = `${keyBase}-${n++}`;
        if (m[2] !== undefined) {
            const src = m[2];
            out.push(
                src.startsWith("assets/") ? (
                    <AssetImage key={k} projectPath={projectPath} asset={src} alt={m[1]} className="md-img" />
                ) : (
                    <span key={k} className="md-img-external" title="Only pictures saved in the project are shown">
                        [picture: {m[1] || src}]
                    </span>
                ),
            );
        } else if (m[3] !== undefined) {
            const href = m[4];
            out.push(
                <a
                    key={k}
                    className="md-link"
                    href={href}
                    title={/^https:\/\//i.test(href) ? `Open ${href} in your browser` : href}
                    onClick={(e) => {
                        e.preventDefault();
                        openLink(href);
                    }}
                >
                    {m[3]}
                </a>,
            );
        } else if (m[5] !== undefined) out.push(<code key={k}>{m[5]}</code>);
        else if (m[6] !== undefined || m[7] !== undefined) out.push(<strong key={k}>{inline(m[6] ?? m[7], projectPath, k)}</strong>);
        else out.push(<em key={k}>{inline(m[8] ?? m[9], projectPath, k)}</em>);
        last = m.index + m[0].length;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
}

export function MarkdownView({ source, projectPath, empty }: { source: string; projectPath: string; empty?: string }) {
    const lines = source.replace(/\r\n?/g, "\n").split("\n");
    const blocks: ReactNode[] = [];
    let i = 0;
    let key = 0;
    const withBreaks = (ls: string[], k: string) =>
        ls.map((l, j) => (
            <Fragment key={`${k}-${j}`}>
                {j > 0 && <br />}
                {inline(l, projectPath, `${k}-${j}`)}
            </Fragment>
        ));

    while (i < lines.length) {
        const line = lines[i];
        const k = `b${key++}`;
        if (!line.trim()) {
            i++;
            continue;
        }
        if (/^```/.test(line)) {
            const body: string[] = [];
            i++;
            while (i < lines.length && !/^```/.test(lines[i])) body.push(lines[i++]);
            i++;
            blocks.push(<pre key={k} className="md-pre"><code>{body.join("\n")}</code></pre>);
            continue;
        }
        const h = /^(#{1,6})\s+(.*)$/.exec(line);
        if (h) {
            const level = h[1].length;
            const content = inline(h[2], projectPath, k);
            blocks.push(
                level === 1 ? <h1 key={k}>{content}</h1> : level === 2 ? <h2 key={k}>{content}</h2> : level === 3 ? <h3 key={k}>{content}</h3> : <h4 key={k}>{content}</h4>,
            );
            i++;
            continue;
        }
        if (/^(\*\s*\*\s*\*|-\s*-\s*-|_\s*_\s*_)[\s*_-]*$/.test(line)) {
            blocks.push(<hr key={k} />);
            i++;
            continue;
        }
        if (/^>\s?/.test(line)) {
            const body: string[] = [];
            while (i < lines.length && /^>\s?/.test(lines[i])) body.push(lines[i++].replace(/^>\s?/, ""));
            blocks.push(<blockquote key={k}>{withBreaks(body, k)}</blockquote>);
            continue;
        }
        if (/^\s*[-*+]\s+/.test(line)) {
            const items: string[] = [];
            while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*+]\s+/, ""));
            blocks.push(
                <ul key={k}>
                    {items.map((it, j) => {
                        const task = /^\[( |x)\]\s+(.*)$/i.exec(it);
                        return (
                            <li key={j} className={task ? "md-task" : undefined}>
                                {task && <input type="checkbox" checked={task[1].toLowerCase() === "x"} readOnly tabIndex={-1} />}
                                {inline(task ? task[2] : it, projectPath, `${k}-${j}`)}
                            </li>
                        );
                    })}
                </ul>,
            );
            continue;
        }
        if (/^\s*\d+[.)]\s+/.test(line)) {
            const items: string[] = [];
            while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*\d+[.)]\s+/, ""));
            blocks.push(
                <ol key={k}>
                    {items.map((it, j) => (
                        <li key={j}>{inline(it, projectPath, `${k}-${j}`)}</li>
                    ))}
                </ol>,
            );
            continue;
        }
        const para: string[] = [];
        while (
            i < lines.length &&
            lines[i].trim() &&
            !/^(#{1,6}\s|```|>\s?|\s*[-*+]\s+|\s*\d+[.)]\s+)/.test(lines[i])
        ) {
            para.push(lines[i++]);
        }
        const onlyImage = para.length === 1 && /^!\[[^\]]*\]\([^)]+\)$/.test(para[0].trim());
        blocks.push(
            onlyImage ? (
                <figure key={k} className="md-figure">{inline(para[0].trim(), projectPath, k)}</figure>
            ) : (
                <p key={k}>{withBreaks(para, k)}</p>
            ),
        );
    }

    if (blocks.length === 0) return <div className="md-view md-view--empty">{empty ?? "Nothing here yet."}</div>;
    return <div className="md-view">{blocks}</div>;
}

/* ---------- editor ---------- */

type Mode = "edit" | "split" | "view";

export function MarkdownEditor(props: {
    value: string;
    onChange: (value: string) => void;
    projectPath: string;
    onError: (message: string) => void;
    placeholder?: string;
    label: string;
    /** Compact editors (entity bios) default to split too, but are shorter. */
    compact?: boolean;
    defaultMode?: Mode;
}) {
    const [mode, setMode] = useState<Mode>(props.defaultMode ?? "split");
    const [dragging, setDragging] = useState(false);
    const [busy, setBusy] = useState(false);
    const area = useRef<HTMLTextAreaElement>(null);
    const latest = useRef(props.value);
    latest.current = props.value;

    const insertAssets = (assets: string[]) => {
        if (!assets.length) return;
        const el = area.current;
        const text = latest.current;
        // Insert at the caret only when the user is typing in the field; drops and the button append.
        const at = el && mode !== "view" && document.activeElement === el ? el.selectionEnd : text.length;
        const before = text.slice(0, at);
        const after = text.slice(at);
        const snippet = assets.map((a) => `![](${a})`).join("\n\n");
        const pre = before && !before.endsWith("\n\n") ? (before.endsWith("\n") ? "\n" : "\n\n") : "";
        const post = after && !after.startsWith("\n") ? "\n\n" : "";
        const next = `${before}${pre}${snippet}${post}${after}`;
        props.onChange(next);
        const caret = before.length + pre.length + snippet.length;
        requestAnimationFrame(() => {
            if (el && mode !== "view") {
                el.focus();
                el.setSelectionRange(caret, caret);
            }
        });
    };

    const addFiles = async (files: File[]) => {
        if (!files.length) return;
        setBusy(true);
        try {
            insertAssets(await addImageFiles(props.projectPath, files, props.onError));
        } finally {
            setBusy(false);
        }
    };

    const pick = async () => {
        setBusy(true);
        try {
            const asset = await pickImage(props.projectPath, props.onError);
            if (asset) insertAssets([asset]);
        } finally {
            setBusy(false);
        }
    };

    return (
        <div
            className={`md-editor md-editor--${mode} ${props.compact ? "md-editor--compact" : ""} ${dragging ? "is-dragging" : ""}`}
            onDragOver={(e) => {
                if (Array.from(e.dataTransfer.types).includes("Files")) {
                    e.preventDefault();
                    setDragging(true);
                }
            }}
            onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
            }}
            onDrop={(e) => {
                const files = imageFilesFrom(e.dataTransfer.files);
                setDragging(false);
                if (files.length) {
                    e.preventDefault();
                    void addFiles(files);
                }
            }}
        >
            <div className="md-editor__bar">
                <Segmented
                    value={mode}
                    onChange={setMode}
                    options={[
                        { value: "edit", label: "Write" },
                        { value: "split", label: "Split" },
                        { value: "view", label: "View" },
                    ]}
                />
                <div className="toolbar__spacer" />
                <span className="toolbar__note">{busy ? "Adding picture…" : "Markdown. Drop or paste pictures."}</span>
                <button type="button" className="btn btn--secondary btn--sm" onClick={() => void pick()} disabled={busy}>
                    <IconImage size={13} /> Add picture
                </button>
            </div>
            <div className="md-editor__body">
                {mode !== "view" && (
                    <textarea
                        ref={area}
                        className="md-editor__input"
                        aria-label={props.label}
                        value={props.value}
                        placeholder={props.placeholder}
                        spellCheck
                        onChange={(e) => props.onChange(e.target.value)}
                        onPaste={(e) => {
                            const files = imageFilesFrom(e.clipboardData.items);
                            if (files.length) {
                                e.preventDefault();
                                void addFiles(files);
                            }
                        }}
                    />
                )}
                {mode !== "edit" && (
                    <div className="md-editor__view" onDoubleClick={() => mode === "view" && setMode("split")}>
                        <MarkdownView source={props.value} projectPath={props.projectPath} empty={props.placeholder} />
                    </div>
                )}
            </div>
            {dragging && <div className="md-editor__drop">Drop pictures to add them to the project</div>}
        </div>
    );
}

/* ---------- picture gallery (location / scene pictures, portraits) ---------- */

export function PictureGallery(props: {
    pictures: string[];
    projectPath: string;
    onChange: (pictures: string[]) => void;
    onError: (message: string) => void;
    single?: boolean;
    label: string;
}) {
    const [dragging, setDragging] = useState(false);
    const [busy, setBusy] = useState(false);
    const add = (assets: string[]) => {
        if (!assets.length) return;
        props.onChange(props.single ? [assets[0]] : [...props.pictures, ...assets]);
    };
    return (
        <div
            className={`gallery ${props.single ? "gallery--single" : ""} ${dragging ? "is-dragging" : ""}`}
            aria-label={props.label}
            onDragOver={(e) => {
                if (Array.from(e.dataTransfer.types).includes("Files")) {
                    e.preventDefault();
                    setDragging(true);
                }
            }}
            onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
            }}
            onDrop={async (e) => {
                const files = imageFilesFrom(e.dataTransfer.files);
                setDragging(false);
                if (!files.length) return;
                e.preventDefault();
                setBusy(true);
                add(await addImageFiles(props.projectPath, props.single ? files.slice(0, 1) : files, props.onError));
                setBusy(false);
            }}
        >
            {props.pictures.map((p) => (
                <div className="gallery__item" key={p}>
                    <AssetImage projectPath={props.projectPath} asset={p} className="gallery__img" />
                    <button
                        type="button"
                        className="gallery__remove"
                        title="Remove from this page (the file stays in the project)"
                        aria-label="Remove picture"
                        onClick={() => props.onChange(props.pictures.filter((x) => x !== p))}
                    >
                        <IconTrash size={12} />
                    </button>
                </div>
            ))}
            {(!props.single || props.pictures.length === 0) && (
                <button
                    type="button"
                    className="gallery__add"
                    disabled={busy}
                    onClick={async () => {
                        setBusy(true);
                        const a = await pickImage(props.projectPath, props.onError);
                        setBusy(false);
                        if (a) add([a]);
                    }}
                >
                    <IconImage size={18} />
                    <span>{busy ? "Adding…" : props.single ? "Add portrait" : "Add picture"}</span>
                    <span className="gallery__hint">or drop one here</span>
                </button>
            )}
            {props.single && props.pictures.length > 0 && (
                <button
                    type="button"
                    className="btn btn--ghost btn--sm gallery__replace"
                    onClick={async () => {
                        const a = await pickImage(props.projectPath, props.onError);
                        if (a) add([a]);
                    }}
                >
                    Replace
                </button>
            )}
        </div>
    );
}
