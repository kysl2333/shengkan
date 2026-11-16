const fs = require("node:fs");
const { createHash, randomUUID } = require("node:crypto");

function versionOf(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function read(file) {
  const bytes = fs.readFileSync(file);
  const version = versionOf(bytes);
  const project = JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, ""));
  return { project: { ...project, __storageVersion: version }, version };
}

function write(file, project, expectedVersion) {
  const lock = `${file}.lock`;
  const temp = `${file}.${randomUUID()}.tmp`;
  let lockFd;
  try {
    lockFd = fs.openSync(lock, "wx");
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const busy = new Error("PROJECT_BUSY：项目正在写入，请稍后重试；若锁持续存在，请确认没有写入任务后再人工处理锁文件。");
    busy.code = "PROJECT_BUSY";
    throw busy;
  }

  let tempFd;
  let tempCreated = false;
  try {
    let currentVersion = null;
    try {
      currentVersion = versionOf(fs.readFileSync(file));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (expectedVersion !== currentVersion) {
      const conflict = new Error("PROJECT_CONFLICT：项目已被外部修改或移除，保存冲突。请保留当前草稿，重新载入后再保存。");
      conflict.code = "PROJECT_CONFLICT";
      throw conflict;
    }

    const stored = { ...project };
    delete stored.__storageVersion;
    const bytes = Buffer.from(JSON.stringify(stored, null, 2), "utf8");
    const version = versionOf(bytes);
    tempFd = fs.openSync(temp, "wx");
    tempCreated = true;
    fs.writeFileSync(tempFd, bytes);
    fs.fsyncSync(tempFd);
    fs.closeSync(tempFd);
    tempFd = undefined;
    fs.renameSync(temp, file);
    tempCreated = false;
    return { project: { ...stored, __storageVersion: version }, version };
  } finally {
    try {
      if (tempFd !== undefined) fs.closeSync(tempFd);
    } finally {
      try {
        if (tempCreated) fs.unlinkSync(temp);
      } finally {
        try {
          fs.closeSync(lockFd);
        } finally {
          fs.unlinkSync(lock);
        }
      }
    }
  }
}

module.exports = { read, write };
