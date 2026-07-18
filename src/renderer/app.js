const categoryButtons = document.querySelectorAll(".category-button");
const selectFileButton = document.querySelector("#select-file-button");
const convertButton = document.querySelector("#convert-button");
const downloadButton = document.querySelector("#download-button");
const targetFormatSelect = document.querySelector("#target-format");
const fileNameDisplay = document.querySelector("#file-name");
const sourceFormatDisplay = document.querySelector("#source-format");
const inferredCategoryDisplay = document.querySelector("#inferred-category");
const statusDisplay = document.querySelector("#status");
const analysisPanel = document.querySelector("#video-analysis");
const durationDisplay = document.querySelector("#video-duration");
const resolutionDisplay = document.querySelector("#video-resolution");
const videoCodecDisplay = document.querySelector("#video-codec");
const audioCodecDisplay = document.querySelector("#audio-codec");
const audioAnalysisPanel = document.querySelector("#audio-analysis");
const audioDurationDisplay = document.querySelector("#audio-duration");
const audioFileCodecDisplay = document.querySelector("#audio-file-codec");
const audioSampleRateDisplay = document.querySelector("#audio-sample-rate");
const audioChannelsDisplay = document.querySelector("#audio-channels");
const imageAnalysisPanel = document.querySelector("#image-analysis");
const imageResolutionDisplay = document.querySelector("#image-resolution");
const imageFileFormatDisplay = document.querySelector("#image-file-format");
const imageChannelsDisplay = document.querySelector("#image-channels");
const imagePagesDisplay = document.querySelector("#image-pages");
const progressArea = document.querySelector("#progress-area");
const progressBar = document.querySelector("#conversion-progress");
const progressPercent = document.querySelector("#progress-percent");
const appVersionDisplay = document.querySelector("#app-version");

if (!window.convertBox) {
  throw new Error("ConvertBox APIの読み込みに失敗しました。アプリを再起動してください。");
}

const categoryLabels = {
  video: "Video",
  audio: "Audio",
  image: "Image",
  unknown: "不明"
};

let activeCategory = "video";
let selectedFile = null;
let videoMetadata = null;
let audioMetadata = null;
let imageMetadata = null;
let completedConversionId = null;

async function resetCompletedConversion() {
  if (completedConversionId) {
    await window.convertBox.discardConversion(completedConversionId);
  }
  completedConversionId = null;
  downloadButton.hidden = true;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "不明";
  const totalSeconds = Math.round(seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`
    : `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function resetAnalysis() {
  videoMetadata = null;
  audioMetadata = null;
  imageMetadata = null;
  analysisPanel.hidden = true;
  audioAnalysisPanel.hidden = true;
  imageAnalysisPanel.hidden = true;
}

function resetSelectedFile() {
  selectedFile = null;
  fileNameDisplay.textContent = "未選択";
  sourceFormatDisplay.textContent = "-";
  inferredCategoryDisplay.textContent = "-";
  resetAnalysis();
}

function updateFormatOptions() {
  targetFormatSelect.replaceChildren();

  window.convertBox.formats[activeCategory].forEach((format) => {
    const option = document.createElement("option");
    option.value = format;
    option.textContent = format;
    targetFormatSelect.append(option);
  });
}

function setStatus(message, type = "info") {
  statusDisplay.textContent = message;
  statusDisplay.dataset.type = type;
}

categoryButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    await resetCompletedConversion();
    activeCategory = button.dataset.category;
    categoryButtons.forEach((item) => item.classList.toggle("active", item === button));
    updateFormatOptions();
    resetSelectedFile();
    progressArea.hidden = true;
    setStatus(`${categoryLabels[activeCategory]} の変換先形式を表示しています。`);
  });
});

