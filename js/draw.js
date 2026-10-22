// ろくが：描く（得点板・GOAL のエフェクト）。撮る画面・プレビュー・撮った動画に（得点板をつける）で共通に使う。
// 読み込む順は index.html（core → draw → setup → studio → record → editor → render → main）。
"use strict";

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

// ---- GOAL のエフェクト：＋1 のとき、画面の真ん中に得点したチームの色の帯と「⚽ GOAL!」を2秒ほど（動画にも入る）。アイコン・文字は変えられる ----
const GOAL_FX_MS = 2200;
let goalFx = null; // { side: "us"|"them", at: 時刻 }


// エフェクトに出す字：アイコン＋文字（文字が空なら GOAL!）
const fxLabel = () => [state.fxIcon, state.fxText.trim() || "GOAL!"].filter(Boolean).join(" ");

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
  // スコアは左上の得点板と同じ左右の並び（⇄ で入れかえたときは them が左）
  const [left, right] = state.swapped ? [state.them, state.us] : [state.us, state.them];
  c.fillText(`${name ? `${name}　` : ""}${left} - ${right}`, w / 2, h / 2 + 62 * s);
  c.restore();
}
