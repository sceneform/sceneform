// Per-project entity data (format v2): what the writer adds about characters,
// locations and scenes. Everything derived from the script itself (cues,
// scenes, first appearance) is computed by the parser and never stored.

export type CharacterRole = "" | "protagonist" | "antagonist" | "supporting" | "minor" | "custom";

export interface CharacterEntity {
    aliases?: string[];
    age?: string;
    gender?: string;
    role?: CharacterRole;
    /** Free text role, used when role is "custom". */
    roleCustom?: string;
    description?: string;
    /** Markdown; may embed pictures as ![](assets/...). */
    bio?: string;
    /** Asset path ("assets/...") of the portrait image. */
    portrait?: string;
}

export interface LocationEntity {
    description?: string;
    /** Markdown; may embed pictures. */
    notes?: string;
    /** Asset paths. */
    pictures?: string[];
}

/** Scene metadata. Same keys as v1 meta.json scenes, plus notes and pictures. */
export interface SceneEntity {
    location?: string;
    short_description?: string;
    omitted?: boolean;
    wip?: boolean;
    comments?: string[];
    inspo?: string[];
    /** Markdown; may embed pictures. */
    notes?: string;
    /** Asset paths. */
    pictures?: string[];
}

export interface SfpEntities {
    /** Keyed by the uppercase character cue name (e.g. "MAERI"). */
    characters: Record<string, CharacterEntity>;
    /** Keyed by the uppercase location name (e.g. "FERRY - MAIN DECK"). */
    locations: Record<string, LocationEntity>;
    /**
     * Keyed by screenplay document id, then by scene key: the scene's
     * [[id:...]] marker ("id:abc") when it has one, else its position ("scene-3"),
     * exactly like v1 meta.json.
     */
    scenes: Record<string, Record<string, SceneEntity>>;
}