selectFileButton.addEventListener("click", async () => {
  await resetCompletedConversion();
  const file = await window.convertBox.selectFile(activeCategory);

  if (!file) {
    setStatus("ファイル選択をキャンセルしました。");
    return;
  }

  selectedFile = file;
  resetAnalysis();
  fileNameDisplay.textContent = file.fileName;
  sourceFormatDisplay.textContent = file.extension;
  inferredCategoryDisplay.textContent = categoryLabels[file.category];

  if (file.category !== "unknown") {
    activeCategory = file.category;
    categoryButtons.forEach((button) => {
      button.classList.toggle("active", button.dataset.category === activeCategory);
    });
    updateFormatOptions();
  }

  if (file.category === "video") {
    setStatus("動画ファイルを解析しています...");
    const analysis = await window.convertBox.analyzeVideo(file.filePath);
    if (!analysis.ok) {
      setStatus(`動画を解析できませんでした: ${analysis.message}`, "error");
      return;
    }

    videoMetadata = analysis.metadata;
    durationDisplay.textContent = formatDuration(videoMetadata.durationSeconds);
    resolutionDisplay.textContent = `${videoMetadata.width} x ${videoMetadata.height}`;
    videoCodecDisplay.textContent = videoMetadata.videoCodec.toUpperCase();
    audioCodecDisplay.textContent = videoMetadata.audioCodec.toUpperCase();
    analysisPanel.hidden = false;
    setStatus("動画の解析が完了しました。変換先形式を選択してください。", "success");
  } else if (file.category === "audio") {
    setStatus("音声ファイルを解析しています...");
    const analysis = await window.convertBox.analyzeAudio(file.filePath);
    if (!analysis.ok) {
      setStatus(`音声を解析できませんでした: ${analysis.message}`, "error");
      return;
    }

    audioMetadata = analysis.metadata;
    audioDurationDisplay.textContent = formatDuration(audioMetadata.durationSeconds);
    audioFileCodecDisplay.textContent = audioMetadata.audioCodec.toUpperCase();
    audioSampleRateDisplay.textContent = audioMetadata.sampleRate > 0 ? `${audioMetadata.sampleRate} Hz` : "不明";
    audioChannelsDisplay.textContent = audioMetadata.channels > 0
      ? `${audioMetadata.channels} ch (${audioMetadata.channelLayout})`
      : "不明";
    audioAnalysisPanel.hidden = false;
    setStatus("音声の解析が完了しました。変換先形式を選択してください。", "success");
  } else if (file.category === "image") {
    setStatus("画像ファイルを解析しています...");
    const analysis = await window.convertBox.analyzeImage(file.filePath);
    if (!analysis.ok) {
      setStatus(`画像を解析できませんでした: ${analysis.message}`, "error");
      return;
    }

    imageMetadata = analysis.metadata;
    imageResolutionDisplay.textContent = `${imageMetadata.width} x ${imageMetadata.height}`;
    imageFileFormatDisplay.textContent = imageMetadata.imageFormat;
    imageChannelsDisplay.textContent = imageMetadata.channels > 0
      ? `${imageMetadata.channels} (${imageMetadata.hasAlpha ? "透明度あり" : "透明度なし"})`
      : "不明";
    imagePagesDisplay.textContent = String(imageMetadata.pages);
    imageAnalysisPanel.hidden = false;
    setStatus("画像の解析が完了しました。変換先形式を選択してください。", "success");
  } else {
    setStatus("対応形式のファイルを選択してください。", "error");
  }
});

targetFormatSelect.addEventListener("change", async () => {
  await resetCompletedConversion();
  setStatus(`${targetFormatSelect.value} を変換先として選択しました。変換するボタンを押してください。`);
});

convertButton.addEventListener("click", async () => {
  if (activeCategory === "video" && !videoMetadata) {
    setStatus("先に対応する動画ファイルを選択し、解析を完了してください。", "error");
    return;
  }
  if (activeCategory === "audio" && !audioMetadata) {
    setStatus("先に対応する音声ファイルを選択し、解析を完了してください。", "error");
    return;
  }
  if (activeCategory === "image" && !imageMetadata) {
    setStatus("先に対応する画像ファイルを選択し、解析を完了してください。", "error");
    return;
  }

  convertButton.disabled = true;
  progressArea.hidden = !["video", "audio", "image"].includes(activeCategory);
  progressBar.value = 0;
  progressPercent.textContent = "0%";
  await resetCompletedConversion();
  setStatus(`${targetFormatSelect.value} への変換を開始します。`);

  const result = await window.convertBox.requestConversion({
    filePath: selectedFile?.filePath,
    sourceFormat: selectedFile?.extension,
    sourceCategory: selectedFile?.category,
    category: activeCategory,
    targetFormat: targetFormatSelect.value,
    durationSeconds: videoMetadata?.durationSeconds || audioMetadata?.durationSeconds
  });

  convertButton.disabled = false;
  if (result.ok && ["video", "audio", "image"].includes(activeCategory)) {
    completedConversionId = result.conversionId;
    downloadButton.hidden = false;
  }
  setStatus(result.message, result.ok ? "success" : "error");
});

downloadButton.addEventListener("click", async () => {
  if (!completedConversionId) {
    setStatus("先にファイルを変換してください。", "error");
    return;
  }

  downloadButton.disabled = true;
  setStatus("ダウンロード先を選択してください。");
  const result = await window.convertBox.downloadConversion(completedConversionId);
  downloadButton.disabled = false;

  if (result.ok) {
    completedConversionId = null;
    downloadButton.hidden = true;
  }

  setStatus(result.message, result.ok ? "success" : result.canceled ? "info" : "error");
});

window.convertBox.onConversionProgress((percent) => {
  progressArea.hidden = false;
  progressBar.value = percent;
  progressPercent.textContent = `${percent}%`;
  if (percent < 100) setStatus(`${targetFormatSelect.value} へ変換しています... ${percent}%`);
});

updateFormatOptions();

window.convertBox.getAppVersion()
  .then((version) => {
    appVersionDisplay.textContent = `v${version}`;
  })
  .catch(() => {
    appVersionDisplay.textContent = "";
  });
