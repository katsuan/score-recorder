// 画面の部品をまねた入れ物で js/ を全部読み、録画・書き出しの流れを確かめるテスト。node --test test/
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const FILES = ["core", "draw", "setup", "studio", "record", "editor", "render"];

// どんな使い方をしても止まらない、まねの部品（id ごとに1つ。書いた値は覚える）
function fakeEl() {
  const own = {};
  const target = function () {};
  const proxy = new Proxy(target, {
    get(_, key) {
      if (key in own) return own[key];
      if (key === Symbol.iterator) return function* () {};
      if (key === Symbol.toPrimitive) return () => "";
      if (typeof key === "symbol") return undefined;
      if (key === "then") return undefined;
      return proxy;
    },
    set(_, key, value) {
      own[key] = value;
      return true;
    },
    apply: () => proxy
  });
  return proxy;
}

function boot({ MediaRecorder } = {}) {
  const els = new Map();
  const $el = (id) => {
    if (!els.has(id)) els.set(id, fakeEl());
    return els.get(id);
  };
  const asked = [];
  const document = fakeEl();
  document.getElementById = $el;
  const window = fakeEl();
  window.MediaRecorder = MediaRecorder;
  window.LineShareUI = { ask: (o) => (asked.push(o), Promise.resolve(false)), toast: () => {} };
  const ctx = vm.createContext({
    document,
    window,
    LineShareUI: window.LineShareUI,
    localStorage: { getItem: () => null, setItem: () => {} },
    location: { search: "" },
    navigator: { userAgent: "test", platform: "", maxTouchPoints: 0 },
    MediaRecorder,
    URLSearchParams,
    URL: { createObjectURL: () => "blob:x", revokeObjectURL: () => {} },
    Blob,
    File: class {},
    performance,
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    Event: class {},
    Image: class {},
    console
  });
  for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(__dirname, `../js/${f}.js`), "utf8"), ctx, { filename: `${f}.js` });
  return { ctx, run: (code) => vm.runInContext(code, ctx), asked, $el };
}

test("js/ を全部読んでも止まらない", () => {
  const { run } = boot();
  assert.equal(run("recording"), false);
});

test("録画を始められない端末（MediaRecorder が断る）でも、録画中のまま固まらない", () => {
  class Broken {
    constructor() {
      throw new Error("NotSupportedError");
    }
    static isTypeSupported() {
      return true;
    }
  }
  const { run, asked } = boot({ MediaRecorder: Broken });
  // カメラが開いている形にして、録画ボタンを押す
  run("cameraStream = { getAudioTracks: () => [] }; screen.captureStream = () => ({ addTrack() {}, getVideoTracks: () => [] });");
  assert.doesNotThrow(() => run("startRecording()"));
  assert.equal(run("recording"), false);
  assert.equal(asked.length, 1);
});

test("start で断られても、録画中のまま固まらない", () => {
  class StartFails {
    constructor() {
      this.state = "inactive";
    }
    addEventListener() {}
    start() {
      throw new Error("NotSupportedError");
    }
    static isTypeSupported() {
      return true;
    }
  }
  const { run } = boot({ MediaRecorder: StartFails });
  run("cameraStream = { getAudioTracks: () => [] }; screen.captureStream = () => ({ addTrack() {}, getVideoTracks: () => [] });");
  run("startRecording()");
  assert.equal(run("recording"), false);
  assert.equal(run("activeRecs.size"), 0);
});

test("⚡ ハイライトを作ったあとでも、撮った動画にの画面はさっきの動画にもどる", () => {
  const { run } = boot();
  run("editUrl = 'blob:mine'; editVideo.src = 'blob:shot-clip';"); // ハイライトの書き出しで、録った動画に入れかえていた
  run("showEditor()");
  assert.equal(run("editVideo.src"), "blob:mine");
});

test("書き出しで動画が読めないときも、待ちつづけない", async () => {
  const { run } = boot();
  // 読みこみに失敗する動画：loadeddata は来ず、error が来る
  run(`editVideo.addEventListener = (type, fn) => { if (type === "error") Promise.resolve().then(fn); };`);
  const result = await Promise.race([run("loadVideo('blob:gone')").then(() => "done"), new Promise((r) => globalThis.setTimeout(() => r("hang"), 300))]);
  assert.equal(result, "done");
});

