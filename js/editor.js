// ろくが：あとから付ける（撮っておいた動画に、得点の時間を入れる）。
// 読み込む順は index.html（core → draw → setup → studio → record → editor → render → main）。
"use strict";

// ---- あとから付ける：撮っておいた動画に、得点板を付けて書き出す ----
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
  if (file) openEditor(file);
});

function openEditor(file) {
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
  $("setup").hidden = true;
  $("editor").hidden = false;
  requestAnimationFrame(drawEditFrame);
}

function closeEditor() {
  if (exporting) return;
  if (editEvents.length && !confirm("入れた得点の時間は消えます。戻りますか？")) return;
  editVideo.pause();
  $("editor").hidden = true;
  $("setup").hidden = false;
  // 得点板に出していた点を、はじめのスコアにもどす
  state.us = editBase.us;
  state.them = editBase.them;
  save();
  showSetupScore();
  showOpenSaved();
  drawPreview();
}
$("editBack").addEventListener("click", closeEditor);

// その時間までの点
function scoreAt(t) {
  const score = { ...editBase };
  editEvents.forEach((ev) => {
    if (ev.t <= t && !ev.mark) score[ev.key] = Math.max(0, score[ev.key] + ev.delta);
  });
  return score;
}

// 毎コマ：動画の絵 ＋ その時間の得点板 ＋（点が入った時間を通ったら）GOAL のエフェクト
let rendering = false; // 書き出し中（あとから付ける・得点ハイライト）
let renderOverlay = true; // 得点板・GOAL を描くか（得点ハイライトは、動画にもう入っているので描かない）
function drawEditFrame() {
  if ($("editor").hidden && !rendering) return;
  const vw = editVideo.videoWidth;
  const vh = editVideo.videoHeight;
  if (vw && vh) {
    if (editScreen.width !== vw || editScreen.height !== vh) {
      editScreen.width = vw;
      editScreen.height = vh;
    }
    const t = editVideo.currentTime;
    if (!renderOverlay) {
      editCtx.drawImage(editVideo, 0, 0, vw, vh);
      requestAnimationFrame(drawEditFrame);
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
    drawScoreboard(vw, vh, editCtx);
    drawGoalFx(vw, vh, editCtx);
  }
  requestAnimationFrame(drawEditFrame);
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
  if (editVideo.videoWidth && editVideo.videoHeight) $("editor").style.setProperty("--ar", `${editVideo.videoWidth} / ${editVideo.videoHeight}`);
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
  b.addEventListener("click", () => {
    const d = Number.isFinite(editVideo.duration) ? editVideo.duration : 0;
    editVideo.currentTime = Math.max(0, Math.min(d || Infinity, editVideo.currentTime + Number(b.dataset.jump)));
    editLastT = editVideo.currentTime;
  })
);
// 書き出す範囲
document.querySelectorAll("[data-range]").forEach((b) =>
  b.addEventListener("click", () => {
    if (b.disabled) return;
    exportRange = b.dataset.range;
    showExportRange();
  })
);
// 書き出すところ：[はじめの秒, 終わりの秒] のならび。全部か、⚡ ハイライト（得点・⭐ の前後。近いものはひとつにつなぐ）
function exportSegments() {
  const d = Number.isFinite(editVideo.duration) ? editVideo.duration : 0;
  if (!d) return [];
  if (exportRange === "all") return [[0, d]];
  return highlightSpans(editEvents.filter((ev) => ev.delta > 0 || ev.mark).map((ev) => ev.t), d); // 得点と ⭐ ナイスプレー
}
// 範囲の切りかえと、書き出すボタンにかかる時間の目安（書き出しは流した時間だけかかる）
function showExportRange() {
  const hasGoals = editEvents.some((ev) => ev.delta > 0 || ev.mark);
  if (!hasGoals && exportRange === "goals") exportRange = "all";
  document.querySelectorAll("[data-range]").forEach((b) => {
    b.setAttribute("aria-checked", String(b.dataset.range === exportRange));
    if (b.dataset.range === "goals") b.disabled = !hasGoals;
  });
  const total = exportSegments().reduce((sum, [a, b]) => sum + (b - a), 0);
  $("editExport").textContent = total ? `📼 得点板つきで書き出す（約 ${clock(Math.ceil(total))}）` : "📼 得点板つきで書き出す";
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
  const keys = state.swapped ? ["them", "us"] : ["us", "them"];
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
        $(colorKey).value = swatch.value;
        save();
        side.style.setProperty("--team", swatch.value);
        side.style.setProperty("--team-ink", inkFor(swatch.value));
        renderEditEvents();
        renderTeams();
      });
      label.append(swatch, Object.assign(document.createElement("span"), { className: "name", textContent: name }));
      const plus = Object.assign(document.createElement("button"), { type: "button", className: "plus", textContent: "＋1" });
      plus.setAttribute("aria-label", `${name}に1点（いまの時間）`);
      plus.addEventListener("click", () => addEditEvent(key, 1));
      const minus = Object.assign(document.createElement("button"), { type: "button", className: "minus", textContent: "−1" });
      minus.setAttribute("aria-label", `${name}の1点を取り消す（いまの時間）`);
      minus.addEventListener("click", () => addEditEvent(key, -1));
      side.append(label, plus, minus);
      return side;
    })
  );
}

$("editMark").addEventListener("click", () => addEditEvent(null, 0, true));
function addEditEvent(key, delta, mark = false) {
  const ev = { t: editVideo.currentTime, key, delta, ...(mark ? { mark: true } : {}) };
  editEvents.push(ev);
  editEvents.sort((a, b) => a.t - b.t);
  navigator.vibrate?.(delta > 0 ? 30 : [15, 50, 15]);
  renderEditEvents();
  // 一覧へは自動で動かさない（続けて ＋1 を押せるように、ボタンを画面に残す）
}

// 入れた得点の一覧：時間（押すとそこへ）・どちらのチーム・そのあとのスコア・✕（消す）
function renderEditEvents() {
  showExportRange();
  $("editEvents").replaceChildren(
    ...editEvents.map((ev) => {
      const li = document.createElement("li");
      const jump = Object.assign(document.createElement("button"), { type: "button", textContent: clock(Math.floor(ev.t)) });
      jump.setAttribute("aria-label", `${clock(Math.floor(ev.t))} へ`);
      jump.addEventListener("click", () => {
        editVideo.currentTime = Math.max(0, ev.t - 3); // 少し前から見られるように
        editLastT = editVideo.currentTime;
      });
      const color = ev.mark ? "#ffd54a" : ev.key === "us" ? state.colorUs : state.colorThem;
      const name = ev.mark ? "" : (ev.key === "us" ? state.teamUs : state.teamThem).trim() || sideName(ev.key);
      const after = scoreAt(ev.t);
      const [l, r] = state.swapped ? [after.them, after.us] : [after.us, after.them];
      const text = document.createElement("span");
      const dot = Object.assign(document.createElement("i"), { className: "ev-dot" });
      dot.style.background = color;
      text.append(dot, ev.mark ? "⭐ ナイスプレー" : `${name} ${ev.delta > 0 ? "＋1" : "−1"} → ${l} - ${r}`);
      const del = Object.assign(document.createElement("button"), { type: "button", textContent: "✕" });
      del.setAttribute("aria-label", "この得点を消す");
      del.addEventListener("click", () => {
        editEvents = editEvents.filter((x) => x !== ev);
        renderEditEvents();
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
