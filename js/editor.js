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
let editRate = 1; // 得点を入れるときの再生の速さ（書き出しはいつも 1×）
let exportRange = "all"; // 書き出す範囲：all（全部）／goals（⚡ ハイライト＝得点・⭐ の前後だけ）

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
  editRate = 1;
  editVideo.playbackRate = 1;
  $("editRate").value = "1";
  showRate();
  editBase = { us: state.us, them: state.them };
  editLastT = 0;
  goalFx = null;
  renderEditScore();
  renderEditEvents();
  showEditor();
}

// 撮った動画にの画面を出す（はじめて開くときも、さっきの動画にもどるときも）
function showEditor() {
  // 撮る画面の ⚡ ハイライトを作ると、この動画の枠に録った動画を入れているので、さっきの動画にもどす
  if (editUrl && editVideo.src !== editUrl) editVideo.src = editUrl;
  renderEditScore(); // チーム名・色は、はじめの画面で変えているかもしれない
  renderEditEvents();
  $("editFxBody").append($("fxControls")); // エフェクトの設定を、この画面の「🎉 得点のエフェクト」へ
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
  } else if (wipeProgress() !== null || (!editVideo.paused && performance.now() - lastSyncFrameAt > 200)) {
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
  if (!renderOverlay) {
    editCtx.drawImage(editVideo, 0, 0, vw, vh);
    drawPieceTransition(vw, vh);
    return;
  }
  const score = scoreAt(t);
  state.us = score.us;
  state.them = score.them;
  if (state.goalFx && t > editLastT && t - editLastT < 1) {
    const passed = editEvents.find((ev) => ev.delta > 0 && ev.t > editLastT && ev.t <= t);
    if (passed) goalFx = { side: passed.key, at: performance.now() };
  }
  editLastT = t;
  editCtx.drawImage(editVideo, 0, 0, vw, vh);
  drawScoreboard(vw, vh, editCtx); // 「得点板：出さない」のときは描かない（draw.js）
  drawGoalFx(vw, vh, editCtx);
  drawPieceTransition(vw, vh);
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
$("editPlay").addEventListener("click", () => (editVideo.paused ? editVideo.play().catch(() => {}) : editVideo.pause()));
// 速さ：0.5×〜4× を少しずつ（点の場面を探すとき速く、見きわめるとき遅く）
const showRate = () => ($("editRateLabel").textContent = `${editRate}×`);
$("editRate").addEventListener("input", (e) => {
  editRate = Number(e.target.value);
  editVideo.playbackRate = editRate;
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
  editLastT = editVideo.currentTime; // 押したところを通ったと見なして、二重に出さない
  renderEditEvents();
  // 一覧へは自動で動かさない（続けて ＋1 を押せるように、ボタンを画面に残す）
}

// 入れた得点の一覧：時間（押すとそこへ）・どちらのチーム・そのあとのスコア・✕（消す）
function renderEditEvents() {
  showExportRange();
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
