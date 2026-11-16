const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

function preserve(root, project) {
  const dir = path.join(root, ".recovery");
  fs.mkdirSync(dir, { recursive: true });
  const id = String(project.id || "project").replace(/[^a-zA-Z0-9_-]/g, "_");
  const file = path.join(dir, `${id}-${Date.now()}-${randomUUID()}.json`);
  const partial = `${file}.partial`;
  const { __storageVersion, __storageSession, ...content } = project;
  const fd = fs.openSync(partial, "wx");
  try {
    fs.writeFileSync(fd, JSON.stringify(content, null, 2), "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(partial, file);
  return file;
}

module.exports = { preserve };
