const api = window.convertBox;
if (!api) throw new Error("ConvertBox APIの読み込みに失敗しました");
const $ = (selector) => document.querySelector(selector);
const labels = { video: "Video", videoToAudio: "動画 → 音声", audio: "Audio", image: "Image", unknown: "不明" };
const presetLabels = { high: "高画質", standard: "標準", compact: "容量優先" };
const stateLabels = { queued: "待機中", running: "処理中", canceling: "中止中", preparing: "準備中", completed: "完了", failed: "失敗", canceled: "中止" };
let activeCategory = "video";
let files = [];
let jobs = [];
let completedConversionId = null;
let selectionVersion = 0;

function setStatus(message, type = "info") {
  $("#status").textContent = message;
  $("#status").dataset.type = type;
}

async function safely(action) {
  try { return await action(); }
  catch (error) { setStatus(error.message || "処理に失敗しました", "error"); }
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "不明";
  const value = Math.round(seconds);
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}

function updateOptions() {
  $("#target-format").replaceChildren(...api.formats[activeCategory].map((format) => {
    const option = document.createElement("option");
    option.value = format;
    option.textContent = format;
    return option;
  }));
  $("#image-options").hidden = activeCategory !== "image";
  document.querySelectorAll(".category-button").forEach((button) => button.classList.toggle("active", button.dataset.category === activeCategory));
}

function renderSelection() {
  $("#file-name").textContent = files.length === 1 ? files[0].fileName : files.length ? `${files.length}件を選択` : "未選択";
  $("#source-format").textContent = [...new Set(files.map((file) => file.extension))].join(" / ") || "-";
  $("#inferred-category").textContent = files.length ? [...new Set(files.map((file) => labels[file.category]))].join(" / ") : "-";
  $("#clear-selection").hidden = files.length === 0;
  $("#selected-files").replaceChildren(...files.map((file) => {
    const item = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = file.fileName;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "削除";
    remove.setAttribute("aria-label", `${file.fileName}の選択を解除`);
    remove.addEventListener("click", () => {
      files = files.filter((entry) => entry.filePath !== file.filePath);
      selectionVersion++;
      renderSelection();
      hideAnalysis();
    });
    item.append(name, remove);
    return item;
  }));
}

function hideAnalysis() {
  for (const id of ["#video-analysis", "#audio-analysis", "#image-analysis"]) $(id).hidden = true;
}

async function acceptFiles(result) {
  if (!result?.ok) { if (result) setStatus(result.message, "error"); return; }
  if (!result.files.length && !result.rejected.length) return;
  if (!files.length && result.files.length && result.files.every((file) => file.category === result.files[0].category)) {
    const inferred = result.files[0].category;
    if (inferred !== (activeCategory === "videoToAudio" ? "video" : activeCategory)) { activeCategory = inferred; updateOptions(); }
  }
  const source = activeCategory === "videoToAudio" ? "video" : activeCategory;
  const matching = result.files.filter((file) => file.category === source);
  const unique = new Map([...files, ...matching].map((file) => [file.filePath, file]));
  if (unique.size > 100) return setStatus("選択できるファイルは100件までです", "error");
  files = [...unique.values()];
  const version = ++selectionVersion;
  renderSelection();
  hideAnalysis();
  const skipped = result.rejected.length + result.files.length - matching.length;
  if (skipped) return setStatus(`${files.length}件を選択しました。非対応・別カテゴリ・上限超過の${skipped}件は追加しませんでした。`, "notice");
  setStatus(`${files.length}件を選択しました。設定を確認して変換してください。`);
  if (files.length !== 1 || jobs.some((job) => ["queued", "running", "canceling"].includes(job.state))) return;
  const file = files[0];
  setStatus("ファイルを解析しています…");
  const analyze = { video: api.analyzeVideo, audio: api.analyzeAudio, image: api.analyzeImage }[file.category];
  const response = await analyze(file.filePath);
  if (version !== selectionVersion) return;
  if (!response.ok) return setStatus(`ファイルを解析できませんでした: ${response.message}`, "error");
  const metadata = response.metadata;
  if (file.category === "video") {
    $("#video-duration").textContent = formatDuration(metadata.durationSeconds);
    $("#video-resolution").textContent = `${metadata.width} x ${metadata.height}`;
    $("#video-codec").textContent = metadata.videoCodec.toUpperCase();
    $("#audio-codec").textContent = metadata.audioCodec.toUpperCase();
    $("#video-analysis").hidden = false;
  } else if (file.category === "audio") {
    $("#audio-duration").textContent = formatDuration(metadata.durationSeconds);
    $("#audio-file-codec").textContent = metadata.audioCodec.toUpperCase();
    $("#audio-sample-rate").textContent = `${metadata.sampleRate} Hz`;
    $("#audio-channels").textContent = `${metadata.channels} ch`;
    $("#audio-analysis").hidden = false;
  } else {
    $("#image-resolution").textContent = `${metadata.width} x ${metadata.height}`;
    $("#image-file-format").textContent = metadata.imageFormat;
    $("#image-channels").textContent = `${metadata.channels} (${metadata.hasAlpha ? "透明度あり" : "透明度なし"})`;
    $("#image-pages").textContent = metadata.pages;
    $("#image-analysis").hidden = false;
  }
  setStatus(activeCategory === "videoToAudio" && !metadata.hasAudio ? "この動画には音声トラックがありません" : "解析が完了しました。変換先と設定を選んでください。", activeCategory === "videoToAudio" && !metadata.hasAudio ? "error" : "success");
}

