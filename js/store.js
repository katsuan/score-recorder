// ろくが：覚えておくこと（state）。この端末の localStorage に残し、チーム名・色はさくせん盤と分けあう。
// 読み込む順は index.html（page → store → draw → setup → studio → record → editor → render → app.js）。
"use strict";

const STORE_KEY = "roqga:state";
const SAQSEN_KEY = "soccer:state"; // さくせん盤（同じ katsuan.github.io）のチーム名・色

// 端末に残った中身は、ほかのツール（さくせん盤）や前の版が書いたものもあるので、形を確かめてから使う
const isObj = (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const load = (key) => {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return isObj(v) ? v : {};
  } catch {
    return {};
  }
};
// 文字なら max 字まで（絵文字も1字）。文字でなければ null
const textOf = (v, max) => (typeof v === "string" ? [...v].slice(0, max).join("") : null);
// 点は 0〜999 の整数
const scoreOf = (v) => Math.min(999, Math.max(0, Math.floor(Number(v)) || 0));
const NAME_MAX = 20; // さくせん盤のチーム名と同じ
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
  teamUs: textOf(saqsen.team, NAME_MAX) ?? textOf(saved.teamUs, NAME_MAX) ?? "",
  teamThem: textOf(saqsen.opponent, NAME_MAX) ?? textOf(saved.teamThem, NAME_MAX) ?? "",
  colorUs: pickHex(saqsen.ourColor, saved.colorUs, TEAM_COLORS[0].hex),
  colorThem: pickHex(saqsen.oppColor, saved.colorThem, TEAM_COLORS[2].hex),
  us: scoreOf(saved.us),
  them: scoreOf(saved.them),
  // ＋1 のとき「GOAL!」のエフェクトを動画に入れるか。はじめは出す（ON）。
  // 前は「はじめは出さない」で OFF が覚えられているので、fxV（この決まりの版）が 2 でなければ、いちどだけ ON にする
  goalFx: saved.fxV === 2 ? saved.goalFx !== false : true,
  fxV: 2,
  // ⚡ ハイライトのつなぎ目の柄（draw.js の TRANSITIONS の id）。はじめは RoQga
  transition: textOf(saved.transition, 40) ?? "roqga",
  // 得点板を出すか（出さないときは GOAL の演出・つなぎ目だけ）。プレビュー・撮る画面・撮った動画に・書き出す動画のすべてに効く。はじめは出す
  board: saved.board !== false,
  fxIcon: textOf(saved.fxIcon, 16) ?? "⚽", // エフェクトのアイコン（"" はなし）。サッカー以外でも
  fxCustom: textOf(saved.fxCustom, 16) ?? "", // カスタムのアイコン（好きな絵文字・文字。2文字まで）
  fxText: textOf(saved.fxText, 12) ?? "", // エフェクトの文字（空なら GOAL!）
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

// 左右の並び（⇄ で入れかえたときは them が左）。us・them の順にわたすと、[左, 右] で返す
const inOrder = (us, them) => (state.swapped ? [them, us] : [us, them]);
