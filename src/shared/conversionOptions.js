const PRESETS = Object.freeze({
  high: Object.freeze({ label: "高画質", crf: 18, webmCrf: 24, aviQuality: 2, audioKbps: 320, opusKbps: 192, imageQuality: 95 }),
  standard: Object.freeze({ label: "標準", crf: 23, webmCrf: 32, aviQuality: 5, audioKbps: 192, opusKbps: 128, imageQuality: 85 }),
  compact: Object.freeze({ label: "容量優先", crf: 30, webmCrf: 40, aviQuality: 9, audioKbps: 96, opusKbps: 64, imageQuality: 65 })
});

function normalizeOptions(options = {}) {
  if (!options || typeof options !== "object" || Array.isArray(options)) throw new Error("変換設定が不正です");
  const preset = options.preset ?? "standard";
  if (typeof preset !== "string" || !Object.hasOwn(PRESETS, preset)) throw new Error("品質プリセットを選択してください");
  const image = options.image ?? {};
  if (!image || typeof image !== "object" || Array.isArray(image)) throw new Error("画像設定が不正です");
  const width = image.width ?? null;
  const height = image.height ?? null;
  for (const dimension of [width, height]) {
    if (dimension !== null && (!Number.isInteger(dimension) || dimension < 1 || dimension > 16000)) {
      throw new Error("画像の幅・高さは1〜16000ピクセルで指定してください");
    }
  }
  if (width && height && width * height > 40_000_000) throw new Error("出力画像は4000万画素までです");
  const rotation = image.rotation ?? 0;
  if (![0, 90, 180, 270].includes(rotation)) throw new Error("画像の回転は0・90・180・270度から選択してください");
  const autoOrient = image.autoOrient ?? true;
  if (typeof autoOrient !== "boolean") throw new Error("画像の向き補正設定が不正です");
  return { preset, image: { width, height, rotation, autoOrient } };
}

module.exports = { PRESETS, normalizeOptions };
