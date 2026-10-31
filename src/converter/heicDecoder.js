const fs = require("node:fs/promises");
const { Worker, isMainThread, parentPort, workerData } = require("node:worker_threads");
const { LIMITS, assertInputFile, assertImageDimensions } = require("./resourceLimits");
const activeWorkers = new Set();

// HEVC decoding is CPU intensive. Keep it off Electron's main thread and free
// the WebAssembly heap after each image, including failed decodes.
function decodeHeic(filePath, metadataOnly = false) {
  return new Promise((resolve, reject) => {
    assertInputFile(filePath, LIMITS.imageBytes);
    if (activeWorkers.size) throw new Error("別のHEIC / HEIF画像を処理しています");
    const workerPath = __filename.replace(/\.asar([\\/])/, ".asar.unpacked$1");
    const worker = new Worker(workerPath, {
      workerData: { filePath, metadataOnly }, resourceLimits: { maxOldGenerationSizeMb: 256, stackSizeMb: 8 }
    });
    activeWorkers.add(worker);
    let received = false;
    const finish = async (error, result) => {
      if (received) return;
      received = true;
      clearTimeout(timer);
      await worker.terminate().catch(() => {});
      activeWorkers.delete(worker);
      if (error) reject(error);
      else resolve(result);
    };
    const timer = setTimeout(() => finish(new Error("HEIC / HEIF画像の処理時間の上限を超えました")), LIMITS.heicTimeoutMs);
    worker.once("message", (result) => finish(result.error
      ? new Error(`HEIC / HEIF画像を読み込めませんでした: ${result.error}`) : null, result));
    worker.once("error", (error) => finish(error));
    worker.once("exit", (code) => {
      if (!received) finish(new Error(`HEIC / HEIF画像の読み込みが中断されました (${code})`));
    });
  });
}

async function runDecoder() {
  const decode = require("heic-decode");
  // Read only the size checked at open time, even if the file grows afterwards.
  const file = await fs.open(workerData.filePath, "r");
  let buffer;
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > LIMITS.imageBytes) throw new Error("HEIC / HEIFファイルの上限は100 MBです");
    buffer = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await file.read(buffer, offset, buffer.length - offset, offset);
      if (!bytesRead) throw new Error("HEIC / HEIFファイルの読み込みが中断されました");
      offset += bytesRead;
    }
  } finally { await file.close(); }
  const images = await decode.all({ buffer });
  try {
    assertImageDimensions(images[0]?.width, images[0]?.height, images.length);
    // Like other still-image conversions, use the first image in the container.
    const { width, height, data } = await images[0].decode();
    let hasAlpha = false;
    for (let offset = 3; offset < data.length; offset += 4) {
      if (data[offset] !== 255) {
        hasAlpha = true;
        break;
      }
    }
    const result = { width, height, pages: images.length, hasAlpha };
    if (workerData.metadataOnly) {
      parentPort.postMessage(result);
    } else {
      parentPort.postMessage({ ...result, data }, [data.buffer]);
    }
  } finally {
    images.dispose();
  }
}

async function terminateActiveHeicWorkers() {
  await Promise.all([...activeWorkers].map((worker) => worker.terminate()));
}

if (!isMainThread) {
  runDecoder().catch((error) => parentPort.postMessage({ error: error.message }));
}

module.exports = { decodeHeic, terminateActiveHeicWorkers };
