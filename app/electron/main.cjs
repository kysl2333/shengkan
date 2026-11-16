const { app, BrowserWindow, shell, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { ensureEngine, stopEngine } = require("./engine.cjs");
const projects = require("./projects.cjs");
const paths = require("./paths.cjs");
const { readConfig, writeConfig } = require("./config.cjs");
const ai = require("./ai.cjs");
const logs = require("./log.cjs");
const cloud = require("./cloud-tts.cjs");

ipcMain.handle("projects:list", () => projects.listProjects());
ipcMain.handle("projects:load", (_event, id) => projects.loadProject(id));
ipcMain.handle("projects:save", (_event, project) => projects.saveProject(project));
ipcMain.handle("projects:create", (_event, title) => projects.createProject(title));
ipcMain.handle("projects:trash", (_event, id) => projects.trashProject(id));
ipcMain.handle("projects:trash-list", () => projects.listTrash());
ipcMain.handle("projects:restore", (_event, trashName) => projects.restoreProject(trashName));
ipcMain.handle("projects:delete-forever", (_event, trashName) => projects.deleteForever(trashName));
ipcMain.handle("projects:empty-trash", () => projects.emptyTrash());
ipcMain.handle("projects:root", () => projects.ROOT);
ipcMain.handle("app:paths", () => ({
  userData: app.getPath("userData"),
  documents: app.getPath("documents"),
  projects: paths.PROJECTS,
  voices: paths.VOICES,
  outputs: paths.OUTPUTS,
  config: paths.CONFIG,
  logs: paths.LOGS,
  engineLog: paths.ENGINE_LOG,
}));
ipcMain.handle("config:get", () => readConfig());
ipcMain.handle("config:set", (_event, cfg) => writeConfig(cfg));
ipcMain.handle("ai:config:get", () => ai.readAiConfig());
ipcMain.handle("ai:config:set", (_event, cfg) => ai.writeAiConfig(cfg));
ipcMain.handle("ai:config:path", () => ai.configFile());
ipcMain.handle("ai:test", () => ai.testConnection());
ipcMain.handle("ai:default-prompts", () => ai.defaultPrompts());
ipcMain.handle("ai:cancel-detect", () => ai.cancelDetect());
ipcMain.handle("ai:list-models", (_event, payload) => ai.listModels(payload));
ipcMain.handle("ai:detect-chapters", (event, text, toc, workTitle) =>
  ai.detectChapters(
    text,
    (progress) => {
      if (!event.sender.isDestroyed()) event.sender.send("ai:progress", progress);
    },
    toc,
    workTitle
  )
);
ipcMain.handle("ai:annotate-lines", (event, lines, casts, startBatch, context) =>
  ai.annotateLines(
    lines,
    casts,
    (progress) => {
      if (!event.sender.isDestroyed()) event.sender.send("ai:progress", progress);
    },
    startBatch,
    context
  )
);
ipcMain.handle("ai:extract-casts", (event, text, context) =>
  ai.extractCasts(text, (progress) => {
    if (!event.sender.isDestroyed()) event.sender.send("ai:progress", progress);
  }, context)
);
ipcMain.handle("cloud:list", () => cloud.list());
ipcMain.handle("cloud:providers", () => cloud.providers());
ipcMain.handle("cloud:tts", (_event, payload) => cloud.synthesize(payload));
ipcMain.handle("cloud:sample", (_event, id, options) => cloud.sample(id, options));
ipcMain.handle("cloud:design-preview", (_event, payload) => cloud.designPreview(payload));
ipcMain.handle("cloud:save-design", (_event, payload) => cloud.saveDesign(payload));
ipcMain.handle("cloud:materialize", (_event, id) => cloud.materialize(id));
ipcMain.handle("cloud:remove", (_event, id) => cloud.remove(id));
ipcMain.handle("cloud:update", (_event, id, payload) => cloud.update(id, payload));
ipcMain.on("log:write", (_event, scope, message, data) => logs.write(scope, message, data));
ipcMain.handle("log:info", () => logs.info());
ipcMain.handle("log:clear", () => logs.clear());
ipcMain.handle("log:open", () => logs.open());
ipcMain.handle("shell:reveal", (_event, file) => {
  if (!file) throw new Error("缺少文件路径");
  if (!fs.existsSync(file)) {
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) throw new Error(`目录不存在：${dir}`);
    shell.openPath(dir);
    return { ok: true };
  }
  if (fs.statSync(file).isDirectory()) {
    shell.openPath(file);
    return { ok: true };
  }
  shell.showItemInFolder(file);
  return { ok: true };
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1280,
    minHeight: 800,
    backgroundColor: "#0f1114",
    title: "声栞",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      autoplayPolicy: "no-user-gesture-required",
    },
  });

  win.once("ready-to-show", () => {
    win.maximize();
    win.show();
  });

  win.webContents.setZoomFactor(1.6);

  const devUrl = process.env.SHENGKAN_DEV_URL;
  const indexFile = path.join(__dirname, "..", "dist", "index.html");

  if (devUrl) {
    win.loadURL(devUrl);
  } else if (fs.existsSync(indexFile)) {
    win.loadFile(indexFile);
  } else {
    win.loadURL("http://127.0.0.1:5173");
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    const engine = await ensureEngine();
    console.log("[engine]", engine);
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("will-quit", stopEngine);

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
