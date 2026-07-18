const FORMATS = Object.freeze({
  video: Object.freeze(["MP4", "MOV", "WebM", "AVI"]),
  audio: Object.freeze(["MP3", "WAV", "M4A", "AAC"]),
  image: Object.freeze(["JPG", "PNG", "JPEG", "GIF", "WebP", "SVG"])
});

const CATEGORY_LABELS = Object.freeze({
  video: "Video",
  audio: "Audio",
  image: "Image",
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
  CATEGORY_LABELS,
  getExtension,
  inferCategory
};
