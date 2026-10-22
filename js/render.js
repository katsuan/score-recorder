// ろくが：書き出し（撮った動画に（得点板をつける）・⚡ ハイライトで共通）と、撮るときの ⚡ ハイライト。
// 読み込む順は index.html（core → draw → setup → studio → record → editor → render → main）。
"use strict";

// ---- 書き出し（共通）・⚡ ハイライト ----
// 書き出す（共通）：pieces＝[{ src: 動画の URL, a: はじめの秒, b: 終わりの秒 }] を順に流して、canvas の絵と動画の音を1本に録る。
// あいだを飛ばすときは録画を一時停止してつなぐ。流した時間だけかかる
async function renderPieces(pieces, { overlay, kind, title }) {
  if (!window.MediaRecorder || !editScreen.captureStream) {
    alert("この端末のブラウザでは書き出せません。");
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
  if ($("editor").hidden) requestAnimationFrame(drawEditFrame); // 撮った動画にの画面では、もう描きつづけている
  await keepScreenOn();
  const total = pieces.reduce((sum, p) => sum + (p.b - p.a), 0);
  let done = 0;
  let started = false;
  for (const [index, { src, a, b }] of pieces.entries()) {
    if (!exporting) break;
    // つなぎ目の柄：切り出した部分が2つ以上のときだけ（editor.js の drawPieceTransition）
    piecePlan = pieces.length > 1 ? { index, count: pieces.length, a, b } : null;
    if (editVideo.src !== src) {
      editVideo.src = src;
      await new Promise((r) => editVideo.addEventListener("loadeddata", r, { once: true }));
    }
    await seekTo(a);
    editLastT = a;
    goalFx = null;
    if (!started) {
      beginRecording(editScreen, audioDest ? audioDest.stream.getAudioTracks() : [], kind);
      started = true;
    } else if (recorder?.state === "paused") {
      recorder.resume();
    }
    await editVideo.play().catch(() => {});
    await new Promise((resolve) => {
      const iv = setInterval(() => {
        const t = editVideo.currentTime;
        const now = done + Math.max(0, t - a);
        $("exportProg").textContent = `${clock(Math.floor(now))} / ${clock(Math.ceil(total))}　のこり 約 ${clock(Math.max(0, Math.ceil(total - now)))}`;
        $("exportBar").style.width = `${Math.min(100, (now / total) * 100)}%`;
        drawExportPeek();
        if (!exporting || t >= b - 0.05 || editVideo.ended) {
          clearInterval(iv);
          resolve();
        }
      }, 50);
    });
    editVideo.pause();
    if (recorder?.state === "recording") recorder.pause();
    done += b - a;
  }
  finishExport();
}

// 撮った動画に（得点板をつける）：選んだ範囲を、得点板つきで書き出す（終わったら保存の画面は「閉じる」だけ）
async function exportVideo() {
  if (!Number.isFinite(editVideo.duration) || !editVideo.duration) return alert("動画の長さが分かりません。少し待ってから、もう一度お試しください。");
  const pieces = exportSegments().map(([a, b]) => ({ src: editVideo.src, a, b }));
  if (!pieces.length) return;
  exportMode = true;
  const highlight = exportRange === "goals"; // ⚡ ハイライト：保存の画面でも「⚡ ハイライト」として並ぶ
  await renderPieces(pieces, { overlay: true, kind: highlight ? "highlight" : "edit", title: highlight ? "⚡ ハイライトを作っています…" : "書き出し中…" });
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
function showHighlightButton() {
  const total = highlightPieces().reduce((sum, p) => sum + (p.b - p.a), 0);
  $("makeHighlight").hidden = !total;
  document.querySelector('[data-transition-row][data-for="makeHighlight"]').hidden = !total;
  if (total) $("makeHighlight").textContent = `⚡ 得点ハイライトを作る（約 ${clock(Math.ceil(total))}）`;
}
$("makeHighlight").addEventListener("click", () => {
  const pieces = highlightPieces();
  if (!pieces.length) return;
  $("saveSheet").hidden = true;
  $("playback").pause();
  renderPieces(pieces, { overlay: false, kind: "highlight", title: "⚡ ハイライトを作っています…" });
});

// ---- 書き出し中の画面：動き（しま模様のバー・書き出しているところ）とプチ情報、画面を離れないように ----
const EXPORT_TIPS = [
  "⚡ ハイライトは、得点と ⭐ ナイスの 10秒前〜6秒後をつなぎます",
  "🎉 得点のエフェクトは、アイコンと文字を変えられます（サッカー以外でも）",
  "📤 5分をこえると、LINE で送れるよう 5分ずつに分けます",
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
function showTip() {
  const el = $("exportTip");
  el.classList.remove("is-in");
  void el.offsetWidth; // 入れかわるたびに、ふわっと出す
  el.textContent = `💡 ${EXPORT_TIPS[tipIndex % EXPORT_TIPS.length]}`;
  el.classList.add("is-in");
  tipIndex++;
}
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
// 書き出し中にページを閉じる・更新しようとしたら、ブラウザの確かめる画面を出す
window.addEventListener("beforeunload", (e) => {
  if (!exporting) return;
  e.preventDefault();
  e.returnValue = "";
});

function finishExport() {
  piecePlan = null;
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
$("editExport").addEventListener("click", () => {
  if (!editEvents.length && !confirm("まだ得点を入れていません。はじめのスコアのまま書き出しますか？")) return;
  exportVideo();
});
$("exportCancel").addEventListener("click", () => finishExport());
$("back").addEventListener("click", closeCamera);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && cameraStream && !wakeLock) keepScreenOn();
});
