const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const sharp = require("sharp");
const { ConversionQueue } = require("../src/main/conversionQueue");
const { saveUniqueOutput } = require("../src/main/outputFiles");
const { normalizeOptions } = require("../src/shared/conversionOptions");
const { convertAudio, convertVideo, terminateActiveProcesses } = require("../src/converter/converterService");
const { convertImage, analyzeImage, terminateActiveImageProcesses } = require("../src/converter/imageConverterService");
const exec = promisify(execFile);
const root = path.resolve(__dirname, "..");
const parent = path.join(root, ".tmp");
fs.mkdirSync(parent, { recursive: true });
const temp = fs.mkdtempSync(path.join(parent, "features-"));
const ffmpegPath = path.join(root, "portable/bin/ffmpeg.exe");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function drain(queue) { while (queue.pumping) await queue.pumping; }

async function checkQueue() {
  const order = [];
  let running = 0;
  const queue = new ConversionQueue({ execute: async (spec, signal) => {
    assert.equal(++running, 1, "must process only one job at a time");
    try {
      order.push(spec.fileName);
      if (spec.fileName === "cancel") await new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
      return { ok: spec.fileName !== "bad", saved: true, outputPath: spec.fileName };
    } finally { running--; }
  } });
  const specs = ["first", "bad", "last"].map((fileName) => ({ fileName, options: normalizeOptions() }));
  queue.enqueue(specs);
  specs[0].fileName = "changed-after-enqueue";
  await drain(queue);
  assert.deepEqual(order, ["first", "bad", "last"]);
  assert.deepEqual(queue.snapshot().map((job) => job.state), ["completed", "failed", "completed"]);
  const ids = queue.enqueue(["cancel", "skip"].map((fileName) => ({ fileName, options: normalizeOptions() })));
  await delay(0);
  queue.cancel(ids[0]);
  queue.cancel(ids[1]);
  await drain(queue);
  assert.equal(order.includes("skip"), false);
  assert.equal(queue.snapshot().at(-2).state, "canceled");
  await queue.retry(ids[0], { fileName: "retried", options: normalizeOptions({ preset: "compact" }) });
  await drain(queue);
  assert.equal(queue.snapshot().at(-2).state, "completed");
  assert.equal(queue.snapshot().at(-2).options.preset, "compact");
  queue.clearFinished();
  assert.equal(queue.jobs.length, 0);
  await queue.stop();
  assert.throws(() => queue.enqueue([{}]), /終了/);

  let release;
  const duplicateRetry = new ConversionQueue({ execute: async () => ({ ok: true, saved: true }), dispose: () => new Promise((resolve) => { release = resolve; }) });
  const [retryId] = duplicateRetry.enqueue([{ fileName: "x", options: normalizeOptions() }]);
  await drain(duplicateRetry);
  const firstRetry = duplicateRetry.retry(retryId, {});
  await assert.rejects(duplicateRetry.retry(retryId, {}), /完了/);
  release();
  await firstRetry;
  await drain(duplicateRetry);
  console.log("Features: serial queue, failure continuation, cancel current/pending, retry settings, duplicate retry guard passed");
}

