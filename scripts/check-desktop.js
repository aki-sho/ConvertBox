const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const net = require("node:net");
const { spawn, execFile } = require("node:child_process");
const { promisify } = require("node:util");
const exec = promisify(execFile);
const root = path.resolve(__dirname, "..");
const exe = path.resolve(process.argv[2] || path.join(root, "dist", `ConvertBox-Portable-${require("../package.json").version}.exe`));
const temporaryRoot = path.join(root, ".tmp");
fs.mkdirSync(temporaryRoot, { recursive: true });
const testRoot = fs.mkdtempSync(path.join(temporaryRoot, "desktop-"));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function check(category, input) {
  const moved = path.join(testRoot, category);
  fs.mkdirSync(moved);
  const copiedExe = path.join(moved, path.basename(exe));
  const unpacked = fs.existsSync(path.join(path.dirname(exe), "resources", "app.asar"));
  if (!unpacked) fs.copyFileSync(exe, copiedExe);
  const port = await freePort();
  const env = { ...process.env, CONVERTBOX_TEST_INPUT: input,
    CONVERTBOX_TEST_OUTPUT: path.join(moved, category === "image" ? "output.webp" : category === "video" ? "output.webm" : "output.mp3") };
  if (unpacked) env.PORTABLE_EXECUTABLE_DIR = moved;
  const launcher = spawn(unpacked ? exe : copiedExe, [`--remote-debugging-port=${port}`], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"], env });
  let errors = "";
  launcher.stderr.on("data", (chunk) => { errors = (errors + chunk.toString()).slice(-12000); });
  const exited = new Promise((resolve, reject) => { launcher.once("exit", resolve); launcher.once("error", reject); });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 120; attempt++) {
      if (launcher.exitCode !== null) throw new Error(`App exited before startup (${launcher.exitCode}): ${errors}`);
      try {
        const targets = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json());
        ready = targets.some((target) => target.title === "ConvertBox");
      } catch { /* Portable extraction may take time on first launch. */ }
      if (ready) break;
      await delay(500);
    }
    if (!ready) throw new Error(`Portable startup timed out: ${errors}`);
    console.log(`Desktop ready: ${category}, port ${port}`);
    const { stdout } = await exec(process.execPath, [path.join(__dirname, "check-renderer.js"), String(port), category], {
      windowsHide: true, env, timeout: 60000
    });
    process.stdout.write(stdout);
    await Promise.race([exited, delay(15000).then(() => { if (launcher.exitCode === null) throw new Error("Portable launcher did not exit"); })]);
    assert.equal(fs.existsSync(path.join(moved, "ConvertBox-PortableData/temp/working")), false);
    console.log(`Desktop flow passed: ${category}, isolated portable EXE`);
  } finally {
    if (launcher.exitCode === null && launcher.pid) {
      await exec("taskkill.exe", ["/PID", String(launcher.pid), "/T", "/F"], { windowsHide: true }).catch(() => {});
      await Promise.race([exited, delay(5000)]);
    }
  }
}

(async () => {
  const input = path.join(testRoot, "input.mp4");
  await exec(path.join(root, "portable/bin/ffmpeg.exe"), [
    "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=24",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100", "-t", "1",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", input
  ], { windowsHide: true, timeout: 30000 });
  const audio = path.join(testRoot, "input.m4a");
  await exec(path.join(root, "portable/bin/ffmpeg.exe"), ["-v", "error", "-y", "-i", input, "-vn", "-c:a", "copy", audio], { windowsHide: true });
  for (const [category, file] of [["video", input], ["videoToAudio", input], ["audio", audio], ["image", path.join(__dirname, "fixtures/rainbow.heic")]]) {
    if (process.argv[3] && process.argv[3] !== category) continue;
    await check(category, file);
  }
})().catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => {
    assert.equal(path.dirname(testRoot), temporaryRoot);
    fs.rmSync(testRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  });
