export interface CanvasCard {
    id: string;
    type: "markdown" | "scene-ref" | "image";
    title: string;
    body?: string;
    sceneId?: string;
    x: number;
    y: number;
    w: number;
    h: number;
    /** Who created the card, and who last changed it, with ISO times (blame for canvases). */
    createdBy?: string;
    createdAt?: string;
    editedBy?: string;
    editedAt?: string;
}
