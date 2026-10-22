// ろくが：撮る画面（カメラ・映像を描く・倒して撮る・＋1 の位置・得点の ＋・−・⭐ ナイス）。
// 読み込む順は index.html（core → draw → setup → studio → record → editor → render → main）。
"use strict";

// ---- カメラ ----
const video = $("camera");
const screen = $("screen");
const ctx = screen.getContext("2d");
const screenCtx = ctx;
let cameraStream = null;
let wakeLock = null;

async function openCamera() {
  $("setupError").hidden = true;
  showTeamColors(); // はじめの画面で変えた色を、＋1 のボタンにも
  const video_ = { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } };
  try {
    // 音も一緒に録る。マイクが使えないときは映像だけ
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: video_, audio: true }).catch(() => navigator.mediaDevices.getUserMedia({ video: video_, audio: false }));
  } catch (error) {
    $("setupError").textContent = "カメラを使えませんでした。ブラウザの設定でカメラを許可してから、もう一度押してね。";
    $("setupError").hidden = false;
    return;
  }
  video.srcObject = cameraStream;
  await video.play().catch(() => {});
  $("setup").hidden = true;
  $("studio").hidden = false;
  // 縦の画面で開いたとき、前に倒して撮った向きがあれば、選ばずにその向きで始める（ちがえば ⇅ で逆に）
  if (state.turn && window.matchMedia("(orientation: portrait)").matches) setTurn(state.turn, false);
  maybeShowTip();
  await keepScreenOn();
  requestAnimationFrame(drawFrame);
}

// はじめて撮る画面を開いたときだけ、ボタンの使い方を出す（「わかった」でこの端末では次から出さない）。
// 縦の画面で「横向きにしてください」が出ているあいだは出さず、横向き（倒す）になってから
const TIP_KEY = "roqga:tip-seen";
function maybeShowTip() {
  let seen = false;
  try {
    seen = localStorage.getItem(TIP_KEY) === "1";
  } catch {
    // 残せない端末では毎回出さない
    seen = true;
  }
  const blocked = !turn && window.matchMedia("(orientation: portrait)").matches;
  $("studioTip").hidden = seen || blocked || $("studio").hidden;
}
$("tipOk").addEventListener("click", () => {
  $("studioTip").hidden = true;
  try {
    localStorage.setItem(TIP_KEY, "1");
  } catch {
    // 残せなくても使える
  }
});
// 横向きにしてくださいの画面からも、はじめの画面へ
$("rotateHome").addEventListener("click", closeCamera);

