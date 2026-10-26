// ろくが：撮った動画に（得点板をつける）（撮っておいた動画に、得点の時間を入れる）。
// 読み込む順は index.html（page → store → draw → setup → studio → record → editor → render → app.js）。
"use strict";

// ---- 撮った動画に（得点板をつける）：撮っておいた動画に、得点板を付けて書き出す ----
// 動画を流しながら ＋1／−1 を押すと、その時間を覚える（events）。得点板はその時間までの点を出す。
// 書き出しは、動画を最初から流して、得点板つきの canvas と動画の音を録る（5分ごとに分ける・保存の画面は撮るときと同じ）
const editVideo = $("editVideo");
const editScreen = $("editScreen");
const editCtx = editScreen.getContext("2d");
let editEvents = []; // [{ t: 秒, key: "us"|"them", delta: 1|-1 }]
let editBase = { us: 0, them: 0 }; // はじめのスコア（はじめの画面のスコア）
let editLastT = 0;
let editUrl = "";
let exporting = false;
let exportMode = false; // 書き出しの録画が終わったら、保存の画面を「閉じるだけ」にする
let audioCtx = null;
let audioDest = null;
let editRate = state.editRate; // 得点を入れるときの再生の速さ（端末に覚えておく。書き出しはいつも 1×）
let exportRange = "all"; // 書き出す範囲：all（全部）／goals（⚡ ハイライト＝得点・⭐ の前後だけ）
let modeChosen = true; // 新しく選んだ動画で、点の入れ方（見ながら記録／じっくり記録）を選んだか
let quick = false; // 見ながら記録のあいだ

$("pickVideo").addEventListener("click", () => $("videoFile").click());
$("videoFile").addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  e.target.value = ""; // 同じ動画をもう一度選べるように
  if (file) {
    logUse("pick-video"); // 🎞 撮った動画にを使った
    openEditor(file);
  }
});

// 撮った動画にの画面で、選んだ動画を開く（入れた得点は消して、はじめのスコアから）
async function openEditor(file) {
  // さっきの動画に点を入れていたら、別の動画にする前に確かめる（さっきの点は消える）
  if (editUrl && editEvents.length && !(await LineShareUI.ask({ title: "別の動画にしますか？", text: `さっきの動画に入れた得点（${editEvents.length}件）は消えます。`, ok: "別の動画にする", danger: true }))) return;
  if (editUrl) URL.revokeObjectURL(editUrl);
  editUrl = URL.createObjectURL(file);
  editVideo.src = editUrl;
  editVideo.load();
  editEvents = [];
  exportRange = "all";
  // 見る速さは、前に選んだまま（load で 1× にもどるので、そのあとで入れる）
  editVideo.playbackRate = editRate;
  $("editRate").value = String(editRate);
  showRate();
  editBase = { us: state.us, them: state.them };
  editLastT = 0;
  modeChosen = false; // まず点の入れ方を選ぶ
  goalFx = null;
  renderEditScore();
  renderEditEvents();
  showEditor();
}

// 撮った動画にの画面を出す（はじめて開くときも、さっきの動画にもどるときも）
function showEditor() {
  // 撮る画面の ⚡ ハイライトを作ると、この動画の枠に録った動画を入れているので、さっきの動画にもどす
  if (editUrl && editVideo.src !== editUrl) editVideo.src = editUrl;
  // 見る速さは、前に選んだまま（動画を入れかえると 1× にもどるため、開くたびに入れる）
  editVideo.playbackRate = editRate;
  $("editRate").value = String(editRate);
  showRate();
  renderEditScore(); // チーム名・色は、はじめの画面で変えているかもしれない
  renderEditEvents();
  $("editFxBody").append($("fxControls")); // エフェクトの設定を、この画面の「🎉 得点のエフェクト」へ
  showModePick();
  $("setup").hidden = true;
  $("editor").hidden = false;
  requestAnimationFrame(drawEditFrame);
}

// 「← 戻る」：選んだ動画と入れた点は消さずに残す（まちがえて押しても、はじめの画面の「🎞 さっきの動画にもどる」で続きから）
function closeEditor() {
  if (exporting) return;
  document.activeElement?.blur?.();
  editVideo.pause();
  $("previewFold").querySelector(".ls-fold-body").append($("fxControls")); // エフェクトの設定を、はじめの画面へもどす
  $("editor").hidden = true;
  $("setup").hidden = false;
  // 得点板に出していた点を、はじめのスコアにもどす
  state.us = editBase.us;
  state.them = editBase.them;
  save();
  showSetupScore();
  showOpenSaved();
  showResume();
  drawPreview();
}
$("editBack").addEventListener("click", closeEditor);

// はじめの画面の「🎞 さっきの動画にもどる」：撮った動画にのタブで、さっきの動画があるときだけ
function showResume() {
  const later = document.querySelector('[data-mode="later"]')?.getAttribute("aria-selected") === "true";
  $("resumeEdit").hidden = !(editUrl && later);
  $("resumeEdit").textContent = editEvents.length ? `🎞 さっきの動画にもどる（得点 ${editEvents.length}件）` : "🎞 さっきの動画にもどる";
}
$("resumeEdit").addEventListener("click", showEditor);

