const fs = require("fs");
const path = require("path");
const packageJson = require("../package.json");
const { FORMATS, getExtension, inferCategory } = require("../src/shared/formats");
const { VIDEO_FORMATS, AUDIO_FORMATS } = require("../src/converter/converterService");
const { IMAGE_FORMATS } = require("../src/converter/imageConverterService");

const requiredFiles = [
  "src/main/main.js",
  "src/main/preload.js",
  "src/renderer/index.html",
  "src/renderer/app.js",
  "src/renderer/style.css",
  "src/shared/formats.js",
  "src/converter/converterService.js",
  "src/converter/imageConverterService.js",
  "portable/bin/README.md"
];

for (const file of requiredFiles) {
  if (!fs.existsSync(path.join(__dirname, "..", file))) {
    throw new Error(`必要なファイルがありません: ${file}`);
  }
}

if (packageJson.version !== "1.0.0") {
  throw new Error(`本番バージョンが正しくありません: ${packageJson.version}`);
}

if (FORMATS.video.length !== 4 || FORMATS.audio.length !== 4 || FORMATS.image.length !== 6) {
  throw new Error("対応形式の定義が正しくありません");
}

if (VIDEO_FORMATS.join(",") !== "MP4,MOV,WebM,AVI") {
  throw new Error("Video変換形式の定義が正しくありません");
}

if (AUDIO_FORMATS.join(",") !== "MP3,WAV,M4A,AAC") {
  throw new Error("Audio変換形式の定義が正しくありません");
}

if (IMAGE_FORMATS.join(",") !== "JPG,PNG,JPEG,GIF,WebP,SVG") {
  throw new Error("Image変換形式の定義が正しくありません");
}

for (const binary of ["portable/bin/ffmpeg.exe", "portable/bin/ffprobe.exe"]) {
  if (!fs.existsSync(path.join(__dirname, "..", binary))) {
    throw new Error(`変換用バイナリがありません: ${binary}`);
  }
}

if (getExtension("sample.photo.jpeg") !== "JPEG" || inferCategory("png") !== "image") {
  throw new Error("拡張子またはカテゴリの推定が正しくありません");
}

console.log("Project check passed.");
