const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { pathToFileURL } = require("node:url");
const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const { FORMATS, CONVERSION_FORMATS, inferCategory, getExtension } = require("../shared/formats");
const { validateConversionRequest, isTrustedSender, assertTemporaryPath, assertWorkingDirectory } = require("./security");
const { LIMITS, assertInputFile } = require("../converter/resourceLimits");
const { installShutdown } = require("./shutdown");
const {
  analyzeVideo,
  analyzeAudio,
  convertVideo,
  convertAudio,
  extractAudio,
  terminateActiveProcesses
} = require("../converter/converterService");
const { analyzeImage, convertImage, terminateActiveImageProcesses } = require("../converter/imageConverterService");
const { terminateActiveHeicWorkers } = require("../converter/heicDecoder");
const {
  getBundledRuntimePath,
  getPortableDataPaths,
  ensurePortableDataPaths
} = require("./portablePaths");

const portablePaths = getPortableDataPaths();
assertWorkingDirectory(portablePaths.root, portablePaths.working);
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
const rendererPath = path.join(__dirname, "../renderer/index.html");
const rendererUrl = pathToFileURL(rendererPath).href;
let mainWindow;
let selectedInput = null;
let operationRunning = false;
const shutdown = hasSingleInstanceLock ? installShutdown({
  app,
  stopProcesses: () => Promise.all([terminateActiveProcesses(), terminateActiveHeicWorkers(), terminateActiveImageProcesses()]),
  cleanup: cleanupRuntimeState,
  reportError: (error) => fs.appendFileSync(
    path.join(portablePaths.logs, "shutdown.log"),
    `${new Date().toISOString()} ${error.stack || error}\n`, "utf8"
  )
}) : { isQuitting: () => true };

function handle(channel, handler) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!isTrustedSender(event, mainWindow, rendererUrl)) throw new Error("許可されていない画面からの要求です");
    if (shutdown.isQuitting()) throw new Error("アプリを終了しています");
    return handler(event, ...args);
  });
}

function assertSelectedInput(filePath, category) {
  if (!selectedInput || typeof filePath !== "string" || filePath !== selectedInput.filePath
    || selectedInput.category !== category) throw new Error("先に対応するファイルを選択してください");
  assertInputFile(filePath, category === "image" ? LIMITS.imageBytes : LIMITS.mediaBytes);
}

async function runExclusive(operation) {
  if (operationRunning) return { ok: false, message: "別の解析・変換処理が実行中です" };
  operationRunning = true;
  try { return await operation(); }
  catch (error) { return { ok: false, message: error.message }; }
  finally { operationRunning = false; }
}

function removeTemporaryFile(filePath) {
  assertWorkingDirectory(portablePaths.root, workingPath);
  fs.rmSync(assertTemporaryPath(workingPath, filePath), { force: true });
}

function removeConversionResult(conversionId) {
  const result = conversionResults.get(conversionId);
  if (!result) return;
  conversionResults.delete(conversionId);
  removeTemporaryFile(result.temporaryPath);
}

async function cleanupRuntimeState() {
  conversionResults.clear();
  assertWorkingDirectory(portablePaths.root, workingPath);
  await fs.promises.rm(workingPath, {
    recursive: true, force: true, maxRetries: 3, retryDelay: 100
  });
}

