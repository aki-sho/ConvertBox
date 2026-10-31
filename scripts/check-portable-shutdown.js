const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { spawn, execFileSync } = require("node:child_process");
const net = require("node:net");

const root = path.resolve(__dirname, "..");
const exe = path.resolve(process.argv[2] || path.join(root, "dist", `ConvertBox-Portable-${require("../package.json").version}.exe`));
const temporaryRoot = path.join(root, ".tmp");
fs.mkdirSync(temporaryRoot, { recursive: true });
const testRoot = fs.mkdtempSync(path.join(temporaryRoot, "portable-shutdown-"));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitUntil(read, description, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await read();
    if (value) return value;
    await delay(100);
  }
  throw new Error(`Timeout: ${description}`);
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function check(mode, input) {
  const moved = path.join(testRoot, `移動先 ${mode}`);
  fs.mkdirSync(moved);
  const copiedExe = path.join(moved, path.basename(exe));
  fs.copyFileSync(exe, copiedExe);
  const port = await freePort();
  const launcher = spawn(copiedExe, [`--remote-debugging-port=${port}`], {
    windowsHide: true, stdio: "ignore",
    env: { ...process.env, CONVERTBOX_TEST_INPUT: input }
  });
  let closed = false;
  let socket;
  let locker;
  launcher.once("exit", () => { closed = true; });
  launcher.once("error", (error) => { console.error(error); closed = true; });
  try {
    const target = await waitUntil(async () => {
      try {
        const targets = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json());
        return targets.find((item) => item.title === "ConvertBox");
      } catch { return false; }
    }, "portable window");
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    let id = 0;
    const evaluate = (expression) => new Promise((resolve, reject) => {
      const requestId = ++id;
      const timer = setTimeout(() => { socket.removeEventListener("message", receive); reject(new Error("CDP timeout")); }, 5000);
      function receive(event) {
        const data = JSON.parse(event.data);
        if (data.id !== requestId) return;
        clearTimeout(timer);
        socket.removeEventListener("message", receive);
        if (data.error || data.result?.exceptionDetails) reject(new Error(JSON.stringify(data)));
        else resolve(data.result.result.value);
      }
      socket.addEventListener("message", receive);
      socket.send(JSON.stringify({ id: requestId, method: "Runtime.evaluate", params: { expression, returnByValue: true, awaitPromise: true } }));
    });
    assert.equal(await evaluate("window.convertBox.getAppVersion()"), require("../package.json").version);
    if (mode === "converting") {
      await evaluate("document.querySelector('#select-file-button').click()");
      await waitUntil(() => evaluate("!document.querySelector('#video-analysis').hidden"), "input analysis");
      await evaluate("document.querySelector('#target-format').value = 'WebM'; document.querySelector('#convert-button').click()");
      await waitUntil(() => evaluate("document.querySelector('#convert-button').disabled"), "conversion start");
      await delay(300);
      assert.equal(await evaluate("document.querySelector('#convert-button').disabled"), true, "must close during conversion");
    }
    if (mode === "image") {
      await evaluate("document.querySelector('[data-category=image]').click()");
      await evaluate("document.querySelector('#select-file-button').click()");
      await waitUntil(() => evaluate("!document.querySelector('#image-analysis').hidden"), "HEIC analysis");
      await evaluate("document.querySelector('#target-format').value = 'PNG'; document.querySelector('#convert-button').click()");
      await waitUntil(() => evaluate("document.querySelector('#convert-button').disabled"), "image conversion start");
    }
    if (mode === "locked") {
      const lockedFile = path.join(moved, "ConvertBox-PortableData", "temp", "working", "locked.tmp");
      locker = spawn("powershell.exe", ["-NoProfile", "-Command",
        "$stream = [System.IO.File]::Open($env:CONVERTBOX_LOCK_TEST, 'OpenOrCreate', 'ReadWrite', 'None'); try { [Console]::WriteLine('LOCKED'); Start-Sleep -Seconds 60 } finally { $stream.Dispose() }"
      ], { windowsHide: true, env: { ...process.env, CONVERTBOX_LOCK_TEST: lockedFile } });
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("lock setup timeout")), 5000);
        locker.stdout.on("data", () => { clearTimeout(timer); resolve(); });
        locker.once("error", reject);
      });
    }
    const startup = JSON.parse(fs.readFileSync(path.join(moved, "ConvertBox-PortableData", "logs", "startup.json"), "utf8"));
    // window.close() follows BrowserWindow's close path, as does the title-bar X.
    socket.send(JSON.stringify({ id: ++id, method: "Runtime.evaluate", params: { expression: "window.close()" } }));
    await waitUntil(() => closed, `${mode}: portable launcher exit`, 15000);
    const remaining = execFileSync("powershell.exe", ["-NoProfile", "-Command",
      "@(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($env:CONVERTBOX_TEST_EXTRACTED, [StringComparison]::OrdinalIgnoreCase) }).Count"
    ], { windowsHide: true, encoding: "utf8", env: { ...process.env, CONVERTBOX_TEST_EXTRACTED: path.dirname(startup.execPath) + path.sep } }).trim();
    assert.equal(remaining, "0", "portable child process remains");
    if (mode === "locked") {
      assert.match(fs.readFileSync(path.join(moved, "ConvertBox-PortableData", "logs", "shutdown.log"), "utf8"), /EPERM|EBUSY|EACCES/);
    } else {
      assert.equal(fs.existsSync(path.join(moved, "ConvertBox-PortableData", "temp", "working")), false);
    }
    fs.unlinkSync(copiedExe); // Actual deletion, not just a file-exists check.
    console.log(`Portable shutdown passed: ${mode}, no remaining processes, moved EXE deleted`);
  } finally {
    socket?.close();
    if (locker && locker.exitCode === null) {
      const stopped = new Promise((resolve) => locker.once("exit", resolve));
      locker.kill();
      await stopped;
    }
    if (!closed && launcher.pid) {
      execFileSync("taskkill.exe", ["/PID", String(launcher.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    }
  }
}

(async () => {
  const input = path.join(testRoot, "input.mp4");
  execFileSync(path.join(root, "portable/bin/ffmpeg.exe"), [
    "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30",
    "-t", "20", "-c:v", "libx264", "-preset", "ultrafast", input
  ], { windowsHide: true });
  for (const mode of ["idle", "converting", "locked"]) await check(mode, input);
  await check("image", path.join(__dirname, "fixtures", "rainbow.heic"));
  // Only this invocation's mkdtemp directory is removed.
  assert.equal(path.dirname(testRoot), temporaryRoot);
  fs.rmSync(testRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
})().catch((error) => { console.error(error); process.exitCode = 1; });
