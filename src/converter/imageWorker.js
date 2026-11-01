const fs = require("fs");
const sharp = require("sharp");
const { IMAGE_FORMATS, getExtension } = require("../shared/formats");
const { decodeHeic } = require("./heicDecoder");
const { LIMITS, assertInputFile, assertImageDimensions } = require("./resourceLimits");
const IMAGE_OPTIONS = { limitInputPixels: LIMITS.imagePixels, failOn: "warning" };
const { PRESETS, normalizeOptions } = require("../shared/conversionOptions");

function isHeic(filePath) {
  return ["HEIC", "HEIF"].includes(getExtension(filePath));
}

async function openImage(filePath, options) {
  if (!isHeic(filePath)) return sharp(filePath, { ...IMAGE_OPTIONS, ...options }).timeout({ seconds: LIMITS.imageTimeoutMs / 1000 });
  const { width, height, data } = await decodeHeic(filePath);
  return sharp(Buffer.from(data.buffer, data.byteOffset, data.byteLength), {
    ...IMAGE_OPTIONS,
    raw: { width, height, channels: 4 }
  }).timeout({ seconds: LIMITS.imageTimeoutMs / 1000 });
}

async function analyzeImage({ filePath }) {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error("選択したファイルが見つかりません");
  }
  assertInputFile(filePath, LIMITS.imageBytes);

  const metadata = isHeic(filePath)
    ? await decodeHeic(filePath, true).then((image) => ({
      ...image,
      format: "heic",
      channels: image.hasAlpha ? 4 : 3
    }))
    : await sharp(filePath, { ...IMAGE_OPTIONS, animated: true }).metadata();
  assertImageDimensions(metadata.width, metadata.height, metadata.pages || 1);
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

async function convertImage({ filePath, outputPath, targetFormat, onProgress, options }) {
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
    const settings = normalizeOptions(options);
    const quality = PRESETS[settings.preset].imageQuality;
    assertInputFile(filePath, LIMITS.imageBytes);
    // Validate total animation dimensions/page count even when exporting a still.
    const source = await analyzeImage({ filePath });
    onProgress?.(10);
    let pipeline = await openImage(filePath, { animated: targetFormat === "GIF" });
    const transform = (image) => {
      if (settings.image.autoOrient) image = image.autoOrient();
      if (settings.image.rotation) image = image.rotate(settings.image.rotation);
      if (settings.image.width || settings.image.height) image = image.resize({
        width: settings.image.width || undefined, height: settings.image.height || undefined, fit: "inside", withoutEnlargement: true
      });
      return image;
    };
    let animation = {};
    if (source.pages > 1 && targetFormat === "GIF") {
      const metadata = await sharp(filePath, { ...IMAGE_OPTIONS, animated: true }).metadata();
      animation = { delay: metadata.delay, loop: metadata.loop };
      // libvips cannot rotate a multi-page image by 90/270 degrees directly.
      // Transform frames individually, then reassemble their bounded raw pixels.
      if (settings.image.rotation % 180 !== 0) {
        const frames = [];
        let info;
        for (let page = 0; page < source.pages; page++) {
          const frame = await transform(sharp(filePath, { ...IMAGE_OPTIONS, page, pages: 1 })).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
          frames.push(frame.data);
          info = frame.info;
        }
        pipeline = sharp(Buffer.concat(frames), { raw: { width: info.width, height: info.height * source.pages, channels: 4, pageHeight: info.height }, ...IMAGE_OPTIONS });
      } else pipeline = transform(pipeline);
    } else pipeline = transform(pipeline);

    if (targetFormat === "SVG") {
      const { data: pngBuffer, info } = await pipeline.png().toBuffer({ resolveWithObject: true });
      const width = info.width;
      const height = info.height;
      const svg = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
        `  <image width="${width}" height="${height}" href="data:image/png;base64,${pngBuffer.toString("base64")}"/>`,
        "</svg>"
      ].join("\n");
      await fs.promises.writeFile(outputPath, svg, "utf8");
    } else {
      if (targetFormat === "JPG" || targetFormat === "JPEG") {
        pipeline = pipeline.flatten({ background: "#ffffff" }).jpeg({ quality });
      } else if (targetFormat === "PNG") {
        pipeline = pipeline.png({ compressionLevel: settings.preset === "compact" ? 9 : settings.preset === "high" ? 3 : 6 });
      } else if (targetFormat === "GIF") {
        pipeline = pipeline.gif({ effort: 5, colours: settings.preset === "compact" ? 96 : settings.preset === "high" ? 256 : 192, ...animation });
      } else if (targetFormat === "WebP") {
        pipeline = pipeline.webp({ quality });
      }

      await pipeline.toFile(outputPath);
    }

    onProgress?.(100);
    return { ok: true, outputPath, message: `${targetFormat} への変換が完了しました` };
  } catch (error) {
    return { ok: false, message: "画像の変換に失敗しました", detail: error.message };
  }
}

// Decode untrusted images outside Electron's main process. The parent applies a
// hard deadline covering metadata parsing as well as native codec operations.
process.once("message", async ({ operation, request }) => {
  try {
    const result = operation === "analyze"
      ? await analyzeImage(request)
      : await convertImage({ ...request, onProgress: (percent) => process.send({ progress: percent }) });
    process.send({ result }, () => process.disconnect());
  } catch (error) {
    process.send({ error: error.message }, () => process.disconnect());
  }
});
