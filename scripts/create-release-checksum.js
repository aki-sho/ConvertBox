const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const packageJson = require("../package.json");

const artifactName = `FileConverter-Portable-${packageJson.version}.exe`;
const artifactPath = path.join(__dirname, "..", "dist", artifactName);
const checksumPath = `${artifactPath}.sha256`;

if (!fs.existsSync(artifactPath)) {
  throw new Error(`リリース用EXEが見つかりません: ${artifactPath}`);
}

const hash = crypto
  .createHash("sha256")
  .update(fs.readFileSync(artifactPath))
  .digest("hex");

fs.writeFileSync(checksumPath, `${hash}  ${artifactName}\n`, "ascii");
console.log(`SHA-256: ${hash}`);
console.log(`Checksum file: ${checksumPath}`);
