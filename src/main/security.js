const fs = require("node:fs");
const path = require("node:path");
const { CONVERSION_FORMATS } = require("../shared/formats");
const { normalizeOptions } = require("../shared/conversionOptions");

function validateConversionRequest(request) {
  if (!request || typeof request !== "object" || Array.isArray(request)
    || typeof request.category !== "string"
    || !Object.hasOwn(CONVERSION_FORMATS, request.category)
    || typeof request.targetFormat !== "string"
    || !CONVERSION_FORMATS[request.category].includes(request.targetFormat)
    || typeof request.filePath !== "string") {
    throw new Error("対応するカテゴリ・変換元ファイル・変換先形式を指定してください");
  }
  normalizeOptions(request.options);
}

function isTrustedSender(event, window, rendererUrl) {
  return Boolean(window && !window.isDestroyed()
    && event.sender === window.webContents
    && event.senderFrame === window.webContents.mainFrame
    && event.senderFrame.url === rendererUrl);
}

// Only direct children with app-generated names may be removed individually.
function assertTemporaryPath(workingPath, filePath) {
  const relative = path.relative(path.resolve(workingPath), path.resolve(filePath));
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(mp4|mov|webm|avi|mp3|wav|m4a|aac|jpg|jpeg|png|gif|webp|svg)$/i.test(relative)) {
    throw new Error("一時ファイルの保存先が不正です");
  }
  return filePath;
}

// Reject junctions/symlinks in the writable data directories before writing or
// cleaning up. A lexical path check alone would not catch a redirected parent.
function assertWorkingDirectory(portableRoot, workingPath) {
  const relative = path.relative(portableRoot, workingPath);
  if (relative !== path.join("temp", "working")) throw new Error("作業フォルダが不正です");
  for (const directory of [portableRoot, path.join(portableRoot, "temp"), workingPath]) {
    if (fs.existsSync(directory) && (fs.lstatSync(directory).isSymbolicLink()
      || !fs.lstatSync(directory).isDirectory())) {
      throw new Error("作業フォルダにはリンクや通常ファイルを指定できません");
    }
  }
}

module.exports = { validateConversionRequest, isTrustedSender, assertTemporaryPath, assertWorkingDirectory };
