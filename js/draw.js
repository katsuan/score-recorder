// ろくが：描く（得点板・GOAL のエフェクト）。撮る画面・プレビュー・撮った動画に（得点板をつける）で共通に使う。
// 読み込む順は index.html（page → store → draw → setup → studio → record → editor → render → app.js）。
"use strict";

// 得点板：左上に濃い札。[左のチームの色] 左のチーム 2 - 1 右のチーム [右のチームの色]。大きさは映像の高さに合わせる。
// opts：score（{ us, them }。なければいまのスコア）・scale（何倍か）・center（まん中の高さ。上からの割合。結果の札）
function drawScoreboard(w, h, ctx = screenCtx, opts = {}) {
  if (!state.board) return; // 「得点板：出さない」（👀 プレビューの欄）
  const s = (Math.min(w, h) / 720) * (opts.scale || 1); // 720p で 1
  const pad = 20 * s;
  const boxH = 64 * s;
  // 得点板の字の形（太さと大きさ）を返す
  const font = (size, weight = 800) => `${weight} ${size}px "M PLUS Rounded 1c", "Hiragino Maru Gothic ProN", sans-serif`;
  // チーム名がないときは、名前の代わりにチームの色の丸
  // 左右（入れかえたときは them が左）。下の「Us」は左、「Them」は右のこと
  const us = opts.score ? opts.score.us : state.us;
  const them = opts.score ? opts.score.them : state.them;
  const [left, right] = inOrder({ name: state.teamUs, color: state.colorUs, score: us }, { name: state.teamThem, color: state.colorThem, score: them });
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
  // 結果の札：名前が長くてはみ出すときは小さくして描きなおす
  if (opts.center && boxW > w * 0.92) return drawScoreboard(w, h, ctx, { ...opts, scale: ((opts.scale || 1) * w * 0.92) / boxW });
  const x = opts.center ? (w - boxW) / 2 : pad;
  const y = opts.center ? h * opts.center - boxH / 2 : pad;
  ctx.save();
  ctx.fillStyle = "rgba(12, 22, 16, 0.8)";
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, boxW, boxH, 14 * s);
  else ctx.rect(x, y, boxW, boxH); // 角を丸められない古いブラウザ（iOS 15 まで）は四角
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

// ---- 結果の札（「💾 保存の設定」）：動画の最初か最後に 2 秒、RoQga の面（つなぎ目で画面をおおったところ）に、得点板を大きく（1.6 倍）してロゴの下に。
// 最初に入れると、LINE などのサムネ（最初のコマ）に結果が出る。アプリ版（ResultCardRenderer）と同じ絵・同じ寸法 ----
const RESULT_CARD_MS = 2000;
let resultCard = null; // いま出している札のスコア { us, them }（出していなければ null）
// 結果の札を描く（score：最後のスコア）
function drawResultCard(w, h, c, score) {
  drawRoqgaWipe(w, h, c, 0.5);
  drawScoreboard(w, h, c, { score, scale: 1.6, center: 0.79 });
}
// その動画に結果の札を入れるところ（"start"・"end"・null）。kind：highlight（⚡ ハイライト）か full（全部）。
// 得点板を出さないときは入れない（チームが分からないため）。はじめはハイライトだけ
function resultCardPlace(kind) {
  if (!state.board || state.resultCard === "none") return null;
  return kind === "highlight" || state.resultOnFull ? state.resultCard : null;
}