function readSettings() {
  const dimension = (id) => $(id).value.trim() === "" ? null : Number($(id).value);
  return { category: activeCategory, targetFormat: $("#target-format").value,
    options: { preset: $("#quality-preset").value, image: {
      width: dimension("#image-width"), height: dimension("#image-height"),
      rotation: Number($("#image-rotation").value), autoOrient: $("#auto-orient").checked
    } } };
}

async function saveConversion(id) {
  if (!id) return;
  const response = await api.downloadConversion(id);
  if (response.ok) setStatus(response.message, "success");
  else setStatus(response.message, response.canceled ? "info" : "error");
}

function actionButton(label, action) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", () => safely(async () => {
    button.disabled = true;
    try { await action(); } finally { button.disabled = false; }
  }));
  return button;
}

function renderQueue(snapshot) {
  jobs = snapshot;
  $("#conversion-queue").replaceChildren(...jobs.map((job) => {
    const item = document.createElement("li");
    item.dataset.jobId = job.id;
    item.dataset.state = job.state;
    const title = document.createElement("strong");
    title.textContent = `${job.fileName} → ${job.targetFormat}`;
    const details = document.createElement("p");
    const image = job.options.image;
    details.textContent = `${presetLabels[job.options.preset]}${job.category === "image" ? ` / ${image.width || "元の幅"} × ${image.height || "元の高さ"} / 回転 ${image.rotation}°${image.autoOrient ? " / 向き補正" : ""}` : ""}`;
    const state = document.createElement("p");
    state.textContent = `${stateLabels[job.state]}：${job.message}${job.outputPath ? ` / ${job.outputPath}` : ""}`;
    const progress = document.createElement("progress");
    progress.max = 100;
    progress.value = job.progress;
    progress.setAttribute("aria-label", `${job.fileName}の変換進捗`);
    const actions = document.createElement("div");
    actions.className = "job-actions";
    if (["queued", "running"].includes(job.state)) actions.append(actionButton("中止", () => api.cancelJob(job.id)));
    if (["completed", "failed", "canceled"].includes(job.state)) {
      actions.append(actionButton("現在の設定で再実行", async () => {
        if (activeCategory !== job.category) return setStatus(`再実行するには${labels[job.category]}カテゴリを選択し、設定してください`, "notice");
        const response = await api.retryJob({ id: job.id, ...readSettings() });
        if (!response.ok) setStatus(response.message, "error");
      }));
    }
    if (job.state === "completed" && !job.saved) actions.prepend(actionButton("保存", () => saveConversion(job.conversionId)));
    item.append(title, details, state, progress, actions);
    return item;
  }));
  completedConversionId = [...jobs].reverse().find((job) => job.state === "completed" && !job.saved)?.conversionId || null;
  $("#download-button").hidden = !completedConversionId;
  const current = jobs.find((job) => ["running", "canceling"].includes(job.state)) || jobs.at(-1);
  $("#cancel-all").disabled = !jobs.some((job) => ["running", "queued"].includes(job.state));
  $("#progress-area").hidden = !current;
  if (!current) return;
  $("#conversion-progress").value = current.progress;
  $("#progress-percent").textContent = `${current.progress}%`;
  if (current.state === "completed") setStatus(`${current.targetFormat} への変換が完了しました。${current.saved ? "保存しました。" : "ダウンロードしてください。"}`, "success");
  else setStatus(current.message, current.state === "failed" ? "error" : "info");
}

