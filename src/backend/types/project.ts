export interface ProjectSummary {
    id: string;
    title: string;
    author: string;
    logline: string;
    updated: string;
    /** Estimated pages. Since format v2: the total across every screenplay in the project. */
    pages: number;
    timeSpent: string;
    notes: string;
    /** Scene count. Since format v2: the total across every screenplay in the project. */
    scenes: number;
    /** Project accent color, used for the project-list swatch (Project settings). */
    color: string;
    pinned?: boolean;
    /** Number of screenplays (episodes) the totals above cover. Absent in v1 archives (= 1). */
    screenplays?: number;
    genre?: string;
    /** Asset path ("assets/...") of the project's banner image, shown in the project list and Project information. */
    banner?: string;
}
