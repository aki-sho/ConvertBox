const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const archiver = require("archiver");
const packageJson = require("../package.json");

const projectRoot = path.resolve(__dirname, "..");
const distPath = path.join(projectRoot, "dist");
const artifactBaseName = `ConvertBox-Portable-${packageJson.version}`;
const exeName = `${artifactBaseName}.exe`;
const zipName = `${artifactBaseName}.zip`;
const exePath = path.join(distPath, exeName);
const zipPath = path.join(distPath, zipName);
const stagingPath = path.join(distPath, ".portable-staging");
const packageFolderPath = path.join(stagingPath, artifactBaseName);

const readmeText = [
  "ConvertBox ポータブル版",
  "",
  "1. このフォルダを任意の書き込み可能な場所へ移動してください。",
  `2. ${exeName}をダブルクリックして起動してください。`,
  "3. アプリの設定、ログ、キャッシュ、一時ファイルは、このフォルダ内のConvertBox-PortableDataフォルダに保存されます。",
  "4. アプリを移動する場合は、このフォルダごと移動してください。",
  "5. アンインストールは、このフォルダを削除するだけです。",
  ""
].join("\r\n");

function writeChecksum(filePath) {
  const fileName = path.basename(filePath);
  const hash = crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
  const checksumPath = `${filePath}.sha256`;

  fs.writeFileSync(checksumPath, `${hash}  ${fileName}\n`, "ascii");
  console.log(`SHA-256 (${fileName}): ${hash}`);
}

function createZip() {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    output.on("close", resolve);
    output.on("error", reject);
    archive.on("warning", reject);
    archive.on("error", reject);
    archive.pipe(output);
    archive.directory(packageFolderPath, artifactBaseName);
    archive.finalize();
  });
}

function removeBuildIntermediates() {
  const intermediatePaths = [
    "win-unpacked",
    "builder-debug.yml",
    "builder-effective-config.yaml"
  ];

  for (const relativePath of intermediatePaths) {
    fs.rmSync(path.join(distPath, relativePath), { recursive: true, force: true });
  }
}

function verifyReleaseFiles() {
  const expectedFiles = [
    exeName,
    `${exeName}.sha256`,
    zipName,
    `${zipName}.sha256`
  ].sort();
  const actualFiles = fs.readdirSync(distPath).sort();

  if (actualFiles.join("\n") !== expectedFiles.join("\n")) {
    throw new Error(
      `distの成果物が正しくありません。\n期待: ${expectedFiles.join(", ")}\n実際: ${actualFiles.join(", ")}`
    );
  }
}

async function main() {
  if (!fs.existsSync(exePath)) {
    throw new Error(`リリース用EXEが見つかりません: ${exePath}`);
  }

  fs.rmSync(stagingPath, { recursive: true, force: true });
  fs.mkdirSync(packageFolderPath, { recursive: true });
  fs.copyFileSync(exePath, path.join(packageFolderPath, exeName));
  fs.writeFileSync(path.join(packageFolderPath, "README.txt"), readmeText, "utf8");

  try {
    fs.rmSync(zipPath, { force: true });
    await createZip();
  } finally {
    fs.rmSync(stagingPath, { recursive: true, force: true });
  }

  writeChecksum(exePath);
  writeChecksum(zipPath);
  removeBuildIntermediates();
  verifyReleaseFiles();

  console.log(`Portable release created: ${distPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
