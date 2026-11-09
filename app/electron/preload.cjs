const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("shengkan", {
  version: process.versions.electron,
  platform: process.platform,
  projects: {
    list: () => ipcRenderer.invoke("projects:list"),
    load: (id) => ipcRenderer.invoke("projects:load", id),
    save: (project) => ipcRenderer.invoke("projects:save", project),
    create: (title) => ipcRenderer.invoke("projects:create", title),
    trash: (id) => ipcRenderer.invoke("projects:trash", id),
    trashList: () => ipcRenderer.invoke("projects:trash-list"),
    restore: (trashName) => ipcRenderer.invoke("projects:restore", trashName),
    deleteForever: (trashName) => ipcRenderer.invoke("projects:delete-forever", trashName),
    root: () => ipcRenderer.invoke("projects:root"),
  },
  config: {
    get: () => ipcRenderer.invoke("config:get"),
    set: (cfg) => ipcRenderer.invoke("config:set", cfg),
  },
  ai: {
    get: () => ipcRenderer.invoke("ai:config:get"),
    set: (cfg) => ipcRenderer.invoke("ai:config:set", cfg),
    test: () => ipcRenderer.invoke("ai:test"),
    defaults: () => ipcRenderer.invoke("ai:default-prompts"),
    detectChapters: (text, toc) => ipcRenderer.invoke("ai:detect-chapters", text, toc),
    cancel: () => ipcRenderer.invoke("ai:cancel-detect"),
    annotate: (lines, casts, startBatch) => ipcRenderer.invoke("ai:annotate-lines", lines, casts, startBatch),
    extractCasts: (text) => ipcRenderer.invoke("ai:extract-casts", text),
    onProgress: (cb) => {
      const listener = (_event, progress) => cb(progress);
      ipcRenderer.on("ai:progress", listener);
      return () => ipcRenderer.removeListener("ai:progress", listener);
    },
  },
  log: {
    write: (scope, message, data) => ipcRenderer.send("log:write", scope, message, data),
    info: () => ipcRenderer.invoke("log:info"),
    open: () => ipcRenderer.invoke("log:open"),
  },
  shell: {
    reveal: (file) => ipcRenderer.invoke("shell:reveal", file),
  },
  cloud: {
    list: () => ipcRenderer.invoke("cloud:list"),
    providers: () => ipcRenderer.invoke("cloud:providers"),
    tts: (payload) => ipcRenderer.invoke("cloud:tts", payload),
    designPreview: (payload) => ipcRenderer.invoke("cloud:design-preview", payload),
    saveDesign: (payload) => ipcRenderer.invoke("cloud:save-design", payload),
    materialize: (id) => ipcRenderer.invoke("cloud:materialize", id),
    remove: (id) => ipcRenderer.invoke("cloud:remove", id),
    update: (id, payload) => ipcRenderer.invoke("cloud:update", id, payload),
  },
});
