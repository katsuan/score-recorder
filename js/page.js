// ろくが（RoQga）：試合の動画に、得点板（チーム名とスコア）をそのまま入れて残す。
// 使い方は2つ：📹 撮りながら（カメラで撮りながら ＋1）／🎞 撮った動画に（得点板をつける）（撮っておいた動画に、得点の時間を入れて書き出す）。
// どちらも ⚡ ハイライト（得点・⭐ ナイスプレーの前後だけをつなぐ）を作れる。
// しくみ：映像と得点板を1つのキャンバスに描き、そのキャンバス（＋音）を MediaRecorder で録る。
// ボタン（＋1・録画など）はキャンバスの上に重ねた別の部品なので、動画には入らない。
// 動画はこの端末にだけ残す（保存・共有メニュー、ダウンロード）。サーバーには送らない。
//
// ファイル（この順に読む。index.html の <script>）：
//   js/page.js   ページ全体で使う小さな道具（$・時間の文字・色・お知らせ・Q キットの部品へのつなぎ）  ← このファイル
//   js/store.js  覚えておくこと（state）。端末に残す・さくせん盤とチーム名・色を分けあう
//   js/draw.js   描く（得点板・GOAL のエフェクト・つなぎ目の柄）
//   js/setup.js  はじめの画面（スコア・左右の入れかえ・GOAL の設定・プレビュー・使い方のタブ）
//   js/studio.js 撮る画面（カメラ・映像を描く・倒して撮る・＋1 の位置・得点の ＋・−・⭐ ナイス）
//   js/record.js 録画（5分ごとに分ける）と保存の画面
//   js/editor.js 撮った動画に（得点板をつける）
//   js/render.js 書き出し（共通）と ⚡ ハイライト
//   app.js       入口：はじめに一度だけ動かすこと（最初の表示）
// どのファイルも、関数・変数とボタンの動きを決めるだけ。読みこんだときに動かすことは app.js にまとめる
// （ほかのファイルの関数を使うので、全部読んでから）。
"use strict";

// id から画面の部品を返す
const $ = (id) => document.getElementById(id);
// 数を2けたの文字にする（5 → "05"）
const pad2 = (n) => String(n).padStart(2, "0");
// 秒を「分:秒」の文字にする（65 → "1:05"）
const clock = (sec) => `${Math.floor(sec / 60)}:${pad2(sec % 60)}`;
// 明るい色か（白いユニフォームなど）。明るい色の上は濃い字にする（＋1 のボタン・GOAL の帯）
const isLight = (hex) => {
  const n = parseInt(String(hex).replace("#", ""), 16) || 0;
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255 > 0.62;
};
// 色の上にのせる字の色（明るい色なら黒、暗い色なら白）を返す
const inkFor = (hex) => (isLight(hex) ? "#1a1a1a" : "#ffffff");
// お知らせだけの窓（ボタンは「閉じる」1つ）
const notice = (title, text) => LineShareUI.ask({ title, ...(text ? { text } : {}), ok: "閉じる", cancel: null });
// 押したボタンを一瞬光らせる（続けて押しても、はじめから光らせなおす）
const flash = (el, cls = "is-hit") => {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
};

// ---- Q キットのあとから読まれる部品（tool-share.js・log.js）。電波がない・読めない・止まったときも、ろくがはそのまま使える ----
// 季節の絵文字（season.js）：うれしい瞬間の短い文に、ときどき足す
const seasonal = (text) => {
  try {
    return window.QSeason ? window.QSeason.decorate(text) : text;
  } catch {
    return text;
  }
};
// 利用状況の記録（log.js。開いたことは log.js がひとりでに記録する）。
// 送るのは、何をしたか（kind）と数（秒・本数）だけ。動画・チーム名などは送らない（送れなかった記録は捨てる）
const logUse = (kind, count = "") => {
  try {
    window.LineShareLog?.track("send", { kind, count });
  } catch {
    // 記録できなくても使える
  }
};
