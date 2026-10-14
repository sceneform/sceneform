// preview.tsx
//
// Live preview: the active screenplay laid out in industry format, on
// page-sized sheets. Geometry matches src/backend/pdf-export.ts: a 612 x 792
// sheet (US Letter at 72 dpi) with 12px Courier, so one character is 0.1 inch,
// 1.5" left / 1" right margins and 54 lines of body text per page. The page is
// then zoomed to fit the pane. It is an approximation of the PDF, clearly
// labelled as a preview. A speech broken by a page gets (MORE) and NAME (CONT'D),
// as production drafts do (the PDF export doesn't yet); dual dialogue (^) prints
// as two columns side by side.

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { parseInline, type FountainLineType, type FountainParserDocument } from "../lib/fountain";
import { titleKeyLabel } from "../../backend/title-page";
import { Segmented } from "./ui";

const LINES_PER_PAGE = 54;

type Kind = "scene_heading" | "action" | "character" | "parenthetical" | "dialogue" | "lyrics" | "transition" | "centered" | "shot";

const WIDTH: Record<Kind, number> = {
    scene_heading: 60,
    action: 60,
    shot: 60,
    centered: 60,
    character: 38,
    parenthetical: 30,
    dialogue: 35,
    lyrics: 35,
    transition: 20,
};

const SPACE_BEFORE: Record<Kind, number> = {
    scene_heading: 2,
    action: 1,
    shot: 1,
    centered: 1,
    character: 1,
    parenthetical: 0,
    dialogue: 0,
    lyrics: 0,
    transition: 1,
};

interface Run {
    text: string;
    bold: boolean;
    italic: boolean;
    underline: boolean;
}

interface Block {
    kind: Kind;
    line: number;
    lines: Run[][];
    before: number;
    sceneNumber?: string;
    dialogueGroup?: number;
}

/** Narrower columns for the two halves of a dual-dialogue pair (30 characters each). */
const DUAL_WIDTH: Partial<Record<Kind, number>> = { character: 22, parenthetical: 24, dialogue: 27, lyrics: 27 };

/** Two speeches printed side by side (the second cue ends in ^). */
interface DualItem {
    kind: "dual";
    line: number;
    left: Block[];
    right: Block[];
    /** One empty entry per printed line, so pagination can measure it like a block. */
    lines: Run[][];
    before: number;
}

/** A %%% ... %%% page: always alone on its page, text placed on a 3x3 grid. */
interface SpecialItem {
    kind: "special";
    line: number;
    items: Array<{ position: string; text: string }>;
}
type PageItem = Block | SpecialItem | DualItem | { kind: "gap"; n: number };
type FlowItem = Block | SpecialItem | DualItem | "page-break";

/** Removes inline [[notes]], boneyard /* *\/ and Sceneform-only scene tags from printed text. */
function printable(text: string): string {
    return text
        .replace(/\[\[[\s\S]*?\]\]/g, "")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\s+#[^#\s]+#\s*$/, "")
        .replace(/\s{2,}/g, " ")
        .trim();
}

function runsFor(text: string): Run[] {
    try {
        const runs = parseInline(text) as Run[];
        return runs.length ? runs : [{ text, bold: false, italic: false, underline: false }];
    } catch {
        return [{ text, bold: false, italic: false, underline: false }];
    }
}

/** Word-wraps styled runs to a column width, keeping each character's style. */
function wrapRuns(runs: Run[], width: number): Run[][] {
    const chars: Array<{ ch: string; r: Run }> = [];
    for (const r of runs) for (const ch of r.text) chars.push({ ch, r });
    const lines: Array<typeof chars> = [];
    let start = 0;
    while (start < chars.length) {
        while (start < chars.length && chars[start].ch === " ") start++;
        if (start >= chars.length) break;
        let end = Math.min(chars.length, start + width);
        if (end < chars.length) {
            let space = -1;
            for (let i = end; i > start; i--) if (chars[i]?.ch === " ") { space = i; break; }
            if (space > start) end = space;
        }
        lines.push(chars.slice(start, end));
        start = end;
    }
    if (!lines.length) return [[]];
    return lines.map((cs) => {
        const out: Run[] = [];
        for (const { ch, r } of cs) {
            const prev = out[out.length - 1];
            if (prev && prev.bold === r.bold && prev.italic === r.italic && prev.underline === r.underline) prev.text += ch;
            else out.push({ text: ch, bold: r.bold, italic: r.italic, underline: r.underline });
        }
        return out;
    });
}