// ---- ⭐ ナイスのエフェクト：⭐ ナイスを押したとき、得点板のすぐ下（左上）に小さく「⭐ ナイス！」の札がぽんと出て、まわりに小さな星が散る（1.4 秒。動画にも入る）。
// GOAL より控えめ。「👀 プレビュー・得点板と演出」で出さないにもできる。アプリ版（NiceRenderer）と同じ絵・同じ動き ----
const NICE_FX_MS = 1400;
let niceFx = null; // { at: 時刻 }（出していなければ null）
// ⭐ ナイスのエフェクトを、押してから NICE_FX_MS のあいだ描く。終わったら消す
function drawNiceFx(w, h, c = screenCtx) {
  if (!niceFx) return;
  const p = (performance.now() - niceFx.at) / NICE_FX_MS;
  if (p >= 1) {
    niceFx = null;
    return;
  }
  drawNiceFxAt(w, h, c, p);
}
// ⭐ ナイスのエフェクトの、進みぐあい p（0〜1）のときの絵を描く
function drawNiceFxAt(w, h, c, p) {
  const s = Math.min(w, h) / 720;
  const alpha = p < 0.1 ? p / 0.1 : p > 0.75 ? (1 - p) / 0.25 : 1; // 出てくる・とどまる・消える
  const pop = p < 0.15 ? 1.3 - (0.3 * p) / 0.15 : 1; // はじめに少し大きく出て、元の大きさに
  const label = "⭐ ナイス！";
  c.save();
  c.globalAlpha = alpha;
  c.font = `800 ${34 * s * pop}px "M PLUS Rounded 1c", "Hiragino Maru Gothic ProN", sans-serif`;
  const pw = c.measureText(label).width + 44 * s * pop;
  const ph = 64 * s * pop;
  // 得点板のすぐ下（左上。得点板は左 20・上 20・高さ 64）。大きく出るときも左上の角は動かさない
  const cx = 20 * s + pw / 2;
  const cy = (20 + 64 + 12) * s + ph / 2;
  // 札：濃い地に金色のふち
  c.beginPath();
  if (c.roundRect) c.roundRect(cx - pw / 2, cy - ph / 2, pw, ph, ph / 2);
  else c.rect(cx - pw / 2, cy - ph / 2, pw, ph);
  c.fillStyle = "rgba(12, 22, 16, 0.8)";
  c.fill();
  c.lineWidth = 3 * s;
  c.strokeStyle = "#ffd64a";
  c.stroke();
  c.fillStyle = "#ffe082";
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillText(label, cx, cy + 1 * s);
  // まわりに散る小さな星（6つ。札のふちから外へ）
  const ease = 1 - (1 - p) ** 3;
  c.fillStyle = "#ffd64a";
  for (let i = 0; i < 6; i += 1) {
    const a = ((i * 60 + 30) * Math.PI) / 180;
    const x = cx + Math.cos(a) * (pw / 2 + 50 * s * ease);
    const y = cy + Math.sin(a) * (ph / 2 + 40 * s * ease);
    const r = 9 * s * (1 - p * 0.5);
    c.globalAlpha = alpha * (1 - p);
    c.beginPath();
    // 4つのとがりの星
    for (let j = 0; j < 8; j += 1) {
      const rr = j % 2 === 0 ? r : r * 0.35;
      const aa = (j * Math.PI) / 4;
      c.lineTo(x + Math.cos(aa) * rr, y + Math.sin(aa) * rr);
    }
    c.closePath();
    c.fill();
  }
  c.restore();
}

// ---- 何本目かの札：5分ごとに分けた書き出しで、各1本の最初の 2 秒、右上に「1本目（全3本）」（LINE などのサムネに出る）。
// pieceTotal：全部で何本か（0＝出さない・-1＝本数が前もって分からないので「2本目」だけ）。アプリ版（PieceBadgeRenderer）と同じ絵 ----
const PIECE_BADGE_MS = 2000;
let pieceTotal = 0;
// 何本目かの札を描く（分けていない・2 秒たったら描かない）
function drawPieceBadge(w, h, c) {
  if (!pieceTotal || performance.now() - clipStartedAt > PIECE_BADGE_MS) return;
  const s = Math.min(w, h) / 720;
  const label = pieceTotal > 0 ? `${clipNo}本目（全${pieceTotal}本）` : `${clipNo}本目`;
  c.save();
  c.font = `800 ${34 * s}px "M PLUS Rounded 1c", "Hiragino Maru Gothic ProN", sans-serif`;
  const pw = c.measureText(label).width + 44 * s;
  const ph = 64 * s;
  const x = w - 20 * s - pw;
  const y = 20 * s;
  c.beginPath();
  if (c.roundRect) c.roundRect(x, y, pw, ph, ph / 2);
  else c.rect(x, y, pw, ph);
  c.fillStyle = "rgba(12, 22, 16, 0.8)";
  c.fill();
  c.lineWidth = 3 * s;
  c.strokeStyle = "rgba(255, 255, 255, 0.85)";
  c.stroke();
  c.fillStyle = "#ffffff";
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillText(label, x + pw / 2, y + ph / 2 + 1 * s);
  c.restore();
}

// ---- GOAL のエフェクト：＋1 のとき、画面の真ん中に得点したチームの色の帯と「⚽ GOAL!」を2秒ほど（動画にも入る）。アイコン・文字は変えられる ----
const GOAL_FX_MS = 2200;
let goalFx = null; // { side: "us"|"them", at: 時刻, score?: { us, them }（下の行に出すスコア。なければいまのスコア） }
const NEUTRAL_FX_COLOR = "#1f6b38"; // 得点板を出さないときの帯（つなぎ目の柄と同じ芝の緑）


// エフェクトに出す字：アイコン＋文字（文字が空なら GOAL!）
const fxLabel = () => [state.fxIcon, state.fxText.trim() || "GOAL!"].filter(Boolean).join(" ");

