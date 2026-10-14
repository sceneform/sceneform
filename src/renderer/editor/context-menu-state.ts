// context-menu-state.ts
//
// Whether a right-click menu is on screen. Kept apart from context-menu.ts so the
// hover-card sources (fountain-extension.ts, spellcheck.ts) can read it without
// an import cycle: they return null while the menu is open, so two popups never stack.

let menuOpen = false;

export function setContextMenuOpen(value: boolean): void {
    menuOpen = value;
}

export function contextMenuIsOpen(): boolean {
    return menuOpen;
}
