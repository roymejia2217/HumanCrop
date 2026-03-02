import { contextBridge, ipcRenderer } from 'electron';

/** 
 * Preload script: Securely exposes Electron APIs to the renderer process via contextBridge.
 * Implements a strict interface to maintain security and isolation.
 */

contextBridge.exposeInMainWorld('electronAPI', {
    /** Filesystem and dialog interactions */
    openPath: (path: string) => ipcRenderer.invoke('open-path', path),
    selectInputDir: () => ipcRenderer.invoke('select-input-dir'),
    selectFiles: () => ipcRenderer.invoke('select-files'),
    selectOutputDir: () => ipcRenderer.invoke('select-output-dir'),
    
    /** Processing and state synchronization */
    startBatch: (config: any) => ipcRenderer.invoke('start-batch', config),
    getTranslations: () => ipcRenderer.invoke('get-translations'),
    getSystemStatus: () => ipcRenderer.invoke('get-system-status'),
    
    /** Event listeners: Main process to Renderer communication */
    onLanguageChanged: (callback: (data: any) => void) => {
        ipcRenderer.on('language-changed', (_event, data) => callback(data));
    },
    onSystemStatus: (callback: (data: any) => void) => {
        ipcRenderer.on('system-status', (_event, data) => callback(data));
    },
    onBatchProgress: (callback: (data: any) => void) => {
        ipcRenderer.on('batch-progress', (_event, data) => callback(data));
    },
    onShowHelp: (callback: () => void) => {
        ipcRenderer.on('show-help', () => callback());
    },
    onTriggerAddFolder: (callback: () => void) => {
        ipcRenderer.on('trigger-add-folder', () => callback());
    },
    onTriggerAddFiles: (callback: () => void) => {
        ipcRenderer.on('trigger-add-files', () => callback());
    }
});
