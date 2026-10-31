const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");
const { pathToFileURL } = require("node:url");
const { validateConversionRequest, assertTemporaryPath, assertWorkingDirectory } = require("../src/main/security");
const { LIMITS, assertInputFile, assertImageDimensions } = require("../src/converter/resourceLimits");
const { runProcess, terminateActiveProcesses } = require("../src/converter/processRunner");
const { analyzeVideo } = require("../src/converter/converterService");
const { analyzeImage, terminateActiveImageProcesses } = require("../src/converter/imageConverterService");

const root = path.resolve(__dirname, "..");
const temporaryRoot = path.join(root, ".tmp");
fs.mkdirSync(temporaryRoot, { recursive: true });
const testRoot = fs.mkdtempSync(path.join(temporaryRoot, "security-"));

async function checkIpc() {
  const handlers = new Map();
  const removals = [];
  const dataRoot = path.join(testRoot, "ConvertBox-PortableData");
  const working = path.join(dataRoot, "temp", "working");
  const input = path.join(testRoot, "selected.mp4");
  fs.writeFileSync(input, "test");
  const win = { isDestroyed: () => false, webContents: new EventEmitter(), setMenuBarVisibility() {}, loadFile() {} };
  win.webContents.mainFrame = { url: pathToFileURL(path.join(root, "src/renderer/index.html")).href };
  win.webContents.setWindowOpenHandler = (handler) => { win.openHandler = handler; };
  win.webContents.session = { setPermissionRequestHandler() {}, setPermissionCheckHandler() {} };
  const event = { sender: win.webContents, senderFrame: win.webContents.mainFrame };
  let options;
  let ready;
  const app = { isPackaged: false, commandLine: { appendSwitch() {} }, requestSingleInstanceLock: () => true,
    setPath() {}, setAppLogsPath() {}, on() {}, quit() {}, getVersion: () => "test",
    whenReady: () => ({ then(callback) { ready = callback; return { catch() {} }; } }) };
  let finishConversion;
  let calls = 0;
  const converter = {
    analyzeVideo: async () => ({ width: 1 }), analyzeAudio: async () => ({}),
    convertVideo: async () => { calls++; await new Promise((resolve) => { finishConversion = resolve; }); return { ok: false }; },
    terminateActiveProcesses: async () => {}
  };
  const stubs = {
    fs: { ...fs, rmSync(file, ...args) { removals.push(file); return fs.rmSync(file, ...args); } },
    path, crypto: require("node:crypto"), "node:url": require("node:url"),
    electron: { app, BrowserWindow: function (value) { options = value; return win; }, dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [input] }) }, ipcMain: { handle(name, handler) { handlers.set(name, handler); } } },
    "../shared/formats": require("../src/shared/formats"), "./security": require("../src/main/security"),
    "../converter/resourceLimits": require("../src/converter/resourceLimits"),
    "./shutdown": { installShutdown: () => ({ isQuitting: () => false }) },
    "../converter/converterService": converter, "../converter/imageConverterService": {},
    "../converter/heicDecoder": {},
    "./portablePaths": { getBundledRuntimePath: () => "", getPortableDataPaths: () => ({ root: dataRoot, working, logs: dataRoot }), ensurePortableDataPaths: () => fs.mkdirSync(working, { recursive: true }) }
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, "src/main/main.js"), "utf8"), {
    require(name) { assert.ok(Object.hasOwn(stubs, name), name); return stubs[name]; },
    __dirname: path.join(root, "src/main"), process: { ...process, env: {} }, console
  });
  ready();
  assert.equal(options.webPreferences.sandbox, true);
  assert.equal(options.webPreferences.contextIsolation, true);
  assert.equal(options.webPreferences.nodeIntegration, false);
  assert.deepEqual(JSON.parse(JSON.stringify(win.openHandler())), { action: "deny" });
  let prevented = false;
  win.webContents.emit("will-navigate", { preventDefault() { prevented = true; } });
  assert.ok(prevented);
  const invoke = (channel, argument, sender = event) => handlers.get(channel)(sender, argument);
  for (const channel of handlers.keys()) {
    await assert.rejects(invoke(channel, undefined, { ...event, sender: {} }), /許可/);
    await assert.rejects(invoke(channel, undefined, { ...event, senderFrame: { url: event.senderFrame.url } }), /許可/);
  }
  assert.equal((await invoke("video:analyze", input)).ok, false, "unselected file must be rejected");
  await invoke("file:select", "video");
  assert.equal((await invoke("video:analyze", input)).ok, true);
  assert.equal((await invoke("video:analyze", path.join(testRoot, "other.mp4"))).ok, false);
  const outside = path.join(dataRoot, "sentinel.txt");
  fs.writeFileSync(outside, "keep");
  for (const targetFormat of ["../../../../sentinel.txt", "..\\..\\..\\..\\sentinel.txt", {}, ["MP4"], 1, null]) {
    const before = removals.length;
    const result = await invoke("conversion:request", { category: "video", filePath: input, targetFormat });
    assert.equal(result.ok, false);
    assert.equal(removals.length, before, "invalid format must not reach cleanup");
    assert.equal(calls, 0);
    assert.equal(fs.readFileSync(outside, "utf8"), "keep");
  }
  const conversion = invoke("conversion:request", { category: "video", filePath: input, targetFormat: "MP4" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await invoke("conversion:request", { category: "video", filePath: input, targetFormat: "MP4" })).ok, false);
  assert.equal((await invoke("video:analyze", input)).ok, false);
  finishConversion();
  await conversion;
  assert.equal(calls, 1);
  console.log("Security: IPC sender/frame, selected paths, traversal rejection, sandbox/navigation, concurrency passed");
}

