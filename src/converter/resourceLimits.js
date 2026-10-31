const fs = require("node:fs");

const LIMITS = Object.freeze({
  mediaBytes: 20 * 1024 ** 3,
  imageBytes: 100 * 1024 ** 2,
  imagePixels: 40_000_000,
  imagePages: 200,
  probeTimeoutMs: 30_000,
  imageTimeoutMs: 60_000,
  heicTimeoutMs: 30_000,
  conversionTimeoutMs: 2 * 60 * 60 * 1000,
  probeOutputBytes: 1024 * 1024,
  outputBytes: 10 * 1024 ** 3,
  activeProcesses: 2
});

function assertInputFile(filePath, maxBytes = LIMITS.mediaBytes) {
  if (typeof filePath !== "string" || !filePath || filePath.length > 32767 || filePath.includes("\0")) {
    throw new Error("変換元ファイルの指定が不正です");
  }
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new Error("通常のファイルを選択してください");
  if (stat.size > maxBytes) throw new Error(`ファイルサイズの上限（${Math.round(maxBytes / 1024 ** 2)} MB）を超えています`);
  return stat;
}

function assertImageDimensions(width, height, pages = 1) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)
    || width <= 0 || height <= 0 || width * height > LIMITS.imagePixels
    || !Number.isSafeInteger(pages) || pages <= 0 || pages > LIMITS.imagePages) {
    throw new Error("画像の上限（合計4000万画素・200ページ）を超えているか、画像サイズが不正です");
  }
}

module.exports = { LIMITS, assertInputFile, assertImageDimensions };