test("止めたまま ＋1 を続けて押すと、一覧のスコアは 1 - 0 → 2 - 0 と1つずつ", () => {
  const { run } = boot();
  run(`editBase = { us: 0, them: 0 }; editEvents = [{ t: 5, key: "us", delta: 1 }, { t: 5, key: "us", delta: 1 }, { t: 5, key: "them", delta: 1 }, { t: 5, key: null, delta: 0, mark: true }, { t: 6, key: "us", delta: -1 }];`);
  assert.deepEqual(JSON.parse(run("JSON.stringify(scoresAfterEvents())")), [
    { us: 1, them: 0 },
    { us: 2, them: 0 },
    { us: 2, them: 1 },
    { us: 2, them: 1 },
    { us: 1, them: 1 }
  ]);
});

// 利用状況の記録（Q キットの shared/log.js の LineShareLog）。電波がない・読めないときは無くても止まらない
function withLog(run) {
  run("var logged = []; window.LineShareLog = { track: (event, o) => logged.push([event, o.kind, o.count]) };");
  return () => JSON.parse(run("JSON.stringify(logged)"));
}

test("記録の部品が読めない・こわれていても、止まらない（電波がないときも使える）", () => {
  const { run } = boot();
  run("window.LineShareLog = undefined");
  assert.doesNotThrow(() => run("logUse('shot', 1)"));
  run("window.LineShareLog = { track() { throw new Error('offline'); } }");
  assert.doesNotThrow(() => run("logUse('shot', 1)"));
});

test("カメラで録り終えると、録った秒数を記録する（書き出しの録画は数えない）", () => {
  const { run } = boot();
  const logged = withLog(run);
  run("recording = true; recKind = 'shot'; startedAt = Date.now() - 65000; stopRecording()");
  run("recording = true; recKind = 'edit'; startedAt = Date.now(); stopRecording()");
  assert.deepEqual(logged(), [["send", "shot", 65]]);
});

test("共有できたら、本数を記録する（やめたときは記録しない）", async () => {
  const { run } = boot();
  const logged = withLog(run);
  run("navigator.share = () => Promise.resolve()");
  await run("shareFiles([{ file: 1 }, { file: 2 }])");
  run("navigator.share = () => Promise.reject(new Error('AbortError'))");
  await run("shareFiles([{ file: 1 }])");
  assert.deepEqual(logged(), [["send", "share", 2]]);
});

test("共有できたら、季節の絵文字がつくことがある（QSeason がなくても動く）", () => {
  const { run, $el } = boot();
  run("window.QSeason = undefined; markShared();");
  assert.equal($el("sharedNote").textContent, "✓ 共有できました");
  run("window.QSeason = { decorate: (t) => t + ' 🎃' }; markShared();");
  assert.equal($el("sharedNote").textContent, "✓ 共有できました 🎃");
  run("window.QSeason = { decorate() { throw new Error('x'); } }; markShared();");
  assert.equal($el("sharedNote").textContent, "✓ 共有できました");
});

test("書き出せる動画が1本もなかったときは、「書き出した」と記録しない", async () => {
  const { run } = boot({ MediaRecorder: class { static isTypeSupported() { return true; } } });
  const logged = withLog(run);
  // 読めない動画：loadeddata は来ず、error が来る
  run(`editScreen.captureStream = () => ({}); editVideo.addEventListener = (type, fn) => { if (type === "error") Promise.resolve().then(fn); };`);
  await run("renderPieces([{ src: 'blob:gone', a: 0, b: 5 }], { overlay: true, kind: 'edit', title: '' })");
  assert.deepEqual(logged(), []);
  assert.equal(run("exporting"), false);
});

test("動画のファイル名：日時と、分けたときの番号・ハイライト", () => {
  const { run } = boot();
  const at = new Date(2026, 9, 24, 9, 5).getTime();
  run(`var at = ${at};`);
  assert.equal(run("clipFileName({ takeAt: at, type: 'video/mp4', kind: 'shot' }, 0, 1)"), "score-20261024-0905.mp4");
  assert.equal(run("clipFileName({ takeAt: at, type: 'video/webm', kind: 'shot' }, 1, 3)"), "score-20261024-0905-2.webm");
  assert.equal(run("clipFileName({ takeAt: at, type: 'video/mp4', kind: 'highlight' }, 0, 2)"), "score-20261024-0905-highlight.mp4");
});
