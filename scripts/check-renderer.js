const fs = require("fs");

const port = process.argv[2] || "9222";
const category = process.argv[3] || "video";
const categorySettings = {
  video: { label: "Video", options: ["MP4", "MOV", "WebM", "AVI"], target: "WebM", analysisId: "video-analysis" },
  audio: { label: "Audio", options: ["MP3", "WAV", "M4A", "AAC"], target: "MP3", analysisId: "audio-analysis" },
  image: { label: "Image", options: ["JPG", "PNG", "JPEG", "GIF", "WebP", "SVG"], target: "WebP", analysisId: "image-analysis" }
};
const settings = categorySettings[category];

if (!settings) throw new Error(`未対応のテストカテゴリです: ${category}`);

async function waitForTarget() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json());
      const target = targets.find((item) => item.type === "page" && item.title === "ConvertBox");
      if (target) return target;
    } catch {
      // Electron may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("ConvertBoxの画面へ接続できませんでした");
}

async function main() {
  const target = await waitForTarget();
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  let nextId = 1;
  const pending = new Map();

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  });

  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });

  const evaluate = async (expression, awaitPromise = false) => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };

  if (category !== "video") {
    await evaluate(`document.querySelector('[data-category="${category}"]').click()`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  const initial = await evaluate(`(async () => {
    for (let i = 0; i < 20; i += 1) {
      if (document.querySelector('#app-version').textContent) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return {
      apiReady: Boolean(window.convertBox),
      version: document.querySelector('#app-version').textContent,
      options: [...document.querySelectorAll('#target-format option')].map((option) => option.value)
    };
  })()`, true);

  if (!initial.apiReady) throw new Error("renderer APIが読み込まれていません");
  if (initial.version !== "v1.0.0") {
    throw new Error(`画面のバージョン表示が正しくありません: ${initial.version}`);
  }
  if (initial.options.join(",") !== settings.options.join(",")) {
    throw new Error(`${settings.label}形式一覧が正しくありません: ${initial.options.join(",")}`);
  }
  console.log(`1/4 ${settings.label}形式一覧を確認`);

  const analysisResult = await evaluate(`(async () => {
    document.querySelector('#select-file-button').click();
    for (let i = 0; i < 100; i += 1) {
      if (!document.querySelector('#${settings.analysisId}').hidden) {
        return { ready: true, status: document.querySelector('#status').textContent };
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return { ready: false, status: document.querySelector('#status').textContent };
  })()`, true);
  if (!analysisResult.ready) {
    throw new Error(`ファイル選択後の${settings.label}解析が完了しませんでした: ${analysisResult.status}`);
  }
  console.log("2/4 ファイル選択と解析を確認");

  const selectionOnly = await evaluate(`(async () => {
    const select = document.querySelector('#target-format');
    select.value = '${settings.target}';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 300));
    return {
      downloadHidden: document.querySelector('#download-button').hidden,
      progressHidden: document.querySelector('#progress-area').hidden,
      status: document.querySelector('#status').textContent
    };
  })()`, true);

  if (!selectionOnly.downloadHidden || !selectionOnly.progressHidden || !selectionOnly.status.includes("選択しました")) {
    throw new Error("変換形式の選択だけで変換処理が開始されています");
  }
  console.log("3/4 形式変更だけでは変換されないことを確認");

  await evaluate(`document.querySelector('#convert-button').click();`);
  const converted = await evaluate(`(async () => {
    for (let i = 0; i < 200; i += 1) {
      const status = document.querySelector('#status').textContent;
      if (status.includes('変換が完了しました')) return { ok: true, status };
      if (status.includes('失敗しました')) return { ok: false, status };
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return { ok: false, status: document.querySelector('#status').textContent };
  })()`, true);

  if (!converted.ok) throw new Error(`画面からの変換に失敗しました: ${converted.status}`);

  const downloadReady = await evaluate(`({
    visible: !document.querySelector('#download-button').hidden,
    progress: document.querySelector('#conversion-progress').value
  })`);
  if (!downloadReady.visible || Number(downloadReady.progress) !== 100) {
    throw new Error("変換完了後にダウンロードボタンが表示されませんでした");
  }

  await evaluate(`document.querySelector('#download-button').click();`);
  const downloaded = await evaluate(`(async () => {
    for (let i = 0; i < 100; i += 1) {
      const status = document.querySelector('#status').textContent;
      if (status.includes('ダウンロードしました')) return true;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return false;
  })()`, true);
  if (!downloaded) throw new Error("ダウンロード処理が完了しませんでした");

  const outputPath = process.env.CONVERTBOX_TEST_OUTPUT;
  if (!outputPath || !fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
    throw new Error("画面から変換した出力ファイルが見つかりません");
  }

  send("Browser.close").catch(() => {
    // Closing the app also closes the debugger connection before a reply is guaranteed.
  });
  await new Promise((resolve) => setTimeout(resolve, 500));
  socket.close();
  console.log("4/4 変換後のダウンロードを確認");
  console.log("アプリの通常終了を要求");
  console.log("Renderer check passed: select only, convert, then download");
}

Promise.race([
  main(),
  new Promise((_, reject) => setTimeout(() => reject(new Error("画面操作テストが30秒以内に完了しませんでした")), 30000))
])
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
