// scripts/desktop.mjs
//
//   node scripts/desktop.mjs build   -> bundle main + preload into dist-electron/
//   node scripts/desktop.mjs dev     -> vite dev server + electron with live renderer
//
// The renderer is built by Vite (vite.config.mjs). Main and preload are bundled
// with esbuild; the backend stays a plain TypeScript library under src/backend.

import { build, context } from "esbuild";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "dist-electron");
const mode = process.argv[2] ?? "build";

// Build identity, generated once per build (and once per `dev` session) and injected
// into main with esbuild `define` (see src/desktop/build-info.ts). The version itself
// comes from app.getVersion() at runtime.
function randomBuildId() {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    let id = "";
    for (let i = 0; i < 4; i++) id += chars[Math.floor(Math.random() * chars.length)];
    return `sf-${id}`;
}
const buildId = process.env.SCENEFORM_BUILD_ID || randomBuildId();
const buildDate = new Date().toISOString();

const shared = {
    bundle: true,
    platform: "node",
    target: "node22",
    sourcemap: true,
    logLevel: "info",
    external: ["electron", "jszip", "pdf-lib"],
    define: {
        __SF_BUILD_ID__: JSON.stringify(buildId),
        __SF_BUILD_DATE__: JSON.stringify(buildDate),
    },
};

const mainOptions = {
    ...shared,
    entryPoints: [path.join(root, "src/desktop/main.ts")],
    outfile: path.join(out, "main.js"),
    format: "esm",
};

const preloadOptions = {
    ...shared,
    entryPoints: [path.join(root, "src/desktop/preload.ts")],
    outfile: path.join(out, "preload.cjs"),
    format: "cjs",
};

// screenplay.ts loads the parser with createRequire("./fountain-js/fountain-parser.cjs")
// relative to the running module, so the CommonJS copy has to sit next to main.js.
function copyParser() {
    const source = path.join(root, "src/backend/fountain-js/fountain-parser.js");
    const target = path.join(out, "fountain-js/fountain-parser.cjs");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
}

async function buildOnce() {
    fs.mkdirSync(out, { recursive: true });
    copyParser();
    await Promise.all([build(mainOptions), build(preloadOptions)]);
}

async function dev() {
    fs.mkdirSync(out, { recursive: true });
    copyParser();

    const vite = await import("vite");
    const server = await vite.createServer({ configFile: path.join(root, "vite.config.mjs") });
    await server.listen();
    const url = server.resolvedUrls?.local?.[0] ?? "http://localhost:5173/";

    let electron = null;
    const electronBin = (await import("electron")).default;

    const launch = () => {
        if (electron) {
            electron.removeAllListeners("exit");
            electron.kill();
        }
        electron = spawn(electronBin, [root], {
            stdio: "inherit",
            env: { ...process.env, SCENEFORM_DEV_URL: url },
        });
        electron.on("exit", async () => {
            await server.close();
            process.exit(0);
        });
    };

    const restartPlugin = {
        name: "restart-electron",
        setup(b) {
            let first = true;
            b.onEnd((result) => {
                if (result.errors.length) return;
                if (first) {
                    first = false;
                    return;
                }
                launch();
            });
        },
    };

    const mainCtx = await context({ ...mainOptions, plugins: [restartPlugin] });
    const preloadCtx = await context({ ...preloadOptions, plugins: [restartPlugin] });
    await Promise.all([mainCtx.rebuild(), preloadCtx.rebuild()]);
    await Promise.all([mainCtx.watch(), preloadCtx.watch()]);
    launch();
}

if (mode === "dev") {
    await dev();
} else {
    await buildOnce();
}
