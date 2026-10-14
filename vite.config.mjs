// vite.config.mjs — renderer build for the Sceneform desktop app.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    root: path.join(root, "src/renderer"),
    base: "./",
    plugins: [react()],
    server: { port: 5173, strictPort: false },
    build: {
        outDir: path.join(root, "dist-renderer"),
        emptyOutDir: true,
        sourcemap: true,
        target: "chrome130",
        chunkSizeWarningLimit: 1500,
    },
});
