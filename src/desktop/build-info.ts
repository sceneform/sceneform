// src/desktop/build-info.ts
//
// Build identifier shown in About and Settings, e.g. "0.80.0+sf-9hmw Q4 2026".
// The version comes from app.getVersion() (package.json, works inside the asar).
// The build ID and build date are generated once per build by scripts/desktop.mjs
// and injected with esbuild `define`, so they are stable for a given build and
// this module has no side effects. (Replaces the desktop use of src/backend/sfsemver.ts.)

declare const __SF_BUILD_ID__: string;
declare const __SF_BUILD_DATE__: string;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface BuildInfo {
    /** e.g. "sf-9hmw"; "sf-dev" when main was not bundled by scripts/desktop.mjs. */
    buildId: string;
    /** ISO date of the build. */
    buildDate: string;
    /** e.g. "0.80.0+sf-9hmw" */
    semver: string;
    /** e.g. "Q4 2026" */
    quarter: string;
    /** e.g. "Mid Oct 2026" */
    monthPeriod: string;
    /** e.g. "0.80.0+sf-9hmw Q4 2026" */
    label: string;
}

export function buildInfo(version: string): BuildInfo {
    const buildId = typeof __SF_BUILD_ID__ === "string" ? __SF_BUILD_ID__ : "sf-dev";
    const buildDate = typeof __SF_BUILD_DATE__ === "string" ? __SF_BUILD_DATE__ : new Date().toISOString();
    const date = new Date(buildDate);
    const month = date.getUTCMonth();
    const year = date.getUTCFullYear();
    const day = date.getUTCDate();
    const quarter = `Q${Math.floor(month / 3) + 1} ${year}`;
    const period = day <= 10 ? "Early" : day <= 20 ? "Mid" : "Late";
    const semver = `${version}+${buildId}`;
    return {
        buildId,
        buildDate,
        semver,
        quarter,
        monthPeriod: `${period} ${MONTHS[month]} ${year}`,
        label: `${semver} ${quarter}`,
    };
}
