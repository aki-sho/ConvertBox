const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const projectRoot = path.join(__dirname, "..");
const svgPath = path.join(projectRoot, "build", "icon.svg");
const pngPath = path.join(projectRoot, "build", "icon.png");
const icoPath = path.join(projectRoot, "build", "icon.ico");

async function createIcon() {
  const png = await sharp(svgPath)
    .resize(256, 256)
    .png()
    .toBuffer();
  fs.writeFileSync(pngPath, png);

  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header.writeUInt8(0, 6);
  header.writeUInt8(0, 7);
  header.writeUInt8(0, 8);
  header.writeUInt8(0, 9);
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(header.length, 18);

  fs.writeFileSync(icoPath, Buffer.concat([header, png]));
  console.log(`App icons: ${pngPath}, ${icoPath}`);
}

createIcon().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
