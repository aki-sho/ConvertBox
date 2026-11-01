const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const assert = require("node:assert/strict");
const { spawn, execFile } = require("node:child_process");
const { promisify } = require("node:util");
const sharp = require("sharp");
const exec = promisify(execFile);
const root = path.resolve(__dirname, "..");
const exe = path.resolve(process.argv[2] || path.join(root, "dist", `ConvertBox-Portable-${require("../package.json").version}.exe`));
const parent = path.join(root, ".tmp");
fs.mkdirSync(parent, { recursive: true });
const temp = fs.mkdtempSync(path.join(parent, "feature-desktop-"));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let launcher;
let socket;
let exited;

async function main() {
  const directory = path.join(temp, "outputs");
  fs.mkdirSync(directory);
  const inputs = [];
  for (const [folder, name, color] of [["a", "photo.png", "red"], ["b", "photo.png", "blue"], ["c", "drop.png", "green"]]) {
    fs.mkdirSync(path.join(temp, folder));
    const file = path.join(temp, folder, name);
    await sharp({ create: { width: 40, height: 20, channels: 3, background: color } }).png().toFile(file);
    inputs.push(file);
  }
  fs.writeFileSync(path.join(directory, "photo_converted.png"), "keep-existing");
  const video = path.join(temp, "cancel.mp4");
  await exec(path.join(root, "portable/bin/ffmpeg.exe"), ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30", "-t", "15", "-c:v", "libx264", "-preset", "ultrafast", video], { windowsHide: true });
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  const unpacked = fs.existsSync(path.join(path.dirname(exe), "resources/app.asar"));
  const copied = path.join(temp, path.basename(exe));
  if (!unpacked) fs.copyFileSync(exe, copied);
  const env = { ...process.env, CONVERTBOX_TEST_INPUTS: JSON.stringify(inputs.slice(0, 2)), CONVERTBOX_TEST_DIRECTORY: directory };
  if (unpacked) env.PORTABLE_EXECUTABLE_DIR = temp;
  let stderr = "";
  launcher = spawn(unpacked ? exe : copied, [`--remote-debugging-port=${port}`, "--disable-background-timer-throttling"], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"], env });
  launcher.stderr.on("data", (chunk) => { stderr = (stderr + chunk.toString()).slice(-12000); });
  exited = new Promise((resolve, reject) => { launcher.once("exit", resolve); launcher.once("error", reject); });
  let target;
  for (let i = 0; i < 120; i++) {
    if (launcher.exitCode !== null) throw new Error(stderr);
    try { target = (await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json())).find((tab) => tab.title === "ConvertBox"); } catch {}
    if (target) break;
    await delay(500);
  }
  assert.ok(target, `Desktop did not start: ${stderr}`);
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  let id = 0;
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const requestId = ++id;
    const timer = setTimeout(() => { socket.removeEventListener("message", receive); reject(new Error(`CDP timeout: ${method}`)); }, 30000);
    function receive(event) {
      const message = JSON.parse(event.data);
      if (message.id !== requestId) return;
      clearTimeout(timer);
      socket.removeEventListener("message", receive);
      if (message.error) reject(new Error(JSON.stringify(message.error))); else resolve(message.result);
    }
    socket.addEventListener("message", receive);
    socket.send(JSON.stringify({ id: requestId, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const wait = async (expression, description) => {
    for (let attempt = 0; attempt < 300; attempt++) { if (await evaluate(expression)) return; await delay(100); }
    throw new Error(`${description}: ${await evaluate("document.querySelector('#status').textContent")}`);
  };
  await evaluate("document.querySelector('[data-category=image]').click(); document.querySelector('#select-file-button').click()");
  await wait("document.querySelectorAll('#selected-files li').length === 2", "multi-file selection");
  // Use real disk-backed File objects so the preload's File capability check is exercised.
  await evaluate("const testInput = document.createElement('input'); testInput.type = 'file'; testInput.id = 'drop-test-input'; testInput.multiple = true; testInput.hidden = true; document.body.append(testInput)");
  const document = await send("DOM.getDocument");
  const node = await send("DOM.querySelector", { nodeId: document.root.nodeId, selector: "#drop-test-input" });
  await send("DOM.setFileInputFiles", { nodeId: node.nodeId, files: [inputs[2]] });
  await evaluate("const data = new DataTransfer(); data.items.add(document.querySelector('#drop-test-input').files[0]); document.querySelector('#drop-zone').dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }))");
  await wait("document.querySelectorAll('#selected-files li').length === 3", "drop import");
  const fakeFileRejected = await evaluate("(async () => { try { await window.convertBox.importDroppedFiles([new File(['x'], 'fake.png')], 'image'); return false; } catch { return true; } })()");
  assert.equal(fakeFileRejected, true);
  await evaluate("document.querySelector('#quality-preset').value='compact'; document.querySelector('#image-width').value='16'; document.querySelector('#image-height').value='16'; document.querySelector('#image-rotation').value='90'; document.querySelector('#select-output-directory').click()");
  await wait("!document.querySelector('#clear-output-directory').hidden", "output directory");
  await evaluate("document.querySelector('#convert-button').click()");
  await wait("(async()=>{ const jobs=await window.convertBox.getQueue(); return jobs.length===3 && jobs.every(j=>j.state==='completed' && j.saved); })()", "batch completion");
  const batch = await evaluate("window.convertBox.getQueue()");
  assert.equal(fs.readFileSync(path.join(directory, "photo_converted.png"), "utf8"), "keep-existing");
  assert.equal(new Set(batch.map((job) => job.outputPath)).size, 3);
  for (const job of batch) {
    const meta = await sharp(job.outputPath).metadata();
    assert.deepEqual([meta.width, meta.height], [8, 16]);
    assert.equal(job.options.preset, "compact");
  }
  console.log("Desktop features: multi-select, actual File drop, fake File rejection, batch save, collision protection, image settings passed");
  // Import a real video without changing the dialog test fixture.
  await evaluate("document.querySelector('[data-category=video]').click()");
  await send("DOM.setFileInputFiles", { nodeId: node.nodeId, files: [video] });
  await evaluate("const videoDrop = new DataTransfer(); videoDrop.items.add(document.querySelector('#drop-test-input').files[0]); document.querySelector('#drop-zone').dispatchEvent(new DragEvent('drop', { dataTransfer: videoDrop, bubbles: true, cancelable: true }))");
  await wait("!document.querySelector('#video-analysis').hidden", "video analysis");
  await evaluate("document.querySelector('#target-format').value='WebM'; document.querySelector('#convert-button').click()");
  await wait("(async()=> (await window.convertBox.getQueue()).at(-1)?.state==='running')()", "video start");
  await evaluate("document.querySelector('#cancel-all').click()");
  await wait("(async()=> (await window.convertBox.getQueue()).at(-1)?.state==='canceled')()", "cancel current");
  assert.equal(fs.readdirSync(directory).some((file) => file.startsWith("cancel_converted")), false);
  await evaluate("document.querySelector('#target-format').value='MP4'; document.querySelector('#quality-preset').value='high'; [...document.querySelector('#conversion-queue').lastElementChild.querySelectorAll('button')].find(button=>button.textContent.includes('再実行')).click()");
  await wait("(async()=> (await window.convertBox.getQueue()).at(-1)?.state==='completed')()", "retry completion");
  const retried = (await evaluate("window.convertBox.getQueue()")).at(-1);
  assert.equal(retried.targetFormat, "MP4");
  assert.equal(retried.options.preset, "high");
  assert.equal(fs.existsSync(retried.outputPath), true);
  await evaluate("document.querySelector('#clear-finished').click()");
  await wait("document.querySelector('#conversion-queue').children.length===0", "clear saved jobs");
  console.log("Desktop features: cancel without closing, no partial output, retry with changed format/preset, clear queue passed");
  if (process.env.CONVERTBOX_TEST_SCREENSHOT) {
    const screenshot = await send("Page.captureScreenshot", { captureBeyondViewport: true });
    fs.writeFileSync(process.env.CONVERTBOX_TEST_SCREENSHOT, Buffer.from(screenshot.data, "base64"));
  }
  await evaluate("window.close()");
  await Promise.race([exited, delay(15000).then(() => { if (launcher.exitCode === null) throw new Error("Desktop did not stop"); })]);
  assert.equal(fs.existsSync(path.join(temp, "ConvertBox-PortableData/temp/working")), false);
}

main().catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => {
    socket?.close();
    if (launcher?.exitCode === null && launcher.pid) {
      await exec("taskkill.exe", ["/PID", String(launcher.pid), "/T", "/F"], { windowsHide: true }).catch(() => {});
      await Promise.race([exited, delay(5000)]);
    }
    assert.equal(path.dirname(temp), parent);
    fs.rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  });
