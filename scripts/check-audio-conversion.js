const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const { analyzeAudio, convertAudio } = require("../src/converter/converterService");

const execFileAsync = promisify(execFile);
const rootPath = path.join(__dirname, "..");
const ffmpegPath = path.join(rootPath, "portable/bin/ffmpeg.exe");
const ffprobePath = path.join(rootPath, "portable/bin/ffprobe.exe");
const temporaryRoot = path.join(rootPath, ".tmp");
fs.mkdirSync(temporaryRoot, { recursive: true });
const testPath = fs.mkdtempSync(path.join(temporaryRoot, "audio-test-"));

async function main() {
  const inputPath = path.join(testPath, "input.wav");
  await execFileAsync(ffmpegPath, [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100",
    "-t", "1", "-c:a", "pcm_s16le", inputPath
  ]);

  const metadata = await analyzeAudio({ filePath: inputPath, ffprobePath });
  if (metadata.sampleRate !== 44100 || metadata.channels <= 0 || metadata.durationSeconds <= 0) {
    throw new Error("テスト音声の解析結果が正しくありません");
  }

  for (const format of ["MP3", "WAV", "M4A", "AAC"]) {
    const outputPath = path.join(testPath, `output.${format.toLowerCase()}`);
    const result = await convertAudio({
      filePath: inputPath,
      outputPath,
      targetFormat: format,
      ffmpegPath,
      durationSeconds: metadata.durationSeconds
    });

    if (!result.ok || !fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
      throw new Error(`${format} 変換テストに失敗しました: ${result.detail || result.message}`);
    }

    const outputMetadata = await analyzeAudio({ filePath: outputPath, ffprobePath });
    if (outputMetadata.durationSeconds <= 0) {
      throw new Error(`${format} の出力音声を解析できませんでした`);
    }
  }

  console.log("Audio conversion check passed: MP3, WAV, M4A, AAC");
}

main()
  .finally(() => {
    fs.rmSync(testPath, { recursive: true, force: true });
    if (fs.existsSync(temporaryRoot) && fs.readdirSync(temporaryRoot).length === 0) {
      fs.rmdirSync(temporaryRoot);
    }
  })
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
