const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const distPath = path.join(projectRoot, "dist");

if (path.dirname(distPath) !== projectRoot || path.basename(distPath) !== "dist") {
  throw new Error(`不正な出力先です: ${distPath}`);
}

fs.rmSync(distPath, { recursive: true, force: true });
fs.mkdirSync(distPath, { recursive: true });
console.log(`Release directory prepared: ${distPath}`);