export function buildBlocks(doc: FountainParserDocument): FlowItem[] {
    const sceneNumbers = new Map<number, string>();
    for (const s of doc.scenes) sceneNumbers.set(s.line, s.number);
    const out: FlowItem[] = [];
    let group = 0;
    let inGroup = false;
    const special = new Map((doc.specialPages ?? []).map((p) => [p.line, p]));
    // Line -> its dual-dialogue block (index into doc.blocks) and side.
    const dualOf = new Map<number, { block: number; side: "left" | "right" }>();
    (doc.blocks ?? []).forEach((b, bi) => {
        if (b.dual) for (let l = b.first; l <= b.last; l++) dualOf.set(l, { block: bi, side: b.dual });
    });
    let dual: DualItem | null = null;
    let dualBlock = -1;
    for (const l of doc.lines) {
        const type = (l.type ?? "blank") as FountainLineType;
        if (type === "special_page") {
            const page = special.get(l.index);
            if (page) out.push({ kind: "special", line: page.line, items: page.items });
            inGroup = false;
            continue;
        }
        if (type === "page_break") {
            out.push("page-break");
            inGroup = false;
            continue;
        }
        if (!(type in WIDTH)) {
            if (type === "blank") inGroup = false;
            continue;
        }
        const kind = type as Kind;
        let text = printable(l.text ?? l.raw);
        if (!text) continue;
        if (kind === "scene_heading" || kind === "character" || kind === "transition") text = text.toUpperCase();
        if (kind === "character") text = text.replace(/^@/, "").replace(/\s*\^$/, "");
        if (kind === "centered") text = text.replace(/^>\s*/, "").replace(/\s*<$/, "");
        if (kind === "transition") text = text.replace(/^>\s*/, "");
        if (kind === "character") {
            group += 1;
            inGroup = true;
        }
        const isDialoguePart = kind === "character" || kind === "parenthetical" || kind === "dialogue" || kind === "lyrics";
        const d = isDialoguePart ? dualOf.get(l.index) : undefined;
        const block: Block = {
            kind,
            line: l.index,
            lines: wrapRuns(runsFor(text), (d && DUAL_WIDTH[kind]) || WIDTH[kind]),
            before: SPACE_BEFORE[kind],
            sceneNumber: kind === "scene_heading" ? sceneNumbers.get(l.index) : undefined,
            dialogueGroup: isDialoguePart && inGroup ? group : undefined,
        };
        if (d) {
            // The left speech opens the pair; the right one (the ^ cue) joins it.
            if (d.side === "left" && d.block !== dualBlock && (!dual || dual.right.length > 0)) {
                dual = { kind: "dual", line: l.index, left: [], right: [], lines: [], before: SPACE_BEFORE.character };
                out.push(dual);
            }
            dualBlock = d.block;
            if (dual) {
                (d.side === "left" ? dual.left : dual.right).push(block);
                const height = (col: Block[]) => col.reduce((n, b) => n + b.lines.length, 0);
                dual.lines = Array.from({ length: Math.max(height(dual.left), height(dual.right)) }, () => []);
                continue;
            }
        } else if (dual && kind !== "parenthetical" && kind !== "dialogue" && kind !== "lyrics") {
            dual = null;
            dualBlock = -1;
        }
        out.push(block);
    }
    return out;
}

