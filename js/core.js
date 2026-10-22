// ろくが（RoQga）：試合の動画に、得点板（チーム名とスコア）をそのまま入れて残す。
// 使い方は2つ：📹 撮りながら（カメラで撮りながら ＋1）／🎞 撮った動画に（得点板をつける）（撮っておいた動画に、得点の時間を入れて書き出す）。
// どちらも ⚡ ハイライト（得点・⭐ ナイスプレーの前後だけをつなぐ）を作れる。
// しくみ：映像と得点板を1つのキャンバスに描き、そのキャンバス（＋音）を MediaRecorder で録る。
// ボタン（＋1・録画など）はキャンバスの上に重ねた別の部品なので、動画には入らない。
// 動画はこの端末にだけ残す（保存・共有メニュー、ダウンロード）。サーバーには送らない。
//
// ファイル（js/。この順に読む。index.html の <script>）：
//   core.js   共通の道具と、覚えておくこと（state）  ← このファイル
//   draw.js   描く（得点板・GOAL のエフェクト）
//   setup.js  はじめの画面（スコア・左右の入れかえ・GOAL の設定・プレビュー・保存したチーム・使い方のタブ）
//   studio.js 撮る画面（カメラ・映像を描く・倒して撮る・＋1 の位置・得点の ＋・−・⭐ ナイス）
//   record.js 録画（5分ごとに分ける）と保存の画面
//   editor.js 撮った動画に（得点板をつける）
//   render.js 書き出し（共通）と ⚡ ハイライト
//   main.js   はじめに一度だけ動かすこと（最初の表示）
// どのファイルも、関数・変数とボタンの動きを決めるだけ。読みこんだときに動かすことは main.js にまとめる
// （ほかのファイルの関数を使うので、全部読んでから）。
"use strict";

// ---- 共通の道具 ----
const $ = (id) => document.getElementById(id);
const clock = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
// 明るい色か（白いユニフォームなど）。明るい色の上は濃い字にする（＋1 のボタン・GOAL の帯）
const isLight = (hex) => {
  const n = parseInt(String(hex).replace("#", ""), 16) || 0;
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255 > 0.62;
};
const inkFor = (hex) => (isLight(hex) ? "#1a1a1a" : "#ffffff");
// ⚡ ハイライト：得点・⭐ ナイスプレーの何秒前から何秒後までを入れるか
const HIGHLIGHT_BEFORE = 10;
const HIGHLIGHT_AFTER = 6;
// 時間（秒）のならびから、ハイライトに入れるところ [はじめ, 終わり] のならびを作る。近いものはひとつにつなぐ
function highlightSpans(times, end) {
  const spans = [];
  [...times]
    .sort((a, b) => a - b)
    .forEach((t) => {
      const a = Math.max(0, t - HIGHLIGHT_BEFORE);
      const b = Math.min(end, t + HIGHLIGHT_AFTER);
      const last = spans[spans.length - 1];
      if (last && a <= last[1]) last[1] = Math.max(last[1], b);
      else spans.push([a, b]);
    });
  return spans;
}

// ---- 覚えておくこと（state）。この端末の localStorage に残す ----
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

// チームの色の選びかた（さくせん盤と同じ形の丸いボタン）。ほかの色はカスタムで
const TEAM_COLORS = [
  { label: "緑", hex: "#22a447" },
  { label: "黄", hex: "#ffd23f" },
  { label: "白", hex: "#ffffff" }
];
// チーム名・色は、さくせん盤と共通（同じ katsuan.github.io の soccer:state の team・opponent・ourColor・oppColor）。
// 左のチーム（us）＝さくせん盤の自チーム、右のチーム（them）＝相手。どちらで変えても、もう一方にも出る。
// さくせん盤にまだなければ、ろくがで前に使ったもの → 初めの値（緑・白）
const saqsen = load(SAQSEN_KEY);
const saved = load(STORE_KEY);
const pickHex = (...list) => list.find((c) => /^#[0-9a-f]{6}$/i.test(String(c || ""))) || "#ffffff";
const state = {
  teamUs: saqsen.team ?? saved.teamUs ?? "",
  teamThem: saqsen.opponent ?? saved.teamThem ?? "",
  colorUs: pickHex(saqsen.ourColor, saved.colorUs, TEAM_COLORS[0].hex),
  colorThem: pickHex(saqsen.oppColor, saved.colorThem, TEAM_COLORS[2].hex),
  us: Number(saved.us) || 0,
  them: Number(saved.them) || 0,
  // ＋1 のとき「GOAL!」のエフェクトを動画に入れるか。はじめは出す（ON）。
  // 前は「はじめは出さない」で OFF が覚えられているので、fxV（この決まりの版）が 2 でなければ、いちどだけ ON にする
  goalFx: saved.fxV === 2 ? saved.goalFx !== false : true,
  fxV: 2,
  fxIcon: typeof saved.fxIcon === "string" ? saved.fxIcon : "⚽", // エフェクトのアイコン（"" はなし）。サッカー以外でも
  fxCustom: typeof saved.fxCustom === "string" ? saved.fxCustom : "", // カスタムのアイコン（好きな絵文字・文字。2文字まで）
  fxText: typeof saved.fxText === "string" ? saved.fxText : "", // エフェクトの文字（空なら GOAL!）
  swapped: saved.swapped === true, // 左右を入れかえる（us を右に）。us・them は中の呼び名で、自分のチームとはかぎらない
  hand: ["left", "right"].includes(saved.hand) ? saved.hand : "center", // ＋1・録画のまとまりの位置（片手で持つ側に寄せる）
  turn: ["left", "right"].includes(saved.turn) ? saved.turn : null // 縦の画面のまま倒して撮るときの向き（前に選んだもの。次からは選ばずに始める）
};
// チーム名・色を、さくせん盤の側にも書く（ほかのところはそのまま）
const shareTeams = () => {
  try {
    const now = load(SAQSEN_KEY);
    Object.assign(now, { team: state.teamUs, opponent: state.teamThem, ourColor: state.colorUs, oppColor: state.colorThem });
    localStorage.setItem(SAQSEN_KEY, JSON.stringify(now));
  } catch {
    // 残せなくても使える
  }
};
