const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
    onProgress: (callback) => ipcRenderer.on('download-progress', callback),
    onComplete: (callback) => ipcRenderer.on('download-complete', callback),
    cancelDownload: () => ipcRenderer.send('cancel-active-download'),
    openFile: (filePath) => ipcRenderer.send('open-downloaded-file', filePath) // Kabel baru untuk Buka File
});