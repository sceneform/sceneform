// src/renderer/components/projects.tsx
import { useEffect, useMemo, useState } from "react";
import type { ProjectListing } from "../../shared/bridge";
import { Titlebar } from "./chrome";
import { EmptyState, Modal } from "./ui";
import { IconChevronLeft, IconFile, IconFolder, IconGear, IconHeart, IconPlus, IconSearch, IconTrash } from "./icons";
import { baseName, relativeTime } from "../lib/format";
import { api } from "../lib/api";

const DONATE_URL = "https://www.patreon.com/cw/morphedstill";

/* ---------- project select ---------- */

/**
 * Colour shown for a project's swatch on the shelf. New archives are still created with the old
 * acid-green default (#96f550, or "var(--c-accent)" in older files); that stored value is left alone,
 * but on the shelf an unchosen default reads as a neutral page chip instead of a second accent.
 */
const LEGACY_DEFAULT_COLORS = new Set(["#96f550", "var(--c-accent)"]);
function swatchColor(color: string | undefined): string {
    if (!color || LEGACY_DEFAULT_COLORS.has(color.trim().toLowerCase())) return "var(--c-text-faint)";
    return color;
}

export function ProjectSelectScreen(props: {
    projects: ProjectListing[];
    recentProjects: ProjectListing[];
    loading: boolean;
    folder: string;
    onOpen: (path: string) => void;
    onOpenRecent: (path: string) => void;
    onNew: () => void;
    onImportFountain: () => void;
    onBrowse: () => void;
    onSettings: () => void;
    onRename: (path: string, title: string) => void;
    onUpdateNotes: (path: string, notes: string) => void;
    onTrash: (listing: ProjectListing) => void;
    onReveal: (path: string) => void;
}) {
    const [activePath, setActivePath] = useState<string>("");
    const [query, setQuery] = useState("");
    const [donateOpen, setDonateOpen] = useState(false);
    const [titleDraft, setTitleDraft] = useState("");
    const [notesDraft, setNotesDraft] = useState("");

    const sorted = useMemo(
        () => [...props.projects].sort((a, b) => (Date.parse(b.summary.updated) || 0) - (Date.parse(a.summary.updated) || 0)),
        [props.projects],
    );
    const recent = props.recentProjects.length ? props.recentProjects : sorted;
    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return recent;
        return recent.filter(
            (p) =>
                p.summary.title.toLowerCase().includes(q) ||
                p.summary.logline.toLowerCase().includes(q) ||
                p.summary.author.toLowerCase().includes(q) ||
                p.path.toLowerCase().includes(q),
        );
    }, [recent, query]);

    const active = recent.find((p) => p.path === activePath) ?? sorted.find((p) => p.path === activePath) ?? recent[0] ?? sorted[0];

    useEffect(() => {
        setTitleDraft(active?.summary.title ?? "");
        setNotesDraft(active?.summary.notes ?? "");
    }, [active?.path, active?.summary.title, active?.summary.notes]);

    const commitTitle = () => {
        if (!active) return;
        const next = titleDraft.trim();
        if (!next) setTitleDraft(active.summary.title);
        else if (next !== active.summary.title) props.onRename(active.path, next);
    };

    return (
        <div className="shell">
            <Titlebar />
            <main className="dash">
                <aside className="dash__list" aria-label="Your projects">
                    <div className="list__header">
                        <h1 className="list__title">Projects</h1>
                        <div className="list__header-actions">
                            <button className="icon-btn icon-btn--heart" title="Support Sceneform" aria-label="Support Sceneform" onClick={() => setDonateOpen(true)}>
                                <IconHeart />
                            </button>
                            <button className="icon-btn" title="Settings" aria-label="Settings" onClick={props.onSettings}>
                                <IconGear />
                            </button>
                            <button className="btn btn--primary btn--sm" onClick={props.onNew} style={{ marginLeft: "var(--sp-2)" }}>
                                <IconPlus /> New
                            </button>
                        </div>
                    </div>

                    <div className="list__search">
                        <div className="input-group input-group--icon">
                            <IconSearch />
                            <input className="input" type="search" placeholder="Search projects…" value={query} onChange={(e) => setQuery(e.target.value)} />
                        </div>
                    </div>

                    <div className="panel-heading">Recent</div>
                    <div className="list__scroll" role="listbox" aria-label="Projects">
                        {filtered.length === 0 && recent.length > 0 ? (
                            <EmptyState title="No matches" body={`Nothing matches "${query}".`} />
                        ) : (
                            filtered.map((p) => (
                                <button
                                    key={p.path}
                                    role="option"
                                    aria-selected={p.path === active?.path}
                                    className={`project-row ${p.path === active?.path ? "is-active" : ""}`}
                                    style={{ ["--row-color" as string]: swatchColor(p.summary.color) }}
                                    onClick={() => setActivePath(p.path)}
                                    onDoubleClick={() => props.onOpenRecent(p.path)}
                                >
                                    <span className="project-row__swatch" />
                                    <span className="project-row__body">
                                        <span className="project-row__title">{p.summary.title}</span>
                                        <span className="project-row__by">by {p.summary.author || "Unknown"}</span>
                                    </span>
                                    <span className="project-row__updated">{relativeTime(p.summary.updated)}</span>
                                </button>
                            ))
                        )}
                    </div>

                    <div className="list__footer">
                        <button className="btn btn--secondary btn--full btn--sm" onClick={props.onBrowse}>
                            <IconFolder size={13} /> Open .sfp from disk…
                        </button>
                        <button className="btn btn--ghost btn--full btn--sm" onClick={props.onImportFountain}>
                            <IconFile size={13} /> Import .fountain or .fdx…
                        </button>
                    </div>
                </aside>

                <section className="dash__detail" aria-label="Selected project">
                    {active ? (
                        <>
                            {active.summary.banner && (
                                <div className="detail__thumb has-banner" aria-hidden="true">
                                    <img className="detail__banner" src={api.assets.url(active.path, active.summary.banner)} alt="" draggable={false} />
                                </div>
                            )}
                            <article className="title-sheet" aria-label="Title page">
                                <input
                                    className="detail__title title-sheet__title"
                                    id="projectTitleInput"
                                    aria-label="Project title"
                                    value={titleDraft}
                                    onChange={(e) => setTitleDraft(e.target.value)}
                                    onBlur={commitTitle}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                                        if (e.key === "Escape") {
                                            setTitleDraft(active.summary.title);
                                            (e.target as HTMLInputElement).blur();
                                        }
                                    }}
                                />
                                <p className="title-sheet__credit">Written by</p>
                                <p className="title-sheet__author">{active.summary.author || "Unknown"}</p>
                                {active.summary.logline ? (
                                    <p className="detail__logline title-sheet__logline">{active.summary.logline}</p>
                                ) : (
                                    <p className="detail__logline title-sheet__logline is-empty">No logline yet.</p>
                                )}
                                <div className="title-sheet__foot">
                                    <button className="detail__file" onClick={() => props.onReveal(active.path)} title="Show in folder">
                                        <IconFile size={13} /> {baseName(active.path)}
                                    </button>
                                    <span>Updated {relativeTime(active.summary.updated)}</span>
                                </div>
                            </article>
                            <div className="detail__actions">
                                <button className="btn btn--primary" onClick={() => props.onOpen(active.path)}>Open in editor</button>
                                <button className="btn btn--secondary" onClick={() => document.getElementById("projectTitleInput")?.focus()}>Rename</button>
                                <button className="btn btn--ghost btn--danger-text detail__trash" onClick={() => props.onTrash(active)}>
                                    <IconTrash /> Move to trash
                                </button>
                            </div>
                            <div className="detail__stats">
                                <div><div className="stat__value">{active.summary.pages}</div><div className="stat__label">{(active.summary.screenplays ?? 1) > 1 ? "Pages, all scripts" : "Pages"}</div></div>
                                <div><div className="stat__value">{active.summary.scenes}</div><div className="stat__label">{(active.summary.screenplays ?? 1) > 1 ? "Scenes, all scripts" : "Scenes"}</div></div>
                                {(active.summary.screenplays ?? 1) > 1 && (
                                    <div><div className="stat__value">{active.summary.screenplays}</div><div className="stat__label">Screenplays</div></div>
                                )}
                                <div><div className="stat__value">{active.summary.timeSpent || "0m"}</div><div className="stat__label">Time spent</div></div>
                            </div>
                            <div className="detail__section-title">Notes</div>
                            <textarea
                                className="detail__notes"
                                placeholder="Notes about this project (only shown here)…"
                                value={notesDraft}
                                onChange={(e) => setNotesDraft(e.target.value)}
                                onBlur={() => notesDraft !== (active.summary.notes ?? "") && props.onUpdateNotes(active.path, notesDraft)}
                            />
                        </>
                    ) : (
                        <EmptyState
                            title={props.loading ? "Loading projects…" : "No projects yet"}
                            body={props.loading ? "" : "Start a new screenplay, or bring in a .fountain or Final Draft (.fdx) file you already have."}
                        >
                            {!props.loading && (
                                <div className="empty-state__actions">
                                    <button className="btn btn--primary" onClick={props.onNew}><IconPlus /> New project</button>
                                    <button className="btn btn--secondary" onClick={props.onImportFountain}>Import .fountain or .fdx…</button>
                                </div>
                            )}
                        </EmptyState>
                    )}
                </section>
            </main>

            <footer className="statusbar">
                <div className="statusbar__group">
                    <span className="statusbar__item">Offline, no account needed</span>
                </div>
                <div className="statusbar__group">
                    <span className="statusbar__item mono" title={props.folder}>{props.folder}</span>
                </div>
            </footer>

            <Modal open={donateOpen} onClose={() => setDonateOpen(false)} labelledBy="donateTitle">
                <h2 className="modal__title modal__title--with-icon" id="donateTitle">
                    <IconHeart size={18} className="modal__title-icon" /> Keep Sceneform free
                </h2>
                <p className="modal__body">
                    Sceneform is free, offline, and never phones home. It stays that way because people who use it chip in. Nothing is unlocked by donating; it's a tip jar.
                </p>
                <div className="modal__actions">
                    <button className="btn btn--secondary" onClick={() => setDonateOpen(false)}>No, thanks</button>
                    <button
                        className="btn btn--primary"
                        title={DONATE_URL}
                        onClick={() => {
                            void api.app.openExternal(DONATE_URL);
                            setDonateOpen(false);
                        }}
                    >
                        Donate!
                    </button>
                </div>
            </Modal>
        </div>
    );
}

