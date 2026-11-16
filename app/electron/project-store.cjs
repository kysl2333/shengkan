const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const process = require("node:process");
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

function busy(message = "项目正在写入或存在遗留锁，请稍后重试；只能显式恢复可确认持有进程已退出的锁。") {
  const error = new Error(`PROJECT_BUSY：${message}`);
  error.code = "PROJECT_BUSY";
  return error;
}

function conflict() {
  const error = new Error("PROJECT_CONFLICT：项目已被外部修改或移除，保存冲突。请保留当前草稿，重新载入后再保存。");
  error.code = "PROJECT_CONFLICT";
  return error;
}

function lockPaths(file) {
  const absolute = path.resolve(file);
  const key = process.platform === "win32" ? absolute.toLowerCase() : absolute;
  const lock = path.join(path.dirname(path.dirname(absolute)), ".locks", `${versionOf(key)}.lock`);
  return { file: absolute, lock, guard: `${lock}.recover`, legacy: `${absolute}.lock` };
}

function metadata() {
  return Buffer.from(JSON.stringify({ pid: process.pid, hostname: os.hostname(), token: randomUUID(), createdAt: new Date().toISOString() }));
}

function recoveryGuards(info) {
  return fs.readdirSync(path.dirname(info.lock))
    .filter(name => name === path.basename(info.guard) || name.startsWith(`${path.basename(info.guard)}-`))
    .map(name => path.join(path.dirname(info.lock), name));
}

function readOptional(file) {
  try {
    return fs.readFileSync(file);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return null;
  }
}

function release(lock, bytes) {
  const current = readOptional(lock);
  if (current && current.equals(bytes)) fs.unlinkSync(lock);
}

function claim(lock) {
  let fd;
  try {
    fd = fs.openSync(lock, "wx");
  } catch (error) {
    if (error.code === "EEXIST") throw busy();
    throw error;
  }
  const bytes = metadata();
  try {
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
  } catch (error) {
    fs.closeSync(fd);
    const current = readOptional(lock);
    if (current && current.length <= bytes.length && current.equals(bytes.subarray(0, current.length))) release(lock, current);
    throw error;
  }
  fs.closeSync(fd);
  return bytes;
}

function withFiles(files, callback) {
  const locks = [...new Map(files.map(file => {
    const info = lockPaths(file);
    return [info.lock, info];
  })).values()].sort((a, b) => a.lock.localeCompare(b.lock));
  const owned = [];
  let operationFailed = false;
  try {
    for (const info of locks) {
      fs.mkdirSync(path.dirname(info.lock), { recursive: true });
      if (recoveryGuards(info).length || fs.existsSync(info.legacy)) throw busy();
      const bytes = claim(info.lock);
      owned.push({ ...info, bytes });
      if (recoveryGuards(info).length || fs.existsSync(info.legacy)) throw busy();
    }
    return callback();
  } catch (error) {
    operationFailed = true;
    throw error;
  } finally {
    const releaseErrors = [];
    for (const info of owned.reverse()) {
      try {
        release(info.lock, info.bytes);
      } catch (error) {
        releaseErrors.push(error);
      }
    }
    if (releaseErrors.length && !operationFailed) {
      throw new AggregateError(releaseErrors, `项目锁释放失败：${releaseErrors.map(error => error.message).join("；")}`);
    }
  }
}

function requireDead(bytes) {
  let owner;
  try { owner = JSON.parse(bytes.toString("utf8")); } catch { throw busy("锁格式未知，无法确认持有者，未恢复。"); }
  if (!Number.isSafeInteger(owner?.pid) || owner.pid <= 0 || owner.hostname !== os.hostname() || typeof owner.token !== "string" || !owner.token) {
    throw busy("锁持有者或主机无法确认，未恢复。");
  }
  try {
    process.kill(owner.pid, 0);
  } catch (error) {
    if (error.code === "ESRCH") return;
    throw busy("无法确认锁持有进程已退出，未恢复。");
  }
  throw busy("锁持有进程仍在运行，未恢复。");
}

function recover(file) {
  const info = lockPaths(file);
  fs.mkdirSync(path.dirname(info.lock), { recursive: true });
  const guard = `${info.guard}-${randomUUID()}`;
  const guardBytes = claim(guard);
  try {
    const candidates = [...recoveryGuards(info).filter(item => item !== guard), info.lock, info.legacy]
      .map(lock => ({ lock, bytes: readOptional(lock) })).filter(item => item.bytes !== null);
    for (const item of candidates) requireDead(item.bytes);
    const recovered = [];
    for (const item of candidates) {
      const current = readOptional(item.lock);
      if (!current && item.lock.startsWith(`${info.guard}-`)) continue;
      if (!current || !current.equals(item.bytes)) throw busy("恢复期间锁内容发生变化，未继续恢复。");
      requireDead(current);
      const evidence = `${info.lock}.${Date.now()}-${randomUUID()}.recovered`;
      fs.renameSync(item.lock, evidence);
      const moved = fs.readFileSync(evidence);
      if (!moved.equals(item.bytes)) throw busy(`恢复证据内容发生变化，请保留检查：${evidence}`);
      recovered.push(evidence);
    }
    return { ok: true, recovered, message: recovered.length ? "已恢复退出进程的锁，原锁内容已保留为恢复证据。" : "没有需要恢复的锁。" };
  } finally {
    release(guard, guardBytes);
  }
}

function write(file, project, expectedVersion) {
  return withFiles([file], () => {
    const temp = `${file}.${randomUUID()}.tmp`;
    let tempFd;
    let tempCreated = false;
    try {
      const currentBytes = readOptional(file);
      const currentVersion = currentBytes === null ? null : versionOf(currentBytes);
      if (expectedVersion !== currentVersion) throw conflict();
      const stored = { ...project };
      delete stored.__storageVersion;
      delete stored.__storageSession;
      const bytes = Buffer.from(JSON.stringify(stored, null, 2), "utf8");
      const version = versionOf(bytes);
      tempFd = fs.openSync(temp, "wx");
      tempCreated = true;
      fs.writeFileSync(tempFd, bytes);
      fs.fsyncSync(tempFd);
      fs.closeSync(tempFd);
      tempFd = undefined;
      const latestBytes = readOptional(file);
      const latestVersion = latestBytes === null ? null : versionOf(latestBytes);
      if (latestVersion !== currentVersion) throw conflict();
      fs.renameSync(temp, file);
      tempCreated = false;
      return { project: { ...stored, __storageVersion: version }, version };
    } finally {
      try {
        if (tempFd !== undefined) fs.closeSync(tempFd);
      } finally {
        if (tempCreated) fs.unlinkSync(temp);
      }
    }
  });
}

module.exports = { read, write, withFiles, recover };
