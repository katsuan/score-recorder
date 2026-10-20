// スコア録画（仮）：スマホで試合を撮りながら、得点板（チーム名とスコア）を動画にそのまま入れて残す。
// しくみ：カメラの映像と得点板を1つのキャンバスに描き、そのキャンバス（＋マイクの音）を MediaRecorder で録る。
// ボタン（得点の ＋・−、録画）はキャンバスの上に重ねた別の部品なので、動画には入らない。
// 動画はこの端末にだけ残す（保存・共有メニュー、ダウンロード）。サーバーには送らない。
"use strict";

const $ = (id) => document.getElementById(id);
const STORE_KEY = "scorecam:state";
const SAQSEN_KEY = "soccer:state"; // さくせん盤（同じ katsuan.github.io）のチーム名・色

const load = (key) => {
  try {
    return JSON.parse(localStorage.getItem(key)) || {};
  } catch {
    return {};
  }
};
const save = () => {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {
    // 残せなくても使える
  }
};

// チーム名・色は、前に使ったもの → さくせん盤のもの → 初めの値 の順に使う
const saqsen = load(SAQSEN_KEY);
const saved = load(STORE_KEY);
const state = {
  teamUs: saved.teamUs ?? saqsen.team ?? "",
  teamThem: saved.teamThem ?? saqsen.opponent ?? "",
  colorUs: saved.colorUs || saqsen.ourColor || "#6c47ff",
  colorThem: saved.colorThem || saqsen.oppColor || "#ffffff",
  us: Number(saved.us) || 0,
  them: Number(saved.them) || 0
};
const fromSaqsen = !saved.teamUs && Boolean(saqsen.team || saqsen.opponent);

// ---- はじめの画面 ----
$("teamUs").value = state.teamUs;
$("teamThem").value = state.teamThem;
$("colorUs").value = state.colorUs;
$("colorThem").value = state.colorThem;
$("fromSaqsen").hidden = !fromSaqsen;
const showSetupScore = () => ($("setupScore").textContent = `${state.us} - ${state.them}`);
showSetupScore();
// 次の試合の前に：スコアを 0 - 0 に
$("resetScore").addEventListener("click", () => {
  state.us = 0;
  state.them = 0;
  save();
  showSetupScore();
});
[["teamUs", "teamUs"], ["teamThem", "teamThem"], ["colorUs", "colorUs"], ["colorThem", "colorThem"]].forEach(([id, key]) =>
  $(id).addEventListener("input", () => {
    state[key] = $(id).value.trim();
    save();
  })
);

// ---- カメラ ----
const video = $("camera");
const screen = $("screen");
const ctx = screen.getContext("2d");
let cameraStream = null;
let wakeLock = null;

async function openCamera() {
  $("setupError").hidden = true;
  const video_ = { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } };
  try {
    // 音も一緒に録る。マイクが使えないときは映像だけ
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: video_, audio: true }).catch(() => navigator.mediaDevices.getUserMedia({ video: video_, audio: false }));
  } catch (error) {
    $("setupError").textContent = "カメラを使えませんでした。ブラウザの設定でカメラを許可してから、もう一度お試しください。";
    $("setupError").hidden = false;
    return;
  }
  video.srcObject = cameraStream;
  await video.play().catch(() => {});
  $("setup").hidden = true;
  $("studio").hidden = false;
  await keepScreenOn();
  requestAnimationFrame(drawFrame);
}

function closeCamera() {
  if (recorder?.state === "recording" && !confirm("録画中です。止めて戻りますか？")) return;
  stopRecording();
  cameraStream?.getTracks().forEach((t) => t.stop());
  cameraStream = null;
  wakeLock?.release?.().catch(() => {});
  wakeLock = null;
  $("studio").hidden = true;
  $("setup").hidden = false;
  showSetupScore();
}

// 撮っている間は画面を消さない（別のアプリに切りかえると外れるので、戻ってきたらかけ直す）
async function keepScreenOn() {
  try {
    wakeLock = await navigator.wakeLock?.request("screen");
    wakeLock?.addEventListener("release", () => (wakeLock = null));
  } catch {
    // 使えない端末もある
  }
}

// ---- 描く：カメラの映像 ＋ 得点板（左上） ----
function drawFrame() {
  if (!cameraStream) return;
  const w = video.videoWidth || 1280;
  const h = video.videoHeight || 720;
  if (screen.width !== w || screen.height !== h) {
    screen.width = w;
    screen.height = h;
  }
  ctx.drawImage(video, 0, 0, w, h);
  drawScoreboard(w, h);
  requestAnimationFrame(drawFrame);
}

