const fs = require("node:fs");
const path = require("node:path");
const { pipeline } = require("node:stream/promises");

// Reserve with wx so duplicate basenames, retries, and pre-existing files never
// overwrite an input or another result, even when another process is saving.
async function saveUniqueOutput(source, directory, suggestedFileName, signal) {
  const name = path.basename(suggestedFileName);
  if (name !== suggestedFileName) throw new Error("保存ファイル名が不正です");
  const extension = path.extname(name);
  const stem = path.basename(name, extension);
  for (let number = 0; number < 10000; number++) {
    signal?.throwIfAborted();
    const destination = path.join(directory, number ? `${stem} (${number})${extension}` : name);
    let handle;
    try { handle = await fs.promises.open(destination, "wx"); }
    catch (error) { if (error.code === "EEXIST") continue; throw error; }
    let saved = false;
    try {
      await pipeline(fs.createReadStream(source), handle.createWriteStream(), { signal });
      signal?.throwIfAborted();
      saved = true;
      return destination;
    } finally {
      await handle.close().catch(() => {});
      if (!saved) await fs.promises.unlink(destination).catch(() => {});
    }
  }
  throw new Error("同じ名前の出力が多すぎます。別の保存先を選択してください");
}

module.exports = { saveUniqueOutput };
