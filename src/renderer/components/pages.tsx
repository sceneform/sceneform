// src/renderer/components/pages.tsx
//
// Full pages that open as tabs, laid out like the script page (centered
// column, generous type, the same toolbar): canvas cards, notes, characters,
// locations, scenes, Project Information and Project settings.

import type { ReactNode } from "react";
import type { CanvasCard } from "../../backend/types/canvas";
import type { CharacterEntity, CharacterRole, LocationEntity, SceneEntity } from "../../backend/types/entities";
import type { SfpDocument, TitlePageDefaults } from "../../shared/bridge";
import { TITLE_PAGE_KEYS, formatDraftDate, isoDate } from "../../backend/title-page";
import type { SceneView } from "../lib/fountain";
import type { CharacterReport, ProjectSettingsX, SceneRef } from "../lib/project";
import { formatTemplates, parseTemplates } from "../editor/templates";
import { colorToHex } from "../lib/project";
import { MarkdownEditor, PictureGallery } from "./markdown";
import { Segmented, SettingRow, Toggle } from "./ui";
import { IconCalendar, IconFile, IconTrash } from "./icons";

/* ---------- shared layout ---------- */

function Page(props: { kicker: string; toolbar?: ReactNode; children: ReactNode; wide?: boolean }) {
    return (
        <div className="workspace-pane">
            <div className="toolbar">
                <span>{props.kicker}</span>
                <div className="toolbar__spacer" />
                {props.toolbar}
            </div>
            <div className="page-scroll">
                <div className={`page-column ${props.wide ? "page-column--wide" : ""}`}>{props.children}</div>
            </div>
        </div>
    );
}

function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
    return (
        <section className="page-section">
            <div className="page-section__head">
                <h2 className="page-section__title">{title}</h2>
                {aside}
            </div>
            {children}
        </section>
    );
}

function Field({ label, id, children, hint }: { label: string; id: string; children: ReactNode; hint?: string }) {
    return (
        <div className="field page-field">
            <label className="field__label" htmlFor={id}>{label}</label>
            {children}
            {hint && <p className="field__hint">{hint}</p>}
        </div>
    );
}

function SceneList(props: {
    refs: SceneRef[];
    showDoc: boolean;
    onJump: (ref: SceneRef) => void;
    onOpenPage: (ref: SceneRef) => void;
    empty: string;
}) {
    if (props.refs.length === 0) return <p className="field__hint">{props.empty}</p>;
    return (
        <div className="page-scenes">
            {props.refs.map((r) => (
                <div className={`page-scene ${r.scene.omitted ? "is-omitted" : ""}`} key={`${r.docId}-${r.scene.id}-${r.scene.line}`}>
                    <button className="page-scene__main" onClick={() => props.onJump(r)} title="Go to this scene in the script">
                        <span className="page-scene__num">{r.scene.num}</span>
                        <span className="page-scene__heading">{r.scene.heading}</span>
                        {props.showDoc && <span className="page-scene__doc">{r.docTitle}</span>}
                    </button>
                    <button className="btn btn--ghost btn--sm page-scene__page" onClick={() => props.onOpenPage(r)} title="Open the scene page">
                        <IconFile size={12} /> Page
                    </button>
                </div>
            ))}
        </div>
    );
}

/* ---------- canvas card ---------- */

