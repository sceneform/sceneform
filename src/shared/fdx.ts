// src/shared/fdx.ts
// Final Draft (.fdx) <-> Fountain. Pure TypeScript with no DOM, so the main process can
// import files and the renderer can export them. FDX is XML: <FinalDraft><Content>
// holds <Paragraph Type="Scene Heading|Action|Character|Parenthetical|Dialogue|
// Transition|Shot|General|...">, each with <Text Style="Bold+Italic+Underline"> runs;
// <DualDialogue> wraps the paragraphs of two simultaneous speeches; <TitlePage> holds
// its own paragraphs.

import type { FountainInlineRun, FountainParserDocument } from "../backend/fountain-js/fountain-parser";

/* ---------- XML helpers ---------- */

const decode = (s: string) =>
    s
        .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
        .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&");

const encode = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const attr = (tag: string, name: string): string | undefined => {
    const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i"));
    return m ? decode(m[1]) : undefined;
};

interface FdxParagraph {
    type: string;
    text: string; // with Fountain emphasis applied
    plain: string;
    number?: string;
    centered: boolean;
    newPage: boolean;
    dual?: 1 | 2;
    /** A script note attached to the paragraph (becomes a Fountain [[note]]). */
    note?: string;
    /** A synopsis attached to the paragraph (becomes `= synopsis`). */
    synopsis?: string;
    /** OSF title-page bookmark (Title, Author, Contact, Copyright, Draft). */
    bookmark?: string;
}

/** One title-page paragraph, as read from FDX or OSF. */
interface TitlePara {
    text: string;
    centered: boolean;
    bookmark?: string;
}

/** Text runs of one <Paragraph>, with Fountain emphasis markers. */
function paragraphText(inner: string): { text: string; plain: string } {
    let text = "";
    let plain = "";
    const re = /<Text\b([^>]*)\/>|<Text\b([^>]*)>([\s\S]*?)<\/Text>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(inner))) {
        if (m[1] !== undefined) continue; // <Text/> empty
        const style = (attr(`<Text ${m[2]}>`, "Style") ?? "").toLowerCase();
        const raw = decode(m[3].replace(/<[^>]+>/g, ""));
        plain += raw;
        if (!raw.trim()) {
            text += raw;
            continue;
        }
        // Keep the run's outer spaces outside the markers: "*word*", not "* word *".
        const lead = raw.match(/^\s*/)![0];
        const trail = raw.match(/\s*$/)![0];
        let core = raw.trim();
        if (style.includes("underline")) core = `_${core}_`;
        if (style.includes("italic")) core = `*${core}*`;
        if (style.includes("bold")) core = `**${core}**`;
        text += lead + core + trail;
    }
    return { text, plain };
}

function readParagraphs(xml: string, dual?: 1 | 2): FdxParagraph[] {
    const out: FdxParagraph[] = [];
    const re = /<Paragraph\b([^>]*)\/>|<Paragraph\b([^>]*)>([\s\S]*?)<\/Paragraph>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml))) {
        const head = `<Paragraph ${m[1] ?? m[2] ?? ""}>`;
        const notes = m[3] ? [...m[3].matchAll(/<SfNote>([\s\S]*?)<\/SfNote>/g)].map((n) => decode(n[1])) : [];
        const body = m[3]?.replace(/<SfNote>[\s\S]*?<\/SfNote>/g, "");
        const { text, plain } = body !== undefined ? paragraphText(body) : { text: "", plain: "" };
        out.push({
            type: (attr(head, "Type") ?? "Action").trim(),
            text,
            plain,
            number: attr(head, "Number"),
            centered: (attr(head, "Alignment") ?? "").toLowerCase() === "center",
            newPage: (attr(head, "StartsNewPage") ?? "").toLowerCase() === "yes",
            dual,
            note: notes.length ? notes.join(" ") : undefined,
        });
    }
    return out;
}