// GOAL のエフェクト（帯と「⚽ GOAL!」）を、＋1 から GOAL_FX_MS のあいだ描く。終わったら消す
function drawGoalFx(w, h, c = screenCtx) {
  if (!goalFx) return;
  const t = (performance.now() - goalFx.at) / GOAL_FX_MS;
  if (t >= 1) {
    goalFx = null;
    return;
  }
  const s = Math.min(w, h) / 720;
  // 得点板を出さないときは、どちらのチームかを出さない（帯はろくがの芝の緑、下のチーム名・スコアもなし）
  const team = state.board;
  const color = team ? (goalFx.side === "us" ? state.colorUs : state.colorThem) : NEUTRAL_FX_COLOR;
  const name = team ? (goalFx.side === "us" ? state.teamUs : state.teamThem).trim() : "";
  const ink = isLight(color) ? "#14231a" : "#ffffff";
  // 出てくる（0〜10%）・とどまる・消える（80〜100%）
  const alpha = t < 0.1 ? t / 0.1 : t > 0.8 ? (1 - t) / 0.2 : 1;
  // 字は最初に大きく出て、すっと元の大きさに（ぽんと出る感じ）
  const pop = t < 0.12 ? 1.35 - (0.35 * t) / 0.12 : 1;
  const bandH = 190 * s;
  const y = h / 2 - bandH / 2;
  // エフェクトの字の形（太さと大きさ）を返す
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
  // GOAL! と、下にチーム名・新しいスコア（下の行がないとき＝得点板なしは、GOAL! を帯のまんなかに）
  // 下の行のスコア：見本などで決めた点があればそれ（goalFx.score）、なければいまのスコア
  const [left, right] = goalFx.score ? inOrder(goalFx.score.us, goalFx.score.them) : inOrder(state.us, state.them);
  const sub = goalFx.trial ? "（お試し）" : team ? `${left} - ${right}` : "";
  c.translate(w / 2, h / 2 - (sub ? 18 * s : 0));
  c.scale(pop, pop);
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillStyle = ink;
  c.shadowColor = "rgba(0, 0, 0, 0.25)";
  c.shadowBlur = 10 * s;
  // アイコンと文字（はじめの画面で変えられる。文字が空なら GOAL!）。長い文字は横からはみ出さないよう縮める
  const label = fxLabel();
  c.font = font(112 * s);
  const fit = Math.min(1, (w * 0.9) / Math.max(1, c.measureText(label).width));
  c.font = font(112 * s * fit);
  c.fillText(label, 0, 0);
  c.restore();
  c.save();
  c.globalAlpha = alpha;
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillStyle = ink;
  c.font = font(34 * s);
  // スコアは左上の得点板と同じ左右の並び（⇄ で入れかえたときは them が左）。
  // ▶ 試す・アイコンや文字を変えたときの見本（trial）は点を入れないので、スコアの代わりに「（お試し）」
  if (sub) c.fillText(`${name ? `${name}　` : ""}${sub}`, w / 2, h / 2 + 62 * s);
  c.restore();
}

// ---- ⚡ ハイライトのつなぎ目（トランジション）：切り出した部分のつなぎ目に、0.8 秒の柄を重ねる ----
// 前の部分の終わり 0.4 秒で柄が入ってきて画面をおおい、次の部分のはじめ 0.4 秒で抜けていく（動画の長さは変わらない）。
// 柄の一覧。premium: true は有料プランの柄（いまはまだない）。柄を足す・差しかえるときは、ここに1行と描き方（draw）を足す。
// アプリ版（q-roqga-ios の TransitionRenderer）も同じ柄・同じ動きにそろえる
const TRANSITION_SEC = 0.8;
const TRANSITIONS = [
  { id: "roqga", label: "RoQga", premium: false, draw: drawRoqgaWipe },
  { id: "none", label: "なし", premium: false, draw: null }
];
// つなぎ目の柄を id から探す（ない・有料のものは、はじめの柄）
const transitionOf = (id) => TRANSITIONS.find((tr) => tr.id === id && !tr.premium) || TRANSITIONS[0];

const transitionLogo = new Image();
transitionLogo.src = "logo.svg"; // 横長のロゴ（柄のまん中に置く）

// p：0（入りはじめ）→ 0.5（画面をおおう＝つなぎ目）→ 1（抜けきる）
function drawTransition(w, h, c, p) {
  const tr = transitionOf(state.transition);
  if (!tr.draw || p <= 0 || p >= 1) return;
  tr.draw(w, h, c, p);
}

// 書き出しの前に、柄の絵を作っておく（はじめて描くときに少し時間がかかり、つなぎ目がかくつくため）
function warmTransition(w, h) {
  if (w && h && transitionOf(state.transition).id === "roqga") roqgaPanel(w, h);
}