function createWindow() {
  const window = new BrowserWindow({
    width: 920,
    height: 720,
    minWidth: 760,
    minHeight: 620,
    title: "ConvertBox",
    icon: path.join(__dirname, "../renderer/icon.png"),
    backgroundColor: "#f4f7fb",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: [`--convertbox-formats=${JSON.stringify(CONVERSION_FORMATS)}`]
    }
  });
  mainWindow = window;
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.on("will-redirect", (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.setMenuBarVisibility(false);
  window.loadFile(rendererPath);
}

handle("file:select", async (_event, category) => {
  if (operationRunning) return null;
  if (typeof category !== "string" || !Object.hasOwn(CONVERSION_FORMATS, category)) return null;
  const categoryFilters = {
    video: { name: "動画ファイル", extensions: ["mp4", "mov", "webm", "avi"] },
    videoToAudio: { name: "音声を取り出す動画ファイル", extensions: ["mp4", "mov", "webm", "avi"] },
    audio: { name: "音声ファイル", extensions: ["mp3", "wav", "m4a", "aac", "webm"] },
    image: { name: "画像ファイル", extensions: FORMATS.image.map((format) => format.toLowerCase()) }
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

  const filePath = path.resolve(result.filePaths[0]);
  const extension = getExtension(filePath);
  const file = {
    fileName: path.basename(filePath),
    filePath,
    extension: extension || "不明",
    category: inferCategory(extension, category === "videoToAudio" ? "video" : category)
  };
  selectedInput = file;
  return file;
});

handle("video:analyze", (_event, filePath) => runExclusive(async () => {
  try {
    assertSelectedInput(filePath, "video");
    const metadata = await analyzeVideo({ filePath, ffprobePath });
    return { ok: true, metadata };
  } catch (error) {
    return { ok: false, message: error.message };
  }
}));

handle("audio:analyze", (_event, filePath) => runExclusive(async () => {
  try {
    assertSelectedInput(filePath, "audio");
    const metadata = await analyzeAudio({ filePath, ffprobePath });
    return { ok: true, metadata };
  } catch (error) {
    return { ok: false, message: error.message };
  }
}));

handle("image:analyze", (_event, filePath) => runExclusive(async () => {
  try {
    assertSelectedInput(filePath, "image");
    const metadata = await analyzeImage({ filePath });
    return { ok: true, metadata };
  } catch (error) {
    return { ok: false, message: error.message };
  }
}));

handle("conversion:request", (event, conversionRequest) => runExclusive(async () => {
  try {
    validateConversionRequest(conversionRequest);
    assertSelectedInput(conversionRequest.filePath, conversionRequest.category === "videoToAudio" ? "video" : conversionRequest.category);
    assertWorkingDirectory(portablePaths.root, workingPath);
  } catch (error) {
    return { ok: false, message: error.message };
  }
  if (conversionResults.size) return { ok: false, message: "変換済みファイルを保存または破棄してから、次の変換を開始してください" };
  if (shutdown.isQuitting()) return { ok: false, message: "アプリを終了しています" };
  const extension = conversionRequest.targetFormat.toLowerCase();
  const inputName = path.basename(conversionRequest.filePath, path.extname(conversionRequest.filePath));
  const conversionId = crypto.randomUUID();
  const suggestedFileName = `${inputName}_converted.${extension}`;
  fs.mkdirSync(workingPath, { recursive: true });
  const temporaryPath = assertTemporaryPath(workingPath, path.join(workingPath, `${conversionId}.${extension}`));

  const convert = {
    video: convertVideo,
    audio: convertAudio,
    image: convertImage,
    videoToAudio: extractAudio
  }[conversionRequest.category];
  const result = await convert({
    filePath: selectedInput.filePath,
    targetFormat: conversionRequest.targetFormat,
    durationSeconds: Number.isFinite(conversionRequest.durationSeconds) ? Math.max(0, conversionRequest.durationSeconds) : 0,
    outputPath: temporaryPath,
    ffmpegPath,
    onProgress: (percent) => {
      if (!shutdown.isQuitting() && !event.sender.isDestroyed()) {
        event.sender.send("conversion:progress", percent);
      }
    }
  });

  if (shutdown.isQuitting()) return { ok: false, message: "アプリを終了しています" };
  if (!result.ok) {
    removeTemporaryFile(temporaryPath);
    return result;
  }

  conversionResults.set(conversionId, {
    temporaryPath,
    suggestedFileName,
    targetFormat: conversionRequest.targetFormat,
    category: conversionRequest.category === "videoToAudio" ? "audio" : conversionRequest.category
  });

  return {
    ok: true,
    conversionId,
    suggestedFileName,
    message: `${conversionRequest.targetFormat} への変換が完了しました。ダウンロードしてください`
  };
}));

handle("conversion:download", async (_event, conversionId) => {
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
    assertWorkingDirectory(portablePaths.root, workingPath);
    assertTemporaryPath(workingPath, converted.temporaryPath);
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

handle("conversion:discard", (_event, conversionId) => {
  removeConversionResult(conversionId);
  return { ok: true };
});

handle("app:get-version", () => app.getVersion());

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
    assertWorkingDirectory(portablePaths.root, workingPath);
    fs.rmSync(workingPath, { recursive: true, force: true });
    fs.mkdirSync(workingPath, { recursive: true });
    createWindow();

    app.on("activate", () => {
      if (!shutdown.isQuitting() && BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  }).catch((error) => {
    try {
      fs.appendFileSync(path.join(portablePaths.logs, "shutdown.log"), `${error.stack || error}\n`);
    } finally {
      app.quit();
    }
  });

}
