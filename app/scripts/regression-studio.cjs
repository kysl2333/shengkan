/* 声栞 · 工作台回归检查
 *
 * 跑法：cd app && npm run check:studio
 *
 * 覆盖：
 * 1. 切换章节时勾选/编辑态不串到下一章
 * 2. 生成中切章节，不把「生成中」显示到新章节
 * 3. 只剩一句时拒绝删除，且不先删音频
 * 4. 生成期间改其他台词，生成结束不覆盖改动
 * 5. AI 重拆本章时清理被替换台词的旧音频
 * 6. 语速拖动只在松手后落盘
 * 7. 重复角色 id 只选中一个，绑定只作用于一个角色
 * 8. 选中台词切原文会定位并高亮对应段
 * 9. 规则重拆保留文字相同的角色和音频
 * 10. AI 标注时显示思考过程
 * 11. 生成参数显示实际音色引擎
 * 12. 连续试听跳过缺音频的句子并跟随当前句
 * 13. 云端失败后串行重试并汇报结果
 * 14. 切换历史配音有反馈
 * 15. 连续换句保持倍速且复用同一个音频元素
 */

const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

const APP_DIR = path.join(__dirname, "..");
const DIST = path.join(APP_DIR, "dist", "index.html");
const results = [];
const savedProjects = [];

const project = {
  id: "p-regression",
  title: "状态回归",
  createdAt: "2026-11-01T10:00:00.000Z",
  updatedAt: "2026-11-11T00:00:00.000Z",
  settings: { engine: "http://127.0.0.1:8290" },
  casts: [
    { id: "cast-dup", name: "旁白", initial: "旁", desc: "待匹配音色", voice: "", voicePath: "", color: "#2f6b57" },
    { id: "cast-dup", name: "沈砚", initial: "沈", desc: "待匹配音色", voice: "", voicePath: "", color: "#a9763c", cloudModel: "mimo-v2.5-tts", cloudVoice: "测试云", cloudName: "测试云" },
  ],
  chapters: [
    {
      id: "ch-01",
      title: "第一章",
      source: "第一句\n\n第二句",
      lines: [
        { id: 1, speaker: "旁白", text: "第一句", emotion: "平静", speed: 1, status: "pending", audio: "", paragraph: 1 },
        { id: 2, speaker: "旁白", text: "第二句", emotion: "平静", speed: 1, status: "done", audio: "line2.wav", audioHistory: ["line2-old.wav"], paragraph: 2 },
        { id: 3, speaker: "旁白", text: "重试测试句", emotion: "平静", speed: 1, status: "pending", audio: "", paragraph: 3 },
        { id: 4, speaker: "旁白", text: "第四句", emotion: "平静", speed: 1, status: "done", audio: "line4.wav", paragraph: 4 },
      ],
    },
    {
      id: "ch-02",
      title: "第二章",
      source: "只有一句",
      lines: [
        { id: 1, speaker: "沈砚", text: "只有一句", emotion: "平静", speed: 1, status: "done", audio: "keep-me.wav", paragraph: 1 },
      ],
    },
  ],
};

const summary = {
  id: project.id,
  title: project.title,
  chapters: 2,
  lines: 3,
  done: 1,
  percent: 33,
  updatedAt: project.updatedAt,
};