// RoQga：濃い緑のピッチの面（左右の辺が斜め）が右から入り、つなぎ目で画面をおおって、左へ抜ける。
// 面の中は芝刈りのしま模様と、うっすらハーフウェーラインとセンターサークル。斜めの辺に、対戦する2チームの色の線（得点板と同じく、左のチームが左側）。まん中に横長のロゴ。
// アプリ版（q-roqga-ios の TransitionRenderer）も同じ寸法・同じ動き
const wipeSlant = (h) => h * 0.22; // 斜めの辺の、上と下のずれ
// 面の横の位置（面の左上が x）：入るときはだんだん遅く、抜けるときはだんだん速く
function wipeOffset(p, w, h) {
  const slant = wipeSlant(h);
  // はじめは速く、だんだんゆっくり（0〜1 → 0〜1）
  const easeOut = (x) => 1 - (1 - x) ** 3;
  // はじめはゆっくり、だんだん速く（0〜1 → 0〜1）
  const easeIn = (x) => x ** 3;
  return p < 0.5 ? w + (-slant - w) * easeOut(p / 0.5) : -slant - (w + slant) * easeIn((p - 0.5) / 0.5);
}
let wipePanel = null; // 面の絵（大きさごとに 1 回だけ描く）
// つなぎ目の RoQga の柄（チームの色の斜めの面とロゴ）を描いたキャンバスを返す。大きさと色が同じあいだは使い回す
function roqgaPanel(w, h) {
  // 得点板の左右の並びのチームの色（⇄ で入れかえたときは them が左）
  const [leftColor, rightColor] = inOrder(state.colorUs, state.colorThem);
  const key = `${w}x${h}:${leftColor}:${rightColor}:${transitionLogo.complete}`;
  if (wipePanel && wipePanel.key === key) return wipePanel.canvas;
  const slant = wipeSlant(h);
  const W = w + slant * 2;
  const s = Math.min(w, h);
  const cv = document.createElement("canvas");
  cv.width = Math.ceil(W);
  cv.height = h;
  const c = cv.getContext("2d");
  // 平行四辺形（左の辺：上が右・下が左。右の辺も同じ向き）
  const shape = () => {
    c.beginPath();
    c.moveTo(slant, 0);
    c.lineTo(W, 0);
    c.lineTo(W - slant, h);
    c.lineTo(0, h);
    c.closePath();
  };
  c.save();
  shape();
  c.clip();
  const g = c.createLinearGradient(0, 0, W, h);
  g.addColorStop(0, "#1f6b38");
  g.addColorStop(1, "#14542e");
  c.fillStyle = g;
  c.fillRect(0, 0, W, h);
  // 芝刈りのしま模様
  c.fillStyle = "rgba(255, 255, 255, 0.05)";
  const band = h * 0.18;
  for (let x = 0; x < W; x += band * 2) c.fillRect(x, 0, band, h);
  // ハーフウェーラインとセンターサークル（うっすら）
  c.strokeStyle = "rgba(255, 255, 255, 0.14)";
  c.lineWidth = s * 0.006;
  c.beginPath();
  c.moveTo(W / 2, 0);
  c.lineTo(W / 2, h);
  c.stroke();
  c.beginPath();
  c.arc(W / 2, h / 2, h * 0.3, 0, Math.PI * 2);
  c.stroke();
  c.restore();
  // 斜めの辺：対戦する2チームの色の線を2本（左のチームの色が左側・右のチームの色が右側）
  const edge = (x0, inward, outer, inner) => {
    [[outer, 0, s * 0.016], [inner, s * 0.03, s * 0.016]].forEach(([color, gap, width]) => {
      const d = (gap + width / 2) * inward;
      c.strokeStyle = color;
      c.lineWidth = width;
      c.beginPath();
      c.moveTo(x0 + slant + d, 0);
      c.lineTo(x0 + d, h);
      c.stroke();
    });
  };
  edge(0, 1, leftColor, rightColor); // 左の辺（入ってくるときの先）：外側が左のチーム
  edge(W - slant, -1, rightColor, leftColor); // 右の辺（抜けていくときの後ろ）：外側が右のチーム
  // まん中に横長のロゴ（影つき）
  if (transitionLogo.complete && transitionLogo.naturalWidth) {
    const lh = s * 0.26;
    const lw = (lh * transitionLogo.naturalWidth) / transitionLogo.naturalHeight;
    c.save();
    c.shadowColor = "rgba(0, 0, 0, 0.35)";
    c.shadowBlur = s * 0.03;
    c.shadowOffsetY = s * 0.008;
    c.drawImage(transitionLogo, W / 2 - lw / 2, h / 2 - lh / 2, lw, lh);
    c.restore();
  }
  wipePanel = { key, canvas: cv };
  return cv;
}
// RoQga の柄を、進みぐあい p（0〜1）の位置に描く（右から入って、左へ抜ける）
function drawRoqgaWipe(w, h, c, p) {
  c.drawImage(roqgaPanel(w, h), wipeOffset(p, w, h), 0);
}
