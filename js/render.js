// ろくが：書き出し（撮った動画に（得点板をつける）・⚡ ハイライトで共通）と、撮るときの ⚡ ハイライト。
// 読み込む順は index.html（page → store → draw → setup → studio → record → editor → render → app.js）。
"use strict";

// ---- 書き出し（共通）・⚡ ハイライト ----
// ⚡ ハイライト：得点・⭐ ナイスプレーの何秒前から何秒後までを入れるか。はじめは 10・6（state.hlBefore・hlAfter。「💾 保存の設定」で 1〜30 秒）
const HIGHLIGHT_DEFAULT = { before: 10, after: 6 };
// 時間（秒）のならびから、ハイライトに入れるところ [はじめ, 終わり] のならびを作る。近いものはひとつにつなぐ
function highlightSpans(times, end) {
  const spans = [];
  [...times]
    .sort((a, b) => a - b)
    .forEach((t) => {
      const a = Math.max(0, t - state.hlBefore);
      const b = Math.min(end, t + state.hlAfter);
      const last = spans[spans.length - 1];
      if (last && a <= last[1]) last[1] = Math.max(last[1], b);
      else spans.push([a, b]);
    });
  return spans;
}

// ⚡ ハイライトに入れる長さの − ＋（[data-hl-range] の欄ごと：はじめの画面の「💾 保存の設定」・保存の画面・撮った動画に）。
// 変えたら、長さの目安・作るボタンも出しなおす
function renderHighlightRange() {
  document.querySelectorAll("[data-hl-range]").forEach((box) => {
    const title = Object.assign(document.createElement("span"), { className: "split-label", textContent: "⚡ ハイライトに入れる長さ（得点・⭐ を押した時間から）" });
    // [−] 10秒前 [＋] の1組を作る
    const stepper = (key, word) => {
      const wrap = Object.assign(document.createElement("div"), { className: "hl-step" });
      const btn = (text, delta, label) => {
        const b = Object.assign(document.createElement("button"), { type: "button", textContent: text });
        b.setAttribute("aria-label", label);
        b.disabled = delta < 0 ? state[key] <= 1 : state[key] >= 30;
        b.addEventListener("click", () => {
          state[key] = Math.min(30, Math.max(1, state[key] + delta));
          save();
          renderHighlightRange();
          showHighlightSetting();
        });
        return b;
      };
      const value = Object.assign(document.createElement("b"), { textContent: `${state[key]}秒${word}` });
      wrap.append(btn("−", -1, `1秒へらす（${word}）`), value, btn("＋", 1, `1秒ふやす（${word}）`));
      return wrap;
    };
    const row = Object.assign(document.createElement("div"), { className: "hl-steps" });
    row.append(stepper("hlBefore", "前"), Object.assign(document.createElement("span"), { textContent: "〜" }), stepper("hlAfter", "後"));
    box.replaceChildren(title, row);
  });
}
// 長さを変えたら、それを使うところを出しなおす（保存の画面の「⚡ 得点ハイライトを作る（約 ◯:◯◯）」・撮った動画にの長さの目安・はじめの画面の小さな字）
function showHighlightSetting() {
  if (!$("saveSheet").hidden) showHighlightButton();
  if (!$("editor").hidden) showExportRange();
  showSplitSetting();
}