// ---- キーボードが出たとき（チーム名・エフェクトの文字を入れるとき）：画面の高さを見えているところに合わせ、動画を小さくする ----
// iPhone はキーボードが出ると見える高さが縮むが、この画面（position: fixed・高さ 100dvh）はそのままで、ずれて崩れるため
const editorEl = $("editor");
// キーボードが出ているあいだ、撮った動画にの画面の高さを見えているところに合わせる
function fitEditorToViewport() {
  const vv = window.visualViewport;
  if (!vv || editorEl.hidden) return;
  const typing = editorEl.classList.contains("is-typing");
  editorEl.style.height = typing ? `${vv.height}px` : "";
  editorEl.style.top = typing ? `${vv.offsetTop}px` : "";
}
editorEl.addEventListener("focusin", (e) => {
  if (!e.target.matches("input:not([type=range]):not([type=color])")) return;
  editorEl.classList.add("is-typing");
  fitEditorToViewport();
  setTimeout(() => e.target.scrollIntoView({ block: "center", behavior: "smooth" }), 300); // キーボードが出きってから
});
editorEl.addEventListener("focusout", () => {
  setTimeout(() => {
    if (editorEl.contains(document.activeElement) && document.activeElement.matches("input:not([type=range]):not([type=color])")) return;
    editorEl.classList.remove("is-typing");
    fitEditorToViewport();
  }, 100);
});
window.visualViewport?.addEventListener("resize", fitEditorToViewport);
window.visualViewport?.addEventListener("scroll", fitEditorToViewport);

// 点を1つ動かす（0 より下にはしない）
const applyEvent = (score, ev) => {
  if (!ev.mark) score[ev.key] = Math.max(0, score[ev.key] + ev.delta);
  return score;
};
// その時間までの点
const scoreAt = (t) => editEvents.filter((ev) => ev.t <= t).reduce(applyEvent, { ...editBase });
// 一覧の1行ずつの「そのあとのスコア」（同じ時間に続けて押しても、押した順に1つずつ）
function scoresAfterEvents() {
  const score = { ...editBase };
  return editEvents.map((ev) => ({ ...applyEvent(score, ev) }));
}

let rendering = false; // 書き出し中（撮った動画に（得点板をつける）・得点ハイライト）
let renderOverlay = true; // 得点板・GOAL を描くか（得点ハイライトは、動画にもう入っているので描かない）

// 毎コマ描く（撮った動画にの画面・書き出し）。書き出しで frameSync のときは、動画のコマごとに paintEditFrame を呼ぶ（下の startFrameSync）
function drawEditFrame() {
  if ($("editor").hidden && !rendering) return;
  if (!(rendering && frameSync)) {
    paintEditFrame();
  } else if (resultCard || wipeProgress() !== null || (!editVideo.paused && performance.now() - lastSyncFrameAt > 200)) {
    // つなぎ目の柄が出ているあいだは、動画のコマを待たずに画面の描き直しごとに描いて録る（柄が時計どおりになめらかに動く）。
    // 安全策：動画のコマの合図が 0.2 秒来ないときも、ここで描いて録る（何も録れないことがないように）
    paintEditFrame();
    pushFrame();
  }
  requestAnimationFrame(drawEditFrame);
}

// 1コマ描く：動画の絵 ＋ その時間の得点板 ＋（点が入った時間を通ったら）GOAL のエフェクト ＋ つなぎ目の柄。t は動画の時間
function paintEditFrame(t = editVideo.currentTime) {
  const vw = editVideo.videoWidth;
  const vh = editVideo.videoHeight;
  if (!vw || !vh) return;
  if (editScreen.width !== vw || editScreen.height !== vh) {
    editScreen.width = vw;
    editScreen.height = vh;
  }
  // 結果の札を出しているあいだは、札だけ（書き出しの最初か最後の 2 秒）
  if (rendering && resultCard) {
    drawResultCard(vw, vh, editCtx, resultCard);
    return drawPieceBadge(vw, vh, editCtx); // 1本目の最初が札のときも「1本目」
  }
  if (!renderOverlay) {
    editCtx.drawImage(editVideo, 0, 0, vw, vh);
    drawPieceTransition(vw, vh);
    if (rendering) drawPieceBadge(vw, vh, editCtx);
    return;
  }
  const score = scoreAt(t);
  state.us = score.us;
  state.them = score.them;
  if (state.goalFx && t > editLastT && t - editLastT < 1) {
    const passed = editEvents.find((ev) => ev.delta > 0 && !ev.mark && ev.t > editLastT && ev.t <= t);
    if (passed) goalFx = { side: passed.key, at: performance.now() };
  }
  // ⭐ ナイスの時間を通ったら、⭐ ナイスのエフェクト
  if (state.niceFx && t > editLastT && t - editLastT < 1 && editEvents.some((ev) => ev.mark && ev.t > editLastT && ev.t <= t)) niceFx = { at: performance.now() };
  editLastT = t;
  editCtx.drawImage(editVideo, 0, 0, vw, vh);
  drawScoreboard(vw, vh, editCtx); // 「得点板：出さない」のときは描かない（draw.js）
  drawGoalFx(vw, vh, editCtx);
  drawNiceFx(vw, vh, editCtx);
  drawPieceTransition(vw, vh);
  if (rendering) drawPieceBadge(vw, vh, editCtx);
}

