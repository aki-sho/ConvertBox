const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { pathToFileURL } = require("node:url");
const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const { FORMATS, CONVERSION_FORMATS, inferCategory, getExtension } = require("../shared/formats");
const { validateConversionRequest, isTrustedSender, assertTemporaryPath, assertWorkingDirectory } = require("./security");
const { LIMITS, assertInputFile } = require("../converter/resourceLimits");
const { installShutdown } = require("./shutdown");
const { ConversionQueue } = require("./conversionQueue");
const { saveUniqueOutput } = require("./outputFiles");
const { normalizeOptions } = require("../shared/conversionOptions");
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
const savingConversions = new Set();
const rendererPath = path.join(__dirname, "../renderer/index.html");
const rendererUrl = pathToFileURL(rendererPath).href;
let mainWindow;
const authorizedInputs = new Map();
let outputDirectory = null;
let operationRunning = false;
const queue = new ConversionQueue({
  execute: executeQueuedConversion,
  dispose: (result) => removeConversionResult(result.conversionId),
  onChange: (jobs) => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed?.()) {
      try { mainWindow.webContents.send("queue:changed", jobs); } catch { /* Window may be closing. */ }
    }
  }
});
const shutdown = hasSingleInstanceLock ? installShutdown({
  app,
  stopProcesses: () => Promise.all([queue.stop(), terminateActiveProcesses(), terminateActiveHeicWorkers(), terminateActiveImageProcesses()]),
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
  const input = authorizedInputs.get(filePath);
  if (typeof filePath !== "string" || !input || input.category !== category) throw new Error("先に対応するファイルを選択してください");
  assertInputFile(filePath, category === "image" ? LIMITS.imageBytes : LIMITS.mediaBytes);
}

async function runExclusive(operation) {
  if (operationRunning || queue.busy) return { ok: false, message: "別の解析・変換処理が実行中です" };
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
  if (savingConversions.has(conversionId)) throw new Error("ファイルを保存しています。完了してから再実行してください");
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
    width: 1040,
    height: 840,
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
  authorizedInputs.set(filePath, file);
  return file;
});

function authorizeFiles(paths, category) {
  if (typeof category !== "string" || !Object.hasOwn(CONVERSION_FORMATS, category)
    || !Array.isArray(paths) || !paths.length || paths.length > 100) throw new Error("1〜100件のファイルを選択してください");
  const files = [];
  const rejected = [];
  for (const input of [...new Set(paths)]) {
    try {
      if (typeof input !== "string" || !path.isAbsolute(input)) throw new Error("ローカルファイルを選択してください");
      const filePath = path.resolve(input);
      const extension = getExtension(filePath);
      const inferred = inferCategory(extension, category === "videoToAudio" ? "video" : category);
      if (inferred === "unknown") throw new Error("非対応のファイル形式です");
      assertInputFile(filePath, inferred === "image" ? LIMITS.imageBytes : LIMITS.mediaBytes);
      const file = { filePath, fileName: path.basename(filePath), extension, category: inferred };
      files.push(file);
    } catch (error) { rejected.push({ fileName: typeof input === "string" ? path.basename(input) : "不明", message: error.message }); }
  }
  if (authorizedInputs.size + files.length > 1000) throw new Error("選択ファイル数の上限に達しました。アプリを再起動してください");
  for (const file of files) authorizedInputs.set(file.filePath, file);
  return { ok: true, files, rejected };
}

handle("files:select", async (_event, category) => {
  if (typeof category !== "string" || !Object.hasOwn(CONVERSION_FORMATS, category)) return { ok: false, message: "カテゴリを選択してください" };
  const testPaths = process.env.CONVERTBOX_TEST_INPUTS
    ? JSON.parse(process.env.CONVERTBOX_TEST_INPUTS)
    : process.env.CONVERTBOX_TEST_INPUT ? [process.env.CONVERTBOX_TEST_INPUT] : null;
  const source = category === "videoToAudio" ? "video" : category;
  const result = testPaths ? { filePaths: testPaths } : await dialog.showOpenDialog({
    title: "変換するファイルを選択（複数選択できます）", properties: ["openFile", "multiSelections"],
    filters: [{ name: "対応するファイル", extensions: FORMATS[source].map((format) => format.toLowerCase()) }]
  });
  if (result.canceled || !result.filePaths.length) return { ok: true, files: [], rejected: [] };
  try { return authorizeFiles(result.filePaths, category); }
  catch (error) { return { ok: false, message: error.message }; }
});

handle("files:drop", (_event, request) => {
  try { return authorizeFiles(request?.paths, request?.category); }
  catch (error) { return { ok: false, message: error.message }; }
});

handle("output:select-directory", async () => {
  const testDirectory = process.env.CONVERTBOX_TEST_DIRECTORY;
  const result = testDirectory ? { filePaths: [testDirectory] } : await dialog.showOpenDialog({
    title: "変換後のファイルをまとめて保存するフォルダ", properties: ["openDirectory", "createDirectory"]
  });
  if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };
  const directory = path.resolve(result.filePaths[0]);
  if (!fs.statSync(directory).isDirectory()) return { ok: false, message: "保存先フォルダを選択してください" };
  outputDirectory = directory;
  return { ok: true, directory };
});
handle("output:clear-directory", () => { outputDirectory = null; return { ok: true }; });

function validateQueuedSettings(request) {
  validateConversionRequest({ ...request, filePath: "validated-at-enqueue" });
  return { category: request.category, targetFormat: request.targetFormat, options: normalizeOptions(request.options), outputDirectory };
}