// 得点板：左上に濃い札。[自チームの色] 自チーム 2 - 1 相手 [相手の色]。大きさは映像の高さに合わせる
function drawScoreboard(w, h) {
  const s = Math.min(w, h) / 720; // 720p で 1
  const pad = 20 * s;
  const boxH = 64 * s;
  const font = (size, weight = 800) => `${weight} ${size}px "M PLUS Rounded 1c", "Hiragino Maru Gothic ProN", sans-serif`;
  const nameUs = state.teamUs || "自チーム";
  const nameThem = state.teamThem || "相手";
  const score = `${state.us} - ${state.them}`;
  ctx.font = font(26 * s);
  const nameUsW = ctx.measureText(nameUs).width;
  const nameThemW = ctx.measureText(nameThem).width;
  ctx.font = font(40 * s);
  const scoreW = ctx.measureText(score).width;
  const chip = 10 * s;
  const gap = 16 * s;
  const boxW = chip + gap + nameUsW + gap * 1.5 + scoreW + gap * 1.5 + nameThemW + gap + chip + gap * 1.2;
  const x = pad;
  const y = pad;
  ctx.save();
  ctx.fillStyle = "rgba(12, 22, 16, 0.8)";
  ctx.beginPath();
  ctx.roundRect(x, y, boxW, boxH, 14 * s);
  ctx.fill();
  // チームの色の帯（左右の端）
  ctx.fillStyle = state.colorUs;
  ctx.fillRect(x + gap * 0.6, y + 12 * s, chip, boxH - 24 * s);
  ctx.fillStyle = state.colorThem;
  ctx.fillRect(x + boxW - gap * 0.6 - chip, y + 12 * s, chip, boxH - 24 * s);
  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "middle";
  let cx = x + gap * 0.6 + chip + gap;
  ctx.font = font(26 * s);
  ctx.fillText(nameUs, cx, y + boxH / 2 + 1 * s);
  cx += nameUsW + gap * 1.5;
  ctx.font = font(40 * s);
  ctx.fillText(score, cx, y + boxH / 2 + 2 * s);
  cx += scoreW + gap * 1.5;
  ctx.font = font(26 * s);
  ctx.fillText(nameThem, cx, y + boxH / 2 + 1 * s);
  ctx.restore();
}

// ---- 得点の ＋・−（録画中でも押せる。0 より下にはしない） ----
document.querySelectorAll("[data-score]").forEach((b) =>
  b.addEventListener("click", () => {
    const key = b.dataset.score;
    state[key] = Math.max(0, state[key] + Number(b.dataset.delta));
    save();
    navigator.vibrate?.(10);
  })
);

// ---- 録画 ----
let recorder = null;
let chunks = [];
let startedAt = 0;
let tick = 0;
let videoUrl = "";
let videoFile = null;

// この端末で録れる形式（iPhone は mp4、Android・パソコンは webm のことが多い）
function pickMimeType() {
  const types = ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
  return types.find((t) => window.MediaRecorder?.isTypeSupported?.(t)) || "";
}

function startRecording() {
  if (!window.MediaRecorder || !screen.captureStream) {
    alert("この端末のブラウザでは録画できません。");
    return;
  }
  const stream = screen.captureStream(30);
  cameraStream.getAudioTracks().forEach((t) => stream.addTrack(t));
  const mimeType = pickMimeType();
  recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: 6_000_000 });
  chunks = [];
  recorder.addEventListener("dataavailable", (e) => e.data.size && chunks.push(e.data));
  recorder.addEventListener("stop", showSaved);
  recorder.start(1000); // 1秒ごとに区切って受け取る（長く録っても途中で失いにくい）
  startedAt = Date.now();
  $("record").classList.add("is-on");
  $("record").setAttribute("aria-label", "録画を止める");
  tick = setInterval(showElapsed, 500);
  showElapsed();
}

function stopRecording() {
  if (recorder?.state === "recording") recorder.stop();
  clearInterval(tick);
  $("elapsed").textContent = "";
  $("record").classList.remove("is-on");
  $("record").setAttribute("aria-label", "録画をはじめる");
}

function showElapsed() {
  const sec = Math.floor((Date.now() - startedAt) / 1000);
  $("elapsed").textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

// 止めたら：見返し・保存・共有
function showSaved() {
  const type = recorder.mimeType || chunks[0]?.type || "video/webm";
  const blob = new Blob(chunks, { type });
  const ext = type.includes("mp4") ? "mp4" : "webm";
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;
  const name = `score-${stamp}.${ext}`;
  if (videoUrl) URL.revokeObjectURL(videoUrl);
  videoUrl = URL.createObjectURL(blob);
  videoFile = new File([blob], name, { type });
  $("playback").src = videoUrl;
  $("downloadVideo").href = videoUrl;
  $("downloadVideo").download = name;
  $("saveInfo").textContent = `${name}（${(blob.size / 1024 / 1024).toFixed(1)}MB）`;
  $("shareVideo").hidden = !navigator.canShare?.({ files: [videoFile] });
  $("saveSheet").hidden = false;
}

$("shareVideo").addEventListener("click", async () => {
  try {
    await navigator.share({ files: [videoFile], title: "試合の動画" });
  } catch {
    // やめたときは何もしない
  }
});
$("closeSave").addEventListener("click", () => {
  $("saveSheet").hidden = true;
  $("playback").pause();
});
$("record").addEventListener("click", () => (recorder?.state === "recording" ? stopRecording() : startRecording()));
$("openCamera").addEventListener("click", openCamera);
$("back").addEventListener("click", closeCamera);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && cameraStream && !wakeLock) keepScreenOn();
});
