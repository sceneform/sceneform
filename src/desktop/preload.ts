// src/desktop/preload.ts
//
// Sandboxed preload: exposes window.sceneform and nothing else.
// Bundled to CommonJS (dist-electron/preload.cjs) because sandboxed
// preloads cannot be ES modules.

import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { CHANNELS, assetUrl, type SceneformAPI } from "../shared/bridge.js";

const invoke = ipcRenderer.invoke.bind(ipcRenderer);

function listen<T extends unknown[]>(channel: string, cb: (...args: T) => void): () => void {
    const handler = (_event: IpcRendererEvent, ...args: unknown[]) => cb(...(args as T));
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
}

const api: SceneformAPI = {
    fountain: {
        open: () => invoke(CHANNELS.fountain.open),
        saveFdx: (xml, suggestedName) => invoke(CHANNELS.fountain.saveFdx, xml, suggestedName),
    },
    profile: {
        open: () => invoke(CHANNELS.profile.open),
        defaultFolder: () => invoke(CHANNELS.profile.defaultFolder),
        pickFolder: (initial) => invoke(CHANNELS.profile.pickFolder, initial ?? null),
        setFolder: (folder) => invoke(CHANNELS.profile.setFolder, folder),
    },
    project: {
        list: (folder) => invoke(CHANNELS.project.list, folder),
        recent: () => invoke(CHANNELS.project.recent),
        open: (file) => invoke(CHANNELS.project.open, file),
        save: (file, data) => invoke(CHANNELS.project.save, file, data),
        create: (folder, name, author, logline, script) =>
            invoke(CHANNELS.project.create, folder, name, author, logline, script ?? null),
        trash: (file) => invoke(CHANNELS.project.trash, file),
        rename: (file, title) => invoke(CHANNELS.project.rename, file, title),
        exportPdf: (script, title, options) => invoke(CHANNELS.project.exportPdf, script, title, options),
        exportFountain: (script, title, defaults) => invoke(CHANNELS.project.exportFountain, script, title, defaults ?? null),
        browse: () => invoke(CHANNELS.project.browse),
        reveal: (file) => invoke(CHANNELS.project.reveal, file),
        backup: (file) => invoke(CHANNELS.project.backup, file),
        restoreBackup: (file) => invoke(CHANNELS.project.restoreBackup, file),
        readCopy: (current) => invoke(CHANNELS.project.readCopy, current),
    },
    settings: {
        load: () => invoke(CHANNELS.settings.load),
        save: (settings) => invoke(CHANNELS.settings.save, settings),
    },
    window: {
        minimize: () => ipcRenderer.send(CHANNELS.window.minimize),
        toggleMaximize: () => ipcRenderer.send(CHANNELS.window.toggleMaximize),
        close: () => ipcRenderer.send(CHANNELS.window.close),
        isMaximized: () => invoke(CHANNELS.window.isMaximized),
        onMaximizedChange: (cb) => listen<[boolean]>(CHANNELS.window.maximizedChanged, cb),
        onCloseRequested: (cb) => listen<[]>(CHANNELS.window.closeRequested, cb),
        confirmClose: () => ipcRenderer.send(CHANNELS.window.confirmClose),
    },
    history: {
        list: (projectPath) => invoke(CHANNELS.history.list, projectPath),
        read: (projectPath, id) => invoke(CHANNELS.history.read, projectPath, id),
        label: (projectPath, docs, label) => invoke(CHANNELS.history.label, projectPath, docs, label),
    },
    assets: {
        pick: (projectPath) => invoke(CHANNELS.assets.pick, projectPath),
        add: (projectPath, fileName, bytes) => invoke(CHANNELS.assets.add, projectPath, fileName, bytes),
        url: (projectPath, asset) => assetUrl(projectPath, asset),
    },
    app: {
        info: () => invoke(CHANNELS.app.info),
        openExternal: (url) => invoke(CHANNELS.app.openExternal, url),
    },
};

contextBridge.exposeInMainWorld("sceneform", api);