ipcMain.handle("projects:list", () => [summary]);
ipcMain.handle("projects:load", () => project);
ipcMain.handle("projects:save", (_e, p) => {
  savedProjects.push(p);
  return { ...summary, updatedAt: p.updatedAt || new Date().toISOString() };
});
ipcMain.handle("projects:create", () => project);
ipcMain.handle("projects:trash", () => ({ ok: true, trashName: "x" }));
ipcMain.handle("projects:trash-list", () => []);
ipcMain.handle("projects:restore", () => summary);
ipcMain.handle("projects:delete-forever", () => ({ ok: true }));
ipcMain.handle("projects:root", () => APP_DIR);
ipcMain.handle("config:get", () => ({ mode: "gradio", gradioUrl: "", gradioApi: "", voiceLib: "", python: "", indexttsCodeDir: "", indexttsModelDir: "" }));
ipcMain.handle("config:set", (_e, cfg) => cfg);
ipcMain.handle("ai:config:get", () => ({ baseUrl: "", model: "", apiKey: "", autoChapter: false, prompts: {} }));
ipcMain.handle("ai:config:set", (_e, cfg) => cfg);
ipcMain.handle("ai:test", () => ({ ok: true, ms: 1, model: "mock" }));
ipcMain.handle("ai:default-prompts", () => ({ chapter: "", annotate: "" }));
ipcMain.handle("ai:cancel-detect", () => true);
ipcMain.handle("ai:extract-casts", () => ({ casts: [], usage: { input: 0, output: 0, total: 0, cached: 0 } }));
ipcMain.handle("ai:annotate-lines", async (event) => {
  if (!event.sender.isDestroyed()) {
    event.sender.send("ai:progress", {
      done: 0,
      total: 1,
      message: "AI 正在思考…",
      reasoning: "先看第二句，说话人是沈砚。",
    });
  }
  await wait(700);
  return { changes: [], cancelled: false, nextBatch: 1, usage: { input: 1, output: 1, total: 2, cached: 0 } };
});
ipcMain.handle("cloud:list", () => []);
ipcMain.handle("cloud:providers", () => []);
ipcMain.handle("log:info", () => ({ file: "app.log", size: 1 }));
ipcMain.handle("log:open", () => "app.log");
ipcMain.on("log:write", () => {});

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function check(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${name}${detail ? " — " + detail : ""}`);
}

function evalJs(win, code) {
  return win.webContents.executeJavaScript(code);
}

async function installStubs(win) {
  await evalJs(
    win,
    `(() => {
      window.__fetchLog = { audioDeletes: [], tts: 0 };
      window.confirm = () => true;
      const RealAudio = window.Audio;
      if (!window.__audioPatched) {
        window.__audioPatched = true;
        window.__audioCount = 0;
        window.__lastAudio = null;
        window.Audio = function (...args) {
          const audio = new RealAudio(...args);
          window.__audioCount += 1;
          window.__lastAudio = audio;
          return audio;
        };
        window.Audio.prototype = RealAudio.prototype;
      }
      if (window.__originalFetch) return true;
      window.__originalFetch = window.fetch.bind(window);
      window.fetch = async (url, init) => {
        const u = String(url);
        const jsonResponse = (data) =>
          new Response(JSON.stringify(data), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        if (u.includes("/v1/audio-delete")) {
          try { window.__fetchLog.audioDeletes.push(JSON.parse(init && init.body ? init.body : "{}").name); } catch { window.__fetchLog.audioDeletes.push("unparsed"); }
          return jsonResponse({ ok: true });
        }
        if (u.includes("/v1/voices")) {
          return jsonResponse({ voices: [{ name: "voice-01.wav", displayName: "沉静旁白", desc: "女声", gender: "女", age: "青年", path: "voice-01.wav", category: "旁白", size: 1000 }], count: 1 });
        }
        if (u.includes("/v1/tts")) {
          window.__fetchLog.tts += 1;
          let ttsText = "";
          try { ttsText = JSON.parse(init && init.body ? init.body : "{}").text || ""; } catch {}
          if (ttsText.includes("重试测试句") && !window.__retryOnce) {
            window.__retryOnce = true;
            await new Promise((resolve) => setTimeout(resolve, 300));
            return new Response(JSON.stringify({ error: "mock 限流" }), {
              status: 429,
              headers: { "Content-Type": "application/json" },
            });
          }
          await new Promise((resolve) => setTimeout(resolve, 500));
          return jsonResponse({ ok: true, file: "mock.wav", url: "/v1/audio/mock.wav" });
        }
        if (u.includes("/v1/split")) {
          let text = "";
          try { text = JSON.parse(init && init.body ? init.body : "{}").text || ""; } catch {}
          const body = text.trim() === "只有一句"
            ? { segments: [{ speaker: "旁白", text: "只有一句", emotion: "平静", confidence: 1, paragraph: 1 }], count: 1 }
            : { segments: [{ speaker: "旁白", text: "第一句", emotion: "平静", confidence: 1, paragraph: 1 }], count: 1 };
          return jsonResponse({ ...body, characters: text.length, mode: "rule" });
        }
        if (u.includes("/health")) {
          return jsonResponse({ ok: true, engine: "stub", code_dir: "", model_dir: "", model_loaded: true });
        }
        return window.__originalFetch(url, init);
      };
      return true;
    })()`
  );
}

async function reload(win) {
  await win.webContents.reload();
  await wait(900);
  await installStubs(win);
}

async function clickChapter(win, title) {
  return evalJs(
    win,
    `(() => { const el = [...document.querySelectorAll('.chapter')].find(x => x.textContent.includes(${JSON.stringify(title)})); if (!el) return false; el.click(); return true; })()`
  );
}

app.whenReady().then(async () => {
  if (!fs.existsSync(DIST)) {
    console.error("找不到 dist/index.html，先运行 npm run build");
    app.exit(1);
    return;
  }

  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    webPreferences: {
      preload: path.join(APP_DIR, "electron", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      offscreen: true,
      backgroundThrottling: false,
    },
  });

  await win.loadFile(DIST);
  await wait(1200);
  await installStubs(win);

  // 1. 勾选状态不跨章节
  await clickChapter(win, "第一章");
  await evalJs(win, `document.querySelector('.line input[type="checkbox"]').click()`);
  await wait(200);
  await clickChapter(win, "第二章");
  await wait(250);
  check("跨章节不保留勾选", (await evalJs(win, `document.querySelector('.line input[type="checkbox"]').checked`)) === false);

  // 2. 编辑状态不跨章节
  await reload(win);
  await evalJs(win, `document.querySelector('.line .line-text').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
  await wait(250);
  const editingBefore = await evalJs(win, `!!document.querySelector('.line .line-edit')`);
  await clickChapter(win, "第二章");
  await wait(250);
  const editingAfter = await evalJs(win, `!!document.querySelector('.line .line-edit')`);
  check("跨章节不保留编辑态", editingBefore === true && editingAfter === false);

  // 3. 生成状态不跨章节
  await reload(win);
  const generateClicked = await evalJs(
    win,
    `(() => { const b = document.querySelector('.line.current .line-actions button[aria-label="生成这句"]'); if (!b) return false; b.click(); return true; })()`
  );
  await wait(300);
  const ttsStarted = await evalJs(win, `window.__fetchLog.tts`);
  await clickChapter(win, "第二章");
  await wait(250);
  const generatingAfterSwitch = await evalJs(win, `!!document.querySelector('.line .spinner') && document.body.textContent.includes('生成中')`);
  check("生成请求确实发出", generateClicked === true && ttsStarted > 0);
  check("跨章节不显示上一章的生成中", generatingAfterSwitch === false);
  await wait(1600);

  // 4. 只剩一句时拒绝删除且不删音频
  await reload(win);
  await clickChapter(win, "第二章");
  await wait(250);
  const beforeLines = await evalJs(win, `document.querySelectorAll('.line').length`);
  const deleteClicked = await evalJs(
    win,
    `(() => { const b = document.querySelector('.line.current .line-actions button[aria-label="删除这句"]'); if (!b) return false; b.click(); return true; })()`
  );
  await wait(400);
  const afterLines = await evalJs(win, `document.querySelectorAll('.line').length`);
  const audioDeletes = await evalJs(win, `window.__fetchLog.audioDeletes`);
  check("只剩一句时保留台词", deleteClicked === true && beforeLines === 1 && afterLines === 1);
  check("只剩一句时不删除音频", audioDeletes.length === 0, JSON.stringify(audioDeletes));

  // 5. 生成期间改其他台词，不能被生成结果覆盖
  await reload(win);
  await evalJs(
    win,
    `(() => { const b = document.querySelector('.line.current .line-actions button[aria-label="生成这句"]'); if (!b) return false; b.click(); return true; })()`
  );
  await wait(250);
  await evalJs(win, `document.querySelectorAll('.line')[1].querySelector('.line-text').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
  await wait(150);
  const editHandled = await evalJs(
    win,
    `(() => {
      const second = document.querySelectorAll('.line')[1];
      const ta = second && second.querySelector('.line-edit');
      if (!ta) return false;
      ta.value = '生成期间改过的第二句';
      ta.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
      return true;
    })()`
  );
  await wait(1600);
  const secondText = await evalJs(win, `document.querySelectorAll('.line')[1].querySelector('.line-text')?.textContent || ''`);
  check("生成期间修改的其他台词不被覆盖", editHandled === true && secondText.includes("生成期间改过"), secondText.trim());

  // 6. AI 重拆本章清理旧音频
  await reload(win);
  await clickChapter(win, "第二章");
  await wait(200);
  await evalJs(win, `document.querySelector('.ai-trigger')?.click()`);
  await wait(150);
  const aiRebuildClicked = await evalJs(
    win,
    `(() => { const b = [...document.querySelectorAll('.ai-menu button')].find(x => x.textContent.includes('AI 重拆本章')); if (!b) return false; b.click(); return true; })()`
  );
  await wait(800);
  const aiDeletes = await evalJs(win, `window.__fetchLog.audioDeletes`);
  check("AI 重拆本章清理旧音频", aiRebuildClicked === true && aiDeletes.includes("keep-me.wav"), JSON.stringify(aiDeletes));

  // 7. 拖动语速滑块时只在松手后落盘
  await reload(win);
  savedProjects.length = 0;
  await evalJs(
    win,
    `(() => {
      const slider = document.querySelector('.slider');
      if (!slider) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(slider, '1.25');
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      slider.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`
  );
  await wait(250);
  const duringDragSaves = savedProjects.length;
  await evalJs(win, `document.querySelector('.slider').dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))`);
  await wait(500);
  const speedPersisted = savedProjects.some((p) => p.chapters[0].lines[0].speed === 1.25);
  check("语速拖动只在松手后落盘", duringDragSaves === 0 && speedPersisted, `during=${duringDragSaves} persisted=${speedPersisted}`);

  // 8. 重复角色 id 会被去重，绑定只作用于一个角色
  await reload(win);
  await evalJs(
    win,
    `(() => { const b = [...document.querySelectorAll('.nav button')].find(x => x.textContent.includes('角色与音色')); if (b) b.click(); return !!b; })()`
  );
  await wait(800);
  const currentCount = await evalJs(win, `document.querySelectorAll('.role-current').length`);
  const bindClicked = await evalJs(
    win,
    `(() => { const b = [...document.querySelectorAll('.voice-card .voice-use')].find(x => x.textContent.includes('绑定到角色')); if (!b) return false; b.click(); return true; })()`
  );
  await wait(500);
  const voiceBoundCount = await evalJs(
    win,
    `[...document.querySelectorAll('.role-trait')].filter(x => x.textContent.includes('沉静旁白')).length`
  );
  check("重复角色 id 只选中一个", currentCount === 1, `current=${currentCount}`);
  check("绑定只作用于一个角色", bindClicked === true && voiceBoundCount === 1, `bound=${voiceBoundCount}`);

  // 9. 选中台词后切原文，定位并高亮对应段
  await reload(win);
  await clickChapter(win, "第一章");
  await wait(200);
  await evalJs(win, `document.querySelectorAll('.line')[1].click()`);
  await wait(150);
  await evalJs(
    win,
    `(() => { const b = [...document.querySelectorAll('.view-switch button')].find(x => x.textContent.includes('原文')); if (b) b.click(); return !!b; })()`
  );
  await wait(500);
  const flash = await evalJs(win, `document.querySelector('#source-p-2')?.classList.contains('flash')`);
  check("原文定位并高亮当前段", flash === true, `flash=${flash}`);

  // 10. 规则重拆保留文字相同的角色和音频
  await reload(win);
  await clickChapter(win, "第二章");
  await wait(200);
  await evalJs(win, `document.querySelector('.ai-trigger')?.click()`);
  await wait(150);
  const splitClicked = await evalJs(
    win,
    `(() => { const b = [...document.querySelectorAll('.ai-menu button')].find(x => x.textContent.includes('规则重拆')); if (!b) return false; b.click(); return true; })()`
  );
  await wait(600);
  const keptSpeaker = await evalJs(
    win,
    `[...document.querySelectorAll('.line')].some(x => x.textContent.includes('沈砚'))`
  );
  const deletedKeep = await evalJs(
    win,
    `window.__fetchLog.audioDeletes.filter(x => x === "keep-me.wav").length`
  );
  check(
    "规则重拆保留相同文字的角色和音频",
    splitClicked === true && keptSpeaker === true && deletedKeep === 0,
    `speaker=${keptSpeaker} deleted=${deletedKeep}`
  );

  // 11. AI 标注时显示思考过程
  await reload(win);
  await clickChapter(win, "第一章");
  await wait(200);
  await evalJs(win, `document.querySelector('.ai-trigger')?.click()`);
  await wait(150);
  await evalJs(
    win,
    `(() => { const b = [...document.querySelectorAll('.ai-menu button')].find(x => x.textContent.includes('AI 标注角色')); if (b) b.click(); return !!b; })()`
  );
  await wait(350);
  const thinkingShown = await evalJs(
    win,
    `document.querySelector('.ai-thinking-body')?.textContent?.includes('沈砚') === true`
  );
  check("AI 标注显示思考过程", thinkingShown === true, `shown=${thinkingShown}`);
  await wait(600);

  // 11. 生成参数显示实际音色引擎
  await reload(win);
  await clickChapter(win, "第二章");
  await wait(300);
  const engineLabel = await evalJs(
    win,
    `([...document.querySelectorAll('.right-title')].find(x => x.textContent.includes('生成参数'))?.querySelector('.kbd')?.textContent || '').trim()`
  );
  check("生成参数显示实际引擎", engineLabel.includes("小米云 TTS"), engineLabel);

  // 12. 连续试听跳过没音频的句子，并跟随当前句高亮
  await reload(win);
  await clickChapter(win, "第一章");
  await wait(250);
  await evalJs(win, `document.querySelectorAll('.line')[0].click()`);
  await evalJs(
    win,
    `(() => { const b = [...document.querySelectorAll('.studio-head .seg button')].find(x => x.textContent.includes('连续')); if (b) b.click(); return !!b; })()`
  );
  await wait(100);
  await evalJs(
    win,
    `(() => { const b = [...document.querySelectorAll('.studio-head button')].find(x => x.textContent.includes('连续试听')); if (b) b.click(); return !!b; })()`
  );
  await wait(450);
  const followed = await evalJs(
    win,
    `document.querySelectorAll('.line')[1].classList.contains('current')`
  );
  const flashed = await evalJs(
    win,
    `document.querySelectorAll('.line')[1].classList.contains('flash')`
  );
  check(
    "连续试听跳过缺音频并跟随当前句",
    followed === true && flashed === true,
    `current=${followed} flash=${flashed}`
  );

  // 13. 云端失败后串行重试并汇报结果
  await reload(win);
  await clickChapter(win, "第一章");
  await wait(250);
  await evalJs(
    win,
    `(() => { const b = [...document.querySelectorAll('.studio-head button')].find(x => x.textContent.includes('生成配音')); if (b) b.click(); return !!b; })()`
  );
  await wait(250);
  await evalJs(
    win,
    `(() => { const b = document.querySelector('.gen-dialog .edit-option'); if (b) b.click(); return !!b; })()`
  );
  await wait(6000);
  const retryDone = await evalJs(
    win,
    `document.querySelectorAll('.line')[2].textContent.includes('已生成')`
  );
  const retryMsg = await evalJs(
    win,
    `([...document.querySelectorAll('.engine-note')].pop()?.textContent || '').trim()`
  );
  check(
    "失败后串行重试并汇报结果",
    retryDone === true && retryMsg.includes("重试成功 1 句"),
    `done=${retryDone} msg=${retryMsg.replace(/\s+/g, " ").slice(0, 60)}`
  );

  // 14. 切换历史配音有反馈
  await reload(win);
  await clickChapter(win, "第一章");
  await wait(250);
  await evalJs(
    win,
    `document.querySelectorAll('.line')[1].querySelector('button[aria-label="切换上一个音频"]')?.click()`
  );
  await wait(250);
  const switchToast = await evalJs(win, `document.querySelector('.toast')?.textContent || ''`);
  check("切换历史配音有反馈", switchToast.includes("上一版配音"), switchToast.trim());

  // 15. 倍速全局生效并复用同一个 Audio 元素
  await reload(win);
  await clickChapter(win, "第一章");
  await wait(250);
  await evalJs(
    win,
    `(() => {
      const sel = document.querySelector('.speed-select');
      if (!sel) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      setter.call(sel, '3');
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`
  );
  await wait(150);
  await evalJs(win, `document.querySelectorAll('.line')[1].querySelector('.line-play')?.click()`);
  await wait(350);
  const rate1 = await evalJs(win, `window.__lastAudio?.playbackRate ?? 0`);
  await evalJs(win, `document.querySelectorAll('.line')[3].querySelector('.line-play')?.click()`);
  await wait(350);
  const rate2 = await evalJs(win, `window.__lastAudio?.playbackRate ?? 0`);
  const audioCount = await evalJs(win, `window.__audioCount`);
  check(
    "连续换句保持倍速且复用同一个音频元素",
    rate1 === 3 && rate2 === 3 && audioCount === 1,
    `rate1=${rate1} rate2=${rate2} count=${audioCount}`
  );

  const failed = results.filter((r) => !r.pass).length;
  console.log(`\nRESULT ${failed === 0 ? "GREEN" : "RED"} ${results.length - failed}/${results.length}`);
  app.exit(failed ? 1 : 0);
});
