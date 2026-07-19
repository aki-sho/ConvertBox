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
  "portable/bin/README.md",
  "scripts/prepare-portable-release.js",
  "scripts/create-portable-release.js"
];

for (const file of requiredFiles) {
  if (!fs.existsSync(path.join(__dirname, "..", file))) {
    throw new Error(`必要なファイルがありません: ${file}`);
  }
}

if (packageJson.version !== "1.0.0") {
  throw new Error(`本番バージョンが正しくありません: ${packageJson.version}`);
}

if (
  packageJson.name !== "convertbox"
  || packageJson.build?.productName !== "ConvertBox"
  || packageJson.build?.appId !== "com.convertbox.desktop"
  || packageJson.build?.artifactName !== "ConvertBox-Portable-${version}.${ext}"
) {
  throw new Error("ConvertBoxのパッケージまたはビルド設定が正しくありません");
}

if (
  packageJson.scripts?.["release:portable"]
  !== "node scripts/prepare-portable-release.js && npm run package:portable && node scripts/create-portable-release.js"
) {
  throw new Error("ポータブル版のリリース生成コマンドが正しくありません");
}

if (!packageJson.devDependencies?.archiver) {
  throw new Error("ZIP生成用のarchiverが開発依存関係にありません");
}

const releaseScriptSource = fs.readFileSync(
  path.join(__dirname, "..", "scripts/create-portable-release.js"),
  "utf8"
);
for (const requiredText of [
  "ConvertBox ポータブル版",
  "ConvertBox-PortableDataフォルダに保存されます。",
  "アンインストールは、このフォルダを削除するだけです。",
  "`${zipName}.sha256`"
]) {
  if (!releaseScriptSource.includes(requiredText)) {
    throw new Error(`ZIP版の生成設定が不足しています: ${requiredText}`);
  }
}

const preloadSource = fs.readFileSync(path.join(__dirname, "..", "src/main/preload.js"), "utf8");
const portablePathsSource = fs.readFileSync(path.join(__dirname, "..", "src/main/portablePaths.js"), "utf8");

if (!preloadSource.includes('exposeInMainWorld("convertBox"')) {
  throw new Error("ConvertBoxのrenderer API名が正しくありません");
}

if (!portablePathsSource.includes('"ConvertBox-PortableData"')) {
  throw new Error("ConvertBoxのポータブルデータフォルダ名が正しくありません");
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
