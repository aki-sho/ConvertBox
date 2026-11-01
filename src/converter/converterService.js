const fs = require("fs");
const path = require("path");
const { runProcess, terminateActiveProcesses } = require("./processRunner");
const { LIMITS, assertInputFile } = require("./resourceLimits");
const { PRESETS, normalizeOptions } = require("../shared/conversionOptions");

const { FORMATS } = require("../shared/formats");
const VIDEO_FORMATS = FORMATS.video;
const AUDIO_FORMATS = FORMATS.audio;
// Media files must not turn into playlists or fetch network resources.
const INPUT_ARGUMENTS = ["-protocol_whitelist", "file,pipe", "-format_whitelist", "mov,matroska,webm,avi,mp3,wav,aac", "-threads", "2"];

const VIDEO_ARGUMENTS = Object.freeze({
  MP4: ["-c:v", "libx264", "-preset", "medium", "-crf", "23", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart"],
  MOV: ["-c:v", "libx264", "-preset", "medium", "-crf", "23", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart"],
  WebM: ["-c:v", "libvpx-vp9", "-crf", "32", "-b:v", "0", "-c:a", "libopus", "-b:a", "128k"],
  AVI: ["-c:v", "mpeg4", "-q:v", "5", "-c:a", "libmp3lame", "-b:a", "192k"]
});

const AUDIO_ARGUMENTS = Object.freeze({
  MP3: ["-vn", "-c:a", "libmp3lame", "-b:a", "192k"],
  WAV: ["-vn", "-c:a", "pcm_s16le"],
  M4A: ["-vn", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart"],
  AAC: ["-vn", "-c:a", "aac", "-b:a", "192k", "-f", "adts"],
  WebM: ["-map", "0:a:0", "-vn", "-c:a", "libopus", "-b:a", "128k", "-ar", "48000", "-f", "webm"]
});

async function analyzeVideo({ filePath, ffprobePath, signal }) {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error("選択したファイルが見つかりません");
  }
  assertInputFile(filePath);

  if (!fs.existsSync(ffprobePath)) {
    throw new Error("解析用の ffprobe.exe が見つかりません");
  }

  let output = "";
  await runProcess(
    ffprobePath,
    ["-v", "error", "-max_alloc", "268435456", ...INPUT_ARGUMENTS, "-show_format", "-show_streams", "-of", "json", filePath],
    (chunk) => { output += chunk; },
    { timeoutMs: LIMITS.probeTimeoutMs, maxStdoutBytes: LIMITS.probeOutputBytes, signal }
  );

  const metadata = JSON.parse(output);
  const videoStream = metadata.streams?.find((stream) => stream.codec_type === "video");
  const audioStream = metadata.streams?.find((stream) => stream.codec_type === "audio");

  if (!videoStream) {
    throw new Error("このファイルから映像データを確認できませんでした");
  }

  return {
    durationSeconds: Number(metadata.format?.duration || videoStream.duration || 0),
    width: videoStream.width || 0,
    height: videoStream.height || 0,
    videoCodec: videoStream.codec_name || "不明",
    audioCodec: audioStream?.codec_name || "音声なし",
    hasAudio: Boolean(audioStream),
    sizeBytes: Number(metadata.format?.size || 0),
    formatName: metadata.format?.format_long_name || metadata.format?.format_name || "不明"
  };
}

async function analyzeAudio({ filePath, ffprobePath, signal }) {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error("選択したファイルが見つかりません");
  }
  assertInputFile(filePath);

  if (!fs.existsSync(ffprobePath)) {
    throw new Error("解析用の ffprobe.exe が見つかりません");
  }

  let output = "";
  await runProcess(
    ffprobePath,
    ["-v", "error", "-max_alloc", "268435456", ...INPUT_ARGUMENTS, "-show_format", "-show_streams", "-of", "json", filePath],
    (chunk) => { output += chunk; },
    { timeoutMs: LIMITS.probeTimeoutMs, maxStdoutBytes: LIMITS.probeOutputBytes, signal }
  );

  const metadata = JSON.parse(output);
  const audioStream = metadata.streams?.find((stream) => stream.codec_type === "audio");

  if (!audioStream) {
    throw new Error("このファイルから音声データを確認できませんでした");
  }

  return {
    durationSeconds: Number(metadata.format?.duration || audioStream.duration || 0),
    audioCodec: audioStream.codec_name || "不明",
    sampleRate: Number(audioStream.sample_rate || 0),
    channels: Number(audioStream.channels || 0),
    channelLayout: audioStream.channel_layout || "不明",
    sizeBytes: Number(metadata.format?.size || 0),
    formatName: metadata.format?.format_long_name || metadata.format?.format_name || "不明"
  };
}

async function convertWithArguments({
  filePath,
  outputPath,
  targetFormat,
  supportedFormats,
  formatArguments,
  ffmpegPath,
  durationSeconds,
  onProgress,
  mediaLabel,
  options,
  signal
}) {
  if (!filePath || !fs.existsSync(filePath)) {
    return { ok: false, message: "選択したファイルが見つかりません" };
  }

  if (!supportedFormats.includes(targetFormat)) {
    return { ok: false, message: "選択した変換先形式にはまだ対応していません" };
  }

  if (!outputPath) {
    return { ok: false, message: "変換後ファイルの準備先がありません" };
  }

  if (path.resolve(filePath).toLowerCase() === path.resolve(outputPath).toLowerCase()) {
    return { ok: false, message: "元のファイルとは別の保存先を指定してください" };
  }

  if (!fs.existsSync(ffmpegPath)) {
    return { ok: false, message: "変換用の ffmpeg.exe が見つかりません" };
  }

  const totalMicroseconds = Math.max(Number(durationSeconds) || 0, 0) * 1000000;
  let progressBuffer = "";

  try {
    const preset = PRESETS[normalizeOptions(options).preset];
    const argumentsForFormat = [...formatArguments[targetFormat]];
    for (let index = 0; index < argumentsForFormat.length - 1; index++) {
      const flag = argumentsForFormat[index];
      if (flag === "-crf") argumentsForFormat[index + 1] = String(targetFormat === "WebM" ? preset.webmCrf : preset.crf);
      if (flag === "-q:v") argumentsForFormat[index + 1] = String(preset.aviQuality);
      if (flag === "-b:a") argumentsForFormat[index + 1] = `${targetFormat === "WebM" ? preset.opusKbps : preset.audioKbps}k`;
    }
    assertInputFile(filePath);
    await runProcess(
      ffmpegPath,
      ["-hide_banner", "-nostdin", "-y", "-max_alloc", "268435456", ...INPUT_ARGUMENTS, "-i", filePath,
        ...argumentsForFormat, "-threads", "2", "-fs", String(LIMITS.outputBytes), "-progress", "pipe:1", "-nostats", outputPath],
      (chunk) => {
        progressBuffer += chunk;
        const lines = progressBuffer.split(/\r?\n/);
        progressBuffer = lines.pop() || "";
        if (progressBuffer.length > 8192) throw new Error("進捗情報のサイズが不正です");

        for (const line of lines) {
          const [key, value] = line.split("=");
          if (key === "out_time_us" && totalMicroseconds > 0) {
            const percent = Math.min(99, Math.max(0, Math.round((Number(value) / totalMicroseconds) * 100)));
            onProgress?.(percent);
          }
        }
      },
      { signal }
    );

    if (fs.statSync(outputPath).size >= LIMITS.outputBytes) throw new Error("出力ファイルの上限（10 GB）を超えました");

    onProgress?.(100);
    return { ok: true, outputPath, message: `${targetFormat} への変換が完了しました` };
  } catch (error) {
    return { ok: false, canceled: signal?.aborted || error.name === "AbortError", message: signal?.aborted ? "変換を中止しました" : `${mediaLabel}の変換に失敗しました`, detail: error.message };
  }
}

async function convertVideo({ filePath, outputPath, targetFormat, ffmpegPath, durationSeconds, onProgress, options, signal }) {
  return convertWithArguments({
    filePath, outputPath, targetFormat, ffmpegPath, durationSeconds, onProgress, options, signal,
    supportedFormats: VIDEO_FORMATS,
    formatArguments: VIDEO_ARGUMENTS,
    mediaLabel: "動画"
  });
}

async function convertAudio({ filePath, outputPath, targetFormat, ffmpegPath, durationSeconds, onProgress, options, signal }) {
  return convertWithArguments({
    filePath, outputPath, targetFormat, ffmpegPath, durationSeconds, onProgress, options, signal,
    supportedFormats: AUDIO_FORMATS,
    formatArguments: AUDIO_ARGUMENTS,
    mediaLabel: "音声"
  });
}

async function extractAudio({ filePath, outputPath, targetFormat, ffmpegPath, durationSeconds, onProgress, options, signal }) {
  return convertWithArguments({
    filePath, outputPath, targetFormat, ffmpegPath, durationSeconds, onProgress, options, signal,
    supportedFormats: AUDIO_FORMATS,
    formatArguments: AUDIO_ARGUMENTS,
    mediaLabel: "動画から音声"
  });
}

module.exports = {
  VIDEO_FORMATS,
  AUDIO_FORMATS,
  analyzeVideo,
  analyzeAudio,
  convertVideo,
  convertAudio,
  extractAudio,
  terminateActiveProcesses
};
