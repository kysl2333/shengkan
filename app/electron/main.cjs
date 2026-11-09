const { app, BrowserWindow, shell, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { ensureEngine, stopEngine } = require("./engine.cjs");
const projects = require("./projects.cjs");
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
ipcMain.handle("projects:root", () => projects.ROOT);
ipcMain.handle("config:get", () => readConfig());
ipcMain.handle("config:set", (_event, cfg) => writeConfig(cfg));
ipcMain.handle("ai:config:get", () => ai.readAiConfig());
ipcMain.handle("ai:config:set", (_event, cfg) => ai.writeAiConfig(cfg));
ipcMain.handle("ai:test", () => ai.testConnection());
ipcMain.handle("ai:default-prompts", () => ai.defaultPrompts());
ipcMain.handle("ai:cancel-detect", () => ai.cancelDetect());
ipcMain.handle("ai:detect-chapters", (event, text) =>
  ai.detectChapters(text, (progress) => {
    if (!event.sender.isDestroyed()) event.sender.send("ai:progress", progress);
  })
);
ipcMain.handle("ai:annotate-lines", (event, lines, casts, startBatch) =>
  ai.annotateLines(
    lines,
    casts,
    (progress) => {
      if (!event.sender.isDestroyed()) event.sender.send("ai:progress", progress);
    },
    startBatch
  )
);
ipcMain.handle("ai:extract-casts", (event, text) =>
  ai.extractCasts(text, (progress) => {
    if (!event.sender.isDestroyed()) event.sender.send("ai:progress", progress);
  })
);
ipcMain.handle("cloud:list", () => cloud.list());
ipcMain.handle("cloud:tts", (_event, payload) => cloud.synthesize(payload));
ipcMain.handle("cloud:design-preview", (_event, payload) => cloud.designPreview(payload));
ipcMain.handle("cloud:save-design", (_event, payload) => cloud.saveDesign(payload));
ipcMain.handle("cloud:materialize", (_event, id) => cloud.materialize(id));
ipcMain.handle("cloud:remove", (_event, id) => cloud.remove(id));
ipcMain.handle("cloud:update", (_event, id, payload) => cloud.update(id, payload));
ipcMain.on("log:write", (_event, scope, message, data) => logs.write(scope, message, data));
ipcMain.handle("log:info", () => logs.info());
ipcMain.handle("log:open", () => logs.open());

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1180,
    minHeight: 760,
    backgroundColor: "#0f1114",
    title: "声栞",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.once("ready-to-show", () => {
    win.maximize();
    win.show();
  });

  win.webContents.setZoomFactor(1.25);

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