// 書き出す（共通）：pieces＝[{ src: 動画の URL, a: はじめの秒, b: 終わりの秒 }] を順に流して、canvas の絵と動画の音を1本に録る。
// あいだを飛ばすときは録画を一時停止してつなぐ。流した時間だけかかる
// result：結果の札に出すスコア { us, them }（入れるかどうか・どこには「💾 保存の設定」で決まる。resultCardPlace）
// split・label：5分ごとに分けるか・動画の一覧に出す名前（LINE で送る用の書き出し。なければ「💾 保存の設定」のとおり）
async function renderPieces(pieces, { overlay, kind, title, result, split, label }) {
  if (!window.MediaRecorder || !editScreen.captureStream) {
    notice("この端末のブラウザでは書き出せません");
    return;
  }
  if (!pieces.length) return;
  ensureAudio();
  await audioCtx?.resume().catch(() => {});
  editVideo.pause();
  editVideo.playbackRate = 1;
  exporting = true;
  rendering = true;
  renderOverlay = overlay;
  $("exportTitle").textContent = title;
  startExportWait();
  $("exportOverlay").hidden = false;
  $("editor").classList.add("is-exporting"); // 動画の枠を赤く（録画中と同じ）
  if ($("editor").hidden) requestAnimationFrame(drawEditFrame); // 撮った動画にの画面では、もう描きつづけている
  await keepScreenOn();
  const total = pieces.reduce((sum, p) => sum + (p.b - p.a), 0);
  let done = 0;
  let started = false;
  wipe = null;
  // 結果の札。LINE で送る用（cut）は、元の動画の最後にもう札が入っていることがあるので、最初（サムネ）だけ
  const place = result ? resultCardPlace(kind === "highlight" ? "highlight" : "full") : null;
  const cardAt = kind === "cut" ? (place === "start" ? "start" : null) : place;
  // 何本目かの札：5分ごとに分けるとき。1つの部分を流すだけなら本数が前もって分かるので「全◯本」も（場面のあいだで一時停止すると区切りがずれるので、そのときは「◯本目」だけ）
  const splitting = split === undefined ? state.split : split;
  const length = pieces.reduce((sum, p) => sum + (p.b - p.a), 0) + (cardAt ? RESULT_CARD_MS / 1000 : 0);
  const count = Math.ceil(length / (SEGMENT_MS / 1000) - 0.01);
  pieceTotal = !splitting || count < 2 ? 0 : pieces.length === 1 ? count : -1;
  for (const [index, { src, a, b }] of pieces.entries()) {
    if (!exporting) break;
    // つなぎ目の柄：次の部分があるときは終わりに入れ、前の部分があるときははじめに抜く（editor.js の wipe）
    const hasNext = index < pieces.length - 1;
    const half = Math.min(TRANSITION_SEC / 2, (b - a) / 2);
    if (editVideo.src !== src && !(await loadVideo(src))) continue; // 読めない動画は飛ばす
    await seekTo(a);
    if (pieces.length > 1) warmTransition(editVideo.videoWidth, editVideo.videoHeight); // 柄の絵を先に作っておく（はじめのつなぎ目で止まらない）
    editLastT = a;
    goalFx = null;
    if (!started) {
      frameSync = canSyncFrames(); // 動画のコマごとに描いて録る（カクつかない）。使えないブラウザはこれまでどおり
      if (!beginRecording(editScreen, audioDest ? audioDest.stream.getAudioTracks() : [], kind, { manualFrames: frameSync, ...(split === undefined ? {} : { split }), label })) {
        finishExport();
        notice("書き出しを始められませんでした", "この端末のブラウザでは書き出せないようです。ほかのブラウザ（Safari・Chrome）で開いてね。");
        return;
      }
      if (frameSync) {
        // 録りはじめにすぐ1コマ（最初のコマが出るまで録画に何も来ないと、重い動画で録画がうまく始まらないことがある）
        paintEditFrame();
        pushFrame();
        startFrameSync();
      }
      started = true;
      if (cardAt === "start") await recordCard(result); // 最初に結果の札（LINE などのサムネに結果が出る）
    } else if (recorder?.state === "paused") {
      recorder.resume();
    }
    await editVideo.play().catch(() => {});
    // つなぎ目のあと：柄で画面をおおったまま、動画が流れはじめるのを待ってから、柄を抜けさせる（頭出し直後のかくつきを柄の下に隠す）
    if (wipe?.hold) {
      await firstFrame();
      wipe = { dir: "out", from: performance.now(), half };
    }
    await new Promise((resolve) => {
      const iv = setInterval(() => {
        const t = editVideo.currentTime;
        const now = done + Math.max(0, t - a);
        $("exportProg").textContent = `${clock(Math.floor(now))} / ${clock(Math.ceil(total))}　のこり 約 ${clock(Math.max(0, Math.ceil(total - now)))}`;
        $("exportBar").style.width = `${Math.min(100, (now / total) * 100)}%`;
        drawExportPeek();
        // 次の部分があるときは、終わりの half 秒で柄を入れはじめ、おおいきったら次へ
        if (hasNext && wipe?.dir !== "in" && t >= b - half) wipe = { dir: "in", from: performance.now(), half };
        if (!exporting || (hasNext ? wipeCovered() : t >= b - 0.05) || editVideo.ended) {
          clearInterval(iv);
          resolve();
        }
      }, 50);
    });
    editVideo.pause();
    if (hasNext) {
      // おおいきった絵を1コマ録ってから止める（次の部分は、この絵から始まる）
      wipe = { hold: true };
      paintEditFrame();
      pushFrame();
    }
    if (recorder?.state === "recording") recorder.pause();
    done += b - a;
  }
  // 最後に結果の札
  if (exporting && started && cardAt === "end") {
    if (recorder?.state === "paused") recorder.resume();
    await recordCard(result);
  }
  // 最後まで書き出せたら記録（やめたとき・1本も書き出せなかったときは数えない）：edit＝撮った動画に・highlight＝⚡ ハイライト。数は秒
  if (exporting && started) logUse(kind === "highlight" ? "highlight" : "export", Math.round(total));
  finishExport();
}