async function checkPresetsAndCancel() {
  const audio = path.join(temp, "input.wav");
  await exec(ffmpegPath, ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "2", audio], { windowsHide: true });
  const sizes = [];
  for (const preset of ["high", "standard", "compact"]) {
    const output = path.join(temp, `${preset}.mp3`);
    const result = await convertAudio({ filePath: audio, outputPath: output, targetFormat: "MP3", ffmpegPath, options: { preset } });
    assert.equal(result.ok, true, result.detail);
    sizes.push(fs.statSync(output).size);
  }
  assert.ok(sizes[0] > sizes[1] && sizes[1] > sizes[2]);
  const shortVideo = path.join(temp, "preset-input.mp4");
  await exec(ffmpegPath, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=24", "-t", "2", "-c:v", "libx264", shortVideo], { windowsHide: true });
  const videoSizes = [];
  for (const preset of ["high", "standard", "compact"]) {
    const output = path.join(temp, `video-${preset}.mp4`);
    const encoded = await convertVideo({ filePath: shortVideo, outputPath: output, targetFormat: "MP4", ffmpegPath, options: { preset } });
    assert.equal(encoded.ok, true, encoded.detail);
    videoSizes.push(fs.statSync(output).size);
  }
  assert.ok(videoSizes[0] > videoSizes[1] && videoSizes[1] > videoSizes[2]);
  const video = path.join(temp, "cancel-input.mp4");
  await exec(ffmpegPath, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30", "-t", "10", "-c:v", "libx264", "-preset", "ultrafast", video], { windowsHide: true });
  const controller = new AbortController();
  const converting = convertVideo({ filePath: video, outputPath: path.join(temp, "cancel.webm"), targetFormat: "WebM", ffmpegPath, signal: controller.signal });
  const timer = setTimeout(() => controller.abort(), 150);
  const result = await converting;
  clearTimeout(timer);
  assert.equal(result.ok, false);
  assert.equal(result.canceled, true);
  const next = await convertAudio({ filePath: audio, outputPath: path.join(temp, "after-cancel.mp3"), targetFormat: "MP3", ffmpegPath });
  assert.equal(next.ok, true);
  console.log("Features: real audio preset sizes and real FFmpeg cancellation/recovery passed");
}

async function checkImages() {
  const noise = Buffer.alloc(300 * 200 * 3);
  for (let i = 0; i < noise.length; i++) noise[i] = (i * 37) % 251;
  const noisy = path.join(temp, "noise.png");
  await sharp(noise, { raw: { width: 300, height: 200, channels: 3 } }).png().toFile(noisy);
  const imageSizes = [];
  for (const preset of ["high", "standard", "compact"]) {
    const output = path.join(temp, `image-${preset}.jpg`);
    const result = await convertImage({ filePath: noisy, outputPath: output, targetFormat: "JPG", options: { preset } });
    assert.equal(result.ok, true, result.detail);
    imageSizes.push(fs.statSync(output).size);
  }
  assert.ok(imageSizes[0] > imageSizes[1] && imageSizes[1] > imageSizes[2]);
  const image = path.join(temp, "input.png");
  await sharp({ create: { width: 40, height: 20, channels: 3, background: "red" } }).png().toFile(image);
  const oriented = path.join(temp, "orientation.jpg");
  await sharp(image).withMetadata({ orientation: 6 }).jpeg().toFile(oriented);
  for (const [name, filePath, options, expected] of [
    ["resize", image, { image: { width: 10 } }, [10, 5]],
    ["orient", oriented, { image: { width: 10 } }, [10, 20]],
    ["no-orient", oriented, { image: { autoOrient: false, width: 10 } }, [10, 5]],
    ["rotate", image, { image: { rotation: 90 } }, [20, 40]],
    ["rotate-resize", image, { image: { rotation: 270, width: 10, height: 10 } }, [5, 10]],
    ["no-enlarge", image, { image: { width: 100 } }, [40, 20]]
  ]) {
    const output = path.join(temp, `${name}.png`);
    const result = await convertImage({ filePath, outputPath: output, targetFormat: "PNG", options });
    assert.equal(result.ok, true, `${name}: ${result.detail}`);
    const meta = await analyzeImage({ filePath: output });
    assert.deepEqual([meta.width, meta.height], expected, name);
  }
  const svg = path.join(temp, "resized.svg");
  assert.equal((await convertImage({ filePath: image, outputPath: svg, targetFormat: "SVG", options: { image: { rotation: 90, height: 10 } } })).ok, true);
  const svgMeta = await analyzeImage({ filePath: svg });
  assert.deepEqual([svgMeta.width, svgMeta.height], [5, 10]);
  const red = await sharp({ create: { width: 40, height: 20, channels: 4, background: "red" } }).raw().toBuffer();
  const blue = await sharp({ create: { width: 40, height: 20, channels: 4, background: "blue" } }).raw().toBuffer();
  const gif = path.join(temp, "animated.gif");
  await sharp(Buffer.concat([red, blue]), { raw: { width: 40, height: 40, channels: 4, pageHeight: 20 } }).gif({ delay: [120, 250], loop: 2 }).toFile(gif);
  const rotatedGif = path.join(temp, "rotated.gif");
  const animated = await convertImage({ filePath: gif, outputPath: rotatedGif, targetFormat: "GIF", options: { image: { rotation: 90 } } });
  assert.equal(animated.ok, true, animated.detail);
  const meta = await sharp(rotatedGif, { animated: true }).metadata();
  assert.deepEqual([meta.width, meta.pageHeight, meta.pages, meta.loop], [20, 40, 2, 2]);
  assert.deepEqual(meta.delay, [120, 250]);
  console.log("Features: aspect ratio, EXIF orientation, rotation, SVG dimensions, animated GIF rotation/timing passed");
}

async function checkSavingAndValidation() {
  const source = path.join(temp, "save-input.txt");
  fs.writeFileSync(source, "original");
  const first = await saveUniqueOutput(source, temp, "saved.txt");
  fs.writeFileSync(first, "keep-existing");
  const second = await saveUniqueOutput(source, temp, "saved.txt");
  assert.equal(path.basename(second), "saved (1).txt");
  assert.equal(fs.readFileSync(first, "utf8"), "keep-existing");
  assert.equal(fs.readFileSync(source, "utf8"), "original");
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(saveUniqueOutput(source, temp, "aborted.txt", controller.signal));
  assert.equal(fs.existsSync(path.join(temp, "aborted.txt")), false);
  await assert.rejects(saveUniqueOutput(source, temp, "../escape.txt"));
  for (const options of [{ preset: "__proto__" }, { preset: ["high"] }, { image: { width: -1 } }, { image: { width: 1.5 } }, { image: { rotation: 45 } }, { image: { autoOrient: "true" } }]) assert.throws(() => normalizeOptions(options));
  console.log("Features: collision-safe save, abort without leftovers, output traversal and settings validation passed");
}

(async () => {
  await checkQueue();
  await checkPresetsAndCancel();
  await checkImages();
  await checkSavingAndValidation();
})().catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => {
    await Promise.all([terminateActiveProcesses(), terminateActiveImageProcesses()]);
    assert.equal(path.dirname(temp), parent);
    fs.rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });
