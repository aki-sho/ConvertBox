const { contextBridge, ipcRenderer } = require("electron");
// Sandboxed preloads cannot require local CommonJS files. Main supplies the
// shared format definition as a single process argument when creating a window.
const formatArgument = process.argv.find((argument) => argument.startsWith("--convertbox-formats="));
if (!formatArgument) throw new Error("変換形式の初期設定が見つかりません");
const CONVERSION_FORMATS = JSON.parse(formatArgument.slice("--convertbox-formats=".length));

contextBridge.exposeInMainWorld("convertBox", {
  formats: CONVERSION_FORMATS,
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
