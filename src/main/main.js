const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const { inferCategory, getExtension } = require("../shared/formats");
const {
  analyzeVideo,
  analyzeAudio,
  convertVideo,
  convertAudio,
  terminateActiveProcesses
} = require("../converter/converterService");
const { analyzeImage, convertImage } = require("../converter/imageConverterService");
const {
  getBundledRuntimePath,
  getPortableDataPaths,
  ensurePortableDataPaths
} = require("./portablePaths");

const portablePaths = getPortableDataPaths();
ensurePortableDataPaths(portablePaths);
fs.writeFileSync(
  path.join(portablePaths.logs, "startup.json"),
  JSON.stringify({
    startedAt: new Date().toISOString(),
    isPackaged: app.isPackaged,
    execPath: process.execPath,
    portableExecutableDir: process.env.PORTABLE_EXECUTABLE_DIR || "",
    portableExecutableFile: process.env.PORTABLE_EXECUTABLE_FILE || "",
    portableRoot: portablePaths.root,
    resourcesPath: process.resourcesPath || ""
  }, null, 2),
  "utf8"
);
app.setPath("userData", portablePaths.settings);
app.setPath("sessionData", portablePaths.cache);
app.setPath("temp", portablePaths.temp);
app.setAppLogsPath(portablePaths.logs);
app.commandLine.appendSwitch("disk-cache-dir", portablePaths.cache);
const hasSingleInstanceLock = app.requestSingleInstanceLock();

const portableBinPath = getBundledRuntimePath();
const ffmpegPath = path.join(portableBinPath, "ffmpeg.exe");
const ffprobePath = path.join(portableBinPath, "ffprobe.exe");
const workingPath = portablePaths.working;
const conversionResults = new Map();

function removeConversionResult(conversionId) {
  const result = conversionResults.get(conversionId);
  if (!result) return;
  conversionResults.delete(conversionId);
  fs.rmSync(result.temporaryPath, { force: true });
}

function cleanupRuntimeState() {
  terminateActiveProcesses();
  for (const conversionId of conversionResults.keys()) {
    removeConversionResult(conversionId);
  }
  fs.rmSync(workingPath, { recursive: true, force: true });
}

