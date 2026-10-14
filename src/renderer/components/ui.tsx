// src/renderer/components/ui.tsx
// Small shared building blocks so every screen uses the same toggle, modal and toast.

import { useEffect, useRef, type ReactNode } from "react";

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
    return (
        <label className="toggle">
            <input type="checkbox" checked={checked} aria-label={label} onChange={(e) => onChange(e.target.checked)} />
            <span className="toggle__track">
                <span className="toggle__thumb" />
            </span>
        </label>
    );
}

export function SettingRow({ label, desc, wide, children }: { label: string; desc?: ReactNode; wide?: boolean; children: ReactNode }) {
    return (
        <div className={`setting-row${wide ? " setting-row--wide" : ""}`}>
            <div className="setting-row__text">
                <div className="setting-row__label">{label}</div>
                {desc && <div className="setting-row__desc">{desc}</div>}
            </div>
            <div className="setting-row__control">{children}</div>
        </div>
    );
}

/** A settings group: a side head in the margin, its rows beside it (like a script's slug and its scene). */
export function SettingGroup({ title, children }: { title: string; children: ReactNode }) {
    return (
        <section className="settings-group" aria-label={title}>
            <h2 className="settings-group__title">{title}</h2>
            <div className="settings-group__rows">{children}</div>
        </section>
    );
}

export function Segmented<T extends string>({
    value,
    options,
    onChange,
}: {
    value: T;
    options: Array<{ value: T; label: string; disabled?: boolean; title?: string }>;
    onChange: (v: T) => void;
}) {
    return (
        <div className="segmented" role="radiogroup">
            {options.map((o) => (
                <button
                    key={o.value}
                    type="button"
                    role="radio"
                    aria-checked={value === o.value}
                    className={`segmented__btn ${value === o.value ? "is-active" : ""}`}
                    disabled={o.disabled}
                    title={o.title}
                    onClick={() => onChange(o.value)}
                >
                    {o.label}
                </button>
            ))}
        </div>
    );
}

/** Modal with focus trapping on open, Escape to close, and click-outside to close. */
export function Modal({
    open,
    onClose,
    labelledBy,
    className = "",
    children,
}: {
    open: boolean;
    onClose: () => void;
    labelledBy: string;
    className?: string;
    children: ReactNode;
}) {
    const box = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!open) return;
        const previous = document.activeElement as HTMLElement | null;
        const first = box.current?.querySelector<HTMLElement>("[autofocus], input, select, textarea, button");
        first?.focus();
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.stopPropagation();
                onClose();
            }
        };
        window.addEventListener("keydown", onKey, true);
        return () => {
            window.removeEventListener("keydown", onKey, true);
            previous?.focus?.();
        };
    }, [open, onClose]);

    if (!open) return null;
    return (
        <div className="modal-scrim is-open" onMouseDown={onClose}>
            <div
                ref={box}
                className={`modal ${className}`}
                role="dialog"
                aria-modal="true"
                aria-labelledby={labelledBy}
                onMouseDown={(e) => e.stopPropagation()}
            >
                {children}
            </div>
        </div>
    );
}

export interface ConfirmRequest {
    title: string;
    body: ReactNode;
    confirmLabel: string;
    danger?: boolean;
    onConfirm: () => void;
}

export function ConfirmDialog({ request, onClose }: { request: ConfirmRequest | null; onClose: () => void }) {
    return (
        <Modal open={!!request} onClose={onClose} labelledBy="confirmTitle">
            {request && (
                <>
                    <h2 className="modal__title" id="confirmTitle">{request.title}</h2>
                    <div className="modal__body">{request.body}</div>
                    <div className="modal__actions">
                        <button className="btn btn--secondary" onClick={onClose}>Cancel</button>
                        <button
                            className={`btn ${request.danger ? "btn--danger" : "btn--primary"}`}
                            onClick={() => {
                                request.onConfirm();
                                onClose();
                            }}
                        >
                            {request.confirmLabel}
                        </button>
                    </div>
                </>
            )}
        </Modal>
    );
}

export interface Toast {
    id: number;
    text: string;
    kind: "success" | "error" | "info";
}

export function ToastRegion({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
    return (
        <div className="toast-region" role="status" aria-live="polite">
            {toasts.map((t) => (
                <button key={t.id} className={`toast toast--${t.kind}`} onClick={() => onDismiss(t.id)} title="Dismiss">
                    {t.text}
                </button>
            ))}
        </div>
    );
}

export function EmptyState({ title, body, children }: { title?: string; body: string; children?: ReactNode }) {
    return (
        <div className="empty-state">
            {title && <p className="empty-state__title">{title}</p>}
            <p className="empty-state__body">{body}</p>
            {children}
        </div>
    );
}
