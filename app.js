// ろくが（RoQga）：スマホで試合を撮りながら、得点板（チーム名とスコア）を動画にそのまま入れて残す。
// しくみ：カメラの映像と得点板を1つのキャンバスに描き、そのキャンバス（＋マイクの音）を MediaRecorder で録る。
// ボタン（得点の ＋・−、録画）はキャンバスの上に重ねた別の部品なので、動画には入らない。
// 動画はこの端末にだけ残す（保存・共有メニュー、ダウンロード）。サーバーには送らない。
"use strict";

const $ = (id) => document.getElementById(id);
const STORE_KEY = "roqga:state";
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
  them: Number(saved.them) || 0,
  goalFx: saved.goalFx === true, // ＋1 のとき「GOAL!」のエフェクトを動画に入れるか（ふだんは出さない）
  swapped: saved.swapped === true, // 左右を入れかえる（us を右に）。us・them は中の呼び名で、自分のチームとはかぎらない
  hand: ["left", "right"].includes(saved.hand) ? saved.hand : "center" // ＋1・録画のまとまりの位置（片手で持つ側に寄せる）
};
const fromSaqsen = !saved.teamUs && Boolean(saqsen.team || saqsen.opponent);

// ---- はじめの画面 ----
$("teamUs").value = state.teamUs;
$("teamThem").value = state.teamThem;
$("colorUs").value = state.colorUs;
$("colorThem").value = state.colorThem;
$("fromSaqsen").hidden = !fromSaqsen;
// いまのスコア（左右の並びに合わせる）。点があるときだけ「0 - 0 にする」を出す
function showSetupScore() {
  $("setupScore").textContent = state.swapped ? `${state.them} - ${state.us}` : `${state.us} - ${state.them}`;
  document.querySelectorAll("[data-score-of]").forEach((b) => (b.textContent = state[b.dataset.scoreOf]));
  $("resetScore").hidden = state.us === 0 && state.them === 0;
}
showSetupScore();
// スコアを変える（途中から撮るとき）：各チームの下に − ＋ を出す／しまう。まんなかのスコアを押しても同じ
function toggleScoreEdit() {
  const on = document.querySelector(".teams").classList.toggle("is-editing");
  $("editScore").textContent = on ? "✓ できた" : "✏️ スコアを変える（途中から撮るとき）";
  $("editScore").setAttribute("aria-expanded", on);
}
$("editScore").addEventListener("click", toggleScoreEdit);
$("setupScore").addEventListener("click", toggleScoreEdit);
$("setupScore").addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), toggleScoreEdit()));
document.querySelectorAll("[data-step]").forEach((b) =>
  b.addEventListener("click", () => {
    const k = b.dataset.step;
    state[k] = Math.max(0, Math.min(99, state[k] + Number(b.dataset.delta)));
    save();
    showSetupScore();
    drawPreview();
  })
);
// 次の試合の前に：スコアを 0 - 0 に
$("resetScore").addEventListener("click", () => {
  state.us = 0;
  state.them = 0;
  save();
  showSetupScore();
  drawPreview();
});
[["teamUs", "teamUs"], ["teamThem", "teamThem"], ["colorUs", "colorUs"], ["colorThem", "colorThem"]].forEach(([id, key]) =>
  $(id).addEventListener("input", () => {
    state[key] = $(id).value.trim();
    save();
  })
);

