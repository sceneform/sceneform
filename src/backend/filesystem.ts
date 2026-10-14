// filesystem.ts

import fs from "node:fs/promises";
import { dialog } from "electron";

export async function loadFountain(): Promise<string | undefined> {
    const { canceled, filePaths } = await dialog.showOpenDialog({
        properties: ["openFile"],
        filters: [
            {
                name: "Fountain screenplay",
                extensions: ["fountain", "txt"],
            },
            {
                name: "All files",
                extensions: ["*"],
            },
        ],
    });

    if (canceled || filePaths.length === 0) {
        console.log("Open cancelled");
        return undefined;
    }

    console.log("Selected:", filePaths[0]);

    return filePaths[0];
}

export async function readFountain(path: string): Promise<string> {
    return await fs.readFile(path, "utf8");
}

export async function writeFountain(
    path: string,
    content: string,
): Promise<void> {
    await fs.writeFile(path, content, "utf8");
}