document.querySelectorAll(".category-button").forEach((button) => button.addEventListener("click", () => {
  activeCategory = button.dataset.category;
  files = [];
  selectionVersion++;
  updateOptions();
  renderSelection();
  hideAnalysis();
  setStatus(`${labels[activeCategory]}のファイルを選択してください`);
}));
$("#select-file-button").addEventListener("click", () => safely(async () => acceptFiles(await api.selectFiles(activeCategory))));
$("#clear-selection").addEventListener("click", () => { files = []; selectionVersion++; renderSelection(); hideAnalysis(); });
$("#target-format").addEventListener("change", () => setStatus(`${$("#target-format").value} を変換先として選択しました。変換するボタンを押してください。`));
$("#select-output-directory").addEventListener("click", () => safely(async () => {
  const response = await api.selectOutputDirectory();
  if (response.ok) { $("#output-directory").textContent = response.directory; $("#clear-output-directory").hidden = false; }
  else if (!response.canceled) setStatus(response.message, "error");
}));
$("#clear-output-directory").addEventListener("click", () => safely(async () => {
  await api.clearOutputDirectory();
  $("#output-directory").textContent = "未指定：1件の変換後に保存先を選びます";
  $("#clear-output-directory").hidden = true;
}));
$("#convert-button").addEventListener("click", () => safely(async () => {
  if (!files.length) return setStatus("変換するファイルを選択してください", "error");
  $("#convert-button").disabled = true;
  try {
    const response = await api.enqueue({ ...readSettings(), files: files.map((file) => file.filePath) });
    if (!response.ok) setStatus(response.message, "error");
  } finally { $("#convert-button").disabled = false; }
}));
$("#download-button").addEventListener("click", () => safely(async () => {
  $("#download-button").disabled = true;
  try { await saveConversion(completedConversionId); } finally { $("#download-button").disabled = false; }
}));
$("#cancel-all").addEventListener("click", () => safely(() => api.cancelJob(null)));
$("#clear-finished").addEventListener("click", () => safely(() => api.clearFinished()));
const zone = $("#drop-zone");
document.addEventListener("dragover", (event) => event.preventDefault());
document.addEventListener("drop", (event) => event.preventDefault());
zone.addEventListener("dragover", (event) => { event.preventDefault(); zone.classList.add("drag-over"); });
zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
zone.addEventListener("drop", (event) => {
  event.preventDefault();
  zone.classList.remove("drag-over");
  const dropped = [...event.dataTransfer.files];
  safely(async () => acceptFiles(await api.importDroppedFiles(dropped, activeCategory)));
});
zone.addEventListener("keydown", (event) => { if (event.target === zone && ["Enter", " "].includes(event.key)) { event.preventDefault(); $("#select-file-button").click(); } });
api.onQueueChanged(renderQueue);
safely(async () => renderQueue(await api.getQueue()));
api.getAppVersion().then((version) => { $("#app-version").textContent = `v${version}`; }).catch(() => {});
updateOptions();
renderSelection();
