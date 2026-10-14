// src/renderer/lib/fountain-docs.ts
//
// One source for both the hover cards and the Cheat Sheet panel, keyed by the
// parser's own line types so the docs can never disagree with highlighting.

import type { FountainLineType } from "./fountain";

export interface FountainDoc {
    kind: "fountain" | "sceneform";
    label: string;
    desc: string;
    note?: string;
}

export const FOUNTAIN_DOCS: Partial<Record<FountainLineType | "scene-color" | "inline-note" | "title-key-unknown", FountainDoc>> = {
    scene_heading: {
        kind: "fountain",
        label: "Scene Heading",
        desc: "Starts a new scene: where it happens, and whether it is inside or outside. Needs a blank line before it, unless forced with a leading period.",
    },
    "scene-color": {
        kind: "sceneform",
        label: "Scene Color Tag",
        desc: "Tags the scene with a color, used to color-code it in the outline.",
        note: "<b>Sceneform-only.</b> Reuses note syntax and only recognizes named colors or hex codes.",
    },
    marker: {
        kind: "sceneform",
        label: "Scene ID Marker",
        desc: "An internal tag that keeps scene metadata (WIP, omitted, descriptions, canvas cards) attached to its scene through edits and reordering.",
        note: "<b>Sceneform-only.</b> Hidden in the editor and stripped from every Fountain and PDF export.",
    },
    character: {
        kind: "fountain",
        label: "Character",
        desc: "Names who is speaking. An all-caps line with dialogue directly under it. Force one with a leading @, add ^ for dual dialogue.",
    },
    dialogue: {
        kind: "fountain",
        label: "Dialogue",
        desc: "The spoken line(s) after a character cue. A blank line ends it.",
    },
    parenthetical: {
        kind: "fountain",
        label: "Parenthetical",
        desc: "A short direction between a character cue and the dialogue, such as how a line is delivered.",
    },
    title_page: {
        kind: "fountain",
        label: "Title Page Field",
        desc: "A Key: value field at the very top of the file. Title, Credit, Author, Draft date and Contact appear on the title page.",
        note: "Keys this script leaves out are filled in from <b>Project information</b> when you export.",
    },
    "title-key-unknown": {
        kind: "fountain",
        label: "Unrecognized Title Page Key",
        desc: "This is not a standard title page key. It stays in the file, but PDF export and most Fountain apps ignore it.",
        note: "Standard keys: Title, Credit, Author(s), Source, Draft date, Date, Contact, Copyright, Notes, Revision, Watermark, Header, Footer, Font, TL, TC, TR, CC, BL, BR.",
    },
    action: {
        kind: "fountain",
        label: "Action",
        desc: "What happens on screen. Anything that is not something more specific. Force with a leading !.",
    },
    transition: {
        kind: "fountain",
        label: "Transition",
        desc: "An all-caps line ending in TO:, like CUT TO:. Force any line with a leading >.",
    },
    centered: {
        kind: "fountain",
        label: "Centered",
        desc: "Text wrapped in > and < is centered on the page.",
    },
    section: {
        kind: "fountain",
        label: "Section",
        desc: "# Act, ## Sequence and so on. Structure for the outline only; never printed.",
    },
    synopsis: {
        kind: "fountain",
        label: "Synopsis",
        desc: "A line starting with = describes the scene or section above it. Shown in the outline, never printed.",
    },
    note: {
        kind: "fountain",
        label: "Note",
        desc: "Anything inside [[double brackets]] is a note to yourself. Never printed unless you export with notes.",
    },
    "inline-note": {
        kind: "fountain",
        label: "Note",
        desc: "Anything inside [[double brackets]] is a note to yourself. Never printed unless you export with notes.",
    },
    omit: {
        kind: "fountain",
        label: "Boneyard",
        desc: "Text between /* and */ is ignored entirely: kept in the file, left out of the script.",
    },
    lyrics: {
        kind: "fountain",
        label: "Lyrics",
        desc: "A line starting with ~ is a sung lyric.",
    },
    page_break: {
        kind: "fountain",
        label: "Page Break",
        desc: "A line of three or more equals signs forces a new page.",
    },
    special_page: {
        kind: "sceneform",
        label: "Special Page",
        desc: "Lines between two %%% lines become a page of their own (an epigraph, a quote, In Memoriam). Place text with <[pos]>…</[pos]>: tl, tc, tr, cl, cc, cr, bl, bc, br (or l, c, r, t, b). Untagged text is centered.",
    },
    shot: {
        kind: "fountain",
        label: "Shot",
        desc: "A camera direction such as CLOSE ON, set apart from action.",
    },
};

export const CHEAT_SHEET: Array<[keyof typeof FOUNTAIN_DOCS, string]> = [
    ["scene_heading", "INT. FERRY - MAIN DECK - DAY"],
    ["scene-color", "INT. BATHROOM - NIGHT [[red]]"],
    ["action", "Rain streaks the windows sideways."],
    ["character", "MAERI"],
    ["parenthetical", "(to herself)"],
    ["dialogue", "Nine years."],
    ["transition", "CUT TO:"],
    ["centered", "> THE END <"],
    ["section", "# ACT ONE"],
    ["synopsis", "= Maeri finds the letter."],
    ["note", "[[check this with Axelle]]"],
    ["omit", "/* cut scene */"],
    ["lyrics", "~ Somewhere over the rain"],
    ["page_break", "==="],
    ["special_page", "%%%  <[cc]>For Mom.</[cc]>  %%%"],
    ["title_page", "Author: Axelle"],
    ["marker", "[[id:a1b2c3]]"],
];
