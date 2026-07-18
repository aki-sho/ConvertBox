const fs = require("fs");
const path = require("path");
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

  console.log("Image conversion check passed: JPG, PNG, JPEG, GIF, WebP, SVG");
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
