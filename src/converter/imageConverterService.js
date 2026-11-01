const path = require("node:path");
const { fork } = require("node:child_process");
const { IMAGE_FORMATS } = require("../shared/formats");
const { LIMITS, assertInputFile } = require("./resourceLimits");
const { normalizeOptions } = require("../shared/conversionOptions");
const activeProcesses = new Set();

function runImageOperation(operation, request, onProgress, signal) {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    assertInputFile(request.filePath, LIMITS.imageBytes);
    if (activeProcesses.size) throw new Error("別の画像を処理しています");
    const workerPath = path.join(__dirname, "imageWorker.js").replace(/\.asar([\\/])/, ".asar.unpacked$1");
    const child = fork(workerPath, [], {
      windowsHide: true, stdio: ["ignore", "ignore", "pipe", "ipc"],
      execArgv: ["--max-old-space-size=256"],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }
    });
    activeProcesses.add(child);
    let result;
    let failure;
    let stderr = "";
    const timer = setTimeout(() => {
      failure = new Error("画像の処理時間の上限（60秒）を超えたため停止しました");
      child.kill("SIGKILL");
    }, LIMITS.imageTimeoutMs);
    const abort = () => {
      failure = Object.assign(new Error("画像の処理を中止しました"), { name: "AbortError" });
      child.kill("SIGKILL");
    };
    signal?.addEventListener("abort", abort, { once: true });
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk.toString()).slice(-12000); });
    child.on("message", (message) => {
      if (message.error) failure = new Error(message.error);
      if (Object.hasOwn(message, "result")) result = message.result;
      if (Number.isFinite(message.progress)) onProgress?.(message.progress);
    });
    child.once("error", (error) => { failure = error; });
    child.once("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      activeProcesses.delete(child);
      if (failure) reject(failure);
      else if (code !== 0 || result === undefined) reject(new Error(stderr || "画像処理が中断されました"));
      else resolve(result);
    });
    child.send({ operation, request });
  });
}

const analyzeImage = ({ filePath, signal }) => runImageOperation("analyze", { filePath }, undefined, signal);
async function convertImage({ filePath, outputPath, targetFormat, onProgress, options, signal }) {
  try {
    if (!IMAGE_FORMATS.includes(targetFormat)) throw new Error("選択した変換先形式にはまだ対応していません");
    if (!outputPath || path.resolve(filePath).toLowerCase() === path.resolve(outputPath).toLowerCase()) {
      throw new Error("元のファイルとは別の保存先を指定してください");
    }
    return await runImageOperation("convert", { filePath, outputPath, targetFormat, options: normalizeOptions(options) }, onProgress, signal);
  } catch (error) {
    return { ok: false, canceled: signal?.aborted || error.name === "AbortError", message: signal?.aborted ? "画像の変換を中止しました" : "画像の変換に失敗しました", detail: error.message };
  }
}

async function terminateActiveImageProcesses() {
  await Promise.all([...activeProcesses].map((child) => new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.once("close", resolve);
    child.kill("SIGKILL");
  })));
}

module.exports = { IMAGE_FORMATS, analyzeImage, convertImage, terminateActiveImageProcesses };
