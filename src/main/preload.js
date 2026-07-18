const { contextBridge, ipcRenderer } = require("electron");
const { FORMATS } = require("../shared/formats");

contextBridge.exposeInMainWorld("fileConverter", {
  formats: FORMATS,
  getAppVersion: () => ipcRenderer.invoke("app:get-version"),
  selectFile: (category) => ipcRenderer.invoke("file:select", category),
  analyzeVideo: (filePath) => ipcRenderer.invoke("video:analyze", filePath),
  analyzeAudio: (filePath) => ipcRenderer.invoke("audio:analyze", filePath),
  analyzeImage: (filePath) => ipcRenderer.invoke("image:analyze", filePath),
  requestConversion: (request) => ipcRenderer.invoke("conversion:request", request),
  downloadConversion: (conversionId) => ipcRenderer.invoke("conversion:download", conversionId),
  discardConversion: (conversionId) => ipcRenderer.invoke("conversion:discard", conversionId),
  onConversionProgress: (callback) => {
    ipcRenderer.removeAllListeners("conversion:progress");
    ipcRenderer.on("conversion:progress", (_event, percent) => callback(percent));
  }
});