/** Content paragraphs in order, flattening <DualDialogue> (second speaker gets dual = 2). */
function contentParagraphs(content: string): FdxParagraph[] {
    const out: FdxParagraph[] = [];
    const re = /<DualDialogue\b[^>]*>([\s\S]*?)<\/DualDialogue>/gi;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content))) {
        out.push(...readParagraphs(content.slice(last, m.index)));
        const inner = readParagraphs(m[1]);
        let speaker = 0;
        for (const p of inner) {
            if (p.type === "Character") speaker++;
            out.push({ ...p, dual: speaker >= 2 ? 2 : 1 });
        }
        last = m.index + m[0].length;
    }
    out.push(...readParagraphs(content.slice(last)));
    return out;
}

/* ---------- FDX -> Fountain ---------- */

const HEADING = /^(INT|EXT|EST|INT\.?\/EXT|I\/E)[.\s]/i;
const isUpper = (s: string) => s === s.toUpperCase() && /\p{L}/u.test(s);

export interface FdxImport {
    fountain: string;
    title: string | null;
}

export function fdxToFountain(xml: string): FdxImport {
    if (!/<FinalDraft\b/i.test(xml)) throw new Error("That file isn't a Final Draft (.fdx) document.");
    // Script notes are nested inside paragraphs: keep their text as a marker the
    // paragraph reader turns into a Fountain [[note]], then drop the XML.
    const cleaned = xml
        .replace(/<!--[\s\S]*?-->/g, "")
        // Page headers/footers (the title page has its own, with a "." page-number label).
        .replace(/<HeaderAndFooter\b[\s\S]*?<\/HeaderAndFooter>/gi, "")
        .replace(/<ScriptNote\b[\s\S]*?<\/ScriptNote>/gi, (note) => {
            const text = [...note.matchAll(/<Text\b[^>]*>([\s\S]*?)<\/Text>/gi)].map((m) => decode(m[1].replace(/<[^>]+>/g, ""))).join(" ").replace(/\s+/g, " ").trim();
            return text ? `<SfNote>${encode(text)}</SfNote>` : "";
        });
    const content = cleaned.match(/<Content\b[^>]*>([\s\S]*?)<\/Content>/i)?.[1] ?? "";
    const titleXml = cleaned.match(/<TitlePage\b[^>]*>([\s\S]*?)<\/TitlePage>/i)?.[1] ?? "";
    const titleParas = titleXml ? readParagraphs(titleXml).map((p) => ({ text: p.text.trim(), centered: p.centered })).filter((p) => p.text) : [];
    return emitFountain(contentParagraphs(content), titleParas);
}

/* ---------- Fade In (Open Screenplay Format) -> Fountain ---------- */

/**
 * Fade In's .fadein is a zip around document.xml in Open Screenplay Format:
 * <document><paragraphs><para><style basestyle="Scene Heading"/><text bold="1">…</text></para>…
 * and <titlepage> with the same <para>s. Pass the XML (unzipped by the caller).
 */