export function CardPage(props: {
    card: CanvasCard;
    canvasTitle: string;
    scenes: SceneView[];
    projectPath: string;
    onChange: (patch: Partial<CanvasCard>) => void;
    onDelete: () => void;
    onOpenScene: (scene: SceneView) => void;
    onBackToCanvas: () => void;
    onError: (msg: string) => void;
}) {
    const { card } = props;
    const ref = card.sceneId ? props.scenes.find((s) => s.id === card.sceneId) : null;
    return (
        <Page
            kicker={`Card in ${props.canvasTitle}`}
            toolbar={
                <>
                    <button className="btn btn--ghost btn--sm" onClick={props.onBackToCanvas}>Show on canvas</button>
                    <button className="btn btn--ghost btn--danger-text btn--sm" onClick={props.onDelete}><IconTrash /> Delete card</button>
                </>
            }
        >
            <input
                className="page-title"
                aria-label="Card title"
                value={card.title}
                placeholder="Untitled card"
                onChange={(e) => props.onChange({ title: e.target.value })}
            />
            <div className="page-meta">
                <label className="page-meta__item">
                    <span>Type</span>
                    <select className="select select--sm" value={card.type === "image" ? "markdown" : card.type} onChange={(e) => props.onChange({ type: e.target.value as CanvasCard["type"] })}>
                        <option value="markdown">Note</option>
                        <option value="scene-ref">Scene reference</option>
                    </select>
                </label>
                {card.type === "scene-ref" && (
                    <label className="page-meta__item">
                        <span>Scene</span>
                        <select className="select select--sm" value={card.sceneId ?? ""} onChange={(e) => props.onChange({ sceneId: e.target.value || undefined })}>
                            <option value="">Choose a scene…</option>
                            {props.scenes.map((s) => (
                                <option key={s.id} value={s.id}>{s.num}. {s.heading}</option>
                            ))}
                        </select>
                    </label>
                )}
                {ref && (
                    <button className="btn btn--ghost btn--sm" onClick={() => props.onOpenScene(ref)}>Go to scene {ref.num}</button>
                )}
                {card.sceneId && !ref && <span className="field__error">That scene no longer exists.</span>}
            </div>
            <MarkdownEditor
                label="Card text"
                value={card.body ?? ""}
                onChange={(body) => props.onChange({ body })}
                projectPath={props.projectPath}
                onError={props.onError}
                placeholder="Write anything: beats, research, a mood. Drop pictures in; the first one becomes the card's thumbnail on the canvas."
            />
        </Page>
    );
}

/* ---------- notes document ---------- */

export function NotePage(props: {
    doc: SfpDocument;
    projectPath: string;
    onChange: (content: string) => void;
    onRename: (title: string) => void;
    onError: (msg: string) => void;
}) {
    return (
        <Page kicker="Notes">
            <input className="page-title" aria-label="Notes title" value={props.doc.title} onChange={(e) => props.onRename(e.target.value)} placeholder="Notes" />
            <MarkdownEditor
                label={props.doc.title || "Notes"}
                value={props.doc.content ?? ""}
                onChange={props.onChange}
                projectPath={props.projectPath}
                onError={props.onError}
                placeholder="Markdown notes, saved inside the project. Drop or paste pictures to embed them."
            />
        </Page>
    );
}

/* ---------- character ---------- */

const ROLES: Array<{ value: CharacterRole; label: string }> = [
    { value: "", label: "Not set" },
    { value: "protagonist", label: "Protagonist" },
    { value: "antagonist", label: "Antagonist" },
    { value: "supporting", label: "Supporting" },
    { value: "minor", label: "Minor" },
    { value: "custom", label: "Custom…" },
];

