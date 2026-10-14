export interface SceneItem {
    id: string;
    num: number;
    heading: string;
    desc: string;
    location: string;
    wip?: boolean;
    omitted?: boolean;
}
