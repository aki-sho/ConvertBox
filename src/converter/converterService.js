const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const VIDEO_FORMATS = Object.freeze(["MP4", "MOV", "WebM", "AVI"]);
const AUDIO_FORMATS = Object.freeze(["MP3", "WAV", "M4A", "AAC"]);
const activeProcesses = new Set();

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
  AAC: ["-vn", "-c:a", "aac", "-b:a", "192k", "-f", "adts"]
});

function runProcess(executable, args, onOutput) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true });
    let stderr = "";
    activeProcesses.add(child);

    child.stdout.on("data", (chunk) => onOutput?.(chunk.toString()));
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 12000) stderr = stderr.slice(-12000);
    });
    child.on("error", (error) => {
      activeProcesses.delete(child);
      reject(error);
    });
    child.on("close", (code) => {
      activeProcesses.delete(child);
      if (code === 0) {
        resolve(stderr);
      } else {
        reject(new Error(stderr.trim() || `変換処理が終了コード ${code} で停止しました`));
      }
    });
  });
}

function terminateActiveProcesses() {
  for (const child of activeProcesses) {
    try {
      child.kill("SIGTERM");
    } catch {
      // The process may already have exited.
    }
  }
  activeProcesses.clear();
}

async function analyzeVideo({ filePath, ffprobePath }) {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error("選択したファイルが見つかりません");
  }

  if (!fs.existsSync(ffprobePath)) {
    throw new Error("解析用の ffprobe.exe が見つかりません");
  }

  let output = "";
  await runProcess(
    ffprobePath,
    ["-v", "error", "-show_format", "-show_streams", "-of", "json", filePath],
    (chunk) => { output += chunk; }
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
    sizeBytes: Number(metadata.format?.size || 0),
    formatName: metadata.format?.format_long_name || metadata.format?.format_name || "不明"
  };
}

async function analyzeAudio({ filePath, ffprobePath }) {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error("選択したファイルが見つかりません");
  }

  if (!fs.existsSync(ffprobePath)) {
    throw new Error("解析用の ffprobe.exe が見つかりません");
  }

  let output = "";
  await runProcess(
    ffprobePath,
    ["-v", "error", "-show_format", "-show_streams", "-of", "json", filePath],
    (chunk) => { output += chunk; }
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
  mediaLabel
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
    await runProcess(
      ffmpegPath,
      ["-hide_banner", "-y", "-i", filePath, ...formatArguments[targetFormat], "-progress", "pipe:1", "-nostats", outputPath],
      (chunk) => {
        progressBuffer += chunk;
        const lines = progressBuffer.split(/\r?\n/);
        progressBuffer = lines.pop() || "";

        for (const line of lines) {
          const [key, value] = line.split("=");
          if (key === "out_time_us" && totalMicroseconds > 0) {
            const percent = Math.min(99, Math.max(0, Math.round((Number(value) / totalMicroseconds) * 100)));
            onProgress?.(percent);
          }
        }
      }
    );

    onProgress?.(100);
    return { ok: true, outputPath, message: `${targetFormat} への変換が完了しました` };
  } catch (error) {
    return { ok: false, message: `${mediaLabel}の変換に失敗しました`, detail: error.message };
  }
}

async function convertVideo({ filePath, outputPath, targetFormat, ffmpegPath, durationSeconds, onProgress }) {
  return convertWithArguments({
    filePath, outputPath, targetFormat, ffmpegPath, durationSeconds, onProgress,
    supportedFormats: VIDEO_FORMATS,
    formatArguments: VIDEO_ARGUMENTS,
    mediaLabel: "動画"
  });
}

async function convertAudio({ filePath, outputPath, targetFormat, ffmpegPath, durationSeconds, onProgress }) {
  return convertWithArguments({
    filePath, outputPath, targetFormat, ffmpegPath, durationSeconds, onProgress,
    supportedFormats: AUDIO_FORMATS,
    formatArguments: AUDIO_ARGUMENTS,
    mediaLabel: "音声"
  });
}

module.exports = {
  VIDEO_FORMATS,
  AUDIO_FORMATS,
  analyzeVideo,
  analyzeAudio,
  convertVideo,
  convertAudio,
  terminateActiveProcesses
};