// ---- 書き出しのカクつきをなくす：動画の1コマが出るたびに描いて、その1コマを録る ----
// これまでは画面の描き直し（60回／秒）で描いて 30コマ／秒で録っていたので、同じコマが2回入ったり1コマ抜けたりした。
// requestVideoFrameCallback（動画のコマが出たとき）と、canvas の録画を「描いたときだけ1コマ」（captureStream(0)＋requestFrame）にする。
// どちらかが使えない古いブラウザでは、これまでどおり（frameSync は false）。
// Mac の Chromium で、60コマ／秒の動画が 26コマ前後のばらばらな間隔 → ほぼ 60コマのままになった。iPhone の Safari でもなめらか（2026-10-22）。
// URL に ?framesync=0 を付けると、どのブラウザでも元のやり方（何かあったときの逃げ道）
let frameSync = false;
let lastSyncFrameAt = 0; // 動画のコマの合図が最後に来た時刻（来ないときは drawEditFrame で描いて録る）
const FRAME_SYNC_ON = new URLSearchParams(location.search).get("framesync") !== "0";
// 動画のコマごとに描いて録れるブラウザか（requestVideoFrameCallback と requestFrame があるか）を返す
const canSyncFrames = () =>
  FRAME_SYNC_ON &&
  typeof HTMLVideoElement !== "undefined" &&
  typeof HTMLVideoElement.prototype.requestVideoFrameCallback === "function" &&
  typeof window.CanvasCaptureMediaStreamTrack === "function" &&
  "requestFrame" in window.CanvasCaptureMediaStreamTrack.prototype;
// 書き出し中、動画のコマが出るたびに1コマ描いて録る
function startFrameSync() {
  // 動画のコマが出たときに呼ばれる。そのコマを描いて録り、次のコマを待つ
  const onFrame = (now, meta) => {
    if (!rendering || !frameSync) return;
    lastSyncFrameAt = performance.now();
    // つなぎ目の柄が出ているあいだは drawEditFrame が描いて録る（ここでも録ると、コマの間隔がばらつく）
    if (wipeProgress() === null) {
      paintEditFrame(meta.mediaTime);
      pushFrame();
    }
    editVideo.requestVideoFrameCallback(onFrame);
  };
  editVideo.requestVideoFrameCallback(onFrame);
}

// ⚡ ハイライトの書き出し中：つなぎ目の前後に柄（draw.js の drawTransition）。
// いま出ている柄の動き（render.js の renderPieces が、切り出した部分が2つ以上のときだけ入れる）。null（出ていない）・{ hold: true }（画面をおおったまま）・
// { dir: "in"（入ってくる）か "out"（抜けていく）, from: 始めた時刻, half: 秒 }。
// 柄は動画の時間ではなく時計で動かす（動画のコマは、次の部分の頭出しの直後などに間があいたり詰まったりして、柄がかくつくため）
let wipe = null;
// 柄の進みぐあい p（0〜1。0.5 で画面をおおう）を返す。出ていなければ null
function wipeProgress() {
  if (!rendering || !wipe) return null;
  if (wipe.hold) return 0.5;
  const k = Math.min(1, (performance.now() - wipe.from) / (wipe.half * 1000));
  if (wipe.dir === "out" && k >= 1) return null; // 抜けきった
  return wipe.dir === "in" ? k * 0.5 : 0.5 + k * 0.5;
}
// 入ってくる柄が画面をおおいきったら true（その部分を終えてよい）
const wipeCovered = () => Boolean(wipe && (wipe.hold || (wipe.dir === "in" && performance.now() - wipe.from >= wipe.half * 1000)));
// ⚡ ハイライトの書き出し中、つなぎ目の柄を重ねる
function drawPieceTransition(w, h) {
  const p = wipeProgress();
  if (p !== null) drawTransition(w, h, editCtx, p);
}

