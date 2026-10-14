// src/renderer/components/settings.tsx
//
// The only settings surface. The old app had this screen plus a separate
// "settings modal" in the editor with different, non-working options, and
// nothing was persisted. Every switch here is saved and actually applied.

import type React from "react";
import { useState } from "react";
import { DEFAULT_SETTINGS, type AppInfo, type AppSettings } from "../../shared/bridge";
import { Titlebar } from "./chrome";
import { PALETTES } from "../lib/themes";
import { Modal, Segmented, SettingGroup, SettingRow, Toggle } from "./ui";
import { IconChevronLeft, IconDots, IconGlobe, IconMonitor, IconPen } from "./icons";
import { SHORTCUTS } from "../lib/shortcuts";
import { formatTemplates, parseTemplates } from "../editor/templates";

type Category = "global" | "ui" | "editor" | "stuff";

export function SettingsScreen(props: {
    settings: AppSettings;
    info: AppInfo | null;
    projectFolder: string;
    backLabel: string;
    onChange: (patch: Partial<AppSettings>) => void;
    onReset: () => void;
    onChangeFolder: () => void;
    onBack: () => void;
}) {
    const [category, setCategory] = useState<Category>("global");
    const [shortcutsOpen, setShortcutsOpen] = useState(false);
    const [confirmReset, setConfirmReset] = useState(false);
    const s = props.settings;

    const nav: Array<{ id: Category; label: string; icon: React.ReactElement }> = [
        { id: "global", label: "Global", icon: <IconGlobe /> },
        { id: "ui", label: "Interface", icon: <IconMonitor /> },
        { id: "editor", label: "Editor", icon: <IconPen /> },
        { id: "stuff", label: "More", icon: <IconDots /> },
    ];

    return (
        <div className="settings">
            <Titlebar
                left={
                    <button type="button" className="btn btn--ghost btn--sm titlebar__back" onClick={props.onBack}>
                        <IconChevronLeft /> {props.backLabel}
                    </button>
                }
            />
            <div className="settings__body">
                <nav className="settings__nav" aria-label="Settings categories">
                    {nav.map((n) => (
                        <button
                            key={n.id}
                            className={`settings__nav-item ${category === n.id ? "is-active" : ""}`}
                            aria-current={category === n.id}
                            onClick={() => setCategory(n.id)}
                        >
                            {n.icon}
                            {n.label}
                        </button>
                    ))}
                    <div className="settings__build">
                        {props.info ? `v${props.info.build}, Electron ${props.info.electron}` : ""}
                    </div>
                </nav>

                <div className="settings__content">
                    {category === "global" && (
                        <section className="settings__panel is-active">
                            <h1 className="settings__panel-title">Global</h1>
                            <p className="settings__panel-sub">Behaviour across every project.</p>
                            <SettingGroup title="Projects">
                            <SettingRow label="Project folder" desc={<span className="mono">{props.projectFolder || "Not set"}</span>}>
                                <button className="btn btn--secondary btn--sm" onClick={props.onChangeFolder}>Change…</button>
                            </SettingRow>
                            <SettingRow label="On launch" desc="What Sceneform shows when it starts.">
                                <select className="select setting-select" value={s.onLaunch} onChange={(e) => props.onChange({ onLaunch: e.target.value as AppSettings["onLaunch"] })}>
                                    <option value="projects">Show project list</option>
                                    <option value="last-project">Reopen last project</option>
                                </select>
                            </SettingRow>
                            </SettingGroup>
                            <SettingGroup title="Saving and time">
                            <SettingRow label="Autosave" desc="Saves a second after you stop typing. Off means you save with Ctrl+S.">
                                <Toggle label="Autosave" checked={s.autosave} onChange={(v) => props.onChange({ autosave: v })} />
                            </SettingRow>
                            <SettingRow label="Time tracking" desc="Counts active writing time only, and pauses after this much idle time.">
                                <select className="select setting-select" value={s.timeTrackingIdleMinutes} onChange={(e) => props.onChange({ timeTrackingIdleMinutes: Number(e.target.value) })}>
                                    <option value={2}>Pause after 2 minutes idle</option>
                                    <option value={5}>Pause after 5 minutes idle</option>
                                    <option value={10}>Pause after 10 minutes idle</option>
                                </select>
                            </SettingRow>
                            </SettingGroup>
                            <SettingGroup title="Updates">
                                <p className="settings-note">
                                    Sceneform has no automatic update checker and makes no network requests. New versions are downloaded by hand.
                                </p>
                            </SettingGroup>
                        </section>
                    )}

                    {category === "ui" && (
                        <section className="settings__panel is-active">
                            <h1 className="settings__panel-title">Interface</h1>
                            <p className="settings__panel-sub">How Sceneform looks.</p>
                            <SettingGroup title="Look">
                            <SettingRow label="Interface theme" desc="System follows your OS setting.">
                                <Segmented
                                    value={s.theme}
                                    onChange={(v) => props.onChange({ theme: v })}
                                    options={[
                                        { value: "dark", label: "Dark" },
                                        { value: "light", label: "Light" },
                                        { value: "system", label: "System" },
                                    ]}
                                />
                            </SettingRow>
                            <SettingRow label="Colour palette" desc="Community palettes. A palette sets its own dark or light mode.">
                                <select className="input" value={s.palette ?? "sceneform"} onChange={(e) => props.onChange({ palette: e.target.value })}>
                                    <option value="sceneform">Sceneform</option>
                                    {PALETTES.map((p) => (
                                        <option key={p.id} value={p.id}>{p.label}</option>
                                    ))}
                                </select>
                            </SettingRow>
                            <SettingRow label="UI text size" desc="Scales menus and panels. The script has its own zoom in the status bar.">
                                <input type="range" className="range-input" min={12} max={18} value={s.uiTextSize} onChange={(e) => props.onChange({ uiTextSize: Number(e.target.value) })} />
                                <span className="range-value">{s.uiTextSize}px</span>
                            </SettingRow>
                            </SettingGroup>
                            <SettingGroup title="Accessibility">
                            <SettingRow label="Reduce motion" desc="Turns off caret blinking and panel animations.">
                                <Toggle label="Reduce motion" checked={s.reduceMotion} onChange={(v) => props.onChange({ reduceMotion: v })} />
                            </SettingRow>
                            <SettingRow label="High-contrast focus outlines" desc="Thicker focus rings for keyboard navigation.">
                                <Toggle label="High-contrast focus outlines" checked={s.highContrastOutlines} onChange={(v) => props.onChange({ highContrastOutlines: v })} />
                            </SettingRow>
                            </SettingGroup>
                            <SettingGroup title="Advanced">
                            <SettingRow wide label="Custom CSS" desc="Applied on top of everything. Override any token, e.g. :root { --c-accent: #ff79c6; }">
                                <textarea
                                    className="input textarea--code"
                                    rows={5}
                                    spellCheck={false}
                                    defaultValue={s.customCss ?? ""}
                                    onBlur={(e) => e.target.value !== (s.customCss ?? "") && props.onChange({ customCss: e.target.value })}
                                    placeholder=":root { --c-accent: #ff79c6; }"
                                />
                            </SettingRow>
                            </SettingGroup>
                        </section>
                    )}

                    {category === "editor" && (
                        <section className="settings__panel is-active">
                            <h1 className="settings__panel-title">Editor</h1>
                            <p className="settings__panel-sub">How the screenplay editor behaves.</p>
                            <SettingGroup title="The page">
                            <SettingRow label="Show notes" desc={<>Shows <code className="mono">[[notes]]</code> dimmed and italic. Off hides them from view; they stay in the file.</>}>
                                <Toggle label="Show notes" checked={s.showHiddenNotes} onChange={(v) => props.onChange({ showHiddenNotes: v })} />
                            </SettingRow>
                            <SettingRow label="Syntax highlight intensity" desc="How strongly headings, characters and dialogue are colored.">
                                <Segmented
                                    value={s.syntaxIntensity}
                                    onChange={(v) => props.onChange({ syntaxIntensity: v })}
                                    options={[
                                        { value: "subtle", label: "Subtle" },
                                        { value: "vivid", label: "Vivid" },
                                    ]}
                                />
                            </SettingRow>
                            <SettingRow label="Auto-continuation" desc="Enter after a scene heading or transition adds the blank line Fountain needs. Never types words for you.">
                                <Toggle label="Auto-continuation" checked={s.autoIndentation} onChange={(v) => props.onChange({ autoIndentation: v })} />
                            </SettingRow>
                            <SettingRow label="Live outline" desc="Updates the outline, characters and stats as you type. Off updates them when you pause.">
                                <Toggle label="Live outline" checked={s.liveReparse} onChange={(v) => props.onChange({ liveReparse: v })} />
                            </SettingRow>
                            </SettingGroup>
                            <SettingGroup title="Writing aids">
                            <SettingRow label="Script inspections" desc="Underline likely cue typos, cues with no dialogue, headings with no time of day, long action blocks, missing (CONT'D), parentheticals that are really action, long scenes and more. Alt+Enter on a line shows fixes and actions; Ctrl/Cmd+6 lists them all.">
                                <Toggle label="Script inspections" checked={s.inspections !== false} onChange={(v) => props.onChange({ inspections: v })} />
                            </SettingRow>
                            <SettingRow label="Target length" desc="Pages you're aiming for. Acts (top-level # sections) that run well over or under their share (a quarter, a half, a quarter for three acts; even otherwise) show up in Problems. Leave at 0 to turn this off.">
                                <input
                                    className="input setting-select"
                                    type="number"
                                    min={0}
                                    max={400}
                                    step={5}
                                    aria-label="Target length in pages"
                                    value={s.targetPages ?? 0}
                                    onChange={(e) => props.onChange({ targetPages: Math.max(0, Math.min(400, Math.round(Number(e.target.value) || 0))) })}
                                />
                            </SettingRow>
                            <SettingRow wide label="Live templates" desc="Type an abbreviation alone on a line and press Tab, or press Ctrl/Cmd+J to pick one. Built in: int, ext, ie, intn, extn, fi, fo, ct, dt, sct, fb, eofb, mont, eom, beat, the end, phone, dual. Add your own as abbr = text: $1, $2… are fields you Tab through (${1:default} pre-fills one), $0 is where the cursor ends, \n starts a new line.">
                                <textarea
                                    className="input textarea--code"
                                    rows={5}
                                    spellCheck={false}
                                    placeholder={"wt = WE SEE $0\ntxt = ${1:NAME} (V.O.)\\n(texting)\\n$2$0"}
                                    defaultValue={formatTemplates(s.liveTemplates)}
                                    onBlur={(e) => props.onChange({ liveTemplates: parseTemplates(e.target.value) })}
                                />
                            </SettingRow>
                            </SettingGroup>
                            <SettingGroup title="Spelling">
                            <SettingRow label="Spellcheck" desc={`US English plus screenwriting terms. Hover a flagged word for suggestions. Your dictionary: ${(s.userWords ?? []).length} words.`}>
                                <Toggle label="Spellcheck" checked={s.spellcheck !== false} onChange={(v) => props.onChange({ spellcheck: v })} />
                            </SettingRow>
                            <SettingRow wide label="Your dictionary" desc="One word per line. Words added from the editor land here.">
                                <textarea
                                    className="input textarea--code"
                                    rows={4}
                                    spellCheck={false}
                                    defaultValue={(s.userWords ?? []).join("\n")}
                                    onBlur={(e) => {
                                        const words = [...new Set(e.target.value.split(/\r?\n/).map((w) => w.trim()).filter(Boolean))];
                                        props.onChange({ userWords: words });
                                    }}
                                />
                            </SettingRow>
                            </SettingGroup>
                            <SettingGroup title="Authorship">
                            <SettingRow label="Your name" desc="Stamped on the lines and canvas cards you write, for the authorship (blame) view. View → Authorship.">
                                <input
                                    className="input"
                                    defaultValue={s.authorName ?? ""}
                                    placeholder="e.g. Axelle"
                                    onBlur={(e) => e.target.value.trim() !== (s.authorName ?? "") && props.onChange({ authorName: e.target.value.trim() })}
                                />
                            </SettingRow>
                            </SettingGroup>
                        </section>
                    )}

                    {category === "stuff" && (
                        <section className="settings__panel is-active">
                            <h1 className="settings__panel-title">More</h1>
                            <p className="settings__panel-sub">Shortcuts, version and reset.</p>
                            <SettingGroup title="Help">
                            <SettingRow label="Keyboard shortcuts" desc="Every shortcut Sceneform supports.">
                                <button className="btn btn--secondary btn--sm" onClick={() => setShortcutsOpen(true)}>View shortcuts</button>
                            </SettingRow>
                            </SettingGroup>
                            <SettingGroup title="About">
                                <dl className="settings-about">
                                    <dt>Version</dt>
                                    <dd>{props.info ? props.info.build : "…"}</dd>
                                    <dt>Copyright</dt>
                                    <dd>© 2026 Blasius Nafiri Marvin. All rights reserved.</dd>
                                    <dt>Fonts</dt>
                                    <dd>Courier Prime and Scoutie Sans, SIL Open Font License</dd>
                                    <dt>Fountain parser</dt>
                                    <dd>sceneformfountain, GPL-3.0</dd>
                                </dl>
                            </SettingGroup>
                            <SettingGroup title="Reset">
                            <SettingRow label="Reset all settings" desc="Restores every setting to its default. Projects are never touched.">
                                <button className="btn btn--danger btn--sm" onClick={() => setConfirmReset(true)}>Reset</button>
                            </SettingRow>
                            </SettingGroup>
                        </section>
                    )}
                </div>
            </div>

            <Modal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} labelledBy="shortcutsTitle" className="shortcuts-modal">
                <h2 className="modal__title" id="shortcutsTitle">Keyboard shortcuts</h2>
                <div className="shortcuts-grid">
                    {[SHORTCUTS.slice(0, Math.ceil(SHORTCUTS.length / 2)), SHORTCUTS.slice(Math.ceil(SHORTCUTS.length / 2))].map((col, i) => (
                        <div key={i}>
                            {col.map((sc) => (
                                <div className="shortcut-row" key={sc.description}>
                                    <span>{sc.description}</span>
                                    <span>{sc.keys.map((k) => <kbd key={k}>{k}</kbd>)}</span>
                                </div>
                            ))}
                        </div>
                    ))}
                </div>
                <div className="modal__actions">
                    <button className="btn btn--primary btn--full" onClick={() => setShortcutsOpen(false)}>Close</button>
                </div>
            </Modal>

            <Modal open={confirmReset} onClose={() => setConfirmReset(false)} labelledBy="resetTitle">
                <h2 className="modal__title" id="resetTitle">Reset all settings?</h2>
                <p className="modal__body">Every setting goes back to its default. Your projects and project folder stay as they are.</p>
                <div className="modal__actions">
                    <button className="btn btn--secondary" onClick={() => setConfirmReset(false)}>Cancel</button>
                    <button
                        className="btn btn--danger"
                        onClick={() => {
                            props.onReset();
                            setConfirmReset(false);
                        }}
                    >
                        Reset
                    </button>
                </div>
            </Modal>
        </div>
    );
}

export { DEFAULT_SETTINGS };
