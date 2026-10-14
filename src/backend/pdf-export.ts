// pdf-export.ts

import {
    PDFDocument,
    StandardFonts,
    rgb,
    degrees,
    PDFFont,
    PDFPage,
} from "pdf-lib";
import { parseInline, parseScreenplay } from "./screenplay.js";
import { extractCleanFountain } from "./sfp-archive.js";
import type { FountainLine } from "./fountain-js/fountain-parser.js";

export interface PdfExportOptions {
    includeTitlePage?: boolean;
    watermark?: string;
    /** Print each scene's number in both margins of its heading. */
    sceneNumbering?: boolean;
    /** Paper size. Text widths and indents are identical on both; only the sheet changes. */
    pageSize?: "letter" | "a4";
    /** Project title-page defaults; missing keys are filled in by the project service before export. */
    titlePageDefaults?: Record<string, string>;
    filterSceneIds?: string[];
    filterCharacters?: string[];
    notesIncluded?: boolean;
}

const PAGE_SIZES = {
    letter: [612, 792], // 8.5 x 11 inches in points
    a4: [595.28, 841.89], // 210 x 297 mm in points
} as const;
const MARGIN_LEFT = 108; // 1.5 inches left margin
const MARGIN_RIGHT = 72; // 1.0 inch right margin
const MARGIN_TOP = 72; // 1.0 inch top margin
const MARGIN_BOTTOM = 72; // 1.0 inch bottom margin
const PRINTABLE_WIDTH = 432; // 6 inches: the US Letter text width, kept on A4 so line breaks match
const FONT_SIZE = 12;
const LINE_HEIGHT = 12; // Standard 6 lines per inch vertical pitch

const INDENT_SCENE_HEADING = MARGIN_LEFT;
const WIDTH_SCENE_HEADING = PRINTABLE_WIDTH;

const INDENT_ACTION = MARGIN_LEFT;
const WIDTH_ACTION = PRINTABLE_WIDTH;

const INDENT_CHARACTER = MARGIN_LEFT + 158; // ~3.7 inches from left of page
const WIDTH_CHARACTER = 250;

const INDENT_PARENTHETICAL = MARGIN_LEFT + 115; // ~3.1 inches from left of page
const WIDTH_PARENTHETICAL = 216;

const INDENT_DIALOGUE = MARGIN_LEFT + 72; // ~2.5 inches from left of page
const WIDTH_DIALOGUE = 252; // 3.5 inches wide

const INDENT_TRANSITION = MARGIN_LEFT + 288; // ~5.5 inches from left of page
const WIDTH_TRANSITION = 144;

function wrapText(
    text: string,
    font: PDFFont,
    fontSize: number,
    maxWidth: number,
): string[] {
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let currentLine = "";

    for (const word of words) {
        if (!word) {
            continue;
        }
        const candidate = currentLine ? `${currentLine} ${word}` : word;
        const width = font.widthOfTextAtSize(candidate, fontSize);
        if (width <= maxWidth) {
            currentLine = candidate;
        } else {
            if (currentLine) {
                lines.push(currentLine);
            }
            currentLine = word;
        }
    }

    if (currentLine) {
        lines.push(currentLine);
    }

    return lines.length > 0 ? lines : [""];
}