// 結果の札を 2 秒録る（そのあいだは drawEditFrame が札を描いて録る）
async function recordCard(score) {
  resultCard = score;
  paintEditFrame();
  pushFrame();
  await new Promise((resolve) => setTimeout(resolve, RESULT_CARD_MS));
  resultCard = null;
}

// 再生をはじめた動画の、はじめのコマが出るまで待つ（出ないときも 0.5 秒で先へ。待てないブラウザは 0.15 秒）
const firstFrame = () =>
  new Promise((resolve) => {
    const can = typeof editVideo.requestVideoFrameCallback === "function";
    const timer = setTimeout(resolve, can ? 500 : 150);
    if (!can) return;
    editVideo.requestVideoFrameCallback(() => {
      clearTimeout(timer);
      resolve();
    });
  });

// 動画の枠に src を入れて、読めたら true（読めなければ false。待ちつづけない）
const loadVideo = (src) =>
  new Promise((resolve) => {
    // 読めた（true）・読めなかった（false）ときに呼ぶ関数を作る。待つのをやめて結果を返す
    const done = (ok) => () => {
      editVideo.removeEventListener("loadeddata", onLoad);
      editVideo.removeEventListener("error", onError);
      resolve(ok);
    };
    const onLoad = done(true);
    const onError = done(false);
    editVideo.addEventListener("loadeddata", onLoad, { once: true });
    editVideo.addEventListener("error", onError, { once: true });
    editVideo.src = src;
  });

// 撮った動画に（得点板をつける）：選んだ範囲を、得点板つきで書き出す（終わったら保存の画面は「閉じる」だけ）
async function exportVideo() {
  if (!Number.isFinite(editVideo.duration) || !editVideo.duration) return notice("動画の長さが分かりません", "少し待ってから、もう一度押してね。");
  const pieces = exportSegments().map(([a, b]) => ({ src: editVideo.src, a, b }));
  if (!pieces.length) return;
  exportMode = true;
  const highlight = exportRange === "goals"; // ⚡ ハイライト：保存の画面でも「⚡ ハイライト」として並ぶ
  await renderPieces(pieces, {
    overlay: true,
    kind: highlight ? "highlight" : "edit",
    title: highlight ? "⚡ ハイライトを作っています…" : "書き出し中…",
    result: scoreAt(editVideo.duration) // 結果の札：入れた点の最後のスコア
  });
}