async function checkLimits() {
  for (const category of ["__proto__", "constructor", {}, ["video"], null]) assert.throws(() => validateConversionRequest({ category, targetFormat: "MP4", filePath: "x" }));
  assert.throws(() => assertTemporaryPath(testRoot, path.join(testRoot, "../sentinel.txt")));
  const junction = path.join(testRoot, "junction-data");
  fs.mkdirSync(junction);
  fs.symlinkSync(testRoot, path.join(junction, "temp"), "junction");
  assert.throws(() => assertWorkingDirectory(junction, path.join(junction, "temp/working")), /リンク/);
  fs.unlinkSync(path.join(junction, "temp"));
  assert.throws(() => assertInputFile(testRoot), /通常のファイル/);
  assert.throws(() => assertImageDimensions(10000, 10000));
  assert.throws(() => assertImageDimensions(1, 1, LIMITS.imagePages + 1));
  const oversized = path.join(testRoot, "oversized.heic");
  const fd = fs.openSync(oversized, "w");
  fs.ftruncateSync(fd, LIMITS.imageBytes + 1);
  fs.closeSync(fd);
  await assert.rejects(analyzeImage({ filePath: oversized }), /上限/);
  const svg = path.join(testRoot, "oversized.svg");
  fs.writeFileSync(svg, '<svg xmlns="http://www.w3.org/2000/svg" width="10000" height="10000"><rect width="100%" height="100%"/></svg>');
  await assert.rejects(analyzeImage({ filePath: svg }), /pixel limit|上限/i);
  await assert.rejects(runProcess(process.execPath, ["-e", "setInterval(() => {}, 1000)"], null, { timeoutMs: 100 }), /処理時間/);
  await assert.rejects(runProcess(process.execPath, ["-e", "process.stdout.write('x'.repeat(4096))"], null, { maxStdoutBytes: 32 }), /解析結果/);
  // Test slot exhaustion and that the timed-out children release their slots.
  const pending = [1, 2].map(() => runProcess(process.execPath, ["-e", "setInterval(() => {}, 1000)"], null, { timeoutMs: 250 }).catch((error) => error));
  await assert.rejects(runProcess(process.execPath, ["-e", ""], null), /処理数/);
  await Promise.all(pending);
  await runProcess(process.execPath, ["-e", ""], null);
  const disguisedPlaylist = path.join(testRoot, "playlist.mp4");
  fs.writeFileSync(disguisedPlaylist, "#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\nhttp://127.0.0.1:1/segment.ts\n#EXT-X-ENDLIST\n");
  await assert.rejects(analyzeVideo({ filePath: disguisedPlaylist, ffprobePath: path.join(root, "portable/bin/ffprobe.exe") }), /whitelist|Invalid data/i);
  console.log("Security: file/pixel/page limits, junction rejection, timeout/output cap, process slots, playlist rejection passed");
}