// 再生・止める・動画の位置
const showEditTime = () => {
  const d = Number.isFinite(editVideo.duration) ? editVideo.duration : 0;
  $("editTime").textContent = `${clock(Math.floor(editVideo.currentTime))} / ${clock(Math.floor(d))}`;
  $("editSeek").value = d ? String(Math.round((editVideo.currentTime / d) * 1000)) : "0";
  $("editPlay").textContent = editVideo.paused ? "▶" : "⏸";
  $("editPlay").setAttribute("aria-label", editVideo.paused ? "再生" : "止める");
};
["timeupdate", "loadedmetadata", "play", "pause", "seeked"].forEach((type) => editVideo.addEventListener(type, showEditTime));
// 動画の縦横比を、動画の枠の大きさに使う（枠は縮まず、動画は枠の中にまるごと入る）
editVideo.addEventListener("loadedmetadata", () => {
  if (!editVideo.videoWidth || !editVideo.videoHeight) return;
  $("editor").style.setProperty("--ar", `${editVideo.videoWidth} / ${editVideo.videoHeight}`);
  $("editor").style.setProperty("--arn", String(editVideo.videoWidth / editVideo.videoHeight)); // 枠の高さに上限があるとき、横幅を縦横比から計算する（style.css）
});
// ブラウザで録った webm（Android のろくがの動画など）は長さが入っていない（Infinity）ことがある。
// いちど最後まで飛ばすと長さが分かるので、分かったら最初にもどす
editVideo.addEventListener("loadedmetadata", () => {
  if (editVideo.duration !== Infinity) return;
  editVideo.addEventListener(
    "durationchange",
    () => {
      editVideo.currentTime = 0;
      editLastT = 0;
    },
    { once: true }
  );
  editVideo.currentTime = 1e101;
});
$("editPlay").addEventListener("click", () => {
  if (quick) return toggleQuickPause(); // 見ながら記録：一時停止すると録画も止まる
  editVideo.paused ? editVideo.play().catch(() => {}) : editVideo.pause();
});
// 速さ：0.5×〜4× を少しずつ（点の場面を探すとき速く、見きわめるとき遅く）
const showRate = () => ($("editRateLabel").textContent = `${editRate}×`);
$("editRate").addEventListener("input", (e) => {
  editRate = Number(e.target.value);
  editVideo.playbackRate = editRate;
  state.editRate = editRate; // 次に開いたとき・別の動画にしたときも、この速さ
  save();
  showRate();
});
// 10秒もどる・進む（速く流して得点を通りすぎたとき）。動かしただけでは GOAL を出さない
document.querySelectorAll("[data-jump]").forEach((b) =>
  b.addEventListener("click", () => jumpBy(Number(b.dataset.jump)))
);
// PC：再生の操作（再生・位置・時間、10秒・速さ、ショートカットの案内）を動画のすぐ下へ。スマホ・タブレットでは操作の欄の中
// （この条件は style.css の「PC など、横も高さもある画面」と同じ）
const wideEditor = window.matchMedia("(min-width: 900px) and (min-height: 561px)");
// 再生の操作の置き場所を、PC は動画のすぐ下、スマホ・タブレットは操作の欄の中にする
function placeTransport() {
  const transport = $("editTransport");
  if (wideEditor.matches) $("editor").querySelector(".editor-stage").after(transport);
  else $("editor").querySelector(".editor-side").prepend(transport);
}
wideEditor.addEventListener("change", placeTransport);
placeTransport();

// PC のショートカット（文字を入れているとき・書き出し中は使わない）
//   Space：再生・止める　← →：10秒（Shift で2秒）　↑ ↓：速さ
//   1・2：左・右のチームに ＋1（得点板なしのときは 1 で GOAL）　Shift＋数字：−1　N：⭐ ナイス
function jumpBy(sec) {
  const d = Number.isFinite(editVideo.duration) ? editVideo.duration : 0;
  editVideo.currentTime = Math.max(0, Math.min(d || Infinity, editVideo.currentTime + sec));
  editLastT = editVideo.currentTime; // 動かしただけでは GOAL を出さない
}
// ショートカットのキーで、ボタンを押したことにして光らせる
function pressByKey(button) {
  if (!button) return;
  button.click();
  flash(button, "is-key");
}
document.addEventListener("keydown", (e) => {
  if (editorEl.hidden || exporting || e.metaKey || e.ctrlKey || e.altKey || e.repeat && /^Digit|^Numpad|KeyN/.test(e.code)) return;
  if (e.target.closest?.("input:not([type=range]), textarea, select, [contenteditable]")) return;
  const sides = $("editSides").querySelectorAll(".edit-side");
  const num = { Digit1: 0, Numpad1: 0, Digit2: 1, Numpad2: 1 }[e.code];
  if (e.key === " " || e.code === "Space") {
    if (e.target.closest?.("button, summary")) return; // ボタンにフォーカスがあるときは、そのボタンを押す
    $("editPlay").click();
  } else if (quick && /^Arrow/.test(e.key)) {
    return; // 見ながら記録のあいだは、位置・速さを変えない
  } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    jumpBy((e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 2 : 10));
  } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
    const rate = $("editRate");
    rate.value = String(Math.max(Number(rate.min), Math.min(Number(rate.max), Number(rate.value) + (e.key === "ArrowUp" ? 0.25 : -0.25))));
    rate.dispatchEvent(new Event("input"));
  } else if (num !== undefined && sides[num]) {
    pressByKey(sides[num].querySelector(e.shiftKey ? ".minus" : ".plus"));
  } else if (e.code === "KeyN") {
    pressByKey($("editMark"));
  } else return;
  e.preventDefault();
  if (e.target.matches?.("input[type=range]")) e.target.blur(); // バーにフォーカスが残って、矢印がバーを動かさないように
});