export function CharacterPage(props: {
    name: string;
    entity: CharacterEntity;
    report: CharacterReport;
    multipleScripts: boolean;
    projectPath: string;
    onChange: (patch: Partial<CharacterEntity>) => void;
    onJumpScene: (ref: SceneRef) => void;
    onOpenScenePage: (ref: SceneRef) => void;
    onJumpLine: (docId: string, line: number) => void;
    onError: (msg: string) => void;
}) {
    const e = props.entity;
    const r = props.report;
    return (
        <Page kicker="Character" wide>
            <div className="entity-hero entity-hero--character">
                <div className="entity-hero__body">
                    <h1 className="page-title page-title--static page-title--cue">{props.name}</h1>
                    <p className="page-subtitle">Keyed by the cue name in the script. Aliases help you search; they don't rename cues.</p>
                    <dl className="entity-facts">
                        <div><dt>Cues</dt><dd>{r.cues}</dd></div>
                        <div><dt>Words</dt><dd>{r.words.toLocaleString()}</dd></div>
                        <div><dt>Scenes</dt><dd>{r.scenes.length}</dd></div>
                    </dl>
                    {r.first ? (
                        <button className="page-link" onClick={() => props.onJumpLine(r.first!.docId, r.first!.line)}>
                            First appears{r.first.sceneHeading ? <> in <span className="page-link__slug">{r.first.sceneHeading}</span></> : ""}{props.multipleScripts ? ` (${r.first.docTitle})` : ""}
                        </button>
                    ) : (
                        <p className="field__hint">Not in any screenplay right now.</p>
                    )}
                </div>
                <PictureGallery
                    single
                    label="Portrait"
                    pictures={e.portrait ? [e.portrait] : []}
                    projectPath={props.projectPath}
                    onChange={(p) => props.onChange({ portrait: p[0] })}
                    onError={props.onError}
                />
            </div>

            <Section title="Details">
                <div className="page-grid">
                    <Field label="Aliases" id="chAliases" hint="Comma separated.">
                        <input
                            id="chAliases"
                            className="input"
                            value={(e.aliases ?? []).join(", ")}
                            onChange={(ev) => props.onChange({ aliases: ev.target.value.split(",").map((s) => s.trimStart()).filter((s, i, all) => s || i === all.length - 1) })}
                            onBlur={(ev) => props.onChange({ aliases: ev.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
                        />
                    </Field>
                    <Field label="Age" id="chAge">
                        <input id="chAge" className="input" value={e.age ?? ""} placeholder="30s" onChange={(ev) => props.onChange({ age: ev.target.value })} />
                    </Field>
                    <Field label="Gender" id="chGender">
                        <input id="chGender" className="input" value={e.gender ?? ""} onChange={(ev) => props.onChange({ gender: ev.target.value })} />
                    </Field>
                    <Field label="Role" id="chRole">
                        <div className="input-group">
                            <select id="chRole" className="select" value={e.role ?? ""} onChange={(ev) => props.onChange({ role: ev.target.value as CharacterRole })}>
                                {ROLES.map((ro) => <option key={ro.value} value={ro.value}>{ro.label}</option>)}
                            </select>
                            {e.role === "custom" && (
                                <input className="input" aria-label="Custom role" placeholder="e.g. narrator" value={e.roleCustom ?? ""} onChange={(ev) => props.onChange({ roleCustom: ev.target.value })} />
                            )}
                        </div>
                    </Field>
                </div>
                <Field label="Short description" id="chDesc">
                    <textarea id="chDesc" className="input textarea" value={e.description ?? ""} placeholder="Who they are, in a line or two." onChange={(ev) => props.onChange({ description: ev.target.value })} />
                </Field>
            </Section>

            <Section title="Bio & notes">
                <MarkdownEditor
                    compact
                    label={`${props.name} bio`}
                    value={e.bio ?? ""}
                    onChange={(bio) => props.onChange({ bio })}
                    projectPath={props.projectPath}
                    onError={props.onError}
                    placeholder="Backstory, voice, wardrobe, references. Markdown with pictures."
                />
            </Section>

            <Section title={`Scenes (${r.scenes.length})`}>
                <SceneList refs={r.scenes} showDoc={props.multipleScripts} onJump={props.onJumpScene} onOpenPage={props.onOpenScenePage} empty="No scenes with this character yet." />
            </Section>
        </Page>
    );
}

/* ---------- location ---------- */

export function LocationPage(props: {
    name: string;
    entity: LocationEntity;
    scenes: SceneRef[];
    multipleScripts: boolean;
    projectPath: string;
    onChange: (patch: Partial<LocationEntity>) => void;
    onJumpScene: (ref: SceneRef) => void;
    onOpenScenePage: (ref: SceneRef) => void;
    onError: (msg: string) => void;
}) {
    const e = props.entity;
    return (
        <Page kicker="Location" wide>
            <h1 className="page-title page-title--static page-title--slug">{props.name}</h1>
            <p className="page-subtitle">
                {props.scenes.length === 0 ? "No scene uses this location yet." : `Used in ${props.scenes.length} ${props.scenes.length === 1 ? "scene" : "scenes"}.`}
            </p>
            <Section title="Description">
                <textarea className="input textarea" aria-label="Location description" value={e.description ?? ""} placeholder="What it looks, sounds and feels like." onChange={(ev) => props.onChange({ description: ev.target.value })} />
            </Section>
            <Section title="Pictures">
                <PictureGallery label="Location pictures" pictures={e.pictures ?? []} projectPath={props.projectPath} onChange={(pictures) => props.onChange({ pictures })} onError={props.onError} />
            </Section>
            <Section title="Notes">
                <MarkdownEditor compact label={`${props.name} notes`} value={e.notes ?? ""} onChange={(notes) => props.onChange({ notes })} projectPath={props.projectPath} onError={props.onError} placeholder="Scouting notes, permits, references." />
            </Section>
            <Section title="Scenes">
                <SceneList refs={props.scenes} showDoc={props.multipleScripts} onJump={props.onJumpScene} onOpenPage={props.onOpenScenePage} empty="No scene uses this location right now." />
            </Section>
        </Page>
    );
}

/* ---------- scene ---------- */

export function ScenePage(props: {
    scene: SceneView | null;
    docTitle: string;
    multipleScripts: boolean;
    entity: SceneEntity;
    projectPath: string;
    onChange: (patch: Partial<SceneEntity>) => void;
    onJump: () => void;
    onOpenLocation: (name: string) => void;
    onOpenCharacter: (name: string) => void;
    onError: (msg: string) => void;
}) {
    const s = props.scene;
    if (!s) {
        return (
            <Page kicker="Scene">
                <h1 className="page-title page-title--static">Scene not found</h1>
                <p className="page-subtitle">This scene is no longer in {props.docTitle}. Its notes stay saved in the project.</p>
            </Page>
        );
    }
    const e = props.entity;
    return (
        <Page
            kicker={`Scene ${s.num}${props.multipleScripts ? ` in ${props.docTitle}` : ""}`}
            toolbar={<button className="btn btn--ghost btn--sm" onClick={props.onJump}>Go to scene in script</button>}
        >
            <div className="scene-head">
                <span className="scene-head__num">{s.num}</span>
                <button className="page-title page-title--static page-title--heading" onClick={props.onJump} title="Go to this scene in the script">{s.heading}</button>
            </div>
            {s.synopsis ? <p className="scene-synopsis" title="From the = synopsis lines in the script">{s.synopsis}</p> : <p className="page-subtitle">No synopsis. Add a line starting with = under the heading in the script.</p>}

            <div className="scene-flags">
                <div className="setting-row setting-row--compact">
                    <div className="setting-row__text"><div className="setting-row__label">Work in progress</div></div>
                    <Toggle label="Work in progress" checked={Boolean(e.wip)} onChange={(v) => props.onChange({ wip: v })} />
                </div>
                <div className="setting-row setting-row--compact">
                    <div className="setting-row__text">
                        <div className="setting-row__label">Omitted</div>
                        <div className="setting-row__desc">Struck through in the outline and left out of "exclude omitted" statistics.</div>
                    </div>
                    <Toggle label="Omitted" checked={Boolean(e.omitted)} onChange={(v) => props.onChange({ omitted: v })} />
                </div>
            </div>

            <Section title="Details">
                <Field label="Short description" id="scDesc">
                    <textarea id="scDesc" className="input textarea" value={e.short_description ?? ""} placeholder="What happens here, in a line." onChange={(ev) => props.onChange({ short_description: ev.target.value })} />
                </Field>
                <Field label="Location" id="scLoc" hint="Defaults to the place in the heading.">
                    <div className="input-group">
                        <input id="scLoc" className="input" value={s.location} onChange={(ev) => props.onChange({ location: ev.target.value })} />
                        {s.location && <button className="btn btn--secondary btn--sm" onClick={() => props.onOpenLocation(s.location.toUpperCase())}>Open location</button>}
                    </div>
                </Field>
                <div className="field page-field">
                    <span className="field__label">Characters in this scene</span>
                    {s.characters.length ? (
                        <div className="chip-list chip-list--flush">
                            {[...new Set(s.characters.map((c) => c.toUpperCase()))].map((c) => (
                                <button key={c} className="chip chip--cue chip--button" onClick={() => props.onOpenCharacter(c)}>{c}</button>
                            ))}
                        </div>
                    ) : (
                        <p className="field__hint">Nobody speaks in this scene.</p>
                    )}
                </div>
                {!s.hasStableId && (
                    <p className="field__hint">This scene has no ID marker yet, so its details follow its position. Reordering scenes may shift them. The Scene menu's Add scene ID markers pins them (dragging in the Outline does it for you).</p>
                )}
            </Section>

            <Section title="Pictures">
                <PictureGallery label="Scene pictures" pictures={e.pictures ?? []} projectPath={props.projectPath} onChange={(pictures) => props.onChange({ pictures })} onError={props.onError} />
            </Section>

            <Section title="Notes">
                <MarkdownEditor compact label="Scene notes" value={e.notes ?? ""} onChange={(notes) => props.onChange({ notes })} projectPath={props.projectPath} onError={props.onError} placeholder="Blocking, intent, references. Markdown with pictures." />
            </Section>
        </Page>
    );
}

/* ---------- project information (title-page defaults) ---------- */

const MAIN_KEYS = ["title", "credit", "author", "source", "draft date", "contact", "copyright", "notes"];

export function ProjectInfoPage(props: {
    projectTitle: string;
    defaults: TitlePageDefaults;
    logline: string;
    genre: string;
    isSeries: boolean;
    onChange: (defaults: TitlePageDefaults) => void;
    onSummary: (patch: { logline?: string; genre?: string }) => void;
}) {
    const set = (key: string, value: string) => props.onChange({ ...props.defaults, [key]: value });
    const main = TITLE_PAGE_KEYS.filter((k) => MAIN_KEYS.includes(k.key));
    const extra = TITLE_PAGE_KEYS.filter((k) => !MAIN_KEYS.includes(k.key));
    const field = (k: (typeof TITLE_PAGE_KEYS)[number]) => (
        <Field key={k.key} label={k.label} id={`tp-${k.key}`} hint={k.hint}>
            {k.date ? (
                <div className="input-group">
                    <input
                        id={`tp-${k.key}`}
                        type="date"
                        className="input input--date"
                        value={/^\d{4}-\d{2}-\d{2}$/.test(props.defaults[k.key] ?? "") ? props.defaults[k.key] : ""}
                        onChange={(e) => set(k.key, e.target.value)}
                    />
                    <button
                        type="button"
                        className="btn btn--secondary btn--sm btn--icon"
                        aria-label="Pick a date"
                        title="Pick a date"
                        onClick={(e) => {
                            const input = (e.currentTarget.previousElementSibling as HTMLInputElement | null);
                            try {
                                input?.showPicker();
                            } catch {
                                input?.focus();
                            }
                        }}
                    >
                        <IconCalendar size={14} />
                    </button>
                    <button type="button" className="btn btn--secondary btn--sm" onClick={() => set(k.key, isoDate())}>Today</button>
                    {props.defaults[k.key] && (
                        <button type="button" className="btn btn--ghost btn--sm" onClick={() => set(k.key, "")}>Clear</button>
                    )}
                    <span className="field__hint date-preview">
                        {props.defaults[k.key] ? `Written as “${formatDraftDate(props.defaults[k.key])}”` : "Empty: new scripts get the date they are created"}
                    </span>
                </div>
            ) : k.multiline ? (
                <textarea id={`tp-${k.key}`} className="input textarea" value={props.defaults[k.key] ?? ""} onChange={(e) => set(k.key, e.target.value)} />
            ) : (
                <input id={`tp-${k.key}`} className="input" value={props.defaults[k.key] ?? ""} onChange={(e) => set(k.key, e.target.value)} />
            )}
        </Field>
    );
    return (
        <Page kicker="Project information" wide>
            <h1 className="page-title page-title--static">{props.projectTitle}</h1>
            <div className="callout">
                <b>Title-page defaults{props.isSeries ? " for every episode" : ""}.</b> A new {props.isSeries ? "episode" : "screenplay"} starts with these
                filled in. When you export, any key a script's own title page leaves out is taken from here. A value written in the script always wins.
            </div>
            <Section title="About">
                <Field label="Logline" id="piLogline" hint="Shown on the project list; not printed.">
                    <textarea id="piLogline" className="input textarea" value={props.logline} onChange={(e) => props.onSummary({ logline: e.target.value })} />
                </Field>
                <Field label="Genre" id="piGenre" hint="For your own reference; not printed.">
                    <input id="piGenre" className="input" value={props.genre} onChange={(e) => props.onSummary({ genre: e.target.value })} />
                </Field>
            </Section>
            <Section title="Title page">
                <div className="page-grid">{main.map(field)}</div>
            </Section>
            <Section title="More keys">
                <div className="page-grid">{extra.map(field)}</div>
            </Section>
        </Page>
    );
}

/* ---------- project settings ---------- */

export function ProjectSettingsPage(props: {
    settings: ProjectSettingsX;
    color: string;
    banner?: string;
    projectPath: string;
    globalAutosave: boolean;
    screenplayCount: number;
    onChange: (patch: Partial<ProjectSettingsX>) => void;
    /** App-wide values the project's "App setting" choices follow. */
    appInspections?: boolean;
    appTargetPages?: number;
    onColor: (color: string) => void;
    onBanner: (asset: string | undefined) => void;
    onError: (msg: string) => void;
    onOpenInfo: () => void;
}) {
    const s = props.settings;
    return (
        <Page kicker="Project settings">
            <h1 className="page-title page-title--static">Project settings</h1>
            <p className="page-subtitle">Saved inside this project. App-wide preferences live in Settings.</p>
            <Section title="Project">
                <SettingRow label="Project type" desc={s.type === "series" ? "Screenplays are listed as Episodes." : `A film keeps one screenplay${props.screenplayCount > 1 ? ` (this project has ${props.screenplayCount})` : ""}.`}>
                    <Segmented value={s.type} onChange={(type) => props.onChange({ type })} options={[{ value: "film", label: "Film" }, { value: "series", label: "Series" }]} />
                </SettingRow>
                <SettingRow label="Accent color" desc="The swatch next to this project in the project list.">
                    <input type="color" className="color-input" aria-label="Accent color" value={colorToHex(props.color)} onChange={(e) => props.onColor(e.target.value)} />
                </SettingRow>
                <SettingRow label="Banner" desc="A wide picture shown on this project in the project list. Drop, paste or pick an image.">
                    <PictureGallery
                        single
                        label="Banner"
                        pictures={props.banner ? [props.banner] : []}
                        projectPath={props.projectPath}
                        onChange={(p) => props.onBanner(p[0])}
                        onError={props.onError}
                    />
                </SettingRow>
                <SettingRow label="Title-page defaults" desc="Author, contact and the rest, shared by every screenplay.">
                    <button className="btn btn--secondary btn--sm" onClick={props.onOpenInfo}>Open Project information</button>
                </SettingRow>
            </Section>
            <Section title="Export">
                <SettingRow label="Page size" desc="Paper size for PDF export.">
                    <Segmented value={s.pageSize} onChange={(pageSize) => props.onChange({ pageSize })} options={[{ value: "letter", label: "US Letter" }, { value: "a4", label: "A4" }]} />
                </SettingRow>
                <SettingRow label="Scene numbers" desc="Print scene numbers in both margins of each heading.">
                    <Toggle label="Scene numbers in export" checked={s.sceneNumbers} onChange={(sceneNumbers) => props.onChange({ sceneNumbers })} />
                </SettingRow>
            </Section>
            <Section title="Writing">
                <SettingRow label="Script inspections" desc={`"App setting" follows Settings (currently ${props.appInspections !== false ? "on" : "off"}).`}>
                    <Segmented
                        value={s.inspections ?? "inherit"}
                        onChange={(inspections) => props.onChange({ inspections })}
                        options={[{ value: "inherit", label: "App setting" }, { value: "on", label: "On" }, { value: "off", label: "Off" }]}
                    />
                </SettingRow>
                <SettingRow label="Target length" desc={`Pages this script aims for, for the act-length check. Empty follows Settings (currently ${props.appTargetPages ? `${props.appTargetPages} pages` : "off"}); 0 turns it off here.`}>
                    <input
                        className="input setting-select"
                        type="number"
                        min={0}
                        max={400}
                        step={5}
                        aria-label="Target length in pages for this project"
                        placeholder="App setting"
                        value={s.targetPages ?? ""}
                        onChange={(e) => props.onChange({ targetPages: e.target.value === "" ? undefined : Math.max(0, Math.min(400, Math.round(Number(e.target.value) || 0))) })}
                    />
                </SettingRow>
                <SettingRow label="Live templates" desc="Templates for this project only, as abbr = text (same syntax as Settings → Editor). They win over your own and the built-ins.">
                    <textarea
                        className="input textarea--code"
                        rows={3}
                        spellCheck={false}
                        placeholder={"hq = INT. ${1:SHIP} - BRIDGE - ${2:NIGHT}$0"}
                        defaultValue={formatTemplates(s.liveTemplates)}
                        onBlur={(e) => props.onChange({ liveTemplates: parseTemplates(e.target.value) })}
                    />
                </SettingRow>
                <SettingRow label="Project dictionary" desc="Words the spellchecker accepts in this project only: invented names, places, jargon. One per line or separated by commas.">
                    <textarea
                        className="input textarea--code"
                        rows={3}
                        spellCheck={false}
                        placeholder={"Zarnak\nhyperlane"}
                        defaultValue={(s.words ?? []).join("\n")}
                        onBlur={(e) => props.onChange({ words: [...new Set(e.target.value.split(/[\n,]+/).map((w) => w.trim()).filter(Boolean))] })}
                    />
                </SettingRow>
            </Section>
            <Section title="Saving">
                <SettingRow label="Autosave" desc={`"App setting" follows Settings (currently ${props.globalAutosave ? "on" : "off"}).`}>
                    <Segmented
                        value={s.autosave}
                        onChange={(autosave) => props.onChange({ autosave })}
                        options={[{ value: "inherit", label: "App setting" }, { value: "on", label: "On" }, { value: "off", label: "Off" }]}
                    />
                </SettingRow>
            </Section>
        </Page>
    );
}
