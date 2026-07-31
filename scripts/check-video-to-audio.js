const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const { analyzeVideo, extractAudio } = require("../src/converter/converterService");

const execFileAsync = promisify(execFile);
const rootPath = path.join(__dirname, "..");
const ffmpegPath = path.join(rootPath, "portable/bin/ffmpeg.exe");
const ffprobePath = path.join(rootPath, "portable/bin/ffprobe.exe");
const temporaryRoot = path.join(rootPath, ".tmp");
fs.mkdirSync(temporaryRoot, { recursive: true });
const testPath = fs.mkdtempSync(path.join(temporaryRoot, "video-to-audio-test-"));

async function assertAudioOnly(filePath) {
  const { stdout } = await execFileAsync(ffprobePath, [
    "-v", "error", "-show_entries", "stream=codec_type", "-of", "json", filePath
  ]);
  const streams = JSON.parse(stdout).streams || [];
  if (!streams.some((stream) => stream.codec_type === "audio")) {
    throw new Error(`${path.basename(filePath)} に音声ストリームがありません`);
  }
  if (streams.some((stream) => stream.codec_type === "video")) {
    throw new Error(`${path.basename(filePath)} に映像ストリームが残っています`);
  }
}

async function main() {
  const inputPath = path.join(testPath, "input.mp4");
  await execFileAsync(ffmpegPath, [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "testsrc=size=320x180:rate=24",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100",
    "-t", "1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", inputPath
  ]);

  const metadata = await analyzeVideo({ filePath: inputPath, ffprobePath });
  if (!metadata.hasAudio) {
    throw new Error("テスト動画の音声トラックを検出できませんでした");
  }

  for (const format of ["MP3", "WAV", "M4A", "AAC"]) {
    const outputPath = path.join(testPath, `output.${format.toLowerCase()}`);
    const result = await extractAudio({
      filePath: inputPath,
      outputPath,
      targetFormat: format,
      ffmpegPath,
      durationSeconds: metadata.durationSeconds
    });

    if (!result.ok || !fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
      throw new Error(`${format} 音声抽出テストに失敗しました: ${result.detail || result.message}`);
    }
    await assertAudioOnly(outputPath);
  }

  console.log("Video-to-audio check passed: MP3, WAV, M4A, AAC");
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
