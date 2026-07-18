const fs = require("fs");
const path = require("path");
const { app } = require("electron");

function getAppRootPath() {
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    return process.env.PORTABLE_EXECUTABLE_DIR;
  }

  if (app.isPackaged) {
    return path.dirname(app.getPath("exe"));
  }

  return path.join(__dirname, "../..");
}

function getBundledRuntimePath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "portable", "bin");
  }

  return path.join(getAppRootPath(), "portable", "bin");
}

function getPortableDataPaths() {
  const root = path.join(getAppRootPath(), "FileConverter-PortableData");
  return {
    root,
    settings: path.join(root, "settings"),
    data: path.join(root, "data"),
    logs: path.join(root, "logs"),
    cache: path.join(root, "cache"),
    temp: path.join(root, "temp"),
    working: path.join(root, "temp", "working")
  };
}

function ensurePortableDataPaths(paths) {
  for (const directory of Object.values(paths)) {
    fs.mkdirSync(directory, { recursive: true });
  }
}

module.exports = {
  getAppRootPath,
  getBundledRuntimePath,
  getPortableDataPaths,
  ensurePortableDataPaths
};