// 何を書き出す？：全部（exportRange "all"）／⚡ ハイライト（"goals"）。得点板を出すかは「🎉 得点板と演出」で
const chosenExport = () => (exportRange === "all" ? "all" : "hl");
document.querySelectorAll("[data-export-mode]").forEach((b) =>
  b.addEventListener("click", () => {
    if (b.disabled) return;
    exportRange = b.dataset.exportMode === "all" ? "all" : "goals";
    showExportRange();
  })
);
// 書き出すところ：[はじめの秒, 終わりの秒] のならび。全部か、⚡ ハイライト（得点・⭐ の前後。近いものはひとつにつなぐ）
function exportSegments(range = exportRange) {
  const d = Number.isFinite(editVideo.duration) ? editVideo.duration : 0;
  if (!d) return [];
  if (range === "all") return [[0, d]];
  return highlightSpans(editEvents.filter((ev) => ev.delta > 0 || ev.mark).map((ev) => ev.t), d); // 得点と ⭐ ナイスプレー
}
const EXPORT_LABELS = { all: "📼 全部を書き出す", hl: "⚡ ハイライトを書き出す" };
// 選んでいるもの・それぞれの長さの目安・つなぎ目（ハイライトのときだけ）・書き出すボタンの文言
function showExportRange() {
  const hasGoals = editEvents.some((ev) => ev.delta > 0 || ev.mark);
  if (!hasGoals && exportRange === "goals") exportRange = "all";
  // 書き出す範囲（all・goals）の長さの合計（秒）を返す
  const len = (range) => exportSegments(range).reduce((sum, [a, b]) => sum + (b - a), 0);
  const lens = { all: len("all"), hl: len("goals") };
  const mode = chosenExport();
  document.querySelectorAll("[data-export-mode]").forEach((b) => {
    const m = b.dataset.exportMode;
    b.setAttribute("aria-checked", String(m === mode));
    b.disabled = m !== "all" && !hasGoals;
  });
  document.querySelectorAll("[data-em-len]").forEach((el) => {
    const t = lens[el.dataset.emLen];
    el.textContent = t ? `約 ${clock(Math.ceil(t))}` : "";
  });
  $("exportModeHint").hidden = hasGoals;
  // つなぎ目：ハイライト・演出だけで、つなぐところが2つ以上のときだけ
  document.querySelector("#editor [data-transition-row]").hidden = mode === "all" || exportSegments("goals").length < 2;
  document.querySelector("#editor [data-hl-range]").hidden = mode === "all"; // 入れる長さ（ハイライトを選んだときだけ）
  $("editExport").textContent = lens[mode] ? `${EXPORT_LABELS[mode]}（約 ${clock(Math.ceil(lens[mode]))}）` : EXPORT_LABELS[mode];
}
["loadedmetadata", "durationchange"].forEach((type) => editVideo.addEventListener(type, showExportRange));
$("editSeek").addEventListener("input", (e) => {
  const d = Number.isFinite(editVideo.duration) ? editVideo.duration : 0;
  if (!d) return;
  editVideo.currentTime = (Number(e.target.value) / 1000) * d;
  editLastT = editVideo.currentTime; // 動かしただけでは GOAL を出さない
});

// ＋1／−1：左右は得点板と同じ並び、ボタンはチームの色
function renderEditScore() {
  if (!state.board) return renderEditGoalOnly();
  const keys = inOrder("us", "them");
  $("editSides").replaceChildren(
    ...keys.map((key) => {
      const color = key === "us" ? state.colorUs : state.colorThem;
      const name = (key === "us" ? state.teamUs : state.teamThem).trim() || sideName(key);
      const side = document.createElement("div");
      side.className = "edit-side";
      side.style.setProperty("--team", color);
      side.style.setProperty("--team-ink", inkFor(color));
      // 名前の横の色：動画を入れたあとでも、ユニフォームの色に合わせて変えられる（得点板・ボタン・一覧にすぐ出る。はじめの画面の色も変わる）
      const label = document.createElement("div");
      label.className = "name-row";
      const swatch = Object.assign(document.createElement("input"), { type: "color", value: color, className: "swatch" });
      swatch.setAttribute("aria-label", `${name}の色`);
      swatch.addEventListener("input", () => {
        const colorKey = key === "us" ? "colorUs" : "colorThem";
        state[colorKey] = swatch.value;
        save();
        shareTeams();
        renderTeamColors();
        side.style.setProperty("--team", swatch.value);
        side.style.setProperty("--team-ink", inkFor(swatch.value));
        renderEditEvents();
      });
      // チーム名：動画を見ながら、あとから入れられる（はじめの画面の欄・得点板・一覧・さくせん盤との共有にすぐ入る）
      const teamKey = key === "us" ? "teamUs" : "teamThem";
      const nameInput = Object.assign(document.createElement("input"), {
        className: "name-input",
        value: state[teamKey],
        placeholder: sideName(key),
        maxLength: 12,
        autocomplete: "off",
        enterKeyHint: "done"
      });
      nameInput.setAttribute("aria-label", `${sideName(key)}の名前`);
      nameInput.addEventListener("input", () => {
        state[teamKey] = nameInput.value.trim();
        $(teamKey).value = nameInput.value; // はじめの画面の欄にも
        save();
        shareTeams();
        renderEditEvents();
      });
      label.append(swatch, nameInput);
      const plus = Object.assign(document.createElement("button"), { type: "button", className: "plus", textContent: "＋1" });
      plus.setAttribute("aria-label", `${name}に1点（いまの時間）`);
      plus.addEventListener("click", () => addEditEvent(key, 1));
      const minus = Object.assign(document.createElement("button"), { type: "button", className: "minus", textContent: "−1" });
      minus.setAttribute("aria-label", `${name}の1点をへらす（いまの時間）`);
      minus.addEventListener("click", () => addEditEvent(key, -1));
      side.append(label, plus, minus);
      return side;
    })
  );
}

