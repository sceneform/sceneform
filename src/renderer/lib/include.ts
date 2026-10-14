// src/renderer/lib/include.ts
// `*include: Title` on a line of its own pulls another screenplay (or episode) of the same
// project into this one for the preview and every export, the way a master script is
// assembled from act or episode files. The included script's own title page is dropped.
// Includes nest (up to 8 deep); a missing target or a loop leaves a [[note]] in its place.
// The editor, outline and statistics show each file as written.

import { parseFountain } from "./fountain";

export const INCLUDE_LINE = /^\s*\*include:?\s+(.+?)\s*$/i;

export interface IncludeDoc {
    id: string;
    title: string;
    content: string;
}

const norm = (s: string) => s.trim().toLowerCase();

export function findInclude(target: string, docs: IncludeDoc[]): IncludeDoc | undefined {
    const t = norm(target.replace(/\.fountain$/i, ""));
    return docs.find((d) => norm(d.title) === t) ?? docs.find((d) => d.id === target.trim());
}

/** The script without its title page (the lines from the first body line on). */
export function bodyOf(text: string): string {
    const doc = parseFountain(text);
    const lines = text.split("\n");
    let first = 0;
    while (first < doc.lines.length && doc.lines[first]?.type === "title_page") first++;
    while (first < lines.length && !lines[first].trim()) first++;
    return lines.slice(first).join("\n");
}

export const hasIncludes = (text: string) => text.split("\n").some((l) => INCLUDE_LINE.test(l));

/** `text` with every `*include` line replaced by the body of the screenplay it names. */
export function resolveIncludes(text: string, docs: IncludeDoc[], selfId: string | null = null, depth = 0, stack: string[] = []): string {
    if (!hasIncludes(text)) return text;
    const seen = selfId ? [...stack, selfId] : stack;
    return text
        .split("\n")
        .map((line) => {
            const m = INCLUDE_LINE.exec(line);
            if (!m) return line;
            const doc = findInclude(m[1], docs);
            if (!doc) return `[[Missing include: ${m[1]}]]`;
            if (seen.includes(doc.id) || depth >= 8) return `[[Include loop: ${m[1]}]]`;
            return resolveIncludes(bodyOf(doc.content), docs, doc.id, depth + 1, seen).replace(/\n+$/, "");
        })
        .join("\n");
}
