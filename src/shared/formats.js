const VIDEO_FORMATS = Object.freeze(["MP4", "MOV", "WebM", "AVI"]);
const AUDIO_FORMATS = Object.freeze(["MP3", "WAV", "M4A", "AAC"]);
const IMAGE_FORMATS = Object.freeze(["JPG", "PNG", "JPEG", "GIF", "WebP", "SVG"]);

const FORMATS = Object.freeze({
  video: VIDEO_FORMATS,
  audio: AUDIO_FORMATS,
  image: IMAGE_FORMATS
});

const CONVERSION_FORMATS = Object.freeze({
  ...FORMATS,
  videoToAudio: AUDIO_FORMATS
});

const CATEGORY_LABELS = Object.freeze({
  video: "Video",
  audio: "Audio",
  image: "Image",
  videoToAudio: "動画 → 音声",
  unknown: "不明"
});

function getExtension(filePath) {
  const lastPart = String(filePath).split(/[\\/]/).pop() || "";
  const dotIndex = lastPart.lastIndexOf(".");

  if (dotIndex <= 0 || dotIndex === lastPart.length - 1) {
    return "";
  }

  return lastPart.slice(dotIndex + 1).toUpperCase();
}

function inferCategory(extension) {
  const normalized = String(extension).toUpperCase();
  const category = Object.entries(FORMATS).find(([, formats]) =>
    formats.some((format) => format.toUpperCase() === normalized)
  );

  return category ? category[0] : "unknown";
}

module.exports = {
  FORMATS,
  CONVERSION_FORMATS,
  CATEGORY_LABELS,
  getExtension,
  inferCategory
};