// 得点板を出さないとき：チームを分けない1つの GOAL（左のチームの点として覚える。撮る画面と同じ）
function renderEditGoalOnly() {
  const side = document.createElement("div");
  side.className = "edit-side is-solo";
  side.style.setProperty("--team", NEUTRAL_FX_COLOR);
  side.style.setProperty("--team-ink", "#ffffff");
  const plus = Object.assign(document.createElement("button"), { type: "button", className: "plus", textContent: "GOAL" });
  plus.setAttribute("aria-label", "GOAL（いまの時間。ハイライトに入れる）");
  plus.addEventListener("click", () => addEditEvent("us", 1));
  const minus = Object.assign(document.createElement("button"), { type: "button", className: "minus", textContent: "−1" });
  minus.setAttribute("aria-label", "GOAL を1つへらす（いまの時間）");
  minus.addEventListener("click", () => addEditEvent("us", -1));
  side.append(plus, minus);
  $("editSides").replaceChildren(side);
}

$("editMark").addEventListener("click", () => addEditEvent(null, 0, true));
// いまの時間に得点（＋1・−1）か ⭐ ナイスを入れる。一覧を描きなおし、＋1 なら GOAL の演出
function addEditEvent(key, delta, mark = false) {
  const ev = { t: editVideo.currentTime, key, delta, ...(mark ? { mark: true } : {}) };
  editEvents.push(ev);
  editEvents.sort((a, b) => a.t - b.t);
  navigator.vibrate?.(delta > 0 ? 30 : [15, 50, 15]);
  // ＋1 で GOAL の演出、−1 は点をへらすので消す（撮る画面・アプリと同じ。止めているときも出す）
  if (delta > 0 && !mark && state.goalFx) goalFx = { side: key, at: performance.now() };
  if (delta < 0) goalFx = null;
  if (mark && state.niceFx) niceFx = { at: performance.now() }; // ⭐ ナイスのエフェクト
  editLastT = editVideo.currentTime; // 押したところを通ったと見なして、二重に出さない
  renderEditEvents();
  // 一覧へは自動で動かさない（続けて ＋1 を押せるように、ボタンを画面に残す）
}

// 入れた得点の一覧：時間（押すとそこへ）・どちらのチーム・そのあとのスコア・✕（消す）
// 入れた点（−1 で取り消したものは除く）と ⭐ ナイス：[{ t, key, mark }]。＋1 を順に入れ、−1 はそのチームのいちばん新しい ＋1 を消す（ハイライトに入る場面と同じ）
function effectiveMarks() {
  const goals = [];
  editEvents.forEach((ev) => {
    if (ev.mark) return;
    if (ev.delta > 0) goals.push(ev);
    else {
      const i = goals.map((g) => g.key).lastIndexOf(ev.key);
      if (i >= 0) goals.splice(i, 1);
    }
  });
  return [...goals.map((g) => ({ t: g.t, key: g.key, mark: false })), ...editEvents.filter((ev) => ev.mark).map((ev) => ({ t: ev.t, key: null, mark: true }))];
}
// 動画の位置のバーの上の印：点（GOAL のアイコン。−1 で取り消した点は出さない）と ⭐ ナイス。押すとその少し前（3 秒前）へ
function renderSeekMarks() {
  const d = Number.isFinite(editVideo.duration) ? editVideo.duration : 0;
  if (!d) return $("editMarks").replaceChildren();
  const marks = effectiveMarks().map((m) => ({ t: m.t, icon: m.mark ? "⭐" : state.fxIcon || "⚽", name: m.mark ? "ナイス" : "点" }));
  $("editMarks").replaceChildren(
    ...marks.map((m) => {
      const b = Object.assign(document.createElement("button"), { type: "button", className: "seek-mark", textContent: m.icon });
      b.style.setProperty("--p", String(Math.min(1, Math.max(0, m.t / d))));
      b.setAttribute("aria-label", `${clock(Math.floor(m.t))} の${m.name}へ`);
      b.addEventListener("click", () => {
        editVideo.currentTime = Math.max(0, m.t - 3); // 少し前から見られるように
        editLastT = editVideo.currentTime;
      });
      return b;
    })
  );
}
["loadedmetadata", "durationchange"].forEach((type) => editVideo.addEventListener(type, renderSeekMarks));