function createWindow() {
  const window = new BrowserWindow({
    width: 920,
    height: 720,
    minWidth: 760,
    minHeight: 620,
    title: "ConvertBox",
    backgroundColor: "#f4f7fb",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  window.setMenuBarVisibility(false);
  window.loadFile(path.join(__dirname, "../renderer/index.html"));
}

ipcMain.handle("file:select", async (_event, category) => {
  const categoryFilters = {
    video: { name: "動画ファイル", extensions: ["mp4", "mov", "webm", "avi"] },
    audio: { name: "音声ファイル", extensions: ["mp3", "wav", "m4a", "aac"] },
    image: { name: "画像ファイル", extensions: ["jpg", "png", "jpeg", "gif", "webp", "svg"] }
  };
  const testInputPath = process.env.CONVERTBOX_TEST_INPUT;
  const result = testInputPath
    ? { canceled: false, filePaths: [testInputPath] }
    : await dialog.showOpenDialog({
    title: "変換するファイルを選択",
    properties: ["openFile"],
    filters: [categoryFilters[category] || categoryFilters.video, { name: "すべてのファイル", extensions: ["*"] }]
    });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const filePath = result.filePaths[0];
  const extension = getExtension(filePath);

  return {
    fileName: path.basename(filePath),
    filePath,
    extension: extension || "不明",
    category: inferCategory(extension)
  };
});

ipcMain.handle("video:analyze", async (_event, filePath) => {
  try {
    const metadata = await analyzeVideo({ filePath, ffprobePath });
    return { ok: true, metadata };
  } catch (error) {
    return { ok: false, message: error.message };
  }
});

ipcMain.handle("audio:analyze", async (_event, filePath) => {
  try {
    const metadata = await analyzeAudio({ filePath, ffprobePath });
    return { ok: true, metadata };
  } catch (error) {
    return { ok: false, message: error.message };
  }
});

ipcMain.handle("image:analyze", async (_event, filePath) => {
  try {
    const metadata = await analyzeImage({ filePath });
    return { ok: true, metadata };
  } catch (error) {
    return { ok: false, message: error.message };
  }
});

ipcMain.handle("conversion:request", async (event, conversionRequest) => {
  if (!conversionRequest || !["video", "audio", "image"].includes(conversionRequest.category)) {
    return { ok: false, message: "対応するカテゴリを選択してください" };
  }

  if (!conversionRequest.filePath || !conversionRequest.targetFormat) {
    return { ok: false, message: "変換元ファイルと変換先形式を指定してください" };
  }

  if (conversionRequest.sourceCategory !== conversionRequest.category) {
    const expected = {
      video: "MP4 / MOV / WebM / AVI の動画ファイル",
      audio: "MP3 / WAV / M4A / AAC の音声ファイル",
      image: "JPG / PNG / JPEG / GIF / WebP / SVG の画像ファイル"
    }[conversionRequest.category];
    return { ok: false, message: `${expected}を選択してください` };
  }

  const extension = conversionRequest.targetFormat.toLowerCase();
  const inputName = path.basename(conversionRequest.filePath, path.extname(conversionRequest.filePath));
  const conversionId = crypto.randomUUID();
  const suggestedFileName = `${inputName}_converted.${extension}`;
  fs.mkdirSync(workingPath, { recursive: true });
  const temporaryPath = path.join(workingPath, `${conversionId}.${extension}`);

  const convert = {
    video: convertVideo,
    audio: convertAudio,
    image: convertImage
  }[conversionRequest.category];
  const result = await convert({
    ...conversionRequest,
    outputPath: temporaryPath,
    ffmpegPath,
    onProgress: (percent) => event.sender.send("conversion:progress", percent)
  });

  if (!result.ok) {
    fs.rmSync(temporaryPath, { force: true });
    return result;
  }

  conversionResults.set(conversionId, {
    temporaryPath,
    suggestedFileName,
    targetFormat: conversionRequest.targetFormat,
    category: conversionRequest.category
  });

  return {
    ok: true,
    conversionId,
    suggestedFileName,
    message: `${conversionRequest.targetFormat} への変換が完了しました。ダウンロードしてください`
  };
});

ipcMain.handle("conversion:download", async (_event, conversionId) => {
  const converted = conversionResults.get(conversionId);
  if (!converted || !fs.existsSync(converted.temporaryPath)) {
    return { ok: false, message: "変換済みファイルが見つかりません。もう一度変換してください" };
  }

  const extension = path.extname(converted.suggestedFileName).slice(1);
  const testOutputPath = process.env.CONVERTBOX_TEST_OUTPUT;
  const saveResult = testOutputPath
    ? { canceled: false, filePath: testOutputPath }
    : await dialog.showSaveDialog({
      title: `変換済み${{ video: "動画", audio: "音声", image: "画像" }[converted.category]}をダウンロード`,
      defaultPath: converted.suggestedFileName,
      filters: [{ name: `${converted.targetFormat} ${{ video: "動画", audio: "音声", image: "画像" }[converted.category]}`, extensions: [extension] }]
    });

  if (saveResult.canceled || !saveResult.filePath) {
    return { ok: false, canceled: true, message: "ダウンロード先の選択をキャンセルしました" };
  }

  try {
    await fs.promises.copyFile(converted.temporaryPath, saveResult.filePath);
    removeConversionResult(conversionId);
    return {
      ok: true,
      outputPath: saveResult.filePath,
      message: "変換済みファイルをダウンロードしました"
    };
  } catch (error) {
    return { ok: false, message: `ダウンロードに失敗しました: ${error.message}` };
  }
});

ipcMain.handle("conversion:discard", (_event, conversionId) => {
  removeConversionResult(conversionId);
  return { ok: true };
});

ipcMain.handle("app:get-version", () => app.getVersion());

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const [window] = BrowserWindow.getAllWindows();
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  });

  app.whenReady().then(() => {
    fs.rmSync(workingPath, { recursive: true, force: true });
    fs.mkdirSync(workingPath, { recursive: true });
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });

  app.on("before-quit", () => {
    cleanupRuntimeState();
  });

  app.on("window-all-closed", () => {
    cleanupRuntimeState();
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
}