export function osfToFountain(xml: string): FdxImport {
    if (!/<document\b/i.test(xml) || !/<paragraphs\b/i.test(xml)) throw new Error("That file isn't a Fade In / Open Screenplay Format document.");
    const read = (block: string): FdxParagraph[] => {
        const out: FdxParagraph[] = [];
        const re = /<para\b([^>]*)\/>|<para\b([^>]*)>([\s\S]*?)<\/para>/gi;
        let m: RegExpExecArray | null;
        let dualPending = false;
        while ((m = re.exec(block))) {
            const head = `<para ${m[1] ?? m[2] ?? ""}>`;
            const inner = m[3] ?? "";
            const styleTag = inner.match(/<style\b[^>]*>/i)?.[0] ?? "";
            // OSF 4.0 says basestyle, 2.x baseStyleName, 1.2 basestylename. A paragraph whose
            // <style> only names a style (name="Normal Text") is plain text.
            const type = attr(styleTag, "basestyle") ?? attr(styleTag, "basestylename") ?? attr(styleTag, "base") ?? attr(styleTag, "name") ?? "Action";
            let text = "";
            let plain = "";
            const tr = /<text\b([^>]*)\/>|<text\b([^>]*)>([\s\S]*?)<\/text>/gi;
            let t: RegExpExecArray | null;
            while ((t = tr.exec(inner))) {
                if (t[1] !== undefined) continue;
                const tag = `<text ${t[2]}>`;
                const raw = decode(t[3].replace(/<[^>]+>/g, ""));
                plain += raw;
                if (!raw.trim()) {
                    text += raw;
                    continue;
                }
                const lead = raw.match(/^\s*/)![0];
                const trail = raw.match(/\s*$/)![0];
                let core = raw.trim();
                if (attr(tag, "underline") === "1") core = `_${core}_`;
                if (attr(tag, "italic") === "1") core = `*${core}*`;
                if (attr(tag, "bold") === "1") core = `**${core}**`;
                text += lead + core + trail;
            }
            // Fade In marks the FIRST cue of a dual pair (<style basestyle="Character" dualdialogue="1"/>,
            // checked against the OSF 1.2/2.0/4.0 samples); the next cue is the one Fountain marks with ^.
            const dualAttr = attr(styleTag, "dualdialogue") ?? attr(head, "dualdialogue") ?? attr(head, "dual") ?? attr(styleTag, "dual");
            let dual: 2 | undefined;
            if (type === "Character") {
                if (dualPending) {
                    dual = 2;
                    dualPending = false;
                } else dualPending = dualAttr === "1" || dualAttr === "2";
            } else if (type !== "Dialogue" && type !== "Parenthetical" && type !== "Lyrics") dualPending = false;
            out.push({
                type,
                text,
                plain,
                number: attr(head, "number") ?? attr(head, "scene_number"),
                centered: (attr(head, "align") ?? attr(styleTag, "align") ?? "").toLowerCase() === "center",
                newPage: [attr(head, "page_break"), attr(styleTag, "page_break"), attr(styleTag, "pagebreakbefore"), attr(head, "pagebreakbefore")].includes("1"),
                dual,
                note: attr(head, "note")?.trim() || undefined,
                synopsis: attr(head, "synopsis")?.trim() || undefined,
                bookmark: attr(head, "bookmark"),
            });
        }
        return out;
    };
    const cleaned = xml.replace(/<!--[\s\S]*?-->/g, "");
    const body = cleaned.match(/<paragraphs\b[^>]*>([\s\S]*?)<\/paragraphs>/i)?.[1] ?? "";
    const titleXml = cleaned.match(/<titlepage\b[^>]*>([\s\S]*?)<\/titlepage>/i)?.[1] ?? "";
    let titleParas: TitlePara[] = read(titleXml)
        .map((p) => ({ text: p.text.trim(), centered: p.centered, bookmark: p.bookmark }))
        .filter((p) => p.text);
    if (!titleParas.length) {
        // OSF 1.2 keeps the title page in <info title=… written_by=… copyright=… contact=… drafts=…>.
        const info = cleaned.match(/<info\b[^>]*>/i)?.[0] ?? "";
        const pick = (k: string, bookmark: string, centered: boolean) => {
            const v = attr(info, k)?.trim();
            if (v) titleParas.push({ text: v, centered, bookmark });
        };
        pick("title", "Title", true);
        pick("written_by", "Credit", true);
        pick("author", "Author", true);
        pick("copyright", "Copyright", false);
        pick("drafts", "Draft", false);
        pick("contact", "Contact", false);
        titleParas = titleParas.filter((p) => p.text);
    }
    return emitFountain(read(body), titleParas);
}

/* ---------- shared emitter ---------- */