// ⚡ ハイライト（撮るとき）：撮っているあいだに ＋1・⭐ を押した時間の前後を、録った動画（5分ごとの何本か）から切り出してつなぐ。
// 近いものはひとつにまとめる（highlightSpans）。録った動画が分かれているところは、それぞれの動画から続けて切り出す
function highlightPieces() {
  const pieces = [];
  const takes = [...new Set(liveGoals.map((g) => g.take))].sort((a, b) => a - b);
  takes.forEach((t) => {
    const own = clips.filter((c) => c.take === t && c.kind === "shot" && c.url).sort((a, b) => a.fromExact - b.fromExact);
    if (!own.length) return;
    const end = own[own.length - 1].toExact;
    highlightSpans(liveGoals.filter((g) => g.take === t).map((g) => g.t), end).forEach(([a, b]) =>
      own.forEach((c) => {
        const from = Math.max(a, c.fromExact);
        const to = Math.min(b, c.toExact);
        if (to - from > 0.3) pieces.push({ src: c.url, a: from - c.fromExact, b: to - c.fromExact });
      })
    );
  });
  return pieces;
}
// 保存の画面の「⚡ 得点ハイライトを作る」を、作れる長さがあるときだけ、長さの目安つきで出す
function showHighlightButton() {
  const total = highlightPieces().reduce((sum, p) => sum + (p.b - p.a), 0);
  $("makeHighlight").hidden = !total;
  document.querySelector('[data-transition-row][data-for="makeHighlight"]').hidden = !total;
  document.querySelector('[data-hl-range][data-for="makeHighlight"]').hidden = !total; // 入れる長さ（作る前に変えられる）
  if (total) $("makeHighlight").textContent = `⚡ 得点ハイライトを作る（約 ${clock(Math.ceil(total))}）`;
}
$("makeHighlight").addEventListener("click", () => {
  const pieces = highlightPieces();
  if (!pieces.length) return;
  $("saveSheet").hidden = true;
  $("playback").pause();
  // 結果の札：いちばんあとに撮った回の、止めたときのスコア
  const lastTake = Math.max(...liveGoals.map((g) => g.take));
  renderPieces(pieces, { overlay: false, kind: "highlight", title: "⚡ ハイライトを作っています…", result: takeEnd[lastTake] || { us: state.us, them: state.them } });
});

// ---- LINE で送る用（5分まで）：5分をこえる1本ができたとき、最初の5分・5分ごと・最後の5分を、あとから書き出す ----
const CUT_SEC = SEGMENT_MS / 1000; // LINE の5分に少し余裕をもたせて 4分55秒（5分ごとに分けるときと同じ。確かめるときは ?segment=秒）
// 切り出せる動画：ハイライト・切り出したものを除いた、いちばん新しい回が、5分をこえる1本だけのとき（1つ切り出したあとも、続けてほかも作れる）
function cutSource() {
  const own = clips.filter((c) => c.kind !== "highlight" && c.kind !== "cut");
  if (!own.length) return null;
  const last = Math.max(...own.map((c) => c.take));
  const same = own.filter((c) => c.take === last);
  const c = same.length === 1 ? same[0] : null;
  return c && c.url && c.toExact - c.fromExact > CUT_SEC + 5 ? c : null;
}
// 保存の画面の「LINE で送る用（5分まで）」を、切り出せるときだけ出す
function showCutRow() {
  $("cutRow").hidden = !cutSource();
}
const CUT_LABELS = { first: "最初の5分", split: "5分ごと", last: "最後の5分" };
document.querySelectorAll("[data-cut]").forEach((b) =>
  b.addEventListener("click", () => {
    const c = cutSource();
    if (!c) return;
    const d = c.toExact - c.fromExact;
    const mode = b.dataset.cut;
    const pieces =
      mode === "first" ? [{ src: c.url, a: 0, b: CUT_SEC }] : mode === "last" ? [{ src: c.url, a: d - CUT_SEC, b: d }] : [{ src: c.url, a: 0, b: d }];
    $("saveSheet").hidden = true;
    $("playback").pause();
    // 結果の札（最初に入れるとき）：撮った回なら止めたときのスコア、撮った動画にの書き出しなら入れた点の最後
    const result = c.kind === "shot" ? takeEnd[c.take] || { us: state.us, them: state.them } : { us: state.us, them: state.them };
    renderPieces(pieces, { overlay: false, kind: "cut", title: `✂️ ${CUT_LABELS[mode]}を書き出しています…`, result, split: mode === "split", label: CUT_LABELS[mode] });
  })
);

