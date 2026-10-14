// src/renderer/components/startup.tsx
import { Titlebar } from "./chrome";
import { IconFolder, SceneformMark } from "./icons";

/**
 * Shown only while the profile is genuinely loading. The old splash ran a
 * fixed timer with invented progress steps and could finish before the
 * profile did, sending existing users to first-time setup.
 */
export function SplashScreen({ version }: { version: string }) {
    return (
        <div className="splash" aria-label="Sceneform is starting" aria-busy="true">
            <div className="splash__mark" aria-hidden="true">
                <SceneformMark size={48} className="splash__mark-icon" />
                <span>sceneform</span><span className="splash__caret" />
            </div>
            <p className="splash__slug">
                <span className="heading">INT.</span> STARTUP <span className="heading">-</span> CONTINUOUS
            </p>
            <div className="splash__footer">
                <span>{version ? `v${version}` : ""}</span>
                <span>© 2026 Blasius Nafiri Marvin</span>
            </div>
        </div>
    );
}

export function FirstTimeSetupScreen(props: {
    busy: boolean;
    error: string | null;
    reason: "first-run" | "folder-missing" | "folder-unusable";
    previousFolder: string | null;
    suggestedFolder: string;
    onUseSuggested: () => void;
    onChoose: () => void;
}) {
    const missing = props.reason !== "first-run";
    // Not a centred card: the screen reads like the top of a page, anchored to
    // the left margin, with the one decision (the folder) shown as a file row.
    return (
        <div className="shell">
            <Titlebar />
            <div className="startup-screen startup-screen--page">
                <div className="setup">
                    <div className="startup-mark">
                        <SceneformMark size={22} className="startup-mark__icon" />
                        <span>sceneform</span>
                    </div>
                    <h1 className="setup__title">{missing ? "Your project folder moved" : "Welcome to Sceneform"}</h1>
                    <p className="setup__lede">
                        {missing
                            ? `Sceneform can't use ${props.previousFolder ?? "your old folder"} anymore. Pick it again if it moved, or choose a new one. Nothing has been deleted.`
                            : "Choose where Sceneform keeps your projects. Every project is one self-contained .sfp file there. You can change this later in Settings."}
                    </p>
                    <div className="setup__label" id="setupFolderLabel">Project folder</div>
                    <div className="setup__folder" aria-labelledby="setupFolderLabel">
                        <IconFolder size={16} className="setup__folder-icon" />
                        <span className="setup__path" title={props.suggestedFolder || undefined}>
                            <bdi dir="ltr">{props.suggestedFolder || "No folder chosen yet"}</bdi>
                        </span>
                        <button className="btn btn--ghost btn--sm" disabled={props.busy} onClick={props.onChoose}>
                            {props.suggestedFolder ? "Choose another…" : "Choose…"}
                        </button>
                    </div>
                    <div className="setup__actions">
                        {props.suggestedFolder ? (
                            <button className="btn btn--primary" disabled={props.busy} onClick={props.onUseSuggested}>
                                {props.busy ? "Setting up…" : "Use this folder"}
                            </button>
                        ) : (
                            <button className="btn btn--primary" disabled={props.busy} onClick={props.onChoose}>
                                Choose a folder…
                            </button>
                        )}
                    </div>
                    {props.error && <div className="startup-error" role="alert">{props.error}</div>}
                </div>
            </div>
        </div>
    );
}

export function StartupErrorScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
    return (
        <div className="shell">
            <Titlebar />
            <div className="startup-screen startup-screen--page">
                <div className="setup">
                    <div className="startup-mark">
                        <SceneformMark size={22} className="startup-mark__icon" />
                        <span>sceneform</span>
                    </div>
                    <h1 className="setup__title">Sceneform couldn't start</h1>
                    <div className="startup-error" role="alert">{message}</div>
                    <div className="setup__actions">
                        <button className="btn btn--primary" onClick={onRetry}>Try again</button>
                    </div>
                </div>
            </div>
        </div>
    );
}
