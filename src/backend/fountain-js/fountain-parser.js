// fountain-parser.js
// Fountain parser for sceneform app
// GNU GPL v3.0.0 >

(function (root, factory) {
    if (typeof module === "object" && module.exports)
        module.exports = factory();
    else root.SceneformFountain = factory();
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    const LINE_TYPES = [
        "blank",
        "title_page",
        "scene_heading",
        "action",
        "shot",
        "character",
        "parenthetical",
        "dialogue",
        "lyrics",
        "transition",
        "centered",
        "section",
        "synopsis",
        "page_break",
        "special_page",
        "note",
        "omit",
        "marker",
    ];

    const TRANSP = new Set(["omit", "note", "marker"]); // invisible to structure
    const STARTS_BLOCK = new Set([
        "blank",
        "section",
        "synopsis",
        "page_break",
    ]);
    const TITLE_KEYS = new Set([
        "title",
        "credit",
        "author",
        "authors",
        "source",
        "notes",
        "draft date",
        "date",
        "contact",
        "contact info",
        "copyright",
        "revision",
        "watermark",
        "font",
        "header",
        "footer",
        "tl",
        "tc",
        "tr",
        "cc",
        "bl",
        "br",
    ]);
    // INT. EXT. EST. INT/EXT INT./EXT. EXT/INT I/E (case-insensitive), then "." or whitespace.
    const HEAD_RE =
        /^((?:int|ext)\.?\s*\/\s*(?:int|ext)|int|ext|est|i\/e)(?:\.|\s)/i;
    const COLOR_RE =
        /^(?:#[0-9a-f]{3,8}|red|blue|green|yellow|orange|purple|pink|brown|gray|grey|black|white|cyan|magenta|teal|lime|indigo|violet|gold|silver|navy|maroon|olive|aqua)$/i;
    const NL = /\r\n|\n|\r/g;

    // ---------------------------------------------------------------- small helpers

    const isUpper = (s) =>
        s.length > 0 && s === s.toUpperCase() && s !== s.toLowerCase();

    function splitLines(body, base) {
        const lines = [];
        const re = new RegExp(NL.source, "g");
        let last = 0,
            m,
            idx = 0;
        while ((m = re.exec(body))) {
            lines.push({
                index: idx++,
                start: base + last,
                end: base + m.index,
                eol: m[0],
                raw: body.slice(last, m.index),
            });
            last = m.index + m[0].length;
        }
        lines.push({
            index: idx,
            start: base + last,
            end: base + body.length,
            eol: "",
            raw: body.slice(last),
        });
        return lines;
    }

    function makeLineAt(lines) {
        return function lineAt(off) {
            let lo = 0,
                hi = lines.length - 1;
            while (lo < hi) {
                const mid = (lo + hi + 1) >> 1;
                if (lines[mid].start <= off) lo = mid;
                else hi = mid - 1;
            }
            return lo;
        };
    }

    // Finds /* boneyard */ and [[ note ]] ranges. Offsets are relative to `body`.
    //  - An unterminated /* omits to the end of the document (flagged unterminated).
    //  - An unterminated [[ is plain text. A note never spans a truly empty line.
    function scanRanges(body) {
        const ranges = [];
        const re = /\/\*|\[\[/g;
        let m;
        while ((m = re.exec(body))) {
            const i = m.index;
            if (m[0] === "/*") {
                const j = body.indexOf("*/", i + 2);
                if (j < 0) {
                    ranges.push({
                        kind: "omit",
                        start: i,
                        end: body.length,
                        unterminated: true,
                    });
                    break;
                }
                ranges.push({
                    kind: "omit",
                    start: i,
                    end: j + 2,
                });
                re.lastIndex = j + 2;
            } else {
                if (body[i + 2] === "[") {
                    let k = i;
                    while (body[k] === "[") k++;
                    re.lastIndex = k;
                    continue;
                }
                const j = body.indexOf("]]", i + 2);
                if (
                    j < 0 ||
                    /\n\n/.test(body.slice(i, j).replace(/\r\n?/g, "\n"))
                ) {
                    re.lastIndex = i + 2;
                    continue;
                }
                ranges.push({
                    kind: "note",
                    start: i,
                    end: j + 2,
                });
                re.lastIndex = j + 2;
            }
        }
        return ranges;
    }

    function cueParts(t) {
        let s = t,
            dual = false;
        if (/\^\s*$/.test(s)) {
            dual = true;
            s = s.replace(/\s*\^\s*$/, "");
        }
        const extensions = [];
        let m;
        while ((m = /\s*\(([^()]*)\)\s*$/.exec(s))) {
            extensions.unshift(m[1].trim());
            s = s.slice(0, m.index);
        }
        const name = s.trim();
        const contd = extensions.some((e) =>
            /^cont(?:['\u2019`]?d|\.|inued)\.?$/i.test(e),
        );
        return {
            name,
            extensions,
            dual,
            contd,
            voiceOver: extensions.some((e) => /^v[./]?o\.?$/i.test(e)),
            offScreen: extensions.some((e) => /^o[./]?[sc]\.?$/i.test(e)),
        };
    }

    function isTransition(t) {
        if (!isUpper(t)) return false;
        return /TO:$/.test(t);
    }

    function normPrefix(p) {
        const s = p.toUpperCase().replace(/[.\s]/g, "");
        return s === "I/E" ? "INT/EXT" : s;
    }

    function parseHeading(text, colorNotes) {
        let t = text,
            number = null,
            color = null,
            prefix = null;
        const nm = /\s*#([A-Za-z0-9.\-]+)#\s*$/.exec(t);
        if (nm) {
            number = nm[1];
            t = t.slice(0, nm.index);
        }
        let rest = t;
        const pm = HEAD_RE.exec(t);
        if (pm) {
            prefix = normPrefix(pm[1]);
            rest = t.slice(pm[0].length);
        }
        const parts = rest
            .split(/\s+(?:-{1,2}|[\u2013\u2014])\s+/)
            .map((s) => s.trim());
        for (const n of colorNotes || [])
            if (COLOR_RE.test(n.text)) color = n.text.toLowerCase();
        return {
            title: t.trim(),
            number,
            color,
            prefix,
            location: parts[0] || "",
            time: parts.slice(1).join(" - "),
            parts,
        };
    }

    // ---------------------------------------------------------------- inline formatting

    function findCloser(s, from, ch, k) {
        for (let j = from; j < s.length;) {
            if (s[j] === "\\") {
                j += 2;
                continue;
            }
            if (s[j] === ch) {
                let r = 0;
                while (s[j + r] === ch) r++;
                const prevOk = j > from && !/\s/.test(s[j - 1]);
                const nextOk = ch === "*" || !/\w/.test(s[j + r] || " ");
                if (r === k && prevOk && nextOk) return j;
                j += r;
                continue;
            }
            j++;
        }
        return -1;
    }

    // "**bold** *italic* ***both*** _underline_" -> [{text, bold, italic, underline}]
    // Unmatched or stray markers stay literal; \* and \_ escape; snake_case is untouched.
    function parseInline(s) {
        s = String(s == null ? "" : s);
        const runs = [],
            st = {
                bold: false,
                italic: false,
                underline: false,
            };
        let buf = "";
        const flush = () => {
            if (buf) {
                runs.push({
                    text: buf,
                    bold: st.bold,
                    italic: st.italic,
                    underline: st.underline,
                });
                buf = "";
            }
        };
        for (let i = 0; i < s.length;) {
            const c = s[i];
            if (
                c === "\\" &&
                (s[i + 1] === "*" || s[i + 1] === "_" || s[i + 1] === "\\")
            ) {
                buf += s[i + 1];
                i += 2;
                continue;
            }
            if (c === "*" || c === "_") {
                let k = 0;
                while (s[i + k] === c) k++;
                let keys = null;
                if (c === "_" && k === 1) keys = ["underline"];
                else if (c === "*" && k === 1) keys = ["italic"];
                else if (c === "*" && k === 2) keys = ["bold"];
                else if (c === "*" && k === 3) keys = ["bold", "italic"];
                if (keys) {
                    const active = keys.every((x) => st[x]);
                    const inactive = keys.every((x) => !st[x]);
                    const prev = s[i - 1],
                        next = s[i + k];
                    if (
                        active &&
                        prev &&
                        !/\s/.test(prev) &&
                        (c === "*" || !/\w/.test(next || " "))
                    ) {
                        flush();
                        keys.forEach((x) => {
                            st[x] = false;
                        });
                        i += k;
                        continue;
                    }
                    if (
                        inactive &&
                        next &&
                        !/\s/.test(next) &&
                        (c === "*" || !prev || !/\w/.test(prev)) &&
                        findCloser(s, i + k, c, k) >= 0
                    ) {
                        flush();
                        keys.forEach((x) => {
                            st[x] = true;
                        });
                        i += k;
                        continue;
                    }
                }
                buf += s.slice(i, i + k);
                i += k;
                continue;
            }
            buf += c;
            i++;
        }
        flush();
        return runs;
    }

    // ---------------------------------------------------------------- the parser

    function parse(input, opts) {
        opts = opts || {};
        const src = String(input == null ? "" : input);
        const bom = src.charCodeAt(0) === 0xfeff;
        const base = bom ? 1 : 0;
        const body = src.slice(base);
        const diagnostics = [];
        const maxCue = opts.maxCueLength || 50;
        const markerRes = opts.markers ? [].concat(opts.markers) : null;

        const lines = splitLines(body, base);
        const lineAt = makeLineAt(lines);

        // ---- boneyards and notes -> per-character mask
        const ranges = scanRanges(body);
        const mask = new Uint8Array(body.length + 1);
        let maskedBody = body;
        if (ranges.length) {
            const parts = [];
            let p = 0;
            for (const r of ranges) {
                mask.fill(r.kind === "omit" ? 1 : 2, r.start, r.end);
                parts.push(
                    body.slice(p, r.start),
                    body.slice(r.start, r.end).replace(/[^\r\n]/g, " "),
                );
                p = r.end;
            }
            parts.push(body.slice(p));
            maskedBody = parts.join("");
        }
        const notes = [],
            omits = [],
            notesByLine = new Map();
        for (const r of ranges) {
            const a = r.start + base,
                b = r.end + base,
                l1 = lineAt(a),
                l2 = lineAt(Math.max(a, b - 1));
            if (r.kind === "omit") {
                omits.push({
                    start: a,
                    end: b,
                    line: l1,
                    lastLine: l2,
                    unterminated: !!r.unterminated,
                });
                if (r.unterminated)
                    diagnostics.push({
                        line: l1,
                        code: "unterminated-omit",
                        severity: "warning",
                        message:
                            "Unclosed /* : everything after it is omitted.",
                    });
            } else {
                const n = {
                    start: a,
                    end: b,
                    line: l1,
                    lastLine: l2,
                    text: src.slice(a + 2, b - 2).trim(),
                };
                notes.push(n);
                if (!notesByLine.has(l1)) notesByLine.set(l1, []);
                notesByLine.get(l1).push(n);
            }
        }

        // ---- pre-pass: visible text and transparent lines
        for (const L of lines) {
            const s = L.start - base,
                e = L.end - base;
            L.masked = ranges.length ? maskedBody.slice(s, e) : L.raw;
            L.visible = L.masked.trim();
            let omitHit = false,
                noteHit = false;
            if (ranges.length) {
                if (s === e) {
                    omitHit = mask[s] === 1;
                    noteHit = mask[s] === 2;
                } else
                    for (let p = s; p < e; p++) {
                        if (mask[p] === 1) {
                            omitHit = true;
                            break;
                        }
                        if (mask[p] === 2) noteHit = true;
                    }
            }
            L.type = null;
            L.text = "";
            L.forced = false;
            if (
                markerRes &&
                markerRes.some((r) => {
                    r.lastIndex = 0;
                    return r.test(L.raw);
                })
            )
                L.type = "marker";
            else if (L.visible === "" && (omitHit || noteHit))
                L.type = omitHit ? "omit" : "note";
        }

        // ---- title page (only ever the first thing in the document)
        const titleEntries = [];
        let first = 0;
        while (
            first < lines.length &&
            (TRANSP.has(lines[first].type) ||
                (lines[first].type === null && lines[first].visible === ""))
        )
            first++;
        const km =
            first < lines.length
                ? /^([A-Za-z][A-Za-z ]*?)\s*:\s*(.*)$/.exec(lines[first].masked)
                : null;
        if (km && TITLE_KEYS.has(km[1].toLowerCase().replace(/\s+/g, " "))) {
            let cur = null,
                j = first;
            for (; j < lines.length; j++) {
                const L = lines[j];
                if (TRANSP.has(L.type)) continue;
                if (L.visible === "") break;
                const m = /^([A-Za-z][A-Za-z ]*?)\s*:\s*(.*)$/.exec(L.masked);
                // The block must open with a known key; after that any "Key: value"
                // line belongs to it (Fountain allows custom keys), so an unknown key
                // no longer ends the title page and turns the rest into action.
                if (m && !/^[ \t]/.test(L.masked)) {
                    cur = {
                        key: m[1].trim(),
                        keyLower: m[1].toLowerCase().replace(/\s+/g, " "),
                        value: m[2].trim(),
                        line: j,
                        lastLine: j,
                    };
                    titleEntries.push(cur);
                } else if (cur && /^[ \t]/.test(L.masked)) {
                    cur.value += (cur.value ? "\n" : "") + L.visible;
                    cur.lastLine = j;
                } else break;
                L.type = "title_page";
                L.text = L.visible;
            }
        }
        const titlePage = {};
        for (const e of titleEntries) titlePage[e.keyLower] = e.value;

        // ---- special pages: %%% ... %%% (Sceneform extension)
        // A block between two "%%%" lines is a page of its own (epigraph, quote,
        // in memoriam...). Text is placed with <[pos]>...</[pos]> where pos is
        // tl tc tr cl cc cr bl bc br (or l c r t b); untagged text goes to cc.
        // An unclosed "%%%" is left alone (plain action).
        const specialPages = [];
        const POS_ALIAS = { l: "cl", c: "cc", r: "cr", t: "tc", b: "bc" };
        const POSITIONS = new Set(["tl", "tc", "tr", "cl", "cc", "cr", "bl", "bc", "br"]);
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].type || lines[i].visible.trim() !== "%%%") continue;
            let end = i + 1;
            while (end < lines.length && !(lines[end].type === null && lines[end].visible.trim() === "%%%")) end++;
            if (end >= lines.length) break;
            const body = [];
            for (let j = i; j <= end; j++) {
                const L = lines[j];
                if (TRANSP.has(L.type)) continue;
                L.type = "special_page";
                L.text = j === i || j === end ? "" : L.visible;
                L.delimiter = j === i || j === end;
                if (!L.delimiter) body.push(L.visible);
            }
            lines[i].pageStart = true;
            const text = body.join("\n");
            const items = [];
            const rest = text.replace(/<\[([a-z]{1,2})\]>([\s\S]*?)<\/\[\1\]>/gi, (m, pos, inner) => {
                const p = (POS_ALIAS[pos.toLowerCase()] || pos.toLowerCase());
                if (!POSITIONS.has(p)) return m;
                items.push({ position: p, text: inner.trim() });
                return "";
            });
            if (rest.trim()) items.unshift({ position: "cc", text: rest.trim() });
            specialPages.push({ line: i, lastLine: end, items });
            i = end;
        }

        // ---- main classification pass
        const nextContent = (i) => {
            let j = i + 1;
            while (j < lines.length && TRANSP.has(lines[j].type)) j++;
            return j;
        };
        let prev = "blank",
            inDlg = false;
        for (let i = 0; i < lines.length; i++) {
            const L = lines[i];
            if (L.type) continue; // transparent or title-page line
            const t = L.visible;
            L.indent = L.masked.length - L.masked.trimStart().length;
            const startsBlock = STARTS_BLOCK.has(prev);

            if (t === "") {
                if (L.raw === "  " && (inDlg || prev === "action")) {
                    L.type = inDlg ? "dialogue" : "action";
                    L.continuation = true;
                    continue;
                }
                L.type = "blank";
                prev = "blank";
                inDlg = false;
                continue;
            }

            const c = t[0];
            let type = "action",
                text = t,
                forced = false,
                m;
            if (/^={3,}$/.test(t)) {
                type = "page_break";
                text = "";
            } else if (c === "~") {
                type = "lyrics";
                text = t.slice(1).trim();
                forced = true;
            } else if (inDlg) {
                type = /^\(.*\)$/.test(t) ? "parenthetical" : "dialogue";
            } else if (t.startsWith("!!")) {
                type = "shot";
                text = t.slice(2).trim();
                forced = true;
            } else if (c === "!") {
                type = "action";
                text = t.slice(1).trim();
                forced = true;
            } else if (c === "." && t.length > 1 && t[1] !== ".") {
                type = "scene_heading";
                text = t.slice(1).trim();
                forced = true;
            } else if (c === "@") {
                type = "character";
                text = t.slice(1).trim();
                forced = true;
            } else if (c === "#") {
                m = /^(#+)\s*(.*)$/.exec(t);
                type = "section";
                text = m[2];
                L.depth = m[1].length;
            } else if (/^=(?!=)/.test(t)) {
                type = "synopsis";
                text = t.replace(/^=\s*/, "");
            } else if (c === ">") {
                m = /^>\s*(.*?)\s*<$/.exec(t);
                if (m) {
                    type = "centered";
                    text = m[1];
                } else {
                    type = "transition";
                    text = t.slice(1).trim();
                    forced = true;
                }
            } else if (startsBlock && HEAD_RE.test(t)) {
                type = "scene_heading";
            } else if (startsBlock && isTransition(t)) {
                type = "transition";
            } else if (startsBlock) {
                const cue = cueParts(t);
                if (
                    cue.name &&
                    cue.name.length <= maxCue &&
                    isUpper(cue.name)
                ) {
                    const nx = nextContent(i);
                    const hasBody =
                        nx < lines.length && lines[nx].visible !== "";
                    const caret = opts.caretLine;
                    const provisional =
                        !hasBody &&
                        caret != null &&
                        (i === caret ||
                            (i + 1 === caret &&
                                (lines[caret] || {}).visible === ""));
                    if (hasBody || provisional) {
                        type = "character";
                        L.provisional = provisional && !hasBody;
                    }
                }
            }

            L.type = type;
            L.text = text;
            L.forced = forced;
            if (type === "character") {
                L.character = cueParts(text);
                L.character.forced = forced;
                inDlg = true;
                prev = "character";
            } else if (type === "lyrics") {
                if (inDlg) L.inDialogue = true;
                else prev = "lyrics";
            } else if (
                inDlg &&
                (type === "dialogue" || type === "parenthetical")
            ) {
                prev = type;
            } else {
                inDlg = false;
                prev = type;
            }
        }

        // ---- blocks
        const blocks = [];
        let cur = null;
        const open = (o, i) => {
            o.first = o.last = i;
            blocks.push(o);
            return o;
        };
        for (const L of lines) {
            const ty = L.type,
                i = L.index;
            if (TRANSP.has(ty)) continue;
            if (ty === "blank") {
                cur = null;
                continue;
            }
            if (ty === "special_page") {
                if (L.pageStart || !cur || cur.type !== "special_page")
                    cur = open(
                        {
                            type: "special_page",
                            page: specialPages.find((p) => p.line === i) || null,
                        },
                        i,
                    );
                cur.last = i;
                continue;
            }
            if (ty === "title_page") {
                if (!cur || cur.type !== "title_page")
                    cur = open(
                        {
                            type: "title_page",
                        },
                        i,
                    );
                cur.last = i;
                continue;
            }
            if (ty === "action") {
                if (!cur || cur.type !== "action")
                    cur = open(
                        {
                            type: "action",
                        },
                        i,
                    );
                cur.last = i;
                continue;
            }
            if (ty === "character") {
                cur = open(
                    {
                        type: "dialogue",
                        character: L.character,
                        elements: [],
                    },
                    i,
                );
                continue;
            }
            if (
                ty === "parenthetical" ||
                ty === "dialogue" ||
                (ty === "lyrics" && L.inDialogue)
            ) {
                if (!cur || cur.type !== "dialogue")
                    cur = open(
                        {
                            type: "dialogue",
                            character: null,
                            elements: [],
                        },
                        i,
                    );
                cur.elements.push({
                    type: ty,
                    line: i,
                    text: L.text,
                });
                cur.last = i;
                continue;
            }
            if (ty === "lyrics") {
                if (!cur || cur.type !== "lyrics")
                    cur = open(
                        {
                            type: "lyrics",
                        },
                        i,
                    );
                cur.last = i;
                continue;
            }
            cur = null;
            open(
                {
                    type: ty,
                },
                i,
            );
        }
        for (const B of blocks) {
            B.start = lines[B.first].start;
            B.end = lines[B.last].end;
        }

        // ---- scenes, outline, characters, dual dialogue, continued dialogue
        const scenes = [],
            outline = [],
            chars = new Map();
        let scene = null,
            node = null,
            autoNo = 0,
            lastSpeaker = null,
            interrupted = false;
        const closeScene = (endLineIdx) => {
            if (!scene) return;
            scene.lastLine = endLineIdx - 1;
            scene.end = lines[endLineIdx]
                ? lines[endLineIdx].start
                : src.length;
            scene = null;
        };
        for (let b = 0; b < blocks.length; b++) {
            const B = blocks[b],
                L = lines[B.first];
            if (B.type === "section") {
                closeScene(B.first);
                node = {
                    kind: "section",
                    depth: L.depth,
                    title: L.text,
                    line: B.first,
                    start: L.start,
                    synopsis: [],
                };
                outline.push(node);
                lastSpeaker = null;
                interrupted = false;
                continue;
            }
            if (B.type === "scene_heading") {
                closeScene(B.first);
                const h = parseHeading(L.text, notesByLine.get(B.first));
                scene = {
                    kind: "scene",
                    index: scenes.length,
                    line: B.first,
                    start: L.start,
                    end: src.length,
                    lastLine: lines.length - 1,
                    autoNumber: ++autoNo,
                    customNumber: h.number,
                    number: h.number || String(autoNo),
                    title: h.title,
                    prefix: h.prefix,
                    location: h.location,
                    time: h.time,
                    parts: h.parts,
                    color: h.color,
                    forced: L.forced,
                    synopsis: [],
                    notes: [],
                    shots: [],
                    characters: [],
                    blocks: [b, b],
                };
                scenes.push(scene);
                outline.push(scene);
                node = scene;
                lastSpeaker = null;
                interrupted = false;
                continue;
            }
            if (scene) scene.blocks[1] = b;
            if (B.type === "synopsis") {
                if (node) node.synopsis.push(L.text);
                continue;
            }
            if (B.type === "shot") {
                if (scene)
                    scene.shots.push({
                        line: B.first,
                        text: L.text,
                    });
                interrupted = true;
                continue;
            }
            if (B.type === "dialogue") {
                const c = B.character;
                if (!c) {
                    interrupted = true;
                    continue;
                }
                const key = c.name.toUpperCase().replace(/\s+/g, " ");
                B.speaker = key;
                B.continued = c.contd
                    ? "explicit"
                    : key === lastSpeaker && interrupted
                      ? "auto"
                      : null;
                B.dual = null;
                if (c.dual) {
                    const p = blocks[b - 1];
                    if (p && p.type === "dialogue" && p.dual !== "right") {
                        p.dual = "left";
                        B.dual = "right";
                    } else
                        diagnostics.push({
                            line: B.first,
                            code: "dual-without-partner",
                            severity: "warning",
                            message:
                                "^ needs a dialogue block directly before it.",
                        });
                }
                lastSpeaker = key;
                interrupted = false;
                let e = chars.get(key);
                if (!e) {
                    e = {
                        name: key,
                        count: 0,
                        firstLine: B.first,
                        scenes: [],
                    };
                    chars.set(key, e);
                }
                e.count++;
                if (scene) {
                    if (e.scenes[e.scenes.length - 1] !== scene.index)
                        e.scenes.push(scene.index);
                    if (scene.characters.indexOf(key) < 0)
                        scene.characters.push(key);
                }
                continue;
            }
            if (
                B.type === "action" ||
                B.type === "centered" ||
                B.type === "lyrics" ||
                B.type === "transition"
            )
                interrupted = true;
        }
        closeScene(lines.length);
        if (scenes.length)
            scenes[scenes.length - 1].lastLine = lines.length - 1;
        for (const n of notes) {
            for (let s = scenes.length - 1; s >= 0; s--)
                if (scenes[s].line <= n.line) {
                    if (n.line <= scenes[s].lastLine) scenes[s].notes.push(n);
                    break;
                }
        }

        return {
            text: src,
            bom,
            lines,
            blocks,
            scenes,
            outline,
            notes,
            omits,
            diagnostics,
            titlePage,
            titleEntries,
            specialPages,
            characters: Array.from(chars.values()),
        };
    }

    function serialize(doc) {
        return (
            (doc.bom ? "\uFEFF" : "") +
            doc.lines.map((l) => l.raw + l.eol).join("")
        );
    }

    return {
        parse,
        parseInline,
        serialize,
        LINE_TYPES,
    };
});
