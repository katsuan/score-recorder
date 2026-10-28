// 画面の部品をまねた入れ物で js/ を全部読み、録画・書き出しの流れを確かめるテスト。node --test test/
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const FILES = ["js/page.js", "js/store.js", "js/draw.js", "js/setup.js", "js/studio.js", "js/record.js", "js/editor.js", "js/render.js", "js/quickjoin.js", "js/quickbadge.js", "js/merge.js", "js/keep.js"];

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

function boot({ MediaRecorder, userAgent = "test" } = {}) {
  const els = new Map();
  const $el = (id) => {
    if (!els.has(id)) els.set(id, fakeEl());
    return els.get(id);
  };
  const asked = [];
  const document = fakeEl();
  document.getElementById = $el;
  document.fonts = { ready: Promise.resolve() };
  const window = fakeEl();
  window.MediaRecorder = MediaRecorder;
  window.LineShareUI = { ask: (o) => (asked.push(o), Promise.resolve(false)), toast: () => {} };
  const ctx = vm.createContext({
    document,
    window,
    LineShareUI: window.LineShareUI,
    localStorage: { getItem: () => null, setItem: () => {} },
    location: { search: "", href: "https://katsuan.github.io/score-recorder/" },
    navigator: { userAgent, platform: "", maxTouchPoints: 0 },
    MediaRecorder,
    URLSearchParams,
    URL: Object.assign(class extends URL {}, { createObjectURL: () => "blob:x", revokeObjectURL: () => {} }),
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
  for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(__dirname, "..", f), "utf8"), ctx, { filename: f });
  return { ctx, run: (code) => vm.runInContext(code, ctx), asked, $el };
}

test("入口の app.js まで読んでも止まらない（js/ の関数が、ほかの関数の中に入ってしまっていないか）", () => {
  const { ctx } = boot();
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8"), ctx, { filename: "app.js" });
});

test("LINE の中では「Safari・Chrome で開く」に openExternalBrowser=1 をつける", () => {
  const { run, $el } = boot({ userAgent: "Mozilla/5.0 (iPhone) Line/14.0.0" });
  run("showLineHint()");
  assert.equal($el("lineHint").hidden, false);
  assert.match(String($el("openOutside").href), /openExternalBrowser=1/);
});

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
  assert.equal($el("sharedNote").textContent, "✓ 保存・共有できました");
  run("window.QSeason = { decorate: (t) => t + ' 🎃' }; markShared();");
  assert.equal($el("sharedNote").textContent, "✓ 保存・共有できました 🎃");
  run("window.QSeason = { decorate() { throw new Error('x'); } }; markShared();");
  assert.equal($el("sharedNote").textContent, "✓ 保存・共有できました");
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

// 動画の共有はスマホの共有メニュー（navigator.share）で、おくるんを通らない。おくるんのマーク（is-oqrn）は付けない（Q の決まり F1）
test("動画の「保存・共有」は 📤 のまま、おくるんのマークは付けない", () => {
  const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  const src = fs.readFileSync(path.join(__dirname, "../js/record.js"), "utf8");
  assert.ok(!/is-oqrn/.test(html + src));
  assert.match(html, />📤 まとめて保存・共有</);
  assert.match(src, /textContent: "📤 保存・共有"/);
});

// ファイルの名前の決まり（q-oqrn/docs/structure.md）：入口は app.js、部品は js/ に役わりの名前。
// 前の名前（js/core.js・js/main.js）は、前の index.html を覚えているブラウザのために、新しいファイルを読むだけ
test("index.html は新しい名前のファイルを読み、前の名前のファイルは新しいファイルを読むだけ", () => {
  const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  const scripts = [...html.matchAll(/<script src="((?:js\/)?[a-z-]+\.js)\?v=(\d+)"/g)];
  assert.deepEqual(scripts.map((m) => m[1]), [...FILES, "app.js"]);
  const version = scripts[0][2];
  for (const [old, next] of [["js/core.js", ["js/page.js", "js/store.js"]], ["js/main.js", ["app.js"]]]) {
    const stub = fs.readFileSync(path.join(__dirname, "..", old), "utf8");
    const loads = [...stub.matchAll(/src="([^"?]+)\?v=(\d+)"/g)];
    assert.deepEqual(loads.map((m) => m[1]), next, old);
    assert.ok(loads.every((m) => m[2] === version), `${old} の ?v= が index.html とちがう`);
  }
});

test("つなぎ目の柄は時計で動く：入ってきておおい、おおったまま待ち、抜けきると消える", () => {
  const { run } = boot();
  run("rendering = true; piecePlan = { index: 0, count: 2, a: 0, b: 2 };");
  assert.equal(run("wipeProgress()"), null);
  run("wipe = { dir: 'in', from: performance.now() - 200, half: 0.4 };");
  const mid = run("wipeProgress()");
  assert.ok(mid > 0.2 && mid < 0.3, `入ってくる途中 ${mid}`);
  assert.equal(run("wipeCovered()"), false);
  run("wipe.from = performance.now() - 1000;");
  assert.equal(run("wipeProgress()"), 0.5); // おおいきったら、そこで止まる
  assert.equal(run("wipeCovered()"), true);
  run("wipe = { hold: true };");
  assert.equal(run("wipeProgress()"), 0.5);
  run("wipe = { dir: 'out', from: performance.now() - 200, half: 0.4 };");
  const out = run("wipeProgress()");
  assert.ok(out > 0.7 && out < 0.8, `抜けていく途中 ${out}`);
  run("wipe.from = performance.now() - 1000;");
  assert.equal(run("wipeProgress()"), null);
});

