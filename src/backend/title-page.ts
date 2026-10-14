// src/backend/title-page.ts
//
// Title-page keys and project-level title-page defaults.
//
// One table drives the editor highlighting, the Project Information page, the
// new-screenplay template and export inheritance, so a key (for example the
// "Draft date" label) can be changed in exactly one place.
//
// Inheritance rule: when a screenplay is exported, any key that is missing from
// its own title page is filled in from the project defaults. A key the script
// already has always wins, even when its value is empty.

export interface TitlePageKey {
    /** Lowercase key as the parser reports it (`keyLower`). */
    key: string;
    /** How the key is written into a .fountain title page. */
    label: string;
    /** Short help shown on the Project Information page and in hover docs. */
    hint: string;
    multiline?: boolean;
    /** Value is a date: the Project Information page uses a date picker and stores ISO YYYY-MM-DD. */
    date?: boolean;
}

/** Recognized keys, in the order they are written into a generated title page. */
export const TITLE_PAGE_KEYS: TitlePageKey[] = [
    { key: "title", label: "Title", hint: "The screenplay's title." },
    { key: "credit", label: "Credit", hint: "The credit line, usually \"written by\"." },
    { key: "author", label: "Author", hint: "Who wrote it." },
    { key: "authors", label: "Authors", hint: "Several writers." },
    { key: "source", label: "Source", hint: "What it is based on." },
    { key: "draft date", label: "Draft date", hint: "Date of this draft. Written into a script once, when it is created.", date: true },
    { key: "date", label: "Date", hint: "A date, alternative to Draft date." },
    { key: "revision", label: "Revision", hint: "Revision name or color." },
    { key: "contact", label: "Contact", hint: "Contact details, bottom left of the title page.", multiline: true },
    { key: "contact info", label: "Contact info", hint: "Alternative spelling of Contact.", multiline: true },
    { key: "copyright", label: "Copyright", hint: "Copyright line." },
    { key: "notes", label: "Notes", hint: "Notes printed on the title page.", multiline: true },
    { key: "watermark", label: "Watermark", hint: "Text stamped across every page." },
    { key: "header", label: "Header", hint: "Header text on every page." },
    { key: "footer", label: "Footer", hint: "Footer text on every page." },
    { key: "font", label: "Font", hint: "Requested typeface." },
    { key: "tl", label: "TL", hint: "Free text, top left." },
    { key: "tc", label: "TC", hint: "Free text, top center." },
    { key: "tr", label: "TR", hint: "Free text, top right." },
    { key: "cc", label: "CC", hint: "Free text, center." },
    { key: "bl", label: "BL", hint: "Free text, bottom left." },
    { key: "br", label: "BR", hint: "Free text, bottom right." },
];

const KNOWN = new Map(TITLE_PAGE_KEYS.map((k) => [k.key, k]));

export function normalizeTitleKey(key: string): string {
    return key.trim().toLowerCase().replace(/\s+/g, " ");
}

export function isKnownTitleKey(key: string): boolean {
    return KNOWN.has(normalizeTitleKey(key));
}

export function titleKeyLabel(key: string): string {
    return KNOWN.get(normalizeTitleKey(key))?.label ?? key;
}

/** Project-level title-page defaults, keyed by lowercase key. Empty values mean "not set". */
export type TitlePageDefaults = Record<string, string>;

/** The minimum a caller needs from a parse: each entry's key and the last line it spans. */
export interface TitleEntryLike {
    keyLower: string;
    lastLine: number;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** ISO date (YYYY-MM-DD) for a Date, in local time. */
export function isoDate(d: Date = new Date()): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * How a date is written on a title page: "11 October 2026". Locale-independent
 * so the same project prints the same text on every machine. Anything that is
 * not an ISO date is returned unchanged (users may type free text).
 */
export function formatDraftDate(value: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (!m) return value;
    const month = MONTHS[Number(m[2]) - 1];
    if (!month) return value;
    return `${Number(m[3])} ${month} ${m[1]}`;
}

/** Parses a title-page date back to ISO when it is in a recognizable form, else null. */
export function parseDraftDate(text: string): string | null {
    const t = text.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
    const m = /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/.exec(t);
    if (m) {
        const mi = MONTHS.findIndex((x) => x.toLowerCase().startsWith(m[2].toLowerCase().slice(0, 3)));
        if (mi >= 0) return `${m[3]}-${String(mi + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    }
    return null;
}

function isDateKey(key: string): boolean {
    return KNOWN.get(normalizeTitleKey(key))?.date === true;
}

function formatEntry(key: string, raw: string): string[] {
    const label = titleKeyLabel(key);
    const value = isDateKey(key) ? formatDraftDate(raw) : raw;
    const lines = value.replace(/\r\n?/g, "\n").split("\n");
    if (lines.length <= 1) return [`${label}: ${value.trim()}`];
    return [`${label}:`, ...lines.map((l) => `    ${l.trim()}`)];
}

/** Defaults that are set, in table order. */
export function setDefaults(defaults: TitlePageDefaults | undefined): Array<[string, string]> {
    if (!defaults) return [];
    return TITLE_PAGE_KEYS.filter((k) => (defaults[k.key] ?? "").trim() !== "").map((k) => [k.key, defaults[k.key]]);
}

/** Keys a script would inherit: set in the defaults and absent from its own title page. */
export function inheritedKeys(entries: TitleEntryLike[], defaults: TitlePageDefaults | undefined): string[] {
    const own = new Set(entries.map((e) => normalizeTitleKey(e.keyLower)));
    return setDefaults(defaults)
        .map(([k]) => k)
        .filter((k) => !own.has(k));
}

/**
 * Returns the script with inherited title-page keys filled in. `entries` must
 * come from parsing this exact text. The script's own keys are never changed.
 */
export function applyTitlePageDefaults(
    script: string,
    entries: TitleEntryLike[],
    defaults: TitlePageDefaults | undefined,
): string {
    const missing = inheritedKeys(entries, defaults);
    if (missing.length === 0) return script;
    const add = missing.flatMap((k) => formatEntry(k, defaults![k]));
    const eol = script.includes("\r\n") ? "\r\n" : "\n";
    const lines = script.split(/\r?\n/);
    if (entries.length === 0) {
        return [...add, "", ...lines].join(eol);
    }
    const last = Math.max(...entries.map((e) => e.lastLine));
    lines.splice(last + 1, 0, ...add);
    return lines.join(eol);
}

/**
 * The title page a new screenplay starts with. `Title` and `Author` always
 * appear, `Draft date` is the project default date or today (formatted, e.g.
 * "11 October 2026"), and every other set default is written out so the
 * script owns its values from the start. Called only when a script is created.
 */
export function buildTitlePageTemplate(options: {
    title: string;
    author?: string;
    defaults?: TitlePageDefaults;
    today?: string;
}): string {
    const d = options.defaults ?? {};
    const values: Record<string, string> = {};
    for (const [k, v] of setDefaults(d)) values[k] = v;
    values.title = options.title.trim() || values.title || "Untitled Screenplay";
    if (!values.author && !values.authors) values.author = (options.author ?? "").trim() || "Author";
    // The draft date is filled in once, here, when the script is created; it is never rewritten later.
    if (!values["draft date"] && !values.date) values["draft date"] = options.today ?? isoDate();
    const out: string[] = [];
    for (const k of TITLE_PAGE_KEYS) {
        if (values[k.key] !== undefined && values[k.key] !== "") out.push(...formatEntry(k.key, values[k.key]));
    }
    return `${out.join("\n")}\n\n`;
}