// ---- ＋1・録画のまとまりの位置：左よせ・まんなか・右よせ（片手で持つ側に寄せる）。撮る画面の右上で、録画中も切りかえられる ----
function showHand() {
  $("studio").classList.toggle("hand-left", state.hand === "left");
  $("studio").classList.toggle("hand-right", state.hand === "right");
  document.querySelectorAll("[data-hand]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.hand === state.hand)));
}
document.querySelectorAll("[data-hand]").forEach((b) =>
  b.addEventListener("click", () => {
    state.hand = b.dataset.hand;
    save();
    showHand();
  })
);
showHand();

// ---- 左右の入れかえ（はじめの画面のチームの並び・得点板・撮る画面の ＋1） ----
// いま左にいるか右にいるかで呼ぶ（自分のチームの試合とはかぎらないので「自チーム・相手」とは呼ばない）
const sideName = (key) => ((key === "us") !== state.swapped ? "左のチーム" : "右のチーム");
// ＋1／−1 のボタンをチームの色に。字は色の明るさで白か黒（白いユニフォームなら黒い字）
const inkFor = (hex) => {
  const n = parseInt(String(hex).replace("#", ""), 16) || 0;
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.62 ? "#1a1a1a" : "#ffffff";
};
function showTeamColors() {
  document.querySelectorAll(".side").forEach((el) => {
    const color = el.classList.contains("is-us") ? state.colorUs : state.colorThem;
    el.style.setProperty("--team", color);
    el.style.setProperty("--team-ink", inkFor(color));
  });
}
function showSides() {
  showTeamColors();
  document.querySelector(".teams").classList.toggle("is-swapped", state.swapped);
  $("studio").classList.toggle("is-swapped", state.swapped);
  document.querySelectorAll("[data-side-label]").forEach((el) => (el.textContent = sideName(el.dataset.sideLabel)));
  document.querySelectorAll("[data-side-aria]").forEach((el) => {
    const [key, rest] = el.dataset.sideAria.split(":");
    el.setAttribute("aria-label", sideName(key) + rest);
  });
  showSetupScore();
}
$("swapSides").addEventListener("click", () => {
  state.swapped = !state.swapped;
  save();
  showSides();
  drawPreview();
});
showSides();

// ---- GOAL のエフェクトを出すか・試す ----
const showGoalFxSetting = () => {
  document.querySelectorAll("[data-goal-fx]").forEach((b) => b.setAttribute("aria-checked", String((b.dataset.goalFx === "on") === state.goalFx)));
  $("fxMeta").textContent = state.goalFx ? "ON" : ""; // GOAL のエフェクトを出すときだけ、たたんだ見出しに小さく
};
document.querySelectorAll("[data-goal-fx]").forEach((b) =>
  b.addEventListener("click", () => {
    state.goalFx = b.dataset.goalFx === "on";
    save();
    showGoalFxSetting();
  })
);
showGoalFxSetting();
// たたんだ欄を開いたら、プレビューを描き直す（たたんでいる間は大きさが測れないため）
$("previewFold").addEventListener("toggle", () => $("previewFold").open && drawPreview());
$("tryGoal").addEventListener("click", () => {
  goalFx = { side: "us", at: performance.now() };
  drawPreview();
});

// ---- 得点板のプレビュー（はじめの画面）：芝のピッチの絵に、動画と同じ得点板・エフェクトを描く ----
const preview = $("preview");
const previewCtx = preview.getContext("2d");
let previewLoop = 0;
function drawPreview() {
  const c = previewCtx;
  const w = preview.width;
  const h = preview.height;
  const grass = c.createLinearGradient(0, 0, 0, h);
  grass.addColorStop(0, "#3f9a5a");
  grass.addColorStop(1, "#2e7d47");
  c.fillStyle = grass;
  c.fillRect(0, 0, w, h);
  c.strokeStyle = "rgba(255, 255, 255, 0.6)";
  c.lineWidth = 6;
  c.strokeRect(60, 60, w - 120, h - 120);
  c.beginPath();
  c.moveTo(w / 2, 60);
  c.lineTo(w / 2, h - 60);
  c.stroke();
  c.beginPath();
  c.arc(w / 2, h / 2, 90, 0, Math.PI * 2);
  c.stroke();
  drawScoreboard(w, h, c);
  drawGoalFx(w, h, c);
  // エフェクトが出ている間は描き直し続ける
  cancelAnimationFrame(previewLoop);
  if (goalFx && $("studio").hidden) previewLoop = requestAnimationFrame(drawPreview);
}
document.querySelectorAll(".team-col input").forEach((input) => input.addEventListener("input", drawPreview));
// はじめの1回は、このファイルを読み終わってから（GOAL のエフェクトの決まりがあとに書いてあるため）
queueMicrotask(drawPreview);
document.fonts?.ready.then(drawPreview);

// ---- 保存したチーム（名前と色の組）。さくせん盤など Q のサッカー系で共通に使えるよう、共通の名前で残す ----
const TEAMS_KEY = "q-soccer:teams";
const MAX_TEAMS = 30;
let teams = (() => {
  try {
    const list = JSON.parse(localStorage.getItem(TEAMS_KEY));
    return Array.isArray(list) ? list.filter((t) => t && t.name) : [];
  } catch {
    return [];
  }
})();
const saveTeams = () => {
  try {
    localStorage.setItem(TEAMS_KEY, JSON.stringify(teams));
  } catch {
    // 残せなくても使える
  }
};
const SIDES = { us: { name: "teamUs", color: "colorUs" }, them: { name: "teamThem", color: "colorThem" } };
const sameTeam = (t, name, color) => t.name === name && t.color.toLowerCase() === String(color).toLowerCase();

// さくせん盤で入れたチーム（さくせん盤の自チーム・相手の名前と色）。▼ で選べるように。保存したチームと同じ名前・色のものは出さない
function saqsenTeams() {
  const now = load(SAQSEN_KEY);
  return [
    { name: String(now.team || "").trim(), color: now.ourColor || "#6c47ff" },
    { name: String(now.opponent || "").trim(), color: now.oppColor || "#ffffff" }
  ].filter((t, i, list) => t.name && !teams.some((s) => sameTeam(s, t.name, t.color)) && list.findIndex((u) => sameTeam(u, t.name, t.color)) === i);
}
const pickList = () => [...teams.map((t, i) => ({ ...t, value: `t${i}` })), ...saqsenTeams().map((t, i) => ({ ...t, value: `s${i}` }))];
const option = (value, text) => Object.assign(document.createElement("option"), { value, textContent: text });
const group = (label, list) => {
  const g = Object.assign(document.createElement("optgroup"), { label });
  g.append(...list.map((t) => option(t.value, t.name)));
  return g;
};

// それぞれの行：▼ は選べるチーム（保存したチーム・さくせん盤のチーム）があるときだけ。
// 右のボタンは、いまの名前と色が保存済みなら「消す」、まだなら「保存」
function renderTeams() {
  const list = pickList();
  const fromTeams = list.filter((t) => t.value[0] === "t");
  const fromSaqsen = list.filter((t) => t.value[0] === "s");
  document.querySelectorAll(".team-col").forEach((row) => {
    const keys = SIDES[row.dataset.side];
    const name = state[keys.name].trim();
    const saved = teams.some((t) => sameTeam(t, name, state[keys.color]));
    row.querySelector(".team-pick").hidden = !list.length;
    const select = row.querySelector("select");
    select.replaceChildren(
      option("", "チームを選ぶ"),
      ...(fromTeams.length ? [group("保存したチーム", fromTeams)] : []),
      ...(fromSaqsen.length ? [group("さくせん盤から", fromSaqsen)] : [])
    );
    select.value = "";
    const action = row.querySelector(".team-action");
    action.textContent = saved ? "消す" : "保存";
    action.classList.toggle("is-remove", saved);
    action.disabled = !name;
  });
}

document.querySelectorAll(".team-col").forEach((row) => {
  const keys = SIDES[row.dataset.side];
  // ▼ で選ぶ：名前と色をまとめて入れる
  row.querySelector("select").addEventListener("change", (e) => {
    const t = pickList().find((p) => p.value === e.target.value);
    if (!t) return;
    state[keys.name] = t.name;
    state[keys.color] = t.color;
    $(keys.name).value = t.name;
    $(keys.color).value = t.color;
    save();
    renderTeams();
    drawPreview();
  });
  // 保存／消す
  row.querySelector(".team-action").addEventListener("click", () => {
    const name = state[keys.name].trim();
    const color = state[keys.color];
    if (!name) return;
    const i = teams.findIndex((t) => sameTeam(t, name, color));
    if (i >= 0) {
      if (!confirm(`「${name}」を保存したチームから消しますか？`)) return;
      teams.splice(i, 1);
    } else {
      if (teams.length >= MAX_TEAMS) return alert(`保存できるのは ${MAX_TEAMS} チームまでです。使わないものを消してください。`);
      // 同じ名前は色を上書き（色だけ変えて保存し直せる）
      teams = [{ name, color }, ...teams.filter((t) => t.name !== name)];
    }
    saveTeams();
    renderTeams();
  });
});
document.querySelectorAll(".team-col input").forEach((input) => input.addEventListener("input", renderTeams));
renderTeams();

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
  if (recording && !confirm("録画中です。止めて戻りますか？")) return;
  stopRecording();
  cameraStream?.getTracks().forEach((t) => t.stop());
  cameraStream = null;
  wakeLock?.release?.().catch(() => {});
  wakeLock = null;
  $("studio").hidden = true;
  $("setup").hidden = false;
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
function setTurn(next) {
  if (recording) return;
  turn = next;
  const studio = $("studio");
  studio.classList.toggle("is-turned", Boolean(turn));
  studio.classList.toggle("is-left", turn === "left");
  studio.classList.toggle("is-right", turn === "right");
  $("turnOff").hidden = !turn;
}
document.querySelectorAll("[data-turn]").forEach((b) => b.addEventListener("click", () => setTurn(b.dataset.turn)));
$("turnOff").addEventListener("click", () => setTurn(null));
// 画面の回転がオンで、ほんとうに横向きになったら、倒して撮るのはやめる（ふつうの横向きで撮る）
window.matchMedia("(orientation: landscape)").addEventListener("change", (e) => e.matches && setTurn(null));

// 得点板：左上に濃い札。[左のチームの色] 左のチーム 2 - 1 右のチーム [右のチームの色]。大きさは映像の高さに合わせる
function drawScoreboard(w, h, ctx = screenCtx) {
  const s = Math.min(w, h) / 720; // 720p で 1
  const pad = 20 * s;
  const boxH = 64 * s;
  const font = (size, weight = 800) => `${weight} ${size}px "M PLUS Rounded 1c", "Hiragino Maru Gothic ProN", sans-serif`;
  // チーム名がないときは、名前の代わりにチームの色の丸
  // 左右（入れかえたときは them が左）。下の「Us」は左、「Them」は右のこと
  const left = state.swapped ? { name: state.teamThem, color: state.colorThem, score: state.them } : { name: state.teamUs, color: state.colorUs, score: state.us };
  const right = state.swapped ? { name: state.teamUs, color: state.colorUs, score: state.us } : { name: state.teamThem, color: state.colorThem, score: state.them };
  const nameUs = left.name.trim();
  const nameThem = right.name.trim();
  const dot = 26 * s;
  const score = `${left.score} - ${right.score}`;
  ctx.font = font(26 * s);
  const nameUsW = nameUs ? ctx.measureText(nameUs).width : dot;
  const nameThemW = nameThem ? ctx.measureText(nameThem).width : dot;
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
  ctx.fillStyle = left.color;
  ctx.fillRect(x + gap * 0.6, y + 12 * s, chip, boxH - 24 * s);
  ctx.fillStyle = right.color;
  ctx.fillRect(x + boxW - gap * 0.6 - chip, y + 12 * s, chip, boxH - 24 * s);
  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "middle";
  let cx = x + gap * 0.6 + chip + gap;
  // 名前、なければ色の丸（白いふちで、濃い札の上でも見える）
  const nameOrDot = (name, color, at) => {
    if (name) {
      ctx.font = font(26 * s);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(name, at, y + boxH / 2 + 1 * s);
      return;
    }
    ctx.beginPath();
    ctx.arc(at + dot / 2, y + boxH / 2, dot / 2, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 2.5 * s;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();
  };
  nameOrDot(nameUs, left.color, cx);
  cx += nameUsW + gap * 1.5;
  ctx.font = font(40 * s);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(score, cx, y + boxH / 2 + 2 * s);
  cx += scoreW + gap * 1.5;
  nameOrDot(nameThem, right.color, cx);
  ctx.restore();
}

// ---- GOAL のエフェクト：＋1 のとき、画面の真ん中に得点したチームの色の帯と「GOAL!」を2秒ほど（動画にも入る） ----
const GOAL_FX_MS = 2200;
let goalFx = null; // { side: "us"|"them", at: 時刻 }

// 明るい色の上は濃い字（白いチームの帯でも読める）
const isLight = (hex) => {
  const n = parseInt(String(hex).slice(1), 16);
  return ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114 > 170;
};

function drawGoalFx(w, h, c = screenCtx) {
  if (!goalFx) return;
  const t = (performance.now() - goalFx.at) / GOAL_FX_MS;
  if (t >= 1) {
    goalFx = null;
    return;
  }
  const s = Math.min(w, h) / 720;
  const color = goalFx.side === "us" ? state.colorUs : state.colorThem;
  const name = (goalFx.side === "us" ? state.teamUs : state.teamThem).trim();
  const ink = isLight(color) ? "#14231a" : "#ffffff";
  // 出てくる（0〜10%）・とどまる・消える（80〜100%）
  const alpha = t < 0.1 ? t / 0.1 : t > 0.8 ? (1 - t) / 0.2 : 1;
  // 字は最初に大きく出て、すっと元の大きさに（ぽんと出る感じ）
  const pop = t < 0.12 ? 1.35 - (0.35 * t) / 0.12 : 1;
  const bandH = 190 * s;
  const y = h / 2 - bandH / 2;
  const font = (size) => `800 ${size}px "M PLUS Rounded 1c", "Hiragino Maru Gothic ProN", sans-serif`;
  c.save();
  c.globalAlpha = alpha;
  // 帯：横いっぱいに、チームの色（少し透ける）と、上下の白い線
  c.fillStyle = color;
  c.globalAlpha = alpha * 0.88;
  c.fillRect(0, y, w, bandH);
  c.globalAlpha = alpha;
  c.fillStyle = "#ffffff";
  c.fillRect(0, y - 5 * s, w, 5 * s);
  c.fillRect(0, y + bandH, w, 5 * s);
  // GOAL! と、下にチーム名・新しいスコア
  c.translate(w / 2, h / 2 - 18 * s);
  c.scale(pop, pop);
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillStyle = ink;
  c.shadowColor = "rgba(0, 0, 0, 0.25)";
  c.shadowBlur = 10 * s;
  c.font = font(112 * s);
  c.fillText("⚽ GOAL!", 0, 0);
  c.restore();
  c.save();
  c.globalAlpha = alpha;
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillStyle = ink;
  c.font = font(34 * s);
  c.fillText(`${name ? `${name}　` : ""}${state.us} - ${state.them}`, w / 2, h / 2 + 62 * s);
  c.restore();
}

// ---- 得点の ＋・−（録画中でも押せる。0 より下にはしない）。＋1 のときは GOAL のエフェクト ----
// 点を変える（＋1・−1）。押したボタンが一瞬光る（画面のまんなかには何も出さない。動画に入るのか迷わせないため。
// いまの点は、動画に入る左上の得点板で見える）。Android は軽く震える（iPhone のブラウザは震えない）。
// 押しまちがいは、そのチームの −1 で直す（画面がごちゃつかないよう「取り消す」ボタンは出さない）
function changeScore(key, delta, button) {
  state[key] = Math.max(0, state[key] + delta);
  if (delta > 0 && state.goalFx) goalFx = { side: key, at: performance.now() };
  if (delta < 0) goalFx = null; // 取り消したら消す
  save();
  navigator.vibrate?.(delta > 0 ? 30 : [15, 50, 15]);
  if (button) {
    button.classList.remove("is-hit");
    void button.offsetWidth; // 続けて押しても、はじめから光らせなおす
    button.classList.add("is-hit");
  }
}
document.querySelectorAll("[data-score]").forEach((b) => b.addEventListener("click", () => changeScore(b.dataset.score, Number(b.dataset.delta), b)));

// ---- 録画 ----
// LINE で送れる動画は 5分まで。いつも5分ごとに MediaRecorder を新しくして、1本ずつの動画（clips）にする
// （あとから動画を切るのはブラウザでは難しいため）。5分以下なら1本だけ。
// 5分を超えたときだけ、止めたあとの保存の画面で「全部（5分ごと）・最初の5分・最後の5分（最後の1本）」から選べる
// 1本の長さ（LINE の5分に少し余裕をもたせて 4分55秒）。確かめるときは ?segment=秒 で短くできる
const SEGMENT_MS = (Number(new URLSearchParams(location.search).get("segment")) || 295) * 1000;
let recorder = null;
let recording = false;
let chunks = [];
// 録り終えた動画 [{ blob, type, from, to, take, takeAt, file, url, saved }]。from・to はその回の録りはじめからの秒。
// 「スコアそのままで続きを撮る」で録りなおしても前の動画は消さず、続けて足していく（take が何回目の録画か）。
// 消すのは「0 - 0 から撮りなおす」のときだけ（保存していない動画があれば確かめる）
let clips = [];
let take = 0;
let startedAt = 0;
let clipStartedAt = 0;
let tick = 0;
let segmentTimer = 0;
let recordStream = null;
const activeRecs = new Set(); // まだ止まりきっていない録画（区切った直後は、前の1本と次の1本が少し重なる）
let mimeType = "";

// この端末で録れる形式（iPhone は mp4、Android・パソコンは webm のことが多い）
function pickMimeType() {
  const types = ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
  return types.find((t) => window.MediaRecorder?.isTypeSupported?.(t)) || "";
}

// 1本ぶんの録画をはじめる。止まったら clips に足し、続けるなら次の1本、終わりなら保存のシート
function startClip() {
  const rec = new MediaRecorder(recordStream, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: 6_000_000 });
  const parts = [];
  const from = Math.round((Date.now() - startedAt) / 1000);
  rec.addEventListener("dataavailable", (e) => e.data.size && parts.push(e.data));
  rec.addEventListener("stop", () => {
    activeRecs.delete(rec);
    const type = rec.mimeType || parts[0]?.type || "video/webm";
    const blob = new Blob(parts, { type });
    const to = Math.round((Date.now() - startedAt) / 1000);
    if (blob.size) clips.push({ blob, type, from, to, take, takeAt: startedAt, saved: false });
    // 録画を止めて、すべての1本が止まりきったら保存のシート（止まる順がずれても、録った順に並べる）
    if (!recording && !activeRecs.size) {
      clips.sort((a, b) => a.take - b.take || a.from - b.from);
      showSaved();
    }
  });
  activeRecs.add(rec);
  rec.start(1000); // 1秒ごとに区切って受け取る（長く録っても途中で失いにくい）
  recorder = rec;
  clipStartedAt = Date.now();
  clearTimeout(segmentTimer);
  segmentTimer = setTimeout(() => {
    rec.stop(); // 5分ごとに分ける：いまの1本を閉じて、すぐ次の1本
    startClip();
  }, SEGMENT_MS);
}

function startRecording() {
  if (!window.MediaRecorder || !screen.captureStream) {
    alert("この端末のブラウザでは録画できません。");
    return;
  }
  // カメラが使えていないとき（許可していない・ほかのアプリが使っている）は録画しない
  if (!cameraStream) {
    alert("カメラが使えません。「← 戻る」から、もう一度「カメラを開く」を押して、カメラとマイクを許可してください。");
    return;
  }
  recordStream = screen.captureStream(30);
  cameraStream.getAudioTracks().forEach((t) => recordStream.addTrack(t));
  mimeType = pickMimeType();
  take += 1; // 前の動画は消さない（続きを撮るとき）
  pick = "all";
  recording = true;
  startedAt = Date.now();
  startClip();
  $("record").classList.add("is-on");
  $("studio").classList.add("is-recording");
  $("record").setAttribute("aria-label", "録画を止める（長押し）");
  tick = setInterval(showElapsed, 500);
  showElapsed();
}

function stopRecording() {
  clearTimeout(segmentTimer);
  if (recording) {
    recording = false;
    if (recorder?.state === "recording") recorder.stop();
  }
  clearInterval(tick);
  $("elapsed").textContent = "";
  $("record").classList.remove("is-on");
  $("studio").classList.remove("is-recording");
  $("record").setAttribute("aria-label", "録画をはじめる");
}

const clock = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

// 録画中の時間。5分を超えて分けはじめたら「（2本目）」
function showElapsed() {
  const sec = Math.floor((Date.now() - startedAt) / 1000);
  const done = takeClips().length;
  const note = done ? `（${done + 1}本目）` : "";
  $("elapsed").textContent = `${clock(sec)}${note}`;
}

// 止めたら：見返し・保存・共有（何本かあるときは1本ずつ、またはまとめて）
function showSaved() {
  $("sharedNote").hidden = true;
  $("restartSave").classList.add("ghost");
  // 今回の録画の動画に名前をつける（前の回の動画は、もう名前がついている）
  const now = takeClips();
  now.forEach((c, i) => {
    const d = new Date(c.takeAt);
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;
    const ext = c.type.includes("mp4") ? "mp4" : "webm";
    const name = now.length > 1 ? `score-${stamp}-${i + 1}.${ext}` : `score-${stamp}.${ext}`;
    c.file = new File([c.blob], name, { type: c.type });
    c.url = URL.createObjectURL(c.blob);
  });
  showSaveGuide();
  // 今回の録画が5分を超えていたら（2本以上）、どれを残すか選ぶ：全部・最初の5分・最後の5分
  $("pickClips").hidden = now.length < 2;
  renderClips();
  $("saveSheet").hidden = false;
}

// 保存のしかた：iPhone・iPad は共有から「ビデオを保存」で写真へ。共有できる端末は LINE などへ、できなければ ⬇️ で保存
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
function showSaveGuide() {
  const canShare = clips.length && navigator.canShare?.({ files: [clips[0].file] });
  $("saveGuide").hidden = !clips.length;
  $("saveGuide").textContent = isIOS && canShare
    ? "📱 写真に残すには「📤 保存・共有」→「ビデオを保存」。LINE に送るときは、そのまま LINE を選べます。"
    : canShare
      ? "📱 「📤 保存・共有」から LINE などに送れます。端末に残すときは ⬇️ を押してください。"
      : "⬇️ を押すと、この端末に保存できます。";
}

// state の「どれを残すか」に合う動画（clips の番号）
let pick = "all";
// 今回の録画（いちばん新しい回）の動画
const takeClips = () => clips.filter((c) => c.take === take);
// 出す動画（clips の番号）：前の回の動画は全部、今回の録画は「どれを残すか」に合うもの
const pickedIndexes = () => {
  const now = clips.map((c, i) => (c.take === take ? i : -1)).filter((i) => i >= 0);
  const earlier = clips.map((c, i) => (c.take !== take ? i : -1)).filter((i) => i >= 0);
  const chosen = pick === "first" ? now.slice(0, 1) : pick === "last" ? now.slice(-1) : now;
  return [...earlier, ...chosen];
};

function renderClips() {
  document.querySelectorAll("[data-pick]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.pick === pick)));
  const shown = pickedIndexes();
  const list = $("clipList");
  list.replaceChildren(
    ...shown.map((i) => {
      const c = clips[i];
      const row = document.createElement("div");
      row.className = "clip";
      const sameTake = clips.filter((x) => x.take === c.take);
      const label = `${take > 1 || c.take !== take ? `${takeNumber(c.take)}回目　` : ""}${sameTake.length > 1 ? `${sameTake.indexOf(c) + 1}本目　` : ""}${clock(c.from)}〜${clock(c.to)}（${(c.blob.size / 1024 / 1024).toFixed(1)}MB）${c.saved ? "　✓" : ""}`;
      const play = Object.assign(document.createElement("button"), { type: "button", className: "clip-play", textContent: label });
      play.addEventListener("click", () => showClip(i));
      const share = Object.assign(document.createElement("button"), { type: "button", className: "clip-btn", textContent: "📤 保存・共有" });
      share.hidden = !navigator.canShare?.({ files: [c.file] });
      share.addEventListener("click", () => shareFiles([c]));
      const down = Object.assign(document.createElement("a"), { className: "clip-btn", href: c.url, download: c.file.name, textContent: "⬇️" });
      down.setAttribute("aria-label", `${c.file.name} をダウンロード`);
      down.addEventListener("click", () => markSaved([c]));
      row.dataset.index = String(i);
      row.append(play, share, down);
      return row;
    })
  );
  const files = shown.map((i) => clips[i].file);
  const now = takeClips();
  const earlier = clips.length - now.length;
  $("shareAll").hidden = files.length < 2 || !navigator.canShare?.({ files });
  $("saveInfo").textContent = [
    now.length > 1 ? `5分を超えたので、${now.length}本（1本 5分まで）に分けて録りました。LINE でそのまま送れます。` : now.length ? "" : "録れませんでした。もう一度お試しください。",
    earlier ? `前に録った動画（${earlier}本）も下に残っています。` : ""
  ].filter(Boolean).join("");
  if (shown.length) showClip(shown[shown.length - 1]);
}
document.querySelectorAll("[data-pick]").forEach((b) =>
  b.addEventListener("click", () => {
    pick = b.dataset.pick;
    renderClips();
  })
);

function showClip(i) {
  $("playback").src = clips[i].url;
  document.querySelectorAll(".clip").forEach((row) => row.classList.toggle("is-current", row.dataset.index === String(i)));
}

// 共有は動画だけ（題名や文字をつけると、LINE などで別のメッセージとして届くことがあるため）
async function shareFiles(list) {
  try {
    await navigator.share({ files: list.map((c) => c.file) });
    markSaved(list);
    markShared();
  } catch {
    // やめたときは何もしない
  }
}
// 保存・共有した動画に印（✓）。0 - 0 にするとき、まだ保存していない動画があるか確かめるのに使う
function markSaved(list) {
  list.forEach((c) => (c.saved = true));
  renderClips();
}
// 何回目の録画か（0 - 0 にしてからの数え方）
const takeNumber = (t) => [...new Set(clips.map((c) => c.take))].sort((a, b) => a - b).indexOf(t) + 1;

// 共有がすんだら：「✓ 共有できました」と、「0 - 0 から撮りなおす」を目立たせる（次の試合へ）
function markShared() {
  $("sharedNote").hidden = false;
  $("restartSave").classList.remove("ghost");
}
$("shareAll").addEventListener("click", () => shareFiles(pickedIndexes().map((i) => clips[i])));
const closeSaveSheet = () => {
  $("saveSheet").hidden = true;
  $("playback").pause();
};
// スコアそのままで、撮る画面にもどる（後半など）
$("closeSave").addEventListener("click", closeSaveSheet);
// 0 - 0 にして、撮る画面にもどる（次の試合など）。ここで、いままでの動画を消す（保存していないものがあれば確かめる）
$("restartSave").addEventListener("click", () => {
  const unsaved = clips.filter((c) => !c.saved).length;
  if (unsaved && !confirm(`まだ保存・共有していない動画が ${unsaved}本 あります。0 - 0 にすると、いままでの動画は消えます。よいですか？`)) return;
  clips.forEach((c) => c.url && URL.revokeObjectURL(c.url));
  clips = [];
  state.us = 0;
  state.them = 0;
  save();
  showSetupScore();
  closeSaveSheet();
});
// 録画ボタン：はじめるのはタップ、止めるのは長押し（0.8秒。押しまちがいで止まらないように。押しているあいだ赤い輪がたまる）。
// 録画中に短く押したときは「長押しで止める」を目立たせる。キーボード（Enter・Space）では、そのまま止められる
const HOLD_MS = 800;
let holdTimer = 0;
let skipClickUntil = 0;
const recordBtn = $("record");
const endHold = () => {
  clearTimeout(holdTimer);
  recordBtn.classList.remove("is-holding");
};
recordBtn.addEventListener("pointerdown", () => {
  if (!recording) return;
  recordBtn.classList.add("is-holding");
  holdTimer = setTimeout(() => {
    endHold();
    skipClickUntil = Date.now() + 700; // 指をはなしたときの click で、また録画がはじまらないように
    navigator.vibrate?.(40);
    stopRecording();
  }, HOLD_MS);
});
["pointerup", "pointerleave", "pointercancel"].forEach((type) => recordBtn.addEventListener(type, endHold));
recordBtn.addEventListener("contextmenu", (e) => e.preventDefault()); // 長押しのメニューを出さない
recordBtn.addEventListener("click", (e) => {
  if (Date.now() < skipClickUntil) return;
  if (!recording) return startRecording();
  if (e.detail === 0) return stopRecording(); // キーボード
  const hint = $("recordHint");
  hint.classList.remove("is-flash");
  void hint.offsetWidth;
  hint.classList.add("is-flash");
  setTimeout(() => hint.classList.remove("is-flash"), 1500);
});
$("openCamera").addEventListener("click", openCamera);
$("back").addEventListener("click", closeCamera);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && cameraStream && !wakeLock) keepScreenOn();
});