// ---- 書き出し中の画面：動き（しま模様のバー・書き出しているところ）とプチ情報、画面を離れないように ----
const EXPORT_TIPS = [
  "⚡ ハイライトに入れる長さ（何秒前〜何秒後）は、💾 保存の設定で変えられます",
  "🎉 得点のエフェクトは、アイコンと文字を変えられます（サッカー以外でも）",
  "💾 保存の設定で、LINE で送れるよう 5分ずつに分けることもできます",
  "🔒 動画はこの端末の中だけで使います。どこにも送りません",
  "⚽ チーム名と色は、さくせん盤と共通です",
  "🎞 撮っておいた動画にも、あとから得点板をつけられます",
  "↺ 速く流して点を通りすぎたら「10秒」でもどれます",
  "⇄ 後半にコートが変わったら、左右を入れかえられます",
  "🎬 ハイライトのつなぎ目には RoQga の柄が入ります（「なし」にもできます）"
];
let tipTimer = 0;
let tipIndex = Math.floor(Math.random() * EXPORT_TIPS.length);
let awayWhileExporting = false;
// 書き出し中のプチ情報を、次のものにふわっと入れかえる
function showTip() {
  const el = $("exportTip");
  el.classList.remove("is-in");
  void el.offsetWidth; // 入れかわるたびに、ふわっと出す
  el.textContent = `💡 ${EXPORT_TIPS[tipIndex % EXPORT_TIPS.length]}`;
  el.classList.add("is-in");
  tipIndex++;
}
// 書き出し中の画面（進みぐあい・プチ情報・書き出しているところの小さな映像）を出しはじめる
function startExportWait() {
  awayWhileExporting = false;
  $("exportAway").hidden = true;
  $("exportBar").style.width = "0%";
  $("exportProg").textContent = "";
  // 保存の画面から作るときは、撮った動画にの画面（動画）が見えないので、書き出しているところを小さく映す
  $("exportPeek").hidden = !$("editor").hidden;
  showTip();
  clearInterval(tipTimer);
  tipTimer = setInterval(showTip, 6000);
}
// 保存の画面から書き出しているとき、書き出しているところを小さな枠に写す
function drawExportPeek() {
  const peek = $("exportPeek");
  if (peek.hidden || !editScreen.width) return;
  const h = Math.round((peek.width * editScreen.height) / editScreen.width);
  if (peek.height !== h) peek.height = h;
  peek.getContext("2d").drawImage(editScreen, 0, 0, peek.width, h);
}
// 書き出し中に画面を離れたら、もどったときに知らせる
document.addEventListener("visibilitychange", () => {
  if (!exporting) return;
  if (document.visibilityState === "hidden") awayWhileExporting = true;
  else if (awayWhileExporting) $("exportAway").hidden = false;
});
// 書き出し中・録画中・まだ保存していない動画があるときに、ページを閉じる・更新する・戻ろうとしたら、ブラウザの確かめる画面を出す
// （動画はページの中にしかないので、閉じると消える。iPhone の Safari では出ないこともある）
window.addEventListener("beforeunload", (e) => {
  if (!exporting && !recording && !clips.some((c) => !c.saved)) return;
  e.preventDefault();
  e.returnValue = "";
});

// 書き出しを終える（やめたときも）。画面をもどし、そこまでの動画を保存の画面に出す
function finishExport() {
  $("editor").classList.remove("is-exporting");
  wipe = null;
  resultCard = null;
  pieceTotal = 0;
  frameSync = false;
  clearInterval(tipTimer);
  if (!exporting) return;
  exporting = false;
  rendering = false;
  renderOverlay = true;
  editVideo.pause();
  editVideo.playbackRate = editRate;
  $("exportOverlay").hidden = true;
  wakeLock?.release?.().catch(() => {});
  wakeLock = null;
  // やめたときも、そこまでの動画は保存の画面に出す（撮るときと同じ）
  stopRecording();
}
$("editExport").addEventListener("click", async () => {
  if (!editEvents.length && !(await LineShareUI.ask({ title: "まだ得点を入れていません", text: "はじめのスコアのまま書き出しますか？", ok: "書き出す" }))) return;
  exportVideo();
});
$("exportCancel").addEventListener("click", () => finishExport());
$("back").addEventListener("click", closeCamera);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && cameraStream && !wakeLock) keepScreenOn();
});
