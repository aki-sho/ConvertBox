const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const projectRoot = path.join(__dirname, "..");
const sourcePath = path.join(projectRoot, "build", "icon-source.png");
const pngPath = path.join(projectRoot, "build", "icon.png");
const icoPath = path.join(projectRoot, "build", "icon.ico");
const rendererPngPath = path.join(projectRoot, "src", "renderer", "icon.png");
const iconSizes = [16, 24, 32, 48, 64, 128, 256];

function createIco(pngImages) {
  const headerSize = 6 + (16 * pngImages.length);
  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngImages.length, 4);

  let imageOffset = headerSize;
  pngImages.forEach(({ size, png }, index) => {
    const entryOffset = 6 + (index * 16);
    header.writeUInt8(size === 256 ? 0 : size, entryOffset);
    header.writeUInt8(size === 256 ? 0 : size, entryOffset + 1);
    header.writeUInt8(0, entryOffset + 2);
    header.writeUInt8(0, entryOffset + 3);
    header.writeUInt16LE(1, entryOffset + 4);
    header.writeUInt16LE(32, entryOffset + 6);
    header.writeUInt32LE(png.length, entryOffset + 8);
    header.writeUInt32LE(imageOffset, entryOffset + 12);
    imageOffset += png.length;
  });

  return Buffer.concat([header, ...pngImages.map(({ png }) => png)]);
}

async function createIcon() {
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`アイコン原本が見つかりません: ${sourcePath}`);
  }

  const pngImages = await Promise.all(iconSizes.map(async (size) => ({
    size,
    png: await sharp(sourcePath)
      .resize(size, size, { fit: "cover" })
      .png()
      .toBuffer()
  })));
  const primaryPng = pngImages.find(({ size }) => size === 256).png;
  fs.writeFileSync(pngPath, primaryPng);
  fs.writeFileSync(icoPath, createIco(pngImages));

  const rendererPng = await sharp(sourcePath)
    .resize(256, 256)
    .png()
    .toBuffer();
  fs.writeFileSync(rendererPngPath, rendererPng);

  console.log(`App icons generated from ${sourcePath}: ${pngPath}, ${icoPath}, ${rendererPngPath}`);
}

createIcon().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