/* ---------- new project ---------- */

export function ProjectNewScreen(props: {
    busy: boolean;
    error: string | null;
    folder: string;
    defaultAuthor: string;
    importedFrom: string | null;
    onCancel: () => void;
    onCreate: (name: string, author: string, logline: string) => void;
    onChangeFolder: () => void;
}) {
    const [name, setName] = useState(props.importedFrom ? baseName(props.importedFrom).replace(/\.[^.]+$/, "") : "");
    const [author, setAuthor] = useState(props.defaultAuthor);
    const [logline, setLogline] = useState("");
    const [submitted, setSubmitted] = useState(false);
    const invalid = submitted && !name.trim();

    const submit = (e?: React.FormEvent) => {
        e?.preventDefault();
        setSubmitted(true);
        if (!name.trim() || props.busy) return;
        props.onCreate(name.trim(), author.trim(), logline.trim());
    };

    // Mirrors sanitizeName in the backend closely enough for a preview; the backend has the final say.
    const fileName = `${(name.trim() || "Untitled").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "").slice(0, 100) || "Untitled"}.sfp`;
    const sep = props.folder.includes("\\") ? "\\" : "/";

    return (
        <div className="wizard">
            <Titlebar
                left={
                    <button type="button" className="btn btn--ghost btn--sm titlebar__back" onClick={props.onCancel}>
                        <IconChevronLeft /> Projects
                    </button>
                }
            />
            <div className="wizard__body">
                <form className="wizard__form" id="newProjectForm" onSubmit={submit} noValidate>
                    <p className="wizard__eyebrow">{props.importedFrom ? "Import screenplay" : "New project"}</p>
                    <h1 className="wizard__heading">Let's set up your screenplay.</h1>

                    <div className="wizard__section">
                        <div className="wizard__section-title">Basics</div>
                        <div className={`wizard__row field ${invalid ? "has-error" : ""}`}>
                            <label className="field__label" htmlFor="projectNameInput">Project name</label>
                            <input className="input" id="projectNameInput" placeholder="Untitled Screenplay" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
                            {invalid && <p className="field__error">Give your project a name before continuing.</p>}
                        </div>
                        <div className="wizard__row field">
                            <label className="field__label" htmlFor="projectAuthorInput">Author</label>
                            <input className="input" id="projectAuthorInput" placeholder="Your name" value={author} onChange={(e) => setAuthor(e.target.value)} />
                            <p className="field__hint">Goes on the title page. You can change it later.</p>
                        </div>
                        <div className="wizard__row field">
                            <label className="field__label" htmlFor="projectLoglineInput">
                                Logline <span className="field__optional">(optional)</span>
                            </label>
                            <textarea className="input textarea" id="projectLoglineInput" placeholder="One or two sentences about the story." value={logline} onChange={(e) => setLogline(e.target.value)} />
                        </div>
                    </div>

                    <div className="wizard__section">
                        <div className="wizard__section-title">Source</div>
                        <p className="field__hint">
                            {props.importedFrom
                                ? `Starts from ${baseName(props.importedFrom)}. The original file is left untouched.`
                                : "Starts from a blank Fountain script with a title page."}
                        </p>
                    </div>

                    <div className="wizard__section">
                        <div className="wizard__section-title">Location</div>
                        <div className="wizard__row field">
                            <label className="field__label">Project folder</label>
                            <div className="input-group">
                                <input className="input" value={props.folder} readOnly />
                                <button type="button" className="btn btn--secondary" onClick={props.onChangeFolder}>Change…</button>
                            </div>
                            <div className="path-preview">
                                <span className="seg">{props.folder}</span>
                                <span className="slash">{sep}</span>
                                <span className="seg filename">{fileName}</span>
                            </div>
                            <p className="field__hint">
                                Saved as one self-contained <code className="mono">.sfp</code> file. Changing the folder changes it for every project.
                            </p>
                        </div>
                    </div>
                    {props.error && <div className="startup-error" role="alert">{props.error}</div>}
                </form>
                <aside className="wizard__preview" aria-label="Title page preview">
                    <div className="title-sheet title-sheet--preview" aria-hidden="true">
                        <p className="title-sheet__title-text">{name.trim() || "Untitled Screenplay"}</p>
                        <p className="title-sheet__credit">Written by</p>
                        <p className="title-sheet__author">{author.trim() || "Your name"}</p>
                    </div>
                    <p className="field__hint">A sketch of the title page. Edit it any time in Project information.</p>
                </aside>
            </div>
            <div className="wizard__footer">
                <button type="button" className="btn btn--ghost" onClick={props.onCancel}>Cancel</button>
                <button type="submit" form="newProjectForm" className="btn btn--primary" disabled={props.busy}>
                    <IconPlus size={14} /> {props.busy ? "Creating…" : "Create project"}
                </button>
            </div>
        </div>
    );
}
