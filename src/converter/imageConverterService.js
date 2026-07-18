const fs = require("fs");
const sharp = require("sharp");

const IMAGE_FORMATS = Object.freeze(["JPG", "PNG", "JPEG", "GIF", "WebP", "SVG"]);

async function analyzeImage({ filePath }) {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error("選択したファイルが見つかりません");
  }

  const metadata = await sharp(filePath, { animated: true }).metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error("このファイルから画像情報を確認できませんでした");
  }

  return {
    width: metadata.width,
    height: metadata.pageHeight || metadata.height,
    imageFormat: String(metadata.format || "不明").toUpperCase(),
    channels: metadata.channels || 0,
    pages: metadata.pages || 1,
    hasAlpha: Boolean(metadata.hasAlpha),
    sizeBytes: fs.statSync(filePath).size
  };
}

async function convertImage({ filePath, outputPath, targetFormat, onProgress }) {
  if (!filePath || !fs.existsSync(filePath)) {
    return { ok: false, message: "選択したファイルが見つかりません" };
  }

  if (!IMAGE_FORMATS.includes(targetFormat)) {
    return { ok: false, message: "選択した変換先形式にはまだ対応していません" };
  }

  if (!outputPath) {
    return { ok: false, message: "変換後ファイルの準備先がありません" };
  }

  try {
    onProgress?.(10);

    if (targetFormat === "SVG") {
      const metadata = await sharp(filePath).metadata();
      const pngBuffer = await sharp(filePath).png().toBuffer();
      const width = metadata.width || 1;
      const height = metadata.pageHeight || metadata.height || 1;
      const svg = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
        `  <image width="${width}" height="${height}" href="data:image/png;base64,${pngBuffer.toString("base64")}"/>`,
        "</svg>"
      ].join("\n");
      await fs.promises.writeFile(outputPath, svg, "utf8");
    } else {
      let pipeline = sharp(filePath, { animated: targetFormat === "GIF" });

      if (targetFormat === "JPG" || targetFormat === "JPEG") {
        pipeline = pipeline.flatten({ background: "#ffffff" }).jpeg({ quality: 90 });
      } else if (targetFormat === "PNG") {
        pipeline = pipeline.png({ compressionLevel: 9 });
      } else if (targetFormat === "GIF") {
        pipeline = pipeline.gif({ effort: 5 });
      } else if (targetFormat === "WebP") {
        pipeline = pipeline.webp({ quality: 90 });
      }

      await pipeline.toFile(outputPath);
    }

    onProgress?.(100);
    return { ok: true, outputPath, message: `${targetFormat} への変換が完了しました` };
  } catch (error) {
    return { ok: false, message: "画像の変換に失敗しました", detail: error.message };
  }
}

module.exports = { IMAGE_FORMATS, analyzeImage, convertImage };
