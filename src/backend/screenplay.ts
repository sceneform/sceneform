// screenplay.ts

import { createRequire } from "node:module";

import type {
    FountainBlock,
    FountainCharacter,
    FountainDiagnostic,
    FountainInlineRun,
    FountainLine,
    FountainNote,
    FountainOmit,
    FountainOutlineNode,
    FountainParseOptions,
    FountainParserDocument,
    FountainScene,
    FountainSection,
    FountainTitleEntry,
} from "./fountain-js/fountain-parser.js";
export type ScreenplayDocument = FountainParserDocument;

const require = createRequire(import.meta.url);
const SceneformFountain = require("./fountain-js/fountain-parser.cjs") as {
    parse(
        content: string,
        options?: FountainParseOptions,
    ): FountainParserDocument;
    parseInline(content: string): FountainInlineRun[];
    serialize(document: FountainParserDocument): string;
};

export interface ScreenplaySemanticSummary {
    blockCount: number;
    sceneCount: number;
    noteCount: number;
    annotationCount: number;
    blockTypes: Record<string, number>;
    scenes: string[];
    notes: string[];
}
export interface ParsedScreenplay extends ScreenplayDocument {
    semantic: ScreenplaySemanticSummary;
}

export function parseScreenplayDocument(
    content: string,
    options?: FountainParseOptions,
): ScreenplayDocument {
    return SceneformFountain.parse(content, options);
}

export function serializeScreenplay(document: ScreenplayDocument): string {
    return SceneformFountain.serialize(document);
}

export function parseInline(content: string): FountainInlineRun[] {
    return SceneformFountain.parseInline(content);
}

export function deriveSemanticSummary(
    document: ScreenplayDocument,
): ScreenplaySemanticSummary {
    const blockTypes: Record<string, number> = {};

    for (const block of document.blocks) {
        blockTypes[block.type] = (blockTypes[block.type] ?? 0) + 1;
    }

    const scenes = document.scenes
        .map((scene) => scene.title)
        .filter((title) => title.length > 0);

    const notes = document.notes
        .map((note) => note.text)
        .filter((text) => text.length > 0);

    return {
        blockCount: document.blocks.length,
        sceneCount: document.scenes.length,
        noteCount: document.notes.length,
        annotationCount: document.notes.length,
        blockTypes,
        scenes,
        notes,
    };
}

export function parseScreenplay(
    content: string,
    options?: FountainParseOptions,
): ParsedScreenplay {
    const document = parseScreenplayDocument(content, options);

    return {
        ...document,
        semantic: deriveSemanticSummary(document),
    };
}

export function lineAtOffset(
    document: ScreenplayDocument,
    offset: number,
): FountainLine | null {
    if (document.lines.length === 0) {
        return null;
    }

    if (offset <= document.lines[0].start) {
        return document.lines[0];
    }

    const last = document.lines[document.lines.length - 1];

    if (offset >= last.end) {
        return last;
    }

    let low = 0;
    let high = document.lines.length - 1;

    while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        const line = document.lines[middle];

        if (offset < line.start) {
            high = middle - 1;
            continue;
        }

        if (offset > line.end) {
            low = middle + 1;
            continue;
        }

        return line;
    }

    return null;
}

export function sceneAtLine(
    document: ScreenplayDocument,
    lineIndex: number,
): FountainScene | null {
    for (const scene of document.scenes) {
        if (lineIndex >= scene.line && lineIndex <= scene.lastLine) {
            return scene;
        }
    }

    return null;
}

export function sceneAtOffset(
    document: ScreenplayDocument,
    offset: number,
): FountainScene | null {
    for (const scene of document.scenes) {
        if (offset >= scene.start && offset < scene.end) {
            return scene;
        }
    }

    return null;
}

export function findCharacter(
    document: ScreenplayDocument,
    name: string,
): FountainCharacter | null {
    const normalized = name.trim().replace(/\s+/g, " ").toUpperCase();

    return (
        document.characters.find(
            (character) => character.name === normalized,
        ) ?? null
    );
}

export function outlineNodeAtLine(
    document: ScreenplayDocument,
    lineIndex: number,
): FountainOutlineNode | null {
    for (const node of document.outline) {
        if (node.line === lineIndex) {
            return node;
        }
    }

    return null;
}

export function linesForScene(
    document: ScreenplayDocument,
    scene: FountainScene,
): FountainLine[] {
    return document.lines.slice(scene.line, scene.lastLine + 1);
}

export function blocksForScene(
    document: ScreenplayDocument,
    scene: FountainScene,
): FountainBlock[] {
    const [first, last] = scene.blocks;

    return document.blocks.slice(first, last + 1);
}

export type {
    FountainBlock,
    FountainCharacter,
    FountainCharacterCue,
    FountainDiagnostic,
    FountainDialogueElement,
    FountainInlineRun,
    FountainLine,
    FountainLineType,
    FountainNote,
    FountainOmit,
    FountainOutlineNode,
    FountainParseOptions,
    FountainScene,
    FountainSection,
    FountainTitleEntry,
} from "./fountain-js/fountain-parser.js";