export function paginate(items: FlowItem[]): PageItem[][] {
    const pages: PageItem[][] = [[]];
    let used = 0;
    const newPage = () => {
        pages.push([]);
        used = 0;
    };
    // The speech in progress, so a page break inside it gets (MORE) and NAME (CONT'D).
    let cue: { group: number; name: string; line: number } | null = null;
    const plain = (b: Block) => b.lines.map((l) => l.map((r) => r.text).join("")).join(" ");
    const text = (t: string): Run[][] => [[{ text: t, bold: false, italic: false, underline: false }]];
    /** Break the page inside a speech: (MORE) at the bottom, the cue again with (CONT'D) on top. */
    const breakInSpeech = (group: number | undefined) => {
        const inSpeech = cue && group !== undefined && group === cue.group;
        if (inSpeech) pages[pages.length - 1].push({ kind: "character", line: cue!.line, lines: text("(MORE)"), before: 0 });
        newPage();
        if (inSpeech) {
            const name = /\(CONT['’]?D\)/i.test(cue!.name) ? cue!.name : `${cue!.name} (CONT'D)`;
            pages[pages.length - 1].push({ kind: "character", line: cue!.line, lines: text(name), before: 0 });
            used = 1;
        }
    };
    for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it === "page-break") {
            if (used > 0) newPage();
            continue;
        }
        if (it.kind === "special") {
            if (used > 0) newPage();
            pages[pages.length - 1].push(it);
            newPage();
            continue;
        }
        if (it.kind === "character" && it.dialogueGroup !== undefined) cue = { group: it.dialogueGroup, name: plain(it), line: it.line };
        else if (it.kind !== "dual" && it.dialogueGroup === undefined) cue = null;
        const gap = used === 0 ? 0 : it.before;
        let need = gap + it.lines.length;
        // Leave room for (MORE) when a speech continues past this page.
        if (it.kind !== "dual" && it.kind !== "character" && cue && it.dialogueGroup === cue.group) need += 1;
        // Keep a character cue with the first line of what they say.
        if (it.kind === "character") {
            const next = items[i + 1];
            if (next && next !== "page-break" && next.kind !== "special" && next.kind !== "dual" && next.dialogueGroup === it.dialogueGroup) need += Math.min(2, next.lines.length);
        }
        // Never leave a scene heading alone at the bottom of a page.
        if (it.kind === "scene_heading") need += 2;
        if (used + need > LINES_PER_PAGE && used > 0) {
            // Long action paragraphs split across pages instead of leaving a big hole.
            if ((it.kind === "action" || it.kind === "dialogue") && it.lines.length > 4 && LINES_PER_PAGE - used - gap >= 2) {
                const speech = it.kind === "dialogue" && !!cue && it.dialogueGroup === cue.group;
                const fit = LINES_PER_PAGE - used - gap - (speech ? 1 : 0);
                pages[pages.length - 1].push({ kind: "gap", n: gap }, { ...it, lines: it.lines.slice(0, fit) });
                breakInSpeech(speech ? it.dialogueGroup : undefined);
                pages[pages.length - 1].push({ ...it, lines: it.lines.slice(fit), before: 0 });
                used += it.lines.length - fit;
                continue;
            }
            breakInSpeech(it.kind === "character" || it.kind === "dual" ? undefined : it.dialogueGroup);
        }
        const g = used === 0 ? 0 : it.before;
        if (g) pages[pages.length - 1].push({ kind: "gap", n: g });
        pages[pages.length - 1].push(it);
        used += g + it.lines.length;
    }
    return pages.filter((p, i) => p.length > 0 || i === 0);
}

function RunLine({ runs }: { runs: Run[] }) {
    return (
        <div className="pv-line">
            {runs.length === 0
                ? "\u00a0"
                : runs.map((r, i) => {
                      let node: ReactNode = r.text;
                      if (r.underline) node = <u>{node}</u>;
                      if (r.italic) node = <em>{node}</em>;
                      if (r.bold) node = <strong>{node}</strong>;
                      return <span key={i}>{node}</span>;
                  })}
        </div>
    );
}

function TitlePage({ entries }: { entries: Array<{ key: string; value: string }> }) {
    const get = (...keys: string[]) => entries.filter((e) => keys.includes(e.key));
    const lines = (v: string) => v.split("\n").map((l, i) => <RunLine key={i} runs={runsFor(l)} />);
    const center = [...get("title"), ...get("credit"), ...get("author", "authors"), ...get("source")];
    const bottomLeft = get("contact", "contact info", "notes", "bl");
    const bottomRight = get("draft date", "date", "revision", "copyright", "br");
    return (
        <div className="pv-page pv-page--title">
            <div className="pv-title__top">
                <div className="pv-title__corner">{get("tl").map((e, i) => <div key={i}>{lines(e.value)}</div>)}</div>
                <div className="pv-title__corner pv-title__corner--center">{get("tc").map((e, i) => <div key={i}>{lines(e.value)}</div>)}</div>
                <div className="pv-title__corner pv-title__corner--right">{get("tr").map((e, i) => <div key={i}>{lines(e.value)}</div>)}</div>
            </div>
            <div className="pv-title__center">
                {center.map((e, i) => (
                    <div key={i} className={e.key === "title" ? "pv-title__title" : "pv-title__by"}>
                        {lines(e.value)}
                    </div>
                ))}
                {get("cc").map((e, i) => (
                    <div key={`cc${i}`} className="pv-title__by">{lines(e.value)}</div>
                ))}
            </div>
            <div className="pv-title__bottom">
                <div>{bottomLeft.map((e, i) => <div key={i} className="pv-title__block">{lines(e.value)}</div>)}</div>
                <div className="pv-title__right">{bottomRight.map((e, i) => <div key={i} className="pv-title__block">{lines(e.value)}</div>)}</div>
            </div>
        </div>
    );
}

const Pages = memo(function Pages(props: { doc: FountainParserDocument; titleEntries: Array<{ key: string; value: string }>; sceneNumbers: boolean }) {
    const pages = useMemo(() => paginate(buildBlocks(props.doc)), [props.doc]);
    return (
        <>
            {props.titleEntries.length > 0 && <TitlePage entries={props.titleEntries} />}
            {pages.map((items, p) =>
                items[0]?.kind === "special" ? (
                    <div className="pv-page pv-page--special" key={p} data-line={(items[0] as SpecialItem).line}>
                        {(items[0] as SpecialItem).items.map((it, i) => (
                            <div key={i} className={`pv-special pv-special--${it.position}`}>
                                {it.text.split("\n").map((l, j) => <RunLine key={j} runs={runsFor(l)} />)}
                            </div>
                        ))}
                    </div>
                ) : (
                <div className="pv-page" key={p}>
                    {p > 0 && <div className="pv-page__num">{p + 1}.</div>}
                    {items.map((it, i) =>
                        it.kind === "gap" ? (
                            <div key={i} style={{ height: `${(it as { n: number }).n * 12}px` }} />
                        ) : it.kind === "dual" ? (
                            <div key={i} className="pv-el pv-el--dual" data-line={it.line}>
                                {[it.left, it.right].map((col, c) => (
                                    <div key={c} className="pv-dual__col">
                                        {col.map((b, j) => (
                                            <div key={j} className={`pv-el pv-el--${b.kind}`} data-line={b.line}>
                                                {b.lines.map((runs, k) => <RunLine key={k} runs={runs} />)}
                                            </div>
                                        ))}
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div
                                key={i}
                                className={`pv-el pv-el--${it.kind}`}
                                data-line={(it as Block).line}
                            >
                                {props.sceneNumbers && (it as Block).sceneNumber && (
                                    <>
                                        <span className="pv-scene-num pv-scene-num--left">{(it as Block).sceneNumber}</span>
                                        <span className="pv-scene-num pv-scene-num--right">{(it as Block).sceneNumber}</span>
                                    </>
                                )}
                                {(it as Block).lines.map((runs, j) => <RunLine key={j} runs={runs} />)}
                            </div>
                        ),
                    )}
                </div>
                ),
            )}
        </>
    );
});

export function LivePreview(props: {
    doc: FountainParserDocument;
    /** Title-page entries after project defaults are applied, in print order. */
    titleEntries: Array<{ key: string; value: string }>;
    sceneNumbers: boolean;
    /** Line of the scene the cursor is in, or -1. */
    sceneLine: number;
    paper: "white" | "dark";
    onPaper: (p: "white" | "dark") => void;
    onClose: () => void;
}) {
    const host = useRef<HTMLDivElement>(null);
    const [zoom, setZoom] = useState(0.8);

    useLayoutEffect(() => {
        const el = host.current;
        if (!el) return;
        const fit = () => setZoom(Math.max(0.35, Math.min(1.5, (el.clientWidth - 40) / 612)));
        fit();
        const ro = new ResizeObserver(fit);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    // Follow the cursor's scene.
    useEffect(() => {
        const el = host.current;
        if (!el || props.sceneLine < 0) return;
        const target = el.querySelector<HTMLElement>(`.pv-el--scene_heading[data-line="${props.sceneLine}"]`);
        if (!target) return;
        const top = target.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - 24;
        el.scrollTo({ top, behavior: document.documentElement.classList.contains("reduce-motion") ? "auto" : "smooth" });
    }, [props.sceneLine, props.doc]);

    return (
        <section className="preview" aria-label="Live preview">
            <div className="toolbar preview__bar">
                <span>Preview</span>
                <span className="toolbar__note">approximate pagination</span>
                <div className="toolbar__spacer" />
                <Segmented
                    value={props.paper}
                    onChange={props.onPaper}
                    options={[
                        { value: "white", label: "White" },
                        { value: "dark", label: "Dark" },
                    ]}
                />
                <button className="btn btn--ghost btn--sm" onClick={props.onClose} aria-label="Close preview" title="Close preview">✕</button>
            </div>
            <div className={`preview__scroll preview--${props.paper}`} ref={host}>
                <div className="preview__pages" style={{ zoom }}>
                    <Pages doc={props.doc} titleEntries={props.titleEntries} sceneNumbers={props.sceneNumbers} />
                </div>
            </div>
        </section>
    );
}

/** Title-page entries for the preview: the script's own, then inherited project defaults. */
export function previewTitleEntries(
    doc: FountainParserDocument,
    inherited: Array<[string, string]>,
): Array<{ key: string; value: string }> {
    const own = doc.titleEntries.map((e) => ({ key: e.keyLower, value: e.value }));
    return [...own, ...inherited.map(([key, value]) => ({ key, value }))].map((e) => ({ ...e, label: titleKeyLabel(e.key) }));
}
