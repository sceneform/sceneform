// themes.ts
//
// Colour palettes on top of the Sceneform design tokens. A palette only sets
// the --c-* variables (main.css / app.css), so every screen follows it.
// "sceneform" means "use the Dark / Light / System theme as is".

export interface Palette {
    id: string;
    label: string;
    mode: "dark" | "light";
    vars: Record<string, string>;
}

const surfaces = (s0: string, s1: string, s2: string, s3: string, s4: string) => ({
    "--c-bg": s0,
    "--c-surface-0": s0,
    "--c-surface-1": s1,
    "--c-surface-2": s2,
    "--c-surface-3": s3,
    "--c-surface-4": s4,
    "--c-border": s4,
    "--c-border-soft": s3,
});

export const PALETTES: Palette[] = [
    {
        id: "catppuccin-mocha",
        label: "Catppuccin Mocha",
        mode: "dark",
        vars: {
            ...surfaces("#1e1e2e", "#181825", "#24273a", "#313244", "#45475a"),
            "--c-fg": "#cdd6f4", "--c-text": "#cdd6f4", "--c-text-dim": "#a6adc8", "--c-text-faint": "#7f849c",
            "--c-accent": "#a6e3a1", "--c-accent-ink": "#1e1e2e",
            "--c-crimson": "#f38ba8", "--c-crimson-bright": "#f38ba8",
            "--c-blue": "#89b4fa", "--c-blue-bright": "#89b4fa", "--c-dialogue": "#f9e2af",
        },
    },
    {
        id: "catppuccin-latte",
        label: "Catppuccin Latte",
        mode: "light",
        vars: {
            ...surfaces("#eff1f5", "#e6e9ef", "#dce0e8", "#ccd0da", "#bcc0cc"),
            "--c-fg": "#4c4f69", "--c-text": "#4c4f69", "--c-text-dim": "#5c5f77", "--c-text-faint": "#8c8fa1",
            "--c-accent": "#40a02b", "--c-accent-ink": "#eff1f5",
            "--c-crimson": "#d20f39", "--c-crimson-bright": "#d20f39",
            "--c-blue": "#1e66f5", "--c-blue-bright": "#1e66f5", "--c-dialogue": "#df8e1d",
        },
    },
    {
        id: "ayu-dark",
        label: "Ayu Dark",
        mode: "dark",
        vars: {
            ...surfaces("#0b0e14", "#0d1017", "#131721", "#1c212b", "#272d38"),
            "--c-fg": "#bfbdb6", "--c-text": "#bfbdb6", "--c-text-dim": "#8a8986", "--c-text-faint": "#565b66",
            "--c-accent": "#e6b450", "--c-accent-ink": "#0b0e14",
            "--c-crimson": "#f07178", "--c-crimson-bright": "#f07178",
            "--c-blue": "#59c2ff", "--c-blue-bright": "#59c2ff", "--c-dialogue": "#aad94c",
        },
    },
    {
        id: "ayu-light",
        label: "Ayu Light",
        mode: "light",
        vars: {
            ...surfaces("#fcfcfc", "#f8f9fa", "#f0f1f2", "#e7e8e9", "#d8d9da"),
            "--c-fg": "#5c6166", "--c-text": "#5c6166", "--c-text-dim": "#787b80", "--c-text-faint": "#a0a6ac",
            "--c-accent": "#f2ae49", "--c-accent-ink": "#ffffff",
            "--c-crimson": "#f07171", "--c-crimson-bright": "#f07171",
            "--c-blue": "#399ee6", "--c-blue-bright": "#399ee6", "--c-dialogue": "#86b300",
        },
    },
    {
        id: "nord",
        label: "Nord",
        mode: "dark",
        vars: {
            ...surfaces("#2e3440", "#2b303b", "#3b4252", "#434c5e", "#4c566a"),
            "--c-fg": "#eceff4", "--c-text": "#eceff4", "--c-text-dim": "#d8dee9", "--c-text-faint": "#81a1c1",
            "--c-accent": "#a3be8c", "--c-accent-ink": "#2e3440",
            "--c-crimson": "#bf616a", "--c-crimson-bright": "#bf616a",
            "--c-blue": "#5e81ac", "--c-blue-bright": "#88c0d0", "--c-dialogue": "#ebcb8b",
        },
    },
];

const ALL_VARS = [...new Set(PALETTES.flatMap((p) => Object.keys(p.vars)))];

/** Applies a palette (or clears it for "sceneform") plus the user's custom CSS. Returns the mode it forces, if any. */
export function applyPalette(id: string, customCss: string): "dark" | "light" | null {
    const root = document.documentElement;
    for (const v of ALL_VARS) root.style.removeProperty(v);
    const palette = PALETTES.find((p) => p.id === id);
    if (palette) for (const [k, v] of Object.entries(palette.vars)) root.style.setProperty(k, v);
    let style = document.getElementById("sf-custom-css") as HTMLStyleElement | null;
    if (!style) {
        style = document.createElement("style");
        style.id = "sf-custom-css";
        document.head.appendChild(style);
    }
    style.textContent = customCss;
    return palette?.mode ?? null;
}