// 言葉の決まり（ux.md の G1）：画面の文は「〜してください」「お試しください」より「〜してね」
test("画面の文に「〜してください」「お試しください」を使わない", () => {
  const root = path.join(__dirname, "..");
  const files = ["index.html", "app.js", ...fs.readdirSync(path.join(root, "js")).map((f) => `js/${f}`)];
  const bad = [];
  for (const f of files) {
    fs.readFileSync(path.join(root, f), "utf8").split("\n").forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, "").replace(/<!--.*?-->/g, "");
      if (/してください|お試しください/.test(code)) bad.push(`${f}:${i + 1}`);
    });
  }
  assert.deepStrictEqual(bad, []);
});

test("⚡ ハイライトの範囲は、設定した何秒前〜何秒後で作る（近いものはつなぐ）", () => {
  const { run } = boot();
  assert.equal(JSON.stringify(run("highlightSpans([12, 100], 200)")), JSON.stringify([[2, 18], [90, 106]]));
  run("state.hlBefore = 5; state.hlAfter = 3;");
  assert.equal(JSON.stringify(run("highlightSpans([12, 100], 200)")), JSON.stringify([[7, 15], [95, 103]]));
});

test("結果の札：はじめはハイライトの最初だけ。全部にも・最後・なしを選べ、得点板を出さないときは入れない", () => {
  const { run } = boot();
  assert.equal(run("resultCardPlace('highlight')"), "start");
  assert.equal(run("resultCardPlace('full')"), null);
  run("state.resultOnFull = true; state.resultCard = 'end';");
  assert.equal(run("resultCardPlace('full')"), "end");
  run("state.board = false;");
  assert.equal(run("resultCardPlace('highlight')"), null);
  run("state.board = true; state.resultCard = 'none';");
  assert.equal(run("resultCardPlace('highlight')"), null);
});

test("何本目かの札：5分ごとに分けた各1本の最初の 2 秒に「2/3」。本数が分からないときは「2本目」、分けないときは出さない", () => {
  const { run } = boot();
  run("var texts = []; var ctx = new Proxy({ fillText: (t) => texts.push(t), measureText: () => ({ width: 100 }) }, { get: (o, k) => (k in o ? o[k] : () => {}), set: () => true });");
  run("pieceTotal = 3; clipNo = 2; clipStartedAt = performance.now(); drawPieceBadge(1280, 720, ctx);");
  assert.equal(run("texts.at(-1)"), "2/3");
  run("pieceTotal = -1; drawPieceBadge(1280, 720, ctx);");
  assert.equal(run("texts.at(-1)"), "2本目");
  run("texts = []; pieceTotal = 0; drawPieceBadge(1280, 720, ctx); pieceTotal = 3; clipStartedAt = performance.now() - 3000; drawPieceBadge(1280, 720, ctx);");
  assert.equal(run("texts.length"), 0);
});

test("🔗 つなぐ：5分をこえて切るところは、作り直さずに切れるキーフレームにそろえる", () => {
  const { run } = boot();
  // 4分55秒（295秒）ごと。1本目 100秒、2本目 400秒（キーフレームは 1秒ごと）
  run(`mergeItems.splice(0, mergeItems.length,
    { url: "a", duration: 100, keys: Array.from({ length: 100 }, (_, i) => i) },
    { url: "b", duration: 400, keys: Array.from({ length: 400 }, (_, i) => i) });`);
  // 途中で切らない：1本目だけで1本、5分をこえる2本目は 295秒のキーフレームで切る
  run(`mergeSplit = "video"`);
  const video = JSON.parse(run(`JSON.stringify(mergeParts().map((p) => p.map((x) => [x.src, x.a, x.b])))`));
  assert.deepEqual(video, [[["a", 0, 100]], [["b", 0, 295]], [["b", 295, 400]]]);
  assert.equal(run(`mergeParts().inexact`), false);
  // 5分ごとに切る：つないだ時間で 295秒ごと（1本目のあと 195秒入るところで2本目を切る）
  run(`mergeSplit = "time"`);
  const time = JSON.parse(run(`JSON.stringify(mergeParts().map((p) => p.map((x) => [x.src, x.a, x.b])))`));
  assert.deepEqual(time, [[["a", 0, 100], ["b", 0, 195]], [["b", 195, 400]]]);
  // キーフレームが分からない動画は、そのままでは切れない（流してつなぐ）
  run(`mergeItems[1].keys = null; mergeSplit = "video"`);
  assert.equal(run(`mergeParts().inexact`), true);
});

test("🔗 つなぐ：すぐつなげなかった印は、動画を並べかえ・足す・外すと消える（もう一度試す）", () => {
  const { run } = boot();
  run(`mergeQuickFailed = "badge"; mergeChanged();`);
  assert.equal(run("mergeQuickFailed"), null);
});