export async function generateScreenplayPdf(
    rawScript: string,
    options: PdfExportOptions = {},
): Promise<Uint8Array> {
    const cleanScript = extractCleanFountain(rawScript);
    const parsed = parseScreenplay(cleanScript);
    const pdfDoc = await PDFDocument.create();
    const [PAGE_WIDTH, PAGE_HEIGHT] = PAGE_SIZES[options.pageSize === "a4" ? "a4" : "letter"];
    const sceneNumberAt = new Map<number, string>();
    for (const scene of parsed.scenes) sceneNumberAt.set(scene.line, scene.number);

    const courierFont = await pdfDoc.embedFont(StandardFonts.Courier);
    const courierBoldFont = await pdfDoc.embedFont(StandardFonts.CourierBold);
    const courierObliqueFont = await pdfDoc.embedFont(
        StandardFonts.CourierOblique,
    );

    let currentPageIndex = 0;
    let currentPage: PDFPage | null = null;
    let cursorY = PAGE_HEIGHT - MARGIN_TOP;

    function addNewPage(isTitlePage = false): PDFPage {
        currentPageIndex += 1;
        const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
        cursorY = PAGE_HEIGHT - MARGIN_TOP;

        if (!isTitlePage && currentPageIndex > 1) {
            const pageNumText = `${currentPageIndex}.`;
            const numWidth = courierFont.widthOfTextAtSize(
                pageNumText,
                FONT_SIZE,
            );
            page.drawText(pageNumText, {
                x: PAGE_WIDTH - MARGIN_RIGHT - numWidth,
                y: PAGE_HEIGHT - MARGIN_TOP + 24,
                size: FONT_SIZE,
                font: courierFont,
                color: rgb(0, 0, 0),
            });
        }

        if (options.watermark) {
            const wmText = options.watermark.toUpperCase();
            const wmSize = 36;
            const wmWidth = courierBoldFont.widthOfTextAtSize(wmText, wmSize);
            page.drawText(wmText, {
                x: (PAGE_WIDTH - wmWidth) / 2,
                y: PAGE_HEIGHT / 2,
                size: wmSize,
                font: courierBoldFont,
                color: rgb(0.85, 0.85, 0.85),
                rotate: degrees(45),
            });
        }

        return page;
    }

    if (
        options.includeTitlePage !== false &&
        parsed.titleEntries &&
        parsed.titleEntries.length > 0
    ) {
        const titlePage = addNewPage(true);
        let title = "UNTITLED";
        let author = "";
        let credit = "written by";
        let draftDate = "";
        let contact = "";

        for (const item of parsed.titleEntries) {
            const key = item.keyLower || item.key.toLowerCase();
            const text = item.value || "";
            if (key === "title") {
                title = text;
            } else if (key === "author" || key === "authors") {
                author = text;
            } else if (key === "credit") {
                credit = text;
            } else if (key === "draft date" || key === "date") {
                draftDate = text;
            } else if (key === "contact" || key === "source") {
                contact = text;
            }
        }

        const titleLines = wrapText(title, courierBoldFont, 16, 400);
        let titleY = PAGE_HEIGHT * 0.6;
        for (const line of titleLines) {
            const lineWidth = courierBoldFont.widthOfTextAtSize(line, 16);
            titlePage.drawText(line, {
                x: (PAGE_WIDTH - lineWidth) / 2,
                y: titleY,
                size: 16,
                font: courierBoldFont,
                color: rgb(0, 0, 0),
            });
            titleY -= 20;
        }

        titleY -= 12;
        const creditWidth = courierFont.widthOfTextAtSize(credit, FONT_SIZE);
        titlePage.drawText(credit, {
            x: (PAGE_WIDTH - creditWidth) / 2,
            y: titleY,
            size: FONT_SIZE,
            font: courierFont,
            color: rgb(0, 0, 0),
        });

        titleY -= 16;
        const authorWidth = courierFont.widthOfTextAtSize(
            author || "Anonymous",
            FONT_SIZE,
        );
        titlePage.drawText(author || "Anonymous", {
            x: (PAGE_WIDTH - authorWidth) / 2,
            y: titleY,
            size: FONT_SIZE,
            font: courierFont,
            color: rgb(0, 0, 0),
        });

        let footerY = MARGIN_BOTTOM + 40;
        if (draftDate) {
            titlePage.drawText(draftDate, {
                x: MARGIN_LEFT,
                y: footerY,
                size: FONT_SIZE,
                font: courierFont,
                color: rgb(0, 0, 0),
            });
            footerY += 14;
        }
        if (contact) {
            const contactLines = wrapText(contact, courierFont, 10, 300);
            let cY = MARGIN_BOTTOM + 20;
            for (const cLine of contactLines) {
                titlePage.drawText(cLine, {
                    x: MARGIN_LEFT,
                    y: cY,
                    size: 10,
                    font: courierFont,
                    color: rgb(0, 0, 0),
                });
                cY -= 12;
            }
        }

        currentPageIndex = 0;
    }

    currentPage = addNewPage(false);

    function ensureSpace(requiredHeight: number) {
        if (cursorY - requiredHeight < MARGIN_BOTTOM) {
            currentPage = addNewPage(false);
        }
    }

    const lines: FountainLine[] = parsed.lines || [];

    // Dual dialogue (a cue ending in ^): the pair prints as two columns side by side.
    const dualAt = new Map<number, { left: { first: number; last: number }; right: { first: number; last: number } }>();
    const blocks = parsed.blocks || [];
    for (let b = 0; b + 1 < blocks.length; b++) {
        if (blocks[b].dual === "left" && blocks[b + 1].dual === "right") dualAt.set(blocks[b].first, { left: blocks[b], right: blocks[b + 1] });
    }
    // %%% special pages: each on its own page, text placed on a 3x3 grid (same layout as the preview:
    // columns 1/4, 1/2, 1/4 of the text width; rows top, middle, bottom).
    const specialAt = new Map((parsed.specialPages || []).map((p) => [p.line, p]));
    function drawSpecialPage(sp: { items: Array<{ position: string; text: string }> }) {
        if (cursorY < PAGE_HEIGHT - MARGIN_TOP) currentPage = addNewPage(false);
        const W = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;
        const cols: Record<string, [number, number]> = { l: [MARGIN_LEFT, W / 4], c: [MARGIN_LEFT + W / 4, W / 2], r: [MARGIN_LEFT + (3 * W) / 4, W / 4] };
        for (const item of sp.items) {
            const [v, h] = [item.position[0], item.position[1]];
            const [x0, width] = cols[h] ?? cols.c;
            const rows: string[] = [];
            for (const raw of item.text.split("\n")) {
                const plain = parseInline(raw).map((r) => r.text).join("") || raw;
                rows.push(...(plain.trim() ? wrapText(plain, courierFont, FONT_SIZE, width) : [""]));
            }
            const height = rows.length * LINE_HEIGHT;
            const top = PAGE_HEIGHT - MARGIN_TOP;
            const y0 = v === "t" ? top : v === "b" ? MARGIN_BOTTOM + height - LINE_HEIGHT : (top + MARGIN_BOTTOM) / 2 + height / 2;
            rows.forEach((row, n) => {
                const w = courierFont.widthOfTextAtSize(row, FONT_SIZE);
                const x = h === "l" ? x0 : h === "r" ? x0 + width - w : x0 + (width - w) / 2;
                currentPage?.drawText(row, { x, y: y0 - n * LINE_HEIGHT, size: FONT_SIZE, font: courierFont, color: rgb(0, 0, 0) });
            });
        }
        // Whatever follows starts on a fresh page.
        cursorY = MARGIN_BOTTOM - 1;
    }
    const cueText = (t: string) => t.replace(/^@/, "").replace(/\s*\^\s*$/, "").toUpperCase();
    function drawDual(pair: { left: { first: number; last: number }; right: { first: number; last: number } }) {
        const COL = PRINTABLE_WIDTH / 2;
        const column = (block: { first: number; last: number }, x0: number) => {
            const rows: Array<{ text: string; x: number }> = [];
            for (let l = block.first; l <= block.last; l++) {
                const ln = lines[l];
                const t = (ln?.text || ln?.raw || "").trim();
                if (!t) continue;
                if (ln.type === "character") for (const w of wrapText(cueText(t), courierFont, FONT_SIZE, COL - 58)) rows.push({ text: w, x: x0 + 58 });
                else if (ln.type === "parenthetical") for (const w of wrapText(t, courierFont, FONT_SIZE, COL - 40)) rows.push({ text: w, x: x0 + 22 });
                else if (ln.type === "dialogue" || ln.type === "lyrics") for (const w of wrapText(t, courierFont, FONT_SIZE, COL - 22)) rows.push({ text: w, x: x0 });
            }
            return rows;
        };
        const left = column(pair.left, MARGIN_LEFT);
        const right = column(pair.right, MARGIN_LEFT + COL + 14);
        const height = Math.max(left.length, right.length);
        ensureSpace(LINE_HEIGHT * (height + 1));
        cursorY -= LINE_HEIGHT * 0.5;
        for (const rows of [left, right])
            rows.forEach((r, n) =>
                currentPage?.drawText(r.text, { x: r.x, y: cursorY - n * LINE_HEIGHT, size: FONT_SIZE, font: courierFont, color: rgb(0, 0, 0) }),
            );
        cursorY -= LINE_HEIGHT * (height + 0.5);
    }

    for (let i = 0; i < lines.length; i++) {
        const el = lines[i];
        const text = el.text || el.raw || "";

        const special = specialAt.get(el.index ?? i);
        if (special) {
            drawSpecialPage(special);
            i = special.lastLine;
            continue;
        }
        if (el.type === "special_page") continue;

        if (!text.trim() || el.type === "blank" || el.type === "title_page") {
            continue;
        }

        const pair = dualAt.get(el.index ?? i);
        if (pair) {
            drawDual(pair);
            i = pair.right.last;
            continue;
        }

        if (el.type === "scene_heading") {
            ensureSpace(LINE_HEIGHT * 3);
            cursorY -= LINE_HEIGHT;

            const wrapped = wrapText(
                text.toUpperCase(),
                courierBoldFont,
                FONT_SIZE,
                WIDTH_SCENE_HEADING,
            );
            const sceneNumber = options.sceneNumbering ? sceneNumberAt.get(el.index ?? i) : undefined;
            wrapped.forEach((line, lineNo) => {
                ensureSpace(LINE_HEIGHT);
                currentPage?.drawText(line, {
                    x: INDENT_SCENE_HEADING,
                    y: cursorY,
                    size: FONT_SIZE,
                    font: courierBoldFont,
                    color: rgb(0, 0, 0),
                });
                if (sceneNumber && lineNo === 0) {
                    const numWidth = courierBoldFont.widthOfTextAtSize(sceneNumber, FONT_SIZE);
                    currentPage?.drawText(sceneNumber, {
                        x: INDENT_SCENE_HEADING - 36 - numWidth,
                        y: cursorY,
                        size: FONT_SIZE,
                        font: courierBoldFont,
                        color: rgb(0, 0, 0),
                    });
                    currentPage?.drawText(sceneNumber, {
                        x: Math.min(PAGE_WIDTH - 36 - numWidth, INDENT_SCENE_HEADING + WIDTH_SCENE_HEADING + 24),
                        y: cursorY,
                        size: FONT_SIZE,
                        font: courierBoldFont,
                        color: rgb(0, 0, 0),
                    });
                }
                cursorY -= LINE_HEIGHT;
            });
            cursorY -= LINE_HEIGHT * 0.5;
        } else if (
            el.type === "action" ||
            el.type === "shot" ||
            el.type === "centered"
        ) {
            const wrapped = wrapText(
                text,
                courierFont,
                FONT_SIZE,
                WIDTH_ACTION,
            );
            ensureSpace(wrapped.length * LINE_HEIGHT + LINE_HEIGHT);
            cursorY -= LINE_HEIGHT * 0.5;

            for (const line of wrapped) {
                ensureSpace(LINE_HEIGHT);
                const xOffset =
                    el.type === "centered"
                        ? (PAGE_WIDTH -
                              courierFont.widthOfTextAtSize(line, FONT_SIZE)) /
                          2
                        : INDENT_ACTION;

                currentPage?.drawText(line, {
                    x: xOffset,
                    y: cursorY,
                    size: FONT_SIZE,
                    font: courierFont,
                    color: rgb(0, 0, 0),
                });
                cursorY -= LINE_HEIGHT;
            }
            cursorY -= LINE_HEIGHT * 0.5;
        } else if (el.type === "character") {
            ensureSpace(LINE_HEIGHT * 4);
            cursorY -= LINE_HEIGHT * 0.5;

            const wrapped = wrapText(
                cueText(text),
                courierFont,
                FONT_SIZE,
                WIDTH_CHARACTER,
            );
            for (const line of wrapped) {
                ensureSpace(LINE_HEIGHT);
                currentPage?.drawText(line, {
                    x: INDENT_CHARACTER,
                    y: cursorY,
                    size: FONT_SIZE,
                    font: courierFont,
                    color: rgb(0, 0, 0),
                });
                cursorY -= LINE_HEIGHT;
            }
        } else if (el.type === "parenthetical") {
            const wrapped = wrapText(
                text,
                courierFont,
                FONT_SIZE,
                WIDTH_PARENTHETICAL,
            );
            for (const line of wrapped) {
                ensureSpace(LINE_HEIGHT);
                currentPage?.drawText(line, {
                    x: INDENT_PARENTHETICAL,
                    y: cursorY,
                    size: FONT_SIZE,
                    font: courierFont,
                    color: rgb(0, 0, 0),
                });
                cursorY -= LINE_HEIGHT;
            }
        } else if (el.type === "dialogue" || el.type === "lyrics") {
            const wrapped = wrapText(
                text,
                courierFont,
                FONT_SIZE,
                WIDTH_DIALOGUE,
            );
            for (const line of wrapped) {
                ensureSpace(LINE_HEIGHT);
                currentPage?.drawText(line, {
                    x: INDENT_DIALOGUE,
                    y: cursorY,
                    size: FONT_SIZE,
                    font: courierFont,
                    color: rgb(0, 0, 0),
                });
                cursorY -= LINE_HEIGHT;
            }
            cursorY -= LINE_HEIGHT * 0.5;
        } else if (el.type === "transition") {
            ensureSpace(LINE_HEIGHT * 2);
            cursorY -= LINE_HEIGHT * 0.5;

            const wrapped = wrapText(
                text.toUpperCase(),
                courierFont,
                FONT_SIZE,
                WIDTH_TRANSITION,
            );
            for (const line of wrapped) {
                ensureSpace(LINE_HEIGHT);
                currentPage?.drawText(line, {
                    x: INDENT_TRANSITION,
                    y: cursorY,
                    size: FONT_SIZE,
                    font: courierFont,
                    color: rgb(0, 0, 0),
                });
                cursorY -= LINE_HEIGHT;
            }
            cursorY -= LINE_HEIGHT * 0.5;
        } else if (el.type === "page_break") {
            currentPage = addNewPage(false);
        } else if (el.type === "note" && options.notesIncluded) {
            const wrapped = wrapText(
                `/* ${text} */`,
                courierObliqueFont,
                10,
                WIDTH_ACTION,
            );
            ensureSpace(wrapped.length * 12 + 6);
            for (const line of wrapped) {
                ensureSpace(12);
                currentPage?.drawText(line, {
                    x: INDENT_ACTION,
                    y: cursorY,
                    size: 10,
                    font: courierObliqueFont,
                    color: rgb(0.4, 0.4, 0.4),
                });
                cursorY -= 12;
            }
        }
    }

    return await pdfDoc.save();
}