async function closeCamera() {
  if (recording && !(await LineShareUI.ask({ title: "録画中です", text: "止めて戻りますか？", ok: "止めて戻る", danger: true }))) return;
  stopRecording();
  cameraStream?.getTracks().forEach((t) => t.stop());
  cameraStream = null;
  wakeLock?.release?.().catch(() => {});
  wakeLock = null;
  $("studio").hidden = true;
  $("setup").hidden = false;
  showOpenSaved(); // 録った動画があれば「🎞 録った動画」を出す
  showSetupScore();
  drawPreview();
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
// 縦の画面のまま横に倒して撮るとき（画面の回転がオフ）："left"・"right"。横向きの画面なら null
let turn = null;

function drawFrame() {
  if (!cameraStream) return;
  const vw = video.videoWidth || 1280;
  const vh = video.videoHeight || 720;
  // 倒して撮るときは、縦に届くカメラの映像を横に回して描く（動画は横長になる）
  const rotate = turn && vh > vw;
  const w = rotate ? vh : vw;
  const h = rotate ? vw : vh;
  if (screen.width !== w || screen.height !== h) {
    screen.width = w;
    screen.height = h;
  }
  ctx.save();
  if (rotate && turn === "left") {
    // 左に倒した（スマホの上が左）：映像の右が上になるので、左回りに 90°
    ctx.translate(0, h);
    ctx.rotate(-Math.PI / 2);
  } else if (rotate) {
    // 右に倒した（スマホの上が右）：映像の左が上になるので、右回りに 90°
    ctx.translate(w, 0);
    ctx.rotate(Math.PI / 2);
  }
  ctx.drawImage(video, 0, 0, vw, vh);
  ctx.restore();
  drawScoreboard(w, h);
  drawGoalFx(w, h);
  requestAnimationFrame(drawFrame);
}

// 倒す向きを選ぶ・やめる。録画中は変えない（動画の向きが途中で変わるため）
// remember：選んだ向きを端末に覚える（次にカメラを開いたとき、縦の画面ならその向きで始める）。
// ほんとうに横向きになって外すときは覚えたままにする
function setTurn(next, remember = true) {
  if (recording) return;
  turn = next;
  if (remember && next) {
    state.turn = next;
    save();
  }
  const studio = $("studio");
  studio.classList.toggle("is-turned", Boolean(turn));
  studio.classList.toggle("is-left", turn === "left");
  studio.classList.toggle("is-right", turn === "right");
  $("turnFlip").hidden = !turn;
  if (turn) maybeShowTip();
}
document.querySelectorAll("[data-turn]").forEach((b) => b.addEventListener("click", () => setTurn(b.dataset.turn)));
$("turnFlip").addEventListener("click", () => setTurn(turn === "left" ? "right" : "left")); // 倒す向きを逆に
// 画面の回転がオンで、ほんとうに横向きになったら、倒して撮るのはやめる（ふつうの横向きで撮る）
window.matchMedia("(orientation: landscape)").addEventListener("change", (e) => {
  if (!e.matches) return;
  setTurn(null, false);
  maybeShowTip();
});

// ---- ＋1 の位置：まんなか・左よせ・右よせ（片手で持つ側に寄せる）。撮る画面の右上の小さな丸で、録画中も切りかえられる ----
const HAND_NAMES = { center: "まんなか", left: "左よせ", right: "右よせ" };
function showHand() {
  $("studio").classList.toggle("hand-left", state.hand === "left");
  $("studio").classList.toggle("hand-right", state.hand === "right");
  const btn = $("handToggle");
  btn.dataset.hand = state.hand;
  btn.setAttribute("aria-label", `＋1 の位置：${HAND_NAMES[state.hand]}（押すと切りかえ）`);
  btn.title = `＋1 の位置：${HAND_NAMES[state.hand]}`;
}
// まんなか → 左よせ → 右よせ → まんなか …
$("handToggle").addEventListener("click", () => {
  state.hand = { center: "left", left: "right", right: "center" }[state.hand];
  save();
  showHand();
});

// ---- 得点の ＋・−（録画中でも押せる。0 より下にはしない）。＋1 のときは GOAL のエフェクト ----
// 点を変える（＋1・−1）。押したボタンが一瞬光る（画面のまんなかには何も出さない。動画に入るのか迷わせないため。
// いまの点は、動画に入る左上の得点板で見える）。Android は軽く震える（iPhone のブラウザは震えない）。
// 押しまちがいは、そのチームの −1 で直す（画面がごちゃつかないよう「元に戻す」ボタンは出さない）
// 撮っているあいだに ＋1 を押した時間（得点ハイライト用）。[{ take, t: その回の録りはじめからの秒, key }]
let liveGoals = [];
function changeScore(key, delta, button) {
  state[key] = Math.max(0, state[key] + delta);
  if (recording && recKind === "shot") {
    if (delta > 0) liveGoals.push({ take, t: (Date.now() - startedAt) / 1000, key });
    else {
      // −1（押しまちがい）：その回の、そのチームのいちばん新しい得点を消す
      const i = liveGoals.map((g) => g.take === take && g.key === key && !g.mark).lastIndexOf(true);
      if (i >= 0) liveGoals.splice(i, 1);
    }
  }
  if (delta > 0 && state.goalFx) goalFx = { side: key, at: performance.now() };
  if (delta < 0) goalFx = null; // へらしたら消す
  save();
  navigator.vibrate?.(delta > 0 ? 30 : [15, 50, 15]);
  if (button) {
    button.classList.remove("is-hit");
    void button.offsetWidth; // 続けて押しても、はじめから光らせなおす
    button.classList.add("is-hit");
  }
}
document.querySelectorAll("[data-score]").forEach((b) => b.addEventListener("click", () => changeScore(b.dataset.score, Number(b.dataset.delta), b)));
// ⭐ ナイスプレー（効くのは録画中だけ）：点は変えずに、その時間を得点ハイライトに入れる
let markHintTimer = 0;
$("markLive").addEventListener("click", () => {
  if (!recording || recKind !== "shot") {
    // 録画前：何も残さず、少しのあいだ「録画中に押してね」と出す
    const b = $("markLive");
    b.textContent = "録画中に押してね";
    clearTimeout(markHintTimer);
    markHintTimer = setTimeout(() => (b.textContent = "⭐ ナイス"), 1500);
    return;
  }
  liveGoals.push({ take, t: (Date.now() - startedAt) / 1000, key: null, mark: true });
  navigator.vibrate?.(20);
  const b = $("markLive");
  b.classList.remove("is-hit");
  void b.offsetWidth;
  b.classList.add("is-hit");
});

$("record").addEventListener("click", () => (recording ? stopRecording() : startRecording()));
// カメラの許可を待つあいだは、ボタンの中に「開いています…」（二度押しもしない）
$("openCamera").addEventListener("click", async () => {
  const button = $("openCamera");
  if (button.disabled) return;
  const label = button.textContent;
  button.disabled = true;
  button.textContent = "📹 カメラを開いています…";
  try {
    await openCamera();
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
});
