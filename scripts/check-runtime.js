const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const manifest = require("../portable/bin/ffmpeg-runtime.json");

for (const [name, expected] of Object.entries(manifest.binaries)) {
  const binary = path.resolve(__dirname, "../portable/bin", name);
  const hash = crypto.createHash("sha256").update(fs.readFileSync(binary)).digest("hex");
  assert.equal(hash, expected, `${name}: SHA-256 mismatch; restore the verified runtime`);
  const version = execFileSync(binary, ["-version"], { windowsHide: true, encoding: "utf8", timeout: 10000 }).split(/\r?\n/)[0];
  assert.ok(version.includes(`version ${manifest.version}-`), `${name}: unexpected version ${version}`);
}
console.log(`Runtime check passed: FFmpeg/ffprobe ${manifest.version}, SHA-256 verified`);
