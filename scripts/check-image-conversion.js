const fs = require("fs");
const path = require("path");
const assert = require("node:assert/strict");
const sharp = require("sharp");
const { analyzeImage, convertImage } = require("../src/converter/imageConverterService");

sharp.cache(false);

const rootPath = path.join(__dirname, "..");
const temporaryRoot = path.join(rootPath, ".tmp");
fs.mkdirSync(temporaryRoot, { recursive: true });
const testPath = fs.mkdtempSync(path.join(temporaryRoot, "image-test-"));

async function main() {
  const inputPath = path.join(testPath, "input.png");
  await sharp({
    create: {
      width: 320,
      height: 180,
      channels: 4,
      background: { r: 49, g: 87, b: 213, alpha: 0.75 }
    }
  }).png().toFile(inputPath);

  const metadata = await analyzeImage({ filePath: inputPath });
  if (metadata.width !== 320 || metadata.height !== 180 || !metadata.hasAlpha) {
    throw new Error("テスト画像の解析結果が正しくありません");
  }

  for (const format of ["JPG", "PNG", "JPEG", "GIF", "WebP", "SVG"]) {
    const outputPath = path.join(testPath, `output.${format.toLowerCase()}`);
    const result = await convertImage({ filePath: inputPath, outputPath, targetFormat: format });

    if (!result.ok || !fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
      throw new Error(`${format} 変換テストに失敗しました: ${result.detail || result.message}`);
    }

    const outputMetadata = await analyzeImage({ filePath: outputPath });
    if (outputMetadata.width !== 320 || outputMetadata.height !== 180) {
      throw new Error(`${format} の出力画像サイズが正しくありません`);
    }
  }

  for (const extension of ["HEIC", "heif"]) {
    const heicPath = path.join(testPath, `写真 テスト.${extension}`);
    fs.copyFileSync(path.join(__dirname, "fixtures", "rainbow.heic"), heicPath);
    const heicMetadata = await analyzeImage({ filePath: heicPath });
    assert.deepEqual(heicMetadata, {
      width: 451, height: 461, imageFormat: "HEIC", channels: 3,
      pages: 1, hasAlpha: false, sizeBytes: fs.statSync(heicPath).size
    });

    for (const format of ["JPG", "PNG", "JPEG", "GIF", "WebP", "SVG"]) {
      const outputPath = path.join(testPath, `${extension}-output.${format.toLowerCase()}`);
      const progress = [];
      const result = await convertImage({
        filePath: heicPath, outputPath, targetFormat: format,
        onProgress: (percent) => progress.push(percent)
      });
      assert.equal(result.ok, true, `${extension} → ${format}: ${result.detail || result.message}`);
      assert.deepEqual(progress, [10, 100]);
      // Decode the output pixels, rather than only trusting the image header.
      const { data, info } = await sharp(outputPath).raw().toBuffer({ resolveWithObject: true });
      assert.equal(info.width, 451);
      assert.equal(info.height, 461);
      assert.ok(data.some((value) => value > 0), `${format}の出力画像が空です`);
    }
  }

  const invalidHeic = path.join(testPath, "broken.heic");
  fs.writeFileSync(invalidHeic, Buffer.from("00000000ftypheic"));
  await assert.rejects(analyzeImage({ filePath: invalidHeic }), /HEIC \/ HEIF/);
  const invalidOutput = path.join(testPath, "broken.png");
  const failed = await convertImage({ filePath: invalidHeic, outputPath: invalidOutput, targetFormat: "PNG" });
  assert.equal(failed.ok, false);
  assert.equal(fs.existsSync(invalidOutput), false);

  console.log("Image conversion check passed: existing formats, HEIC/HEIF to all 6 formats, invalid HEIC");
}

main()
  .finally(async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        fs.rmSync(testPath, { recursive: true, force: true });
        break;
      } catch (error) {
        if (attempt === 4) throw error;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
    if (fs.existsSync(temporaryRoot) && fs.readdirSync(temporaryRoot).length === 0) {
      fs.rmdirSync(temporaryRoot);
    }
  })
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
