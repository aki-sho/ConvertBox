const { contextBridge, ipcRenderer, webUtils } = require("electron");
// Sandboxed preloads cannot require local CommonJS files. Main supplies the
// shared format definition as a single process argument when creating a window.
const formatArgument = process.argv.find((argument) => argument.startsWith("--convertbox-formats="));
if (!formatArgument) throw new Error("変換形式の初期設定が見つかりません");
const CONVERSION_FORMATS = JSON.parse(formatArgument.slice("--convertbox-formats=".length));

contextBridge.exposeInMainWorld("convertBox", {
  formats: CONVERSION_FORMATS,
  getAppVersion: () => ipcRenderer.invoke("app:get-version"),
  selectFile: (category) => ipcRenderer.invoke("file:select", category),
  selectFiles: (category) => ipcRenderer.invoke("files:select", category),
  importDroppedFiles: (files, category) => {
    if (!Array.isArray(files) || !files.length || files.length > 100) throw new Error("1〜100件のファイルをドロップしてください");
    const paths = files.map((file) => webUtils.getPathForFile(file));
    if (paths.some((filePath) => !filePath)) throw new Error("PCに保存されたファイルをドロップしてください");
    return ipcRenderer.invoke("files:drop", { paths, category });
  },
  selectOutputDirectory: () => ipcRenderer.invoke("output:select-directory"),
  clearOutputDirectory: () => ipcRenderer.invoke("output:clear-directory"),
  enqueue: (request) => ipcRenderer.invoke("queue:enqueue", request),
  getQueue: () => ipcRenderer.invoke("queue:get"),
  cancelJob: (id) => ipcRenderer.invoke("queue:cancel", id),
  retryJob: (request) => ipcRenderer.invoke("queue:retry", request),
  clearFinished: () => ipcRenderer.invoke("queue:clear-finished"),
  onQueueChanged: (callback) => {
    ipcRenderer.removeAllListeners("queue:changed");
    ipcRenderer.on("queue:changed", (_event, jobs) => callback(jobs));
  },
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
