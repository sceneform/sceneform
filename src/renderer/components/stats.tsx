// src/renderer/components/stats.tsx
// Full statistics. "Exclude omitted" now really recomputes every number
// (the old toggle only changed the scene list and left the totals alone).

import { useMemo, useState } from "react";
import { computeStats, type FountainParserDocument, type SceneView } from "../lib/fountain";
import { formatRuntime } from "../lib/format";
import { mergeStats, type ParsedScript } from "../lib/project";
import { IconChevronLeft } from "./icons";
import { EmptyState } from "./ui";

export function StatisticsView(props: {
    doc: FountainParserDocument;
    scenes: SceneView[];
    scriptTitle: string;
    /** Every screenplay in the project; the "All" scope appears when there is more than one. */
    allScripts: ParsedScript[];
    seriesLabel: string;
    onBack: () => void;
    onOpenCharacter: (name: string) => void;
    onOpenLocation: (name: string) => void;
}) {
    const [excludeOmitted, setExcludeOmitted] = useState(false);
    const [scope, setScope] = useState<"one" | "all">("one");
    const multi = props.allScripts.length > 1;
    const all = scope === "all" && multi;
    const stats = useMemo(
        () =>
            all
                ? mergeStats(props.allScripts.map((s) => computeStats(s.parsed, s.scenes, { excludeOmitted })))
                : computeStats(props.doc, props.scenes, { excludeOmitted }),
        [all, props.allScripts, props.doc, props.scenes, excludeOmitted],
    );
    const maxCues = stats.characters[0]?.cues || 1;
    const maxLoc = stats.locations[0]?.scenes || 1;
    const omittedCount = all ? props.allScripts.reduce((n, s) => n + s.scenes.filter((x) => x.omitted).length, 0) : props.scenes.filter((s) => s.omitted).length;

    return (
        <div className="workspace-pane">
            <div className="toolbar">
                <button className="btn btn--ghost btn--sm" onClick={props.onBack}><IconChevronLeft size={12} /> Back to script</button>
                <div className="toolbar__sep" />
                <span className="stats-toolbar__title">Statistics <span className="stats-toolbar__scope">{all ? `All ${props.seriesLabel.toLowerCase()}` : props.scriptTitle}</span></span>
                <div className="toolbar__spacer" />
                {multi && (
                    <>
                        <button className={`filter-chip ${!all ? "is-active" : ""}`} onClick={() => setScope("one")}>This screenplay</button>
                        <button className={`filter-chip ${all ? "is-active" : ""}`} onClick={() => setScope("all")}>All {props.seriesLabel.toLowerCase()} ({props.allScripts.length})</button>
                        <div className="toolbar__sep" />
                    </>
                )}
                <button className={`filter-chip ${!excludeOmitted ? "is-active" : ""}`} onClick={() => setExcludeOmitted(false)}>All scenes</button>
                <button
                    className={`filter-chip ${excludeOmitted ? "is-active" : ""}`}
                    onClick={() => setExcludeOmitted(true)}
                    disabled={omittedCount === 0}
                    title={omittedCount === 0 ? "No scenes are marked omitted" : undefined}
                >
                    Exclude omitted{omittedCount ? ` (${omittedCount})` : ""}
                </button>
            </div>
            <div className="stats-scroll">
                {/* The cover numbers a reader of a script report wants first, set as one line of figures, not a row of cards. */}
                <dl className="stats-summary">
                    <div className="stats-summary__item stats-summary__item--lead">
                        <dt>Pages (estimated)</dt>
                        <dd><span className="stats-summary__value">{stats.pages}</span><span className="stats-summary__sub">about {formatRuntime(stats.runtimeMinutes).replace(/^~/, "")} on screen</span></dd>
                    </div>
                    <div className="stats-summary__item">
                        <dt>Scenes</dt>
                        <dd><span className="stats-summary__value">{stats.scenes}</span><span className="stats-summary__sub">in {stats.locations.length} {stats.locations.length === 1 ? "location" : "locations"}</span></dd>
                    </div>
                    <div className="stats-summary__item">
                        <dt>Words</dt>
                        <dd><span className="stats-summary__value">{stats.words.toLocaleString()}</span><span className="stats-summary__sub">{stats.characters.length} speaking {stats.characters.length === 1 ? "character" : "characters"}</span></dd>
                    </div>
                    <div className="stats-summary__item">
                        <dt>Dialogue</dt>
                        <dd><span className="stats-summary__value">{stats.dialoguePercent}%</span><span className="stats-summary__sub">{100 - stats.dialoguePercent}% action</span></dd>
                    </div>
                </dl>

                <div className="stats-section">
                    <h2 className="stats-section__title">Dialogue and action</h2>
                    <div className="split-bar" role="img" aria-label={`${stats.dialoguePercent}% dialogue, ${100 - stats.dialoguePercent}% action`}>
                        <span className="split-bar__seg split-bar__seg--dialogue" style={{ width: `${stats.dialoguePercent}%` }} />
                        <span className="split-bar__seg split-bar__seg--action" style={{ width: `${100 - stats.dialoguePercent}%` }} />
                    </div>
                    <div className="split-bar__legend">
                        <span><i className="sw sw--dialogue" aria-hidden="true" />Dialogue, {stats.dialogueWords.toLocaleString()} words</span>
                        <span><i className="sw sw--action" aria-hidden="true" />Action, {stats.actionWords.toLocaleString()} words</span>
                    </div>
                </div>

                <div className="stats-section">
                    <h2 className="stats-section__title">Characters by cues</h2>
                    {stats.characters.length === 0 ? (
                        <EmptyState body="No speaking characters yet." />
                    ) : (
                        <table className="stats-table">
                            <thead><tr><th>Character</th><th className="num">Cues</th><th className="num">Words</th><th className="num">Scenes</th><th><span className="sr-only">Share of cues</span></th></tr></thead>
                            <tbody>
                                {stats.characters.map((c) => (
                                    <tr key={c.name} onClick={() => props.onOpenCharacter(c.name)} title="Open character page">
                                        <td className="stats-table__name">
                                            <button className="stats-table__open" onClick={(e) => { e.stopPropagation(); props.onOpenCharacter(c.name); }}>{c.name}</button>
                                        </td>
                                        <td className="num">{c.cues}</td>
                                        <td className="num">{c.words.toLocaleString()}</td>
                                        <td className="num">{c.scenes}</td>
                                        <td className="stats-table__bar"><span className="bar-row__track"><span className="bar-row__fill" style={{ width: `${(c.cues / maxCues) * 100}%` }} /></span></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>

                <div className="stats-section">
                    <h2 className="stats-section__title">Locations by scenes</h2>
                    {stats.locations.length === 0 ? (
                        <EmptyState body="No scene headings yet." />
                    ) : (
                        <table className="stats-table">
                            <thead><tr><th>Location</th><th className="num">Scenes</th><th><span className="sr-only">Share of scenes</span></th></tr></thead>
                            <tbody>
                                {stats.locations.map((l) => (
                                    <tr key={l.name} onClick={() => props.onOpenLocation(l.name)} title="Open location page">
                                        <td className="stats-table__name">
                                            <button className="stats-table__open" onClick={(e) => { e.stopPropagation(); props.onOpenLocation(l.name); }}>{l.name}</button>
                                        </td>
                                        <td className="num">{l.scenes}</td>
                                        <td className="stats-table__bar"><span className="bar-row__track"><span className="bar-row__fill" style={{ width: `${(l.scenes / maxLoc) * 100}%` }} /></span></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
        </div>
    );
}