function assertManualSlot(exceptId) {
  if (queue.jobs.some((job) => job.id !== exceptId && !job.spec.outputDirectory
    && (["queued", "running", "canceling", "preparing"].includes(job.state) || (job.state === "completed" && !job.result?.saved)))
    || [...conversionResults.keys()].some((id) => !queue.jobs.some((job) => job.id === exceptId && job.result?.conversionId === id))) {
    throw new Error("未保存の変換があります。保存するか、一括保存先を指定してください");
  }
}

handle("queue:enqueue", (_event, request) => {
  try {
    if (operationRunning) throw new Error("解析・変換が終わるまでお待ちください");
    const settings = validateQueuedSettings(request);
    if (!Array.isArray(request.files) || !request.files.length || request.files.length > 100) throw new Error("1〜100件のファイルを選択してください");
    if (!outputDirectory && request.files.length > 1) throw new Error("一括変換の保存先フォルダを指定してください");
    if (!outputDirectory) assertManualSlot();
    const specs = [...new Set(request.files)].map((filePath) => {
      assertSelectedInput(filePath, settings.category === "videoToAudio" ? "video" : settings.category);
      return { ...settings, filePath, fileName: path.basename(filePath) };
    });
    return { ok: true, ids: queue.enqueue(specs) };
  } catch (error) { return { ok: false, message: error.message }; }
});

handle("queue:get", () => queue.snapshot());
handle("queue:cancel", (_event, id) => {
  if (id !== null && typeof id !== "string") return { ok: false, message: "中止する項目が不正です" };
  queue.cancel(id);
  return { ok: true };
});
handle("queue:clear-finished", () => { queue.clearFinished(); return { ok: true }; });
handle("queue:retry", async (_event, request) => {
  try {
    const job = queue.jobs.find((item) => item.id === request?.id);
    if (!job) throw new Error("キューの項目が見つかりません");
    const settings = validateQueuedSettings({ ...request, category: job.spec.category });
    if (!outputDirectory) assertManualSlot(job.id);
    await queue.retry(job.id, settings);
    return { ok: true };
  } catch (error) { return { ok: false, message: error.message }; }
});

async function executeQueuedConversion(spec, signal, onProgress) {
  assertWorkingDirectory(portablePaths.root, workingPath);
  const sourceCategory = spec.category === "videoToAudio" ? "video" : spec.category;
  assertInputFile(spec.filePath, sourceCategory === "image" ? LIMITS.imageBytes : LIMITS.mediaBytes);
  const analyze = { video: analyzeVideo, audio: analyzeAudio, image: analyzeImage }[sourceCategory];
  const metadata = await analyze({ filePath: spec.filePath, ffprobePath, signal });
  signal.throwIfAborted();
  if (spec.category === "videoToAudio" && !metadata.hasAudio) return { ok: false, message: "この動画には音声トラックがありません" };
  const conversionId = crypto.randomUUID();
  const extension = spec.targetFormat.toLowerCase();
  const temporaryPath = assertTemporaryPath(workingPath, path.join(workingPath, `${conversionId}.${extension}`));
  const suggestedFileName = `${path.basename(spec.filePath, path.extname(spec.filePath))}_converted.${extension}`;
  fs.mkdirSync(workingPath, { recursive: true });
  let keep = false;
  try {
    const convert = { video: convertVideo, audio: convertAudio, image: convertImage, videoToAudio: extractAudio }[spec.category];
    const result = await convert({ filePath: spec.filePath, targetFormat: spec.targetFormat,
      outputPath: temporaryPath, ffmpegPath, durationSeconds: metadata.durationSeconds, options: spec.options, signal, onProgress });
    signal.throwIfAborted();
    if (!result.ok) return result;
    if (spec.outputDirectory) {
      const outputPath = await saveUniqueOutput(temporaryPath, spec.outputDirectory, suggestedFileName, signal);
      return { ok: true, saved: true, outputPath, suggestedFileName };
    }
    conversionResults.set(conversionId, { temporaryPath, suggestedFileName, targetFormat: spec.targetFormat, category: sourceCategory === "video" && spec.category === "videoToAudio" ? "audio" : sourceCategory });
    keep = true;
    return { ok: true, conversionId, suggestedFileName, saved: false };
  } finally { if (!keep) removeTemporaryFile(temporaryPath); }
}

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
    filePath: conversionRequest.filePath,
    targetFormat: conversionRequest.targetFormat,
    options: normalizeOptions(conversionRequest.options),
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
  if (savingConversions.has(conversionId)) return { ok: false, message: "このファイルは保存中です" };
  const converted = conversionResults.get(conversionId);
  if (!converted || !fs.existsSync(converted.temporaryPath)) {
    return { ok: false, message: "変換済みファイルが見つかりません。もう一度変換してください" };
  }
  savingConversions.add(conversionId);
  try {
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
    assertWorkingDirectory(portablePaths.root, workingPath);
    assertTemporaryPath(workingPath, converted.temporaryPath);
    await fs.promises.copyFile(converted.temporaryPath, saveResult.filePath);
    savingConversions.delete(conversionId);
    removeConversionResult(conversionId);
    queue.markSaved(conversionId, saveResult.filePath);
    return {
      ok: true,
      outputPath: saveResult.filePath,
      message: "変換済みファイルをダウンロードしました"
    };
  } catch (error) {
    return { ok: false, message: `ダウンロードに失敗しました: ${error.message}` };
  }
  finally { savingConversions.delete(conversionId); }
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