function emitFountain(paragraphs: FdxParagraph[], titleParas: TitlePara[]): FdxImport {
    const out: string[] = [];
    const title = titlePageEntries(titleParas);
    for (const [k, v] of title) {
        const lines = v.split("\n");
        out.push(lines.length > 1 ? `${k}:\n${lines.map((l) => `    ${l}`).join("\n")}` : `${k}: ${v}`);
    }
    if (title.length) out.push("");

    const blank = () => {
        if (out.length && out[out.length - 1] !== "") out.push("");
    };
    let prev = "";
    for (const p of paragraphs) {
        const t = p.text.replace(/\r/g, "").replace(/\t/g, " ").replace(/\n+$/, "");
        const plain = p.plain.trim();
        if (p.newPage && out.length) {
            blank();
            out.push("===");
            blank();
        }
        if (!plain) {
            if (p.type !== "Dialogue" && p.type !== "Parenthetical") blank();
            continue;
        }
        switch (p.type) {
            case "Scene Heading": {
                blank();
                const h = t.trim().toUpperCase();
                out.push(`${HEADING.test(plain) ? "" : "."}${h}${p.number ? ` #${p.number}#` : ""}`);
                blank();
                break;
            }
            case "Character": {
                blank();
                const name = t.trim();
                out.push(`${isUpper(plain) ? "" : "@"}${name}${p.dual === 2 ? " ^" : ""}`);
                break;
            }
            case "Parenthetical": {
                const s = t.trim();
                out.push(s.startsWith("(") ? s : `(${s})`);
                break;
            }
            case "Dialogue":
                out.push(...t.split("\n").map((l) => (l.trim() ? l.trim() : "  ")));
                break;
            case "Lyrics":
                out.push(...t.split("\n").map((l) => `~${l.trim()}`));
                break;
            case "Transition": {
                blank();
                const s = t.trim().toUpperCase();
                out.push(/TO:$/.test(s) ? s : `> ${s}`);
                blank();
                break;
            }
            case "New Act":
            case "Act Break": {
                blank();
                out.push(`# ${plain}`);
                blank();
                break;
            }
            case "End of Act":
                blank();
                out.push(`> ${t.trim()} <`);
                blank();
                break;
            case "Shot":
                blank();
                out.push(`!${t.trim().toUpperCase()}`);
                blank();
                break;
            default: {
                // Action, General, Cast List, Outline and anything unknown.
                if (prev === "Dialogue" || prev === "Parenthetical" || prev === "Character") blank();
                if (prev !== "Action" && prev !== "General") blank();
                const lines = t.split("\n").map((l) => l.trimEnd());
                for (const l of lines) {
                    if (p.centered) out.push(`> ${l.trim()} <`);
                    // A lone caps line would read as a cue or heading; force it to action.
                    else if (isUpper(l.trim()) && !/[.!?:]$/.test(l.trim()) && lines.length === 1) out.push(`!${l}`);
                    else if (HEADING.test(l.trim())) out.push(`!${l}`);
                    else out.push(l);
                }
                blank();
            }
        }
        if (p.synopsis) {
            blank();
            out.push(`= ${p.synopsis.replace(/\s*\n\s*/g, " ")}`);
            blank();
        }
        if (p.note) {
            // A note on its own line inside dialogue would end the speech; attach it inline there.
            const inline = p.type === "Dialogue" || p.type === "Parenthetical" || p.type === "Character";
            const note = `[[${p.note.replace(/\]\]/g, "] ]")}]]`;
            if (inline && out.length && out[out.length - 1] !== "") out[out.length - 1] += ` ${note}`;
            else {
                blank();
                out.push(note);
                blank();
            }
        }
        prev = p.type;
    }
    while (out.length && out[out.length - 1] === "") out.pop();
    const titleValue = title.find(([k]) => k === "Title")?.[1] ?? null;
    return { fountain: `${out.join("\n")}\n`, title: titleValue ? titleValue.replace(/[*_]/g, "").split("\n")[0] : null };
}

/** OSF title-page bookmarks → Fountain keys. */
const BOOKMARK_KEYS: Record<string, string> = {
    title: "Title",
    credit: "Credit",
    author: "Author",
    authors: "Authors",
    source: "Source",
    draft: "Draft date",
    "draft date": "Draft date",
    date: "Draft date",
    contact: "Contact",
    copyright: "Copyright",
    notes: "Notes",
};

const CREDIT = /^(written\s+by|screenplay\s+by|story\s+by|by|teleplay\s+by|created\s+by)$/i;

/**
 * Best-effort title page. OSF 4 tags paragraphs with bookmarks; otherwise (FDX and older
 * OSF) the page is free paragraphs, read by alignment and cue words: the centred block is
 * title, credit, author and source; the side block holds copyright, draft and contact.
 */
function titlePageEntries(paras: TitlePara[]): Array<[string, string]> {
    if (!paras.length) return [];
    const entries: Array<[string, string]> = [];
    const add = (k: string, v: string) => {
        const e = entries.find(([key]) => key === k);
        if (e) e[1] += `\n${v}`;
        else entries.push([k, v]);
    };
    const plain = (t: string) => t.replace(/[*_]/g, "").trim();
    const rest: TitlePara[] = [];
    for (const p of paras) {
        const key = p.bookmark ? BOOKMARK_KEYS[p.bookmark.trim().toLowerCase()] : undefined;
        if (key) add(key, p.text);
        else rest.push(p);
    }
    const centred = rest.filter((p) => p.centered);
    const side = centred.length ? rest.filter((p) => !p.centered) : rest.slice();
    const middle = centred.length ? centred : [];
    if (!middle.length && side.length && !entries.some(([k]) => k === "Title")) middle.push(side.shift()!);
    let expectAuthor = false;
    for (const p of middle) {
        const t = plain(p.text);
        if (!entries.some(([k]) => k === "Title")) add("Title", p.text);
        else if (CREDIT.test(t)) {
            add("Credit", p.text);
            expectAuthor = true;
        } else if (/^based on/i.test(t)) add("Source", p.text);
        else if (expectAuthor || !entries.some(([k]) => k === "Author")) {
            add("Author", p.text);
            expectAuthor = false;
        } else add("Source", p.text);
    }
    // Without alignment (all paragraphs on one side), "Written by" can still follow the title.
    for (let i = 0; i < side.length; i++) {
        const t = plain(side[i].text);
        if (!entries.some(([k]) => k === "Credit") && CREDIT.test(t)) {
            add("Credit", side[i].text);
            if (side[i + 1]) add("Author", side.splice(i + 1, 1)[0].text);
            side.splice(i--, 1);
        }
    }
    for (const p of side) {
        const t = plain(p.text);
        if (/^based on/i.test(t)) add("Source", p.text);
        else if (/copyright|©|\(c\)/i.test(t) && !entries.some(([k]) => k === "Copyright")) add("Copyright", p.text);
        else if (!entries.some(([k]) => k === "Draft date") && /draft|revision|\b(19|20)\d\d\b|\d{1,2}[./-]\d{1,2}[./-]\d{2,4}/i.test(t.split("\n")[0])) add("Draft date", p.text);
        else add("Contact", p.text);
    }
    // Keep the conventional order.
    const order = ["Title", "Credit", "Author", "Authors", "Source", "Draft date", "Copyright", "Contact", "Notes"];
    return entries.sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
}

/* ---------- Fountain -> FDX ---------- */

const styleOf = (r: FountainInlineRun) => [r.bold && "Bold", r.italic && "Italic", r.underline && "Underline"].filter(Boolean).join("+");

function textRuns(text: string, parseInline: (s: string) => FountainInlineRun[]): string {
    const runs = parseInline(text);
    if (!runs.length) return "<Text></Text>";
    return runs.map((r) => (styleOf(r) ? `<Text Style="${styleOf(r)}">${encode(r.text)}</Text>` : `<Text>${encode(r.text)}</Text>`)).join("");
}

const para = (type: string, body: string, extra = "") => `    <Paragraph Type="${type}"${extra}>\n      ${body}\n    </Paragraph>`;

/**
 * A Fountain document (as parsed) to FDX. Title page entries become centred title-page
 * paragraphs; notes, sections, synopses and boneyard text are left out (FDX has no
 * plain-text equivalent); sections of depth 1 become New Act paragraphs.
 */
export function fountainToFdx(doc: FountainParserDocument, parseInline: (s: string) => FountainInlineRun[]): string {
    const body: string[] = [];
    const lines = doc.lines;
    let pendingPage = false;
    let dualOpen = false;
    const flushDual = () => {
        if (dualOpen) body.push("    </DualDialogue>");
        dualOpen = false;
    };

    for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        const type = l.type ?? "blank";
        const text = (l.text ?? l.raw ?? "").trim();
        const pageAttr = pendingPage ? ' StartsNewPage="Yes"' : "";
        if (type === "page_break") {
            pendingPage = true;
            continue;
        }
        if (type !== "blank" && type !== "dialogue" && type !== "parenthetical" && type !== "lyrics" && type !== "character") flushDual();
        switch (type) {
            case "scene_heading": {
                const num = text.match(/#([^#]+)#\s*$/)?.[1];
                const heading = text.replace(/\s*#[^#]+#\s*$/, "").replace(/^\./, "");
                body.push(para("Scene Heading", textRuns(heading, parseInline), `${num ? ` Number="${encode(num)}"` : ""}${pageAttr}`));
                break;
            }
            case "action":
            case "shot":
                body.push(para(type === "shot" ? "Shot" : "Action", textRuns(text.replace(/^!/, ""), parseInline), pageAttr));
                break;
            case "centered":
                body.push(para("Action", textRuns(text.replace(/^>\s*/, "").replace(/\s*<$/, ""), parseInline), ` Alignment="Center"${pageAttr}`));
                break;
            case "character": {
                const isDual = /\^\s*$/.test(text);
                if (isDual && !dualOpen) {
                    // Wrap the previous speech (back to its cue) and this one.
                    let start = body.length - 1;
                    while (start >= 0 && !body[start].includes('Type="Character"')) start--;
                    if (start >= 0) {
                        body.splice(start, 0, "    <DualDialogue>");
                        dualOpen = true;
                    }
                } else if (!isDual) flushDual();
                const name = text.replace(/\s*\^\s*$/, "").replace(/^@/, "");
                body.push(para("Character", textRuns(name, parseInline), pageAttr));
                break;
            }
            case "parenthetical":
                body.push(para("Parenthetical", textRuns(text, parseInline)));
                break;
            case "dialogue":
                body.push(para("Dialogue", textRuns(text, parseInline)));
                break;
            case "lyrics":
                body.push(para("Lyrics", textRuns(text.replace(/^~\s*/, ""), parseInline)));
                break;
            case "transition":
                body.push(para("Transition", textRuns(text.replace(/^>\s*/, ""), parseInline), pageAttr));
                break;
            case "section":
                if ((l.depth ?? 1) === 1) body.push(para("New Act", textRuns(text.replace(/^#+\s*/, ""), parseInline), pageAttr));
                break;
            default:
                continue; // blank, notes, synopses, boneyard, markers, title page, special pages
        }
        pendingPage = false;
    }
    flushDual();

    const tp = doc.titleEntries ?? [];
    const pick = (k: string) => tp.find((e) => e.keyLower === k)?.value ?? "";
    const title: string[] = [];
    const centre = (v: string) => v.split("\n").forEach((line) => title.push(para("General", textRuns(line.trim(), parseInline), ' Alignment="Center"')));
    if (pick("title")) centre(pick("title"));
    for (const k of ["credit", "author", "authors", "source"]) if (pick(k)) centre(pick(k));
    for (const k of ["draft date", "contact", "copyright", "notes"]) if (pick(k)) pick(k).split("\n").forEach((line) => title.push(para("General", textRuns(line.trim(), parseInline))));

    return [
        '<?xml version="1.0" encoding="UTF-8" standalone="no" ?>',
        '<FinalDraft DocumentType="Script" Template="No" Version="5">',
        "  <Content>",
        ...body,
        "  </Content>",
        "  <TitlePage>",
        "    <Content>",
        ...title.map((t) => `  ${t}`),
        "    </Content>",
        "  </TitlePage>",
        "</FinalDraft>",
        "",
    ].join("\n");
}
