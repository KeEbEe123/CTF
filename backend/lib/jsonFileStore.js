const fs = require("fs");
const path = require("path");

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function ensureJsonFile(filePath, defaultData) {
  const absolutePath = path.resolve(filePath);
  const directory = path.dirname(absolutePath);
  fs.mkdirSync(directory, { recursive: true });

  if (!fs.existsSync(absolutePath)) {
    fs.writeFileSync(absolutePath, `${JSON.stringify(defaultData, null, 2)}\n`, "utf8");
  }
}

function readJsonFile(filePath, defaultData) {
  ensureJsonFile(filePath, defaultData);
  const raw = fs.readFileSync(filePath, "utf8");
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : deepClone(defaultData);
  } catch (error) {
    return deepClone(defaultData);
  }
}

function writeJsonFileAtomic(filePath, data) {
  const absolutePath = path.resolve(filePath);
  const directory = path.dirname(absolutePath);
  fs.mkdirSync(directory, { recursive: true });

  const tempPath = `${absolutePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, absolutePath);
}

module.exports = {
  deepClone,
  ensureJsonFile,
  readJsonFile,
  writeJsonFileAtomic
};
