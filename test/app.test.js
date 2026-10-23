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
