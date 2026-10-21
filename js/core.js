// ろくが（RoQga）：試合の動画に、得点板（チーム名とスコア）をそのまま入れて残す。
// 使い方は2つ：📹 撮る（カメラで撮りながら ＋1）／🎞 あとから付ける（撮っておいた動画に、得点の時間を入れて書き出す）。
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
//   editor.js あとから付ける
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