function renderEditEvents() {
  showExportRange();
  renderSeekMarks();
  const afters = scoresAfterEvents();
  $("editEvents").replaceChildren(
    ...editEvents.map((ev, index) => {
      const li = document.createElement("li");
      const jump = Object.assign(document.createElement("button"), { type: "button", textContent: clock(Math.floor(ev.t)) });
      jump.setAttribute("aria-label", `${clock(Math.floor(ev.t))} へ`);
      jump.addEventListener("click", () => {
        editVideo.currentTime = Math.max(0, ev.t - 3); // 少し前から見られるように
        editLastT = editVideo.currentTime;
      });
      const color = ev.mark ? "#ffd54a" : !state.board ? NEUTRAL_FX_COLOR : ev.key === "us" ? state.colorUs : state.colorThem;
      const name = ev.mark ? "" : (ev.key === "us" ? state.teamUs : state.teamThem).trim() || sideName(ev.key);
      const after = afters[index];
      const [l, r] = inOrder(after.us, after.them);
      const text = document.createElement("span");
      const dot = Object.assign(document.createElement("i"), { className: "ev-dot" });
      dot.style.background = color;
      // 得点板を出さないときは、チーム名とスコアを出さない
      text.append(dot, ev.mark ? "⭐ ナイスプレー" : !state.board ? (ev.delta > 0 ? "GOAL" : "GOAL −1") : `${name} ${ev.delta > 0 ? "＋1" : "−1"} → ${l} - ${r}`);
      const del = Object.assign(document.createElement("button"), { type: "button", textContent: "✕" });
      del.setAttribute("aria-label", "この得点を消す");
      // 確かめずに消して、トーストの「元に戻す」で同じ場所にもどす
      del.addEventListener("click", () => {
        const at = editEvents.indexOf(ev);
        editEvents = editEvents.filter((x) => x !== ev);
        renderEditEvents();
        showResume();
        LineShareUI.toast(ev.mark ? "⭐ を消しました" : "得点を消しました", {
          actionLabel: "元に戻す",
          onAction: () => {
            editEvents.splice(Math.min(at, editEvents.length), 0, ev);
            renderEditEvents();
            showResume();
          }
        });
      });
      li.append(jump, text, del);
      return li;
    })
  );
}

// 書き出す：最初から流して、得点板つきの絵と動画の音を録る（動画と同じ時間かかる）。終わったら保存の画面
function ensureAudio() {
  // iPhone は、消音（マナーモード）のスイッチがオンだと、この音の通り道（Web Audio）の音が出なくなる。
  // 「音を流すページ」だと伝えて、消音でも動画の音が聞こえるように（Safari 16.4 から）
  try {
    if (navigator.audioSession) navigator.audioSession.type = "playback";
  } catch {
    // 使えない端末もある
  }
  if (audioCtx) return;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const src = audioCtx.createMediaElementSource(editVideo);
    audioDest = audioCtx.createMediaStreamDestination();
    src.connect(audioDest);
    src.connect(audioCtx.destination); // 書き出し中も音が聞こえるように
  } catch {
    audioCtx = null; // 音を取れない端末は、絵だけ
  }
}

// 動画をその秒へ動かして、動き終わるまで待つ
const seekTo = (t) =>
  new Promise((resolve) => {
    if (Math.abs(editVideo.currentTime - t) < 0.01) return resolve();
    editVideo.addEventListener("seeked", resolve, { once: true });
    editVideo.currentTime = t;
  });


// ---- 点の入れ方を選ぶ：▶ 見ながら記録（1倍で1回流しながら、同時に書き出す）／✏️ じっくり記録（いまの形。あとで書き出す） ----
// 新しく選んだ動画を開いたときだけ出す（「🎞 さっきの動画にもどる」では出さない）
function showModePick() {
  $("editor").classList.toggle("is-choosing", !modeChosen);
  $("editModePick").hidden = modeChosen;
  showModeLength();
  showModeChip();
}
// 見出しのよこに、いまの記録のしかた。じっくり記録のときは押すと選びなおせる（点はそのまま）
function showModeChip() {
  const chip = $("editModeChip");
  chip.hidden = !modeChosen;
  chip.classList.toggle("is-quick", quick);
  chip.textContent = quick ? "● 見ながら記録中" : "✏️ じっくり記録";
  chip.disabled = quick;
  chip.setAttribute("aria-label", quick ? "見ながら記録中" : "じっくり記録（押すと記録のしかたを選びなおす）");
}
$("editModeChip").addEventListener("click", () => {
  if (quick) return;
  editVideo.pause();
  modeChosen = false;
  showModePick();
});
// 長さの目安：見ながら記録は動画の長さで完成。じっくり記録は、点を入れる時間＋書き出しに動画の長さ
function showModeLength() {
  const d = Number.isFinite(editVideo.duration) ? editVideo.duration : 0;
  $("quickLen").textContent = d ? `この動画は ${clock(Math.ceil(d))}。約 ${clock(Math.ceil(d))} で完成` : "";
  $("slowLen").textContent = d ? `点を入れる時間＋書き出しに約 ${clock(Math.ceil(d))}` : "";
}
["loadedmetadata", "durationchange"].forEach((type) => editVideo.addEventListener(type, showModeLength));
$("slowStart").addEventListener("click", () => {
  modeChosen = true;
  showModePick();
});
$("quickStart").addEventListener("click", () => {
  modeChosen = true;
  showModePick();
  startQuick();
});