async function checkImageDeadlines() {
  // Use deliberately stalled children/threads and the production lifecycle code.
  // Fast clocks keep the regression deterministic without waiting 30/60 seconds.
  const input = path.join(testRoot, "deadline.heic");
  fs.writeFileSync(input, "test");
  let terminated = 0;
  class StalledWorker extends EventEmitter {
    async terminate() { terminated++; this.emit("exit", 1); }
  }
  const heicModule = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, "src/converter/heicDecoder.js"), "utf8"), {
    require(name) {
      if (name === "node:worker_threads") return { Worker: StalledWorker, isMainThread: true };
      if (name === "./resourceLimits") return require("../src/converter/resourceLimits");
      return require(name);
    },
    module: heicModule, __filename: path.join(root, "src/converter/heicDecoder.js"),
    setTimeout: (fn) => setTimeout(fn, 5), clearTimeout, Buffer
  });
  await assert.rejects(heicModule.exports.decodeHeic(input), /処理時間/);
  await assert.rejects(heicModule.exports.decodeHeic(input), /処理時間/);
  assert.equal(terminated, 2, "HEIC workers must terminate and release their slot");

  let killed = 0;
  const imageModule = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, "src/converter/imageConverterService.js"), "utf8"), {
    require(name) {
      if (name === "node:child_process") return { fork() {
        const child = new EventEmitter();
        child.stderr = new EventEmitter();
        child.send = () => {};
        child.kill = () => { killed++; child.emit("close", 1); };
        return child;
      } };
      if (name === "./resourceLimits") return require("../src/converter/resourceLimits");
      if (name === "../shared/formats") return require("../src/shared/formats");
      return require(name);
    },
    module: imageModule, __dirname: path.join(root, "src/converter"), process,
    setTimeout: (fn) => setTimeout(fn, 5), clearTimeout
  });
  await assert.rejects(imageModule.exports.analyzeImage({ filePath: input }), /処理時間/);
  await assert.rejects(imageModule.exports.analyzeImage({ filePath: input }), /処理時間/);
  assert.equal(killed, 2, "image children must stop and release their slot");

  // A small malicious header must be rejected before allocating RGBA pixels.
  let decoded = false;
  let disposed = false;
  let done;
  const message = new Promise((resolve) => { done = resolve; });
  const images = [{ width: 10000, height: 10000, decode() { decoded = true; } }];
  images.dispose = () => { disposed = true; };
  vm.runInNewContext(fs.readFileSync(path.join(root, "src/converter/heicDecoder.js"), "utf8"), {
    require(name) {
      if (name === "node:worker_threads") return { isMainThread: false, workerData: { filePath: input }, parentPort: { postMessage: done } };
      if (name === "./resourceLimits") return require("../src/converter/resourceLimits");
      if (name === "heic-decode") return { all: async () => images };
      return require(name);
    }, module: { exports: {} }, Buffer
  });
  assert.match((await message).error, /上限/);
  assert.equal(decoded, false);
  assert.equal(disposed, true);
  console.log("Security: image/HEIC hard deadlines, slot recovery, pre-decode HEIC dimension check passed");
}

(async () => {
  await checkIpc();
  await checkLimits();
  await checkImageDeadlines();
})().catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => {
    await Promise.all([terminateActiveProcesses(), terminateActiveImageProcesses()]);
    assert.equal(path.dirname(testRoot), temporaryRoot);
    fs.rmSync(testRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });
