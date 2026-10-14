// fountain-parser.d.ts

export type FountainLineType =
    | "blank"
    | "title_page"
    | "scene_heading"
    | "action"
    | "shot"
    | "character"
    | "parenthetical"
    | "dialogue"
    | "lyrics"
    | "transition"
    | "centered"
    | "section"
    | "synopsis"
    | "page_break"
    | "special_page"
    | "note"
    | "omit"
    | "marker";

export interface FountainCharacterCue {
    name: string;
    extensions: string[];
    dual: boolean;
    contd: boolean;
    voiceOver: boolean;
    offScreen: boolean;

    forced?: boolean;
}

export interface FountainLine {
    index: number;
    start: number;
    end: number;
    eol: string;
    raw: string;
    masked?: string;
    visible?: string;
    type?: FountainLineType | null;
    text?: string;
    forced?: boolean;
    indent?: number;
    continuation?: boolean;
    character?: FountainCharacterCue;
    inDialogue?: boolean;
    provisional?: boolean;
    depth?: number;
    /** special_page lines: true on the opening and closing %%%. */
    delimiter?: boolean;
    /** special_page lines: true on the opening %%%. */
    pageStart?: boolean;
}

export type FountainDialogueElementType =
    "dialogue" | "parenthetical" | "lyrics";

export interface FountainDialogueElement {
    type: FountainDialogueElementType;
    line: number;
    text: string;
}

export type FountainPagePosition = "tl" | "tc" | "tr" | "cl" | "cc" | "cr" | "bl" | "bc" | "br";

export interface FountainSpecialPage {
    /** Line of the opening %%%. */
    line: number;
    /** Line of the closing %%%. */
    lastLine: number;
    items: Array<{ position: FountainPagePosition; text: string }>;
}

export interface FountainBlock {
    type:
        | "title_page"
        | "action"
        | "dialogue"
        | "lyrics"
        | "scene_heading"
        | "section"
        | "synopsis"
        | "shot"
        | "transition"
        | "centered"
        | "page_break"
        | "special_page";

    first: number;
    last: number;
    start: number;
    end: number;
    character?: FountainCharacterCue | null;
    elements?: FountainDialogueElement[];
    /** special_page blocks: the parsed page. */
    page?: FountainSpecialPage | null;
    speaker?: string;
    continued?: "explicit" | "auto" | null;
    dual?: "left" | "right" | null;
}

export interface FountainScene {
    kind: "scene";
    index: number;
    line: number;
    start: number;
    end: number;
    lastLine: number;
    autoNumber: number;
    customNumber: string | null;
    number: string;
    title: string;
    prefix: string | null;
    location: string;
    time: string;
    parts: string[];
    color: string | null;
    forced: boolean;
    synopsis: string[];
    notes: FountainNote[];
    shots: FountainShot[];
    characters: string[];
    blocks: [number, number];
}

export interface FountainSection {
    kind: "section";
    depth: number;
    title: string;
    line: number;
    start: number;
    synopsis: string[];
}

export type FountainOutlineNode = FountainScene | FountainSection;

export interface FountainNote {
    start: number;
    end: number;
    line: number;
    lastLine: number;
    text: string;
}

export interface FountainOmit {
    start: number;
    end: number;
    line: number;
    lastLine: number;
    unterminated: boolean;
}

export type FountainDiagnosticSeverity = "warning" | "error" | "info";

export interface FountainDiagnostic {
    line: number;
    code: string;
    severity: FountainDiagnosticSeverity;
    message: string;
}

export interface FountainTitleEntry {
    key: string;
    keyLower: string;
    value: string;
    line: number;
    lastLine: number;
}

export interface FountainCharacter {
    name: string;
    count: number;
    firstLine: number;
    scenes: number[];
}

export interface FountainShot {
    line: number;
    text: string;
}

export interface FountainParserDocument {
    text: string;
    bom: boolean;
    lines: FountainLine[];
    blocks: FountainBlock[];
    /** %%% ... %%% pages (Sceneform extension), in document order. */
    specialPages: FountainSpecialPage[];
    scenes: FountainScene[];
    outline: FountainOutlineNode[];
    notes: FountainNote[];
    omits: FountainOmit[];
    diagnostics: FountainDiagnostic[];
    titlePage: Record<string, string>;
    titleEntries: FountainTitleEntry[];
    characters: FountainCharacter[];
}

export interface FountainInlineRun {
    text: string;
    bold: boolean;
    italic: boolean;
    underline: boolean;
}

export interface FountainParseOptions {
    caretLine?: number;

    markers?: RegExp | RegExp[];

    maxCueLength?: number;
}

declare const SceneformFountain: {
    parse(
        input: string,
        options?: FountainParseOptions,
    ): FountainParserDocument;
    parseInline(input: string): FountainInlineRun[];
    serialize(document: FountainParserDocument): string;
    LINE_TYPES: FountainLineType[];
};

export default SceneformFountain;