// 見ながら記録をはじめる：はじめから 1× で流し、得点板つきの絵と動画の音を、そのまま録る（撮った動画にの書き出しと同じ録り方）。
// 点を入れると、その場で得点板・GOAL の演出が入る。一時停止すると録画も止まる。見終わる・「■ ここまでで保存」で保存の画面へ
async function startQuick() {
  if (!window.MediaRecorder || !editScreen.captureStream) return notice("この端末のブラウザでは書き出せません", "「✏️ じっくり記録」で点を入れて、ほかのブラウザで書き出してね。");
  ensureAudio();
  await audioCtx?.resume().catch(() => {});
  editVideo.pause();
  await seekTo(0);
  editVideo.playbackRate = 1;
  editLastT = 0;
  goalFx = null;
  exporting = true;
  rendering = true;
  renderOverlay = true;
  exportMode = true; // 保存の画面は「閉じる」だけ（撮った動画にの画面にもどる）
  frameSync = canSyncFrames();
  // 5分ごとには分けない（一時停止で区切りがずれるため）。5分をこえたら、保存の画面の「LINE で送る用」で
  if (!beginRecording(editScreen, audioDest ? audioDest.stream.getAudioTracks() : [], "edit", { manualFrames: frameSync, split: false, clock: () => editVideo.currentTime })) {
    exporting = rendering = false;
    return notice("書き出しを始められませんでした", "この端末のブラウザでは書き出せないようです。ほかのブラウザ（Safari・Chrome）で開いてね。");
  }
  if (frameSync) {
    paintEditFrame();
    pushFrame();
    startFrameSync();
  }
  quick = true;
  showModeChip();
  $("editor").classList.add("is-quick");
  $("quickBar").hidden = false;
  $("editSeek").disabled = true;
  await keepScreenOn();
  requestAnimationFrame(drawEditFrame);
  quickTick = setInterval(showQuickTime, 500);
  showQuickTime();
  await editVideo.play().catch(() => {});
}
let quickTick = 0;
// 記録中の時間（動画の時間）と、一時停止しているか
function showQuickTime() {
  const d = Number.isFinite(editVideo.duration) ? editVideo.duration : 0;
  $("quickTime").textContent = `${editVideo.paused ? "一時停止中 " : "記録中 "}${clock(Math.floor(editVideo.currentTime))} / ${clock(Math.ceil(d))}`;
}
// 一時停止・再開（録画も止める・つづける）
function toggleQuickPause() {
  if (editVideo.paused) {
    if (recorder?.state === "paused") recorder.resume();
    editVideo.play().catch(() => {});
  } else {
    editVideo.pause();
    if (recorder?.state === "recording") recorder.pause();
  }
  showQuickTime();
}
// 見ながら記録を終える：結果の札（全部にも入れるとき、最後に）を録ってから止め、保存の画面へ。
// 入れた点・⭐ は、保存の画面の「⚡ 得点ハイライトを作る」にも使う（撮りながらと同じ）
async function finishQuick() {
  if (!quick) return;
  quick = false;
  clearInterval(quickTick);
  editVideo.pause();
  if (recorder?.state === "paused") recorder.resume();
  if (resultCardPlace("full")) await recordCard(scoreAt(Infinity)); // 撮りはじめには結果が分からないので、最初を選んでいても最後に
  effectiveMarks().forEach((m) => liveGoals.push({ take, t: m.t, key: m.key, ...(m.mark ? { mark: true } : {}) }));
  $("editor").classList.remove("is-quick");
  showModeChip(); // 終わったあとは、じっくり記録として直したり書き出したりできる
  $("quickBar").hidden = true;
  $("editSeek").disabled = false;
  editVideo.playbackRate = editRate;
  finishExport(); // 録画を止める → 保存の画面
}
$("quickStop").addEventListener("click", finishQuick);
editVideo.addEventListener("ended", () => quick && finishQuick());
// 見ながら記録のあいだに画面を離れたら、一時停止する（ブラウザは画面を離れると動画が止まり、止まった絵のまま録ってしまうため）
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && quick && !editVideo.paused) toggleQuickPause();
});
