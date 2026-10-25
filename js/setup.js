// ろくが：はじめの画面（チーム名・色・スコア・左右の入れかえ・GOAL の設定・プレビュー・使い方のタブ）。
// 読み込む順は index.html（page → store → draw → setup → studio → record → editor → render → app.js）。
"use strict";

// ---- はじめの画面 ----
$("teamUs").value = state.teamUs;
$("teamThem").value = state.teamThem;
// いまのスコア（左右の並びに合わせる）。点があるときだけ「0 - 0 にする」を出す
function showSetupScore() {
  $("setupScore").textContent = inOrder(state.us, state.them).join(" - ");
  document.querySelectorAll("[data-score-of]").forEach((b) => (b.textContent = state[b.dataset.scoreOf]));
  $("resetScore").hidden = state.us === 0 && state.them === 0;
}
// スコアを変える（途中から撮るとき）：各チームの下に − ＋ を出す／しまう。まんなかのスコアを押しても同じ
function toggleScoreEdit() {
  const on = document.querySelector(".teams").classList.toggle("is-editing");
  $("editScore").textContent = on ? "✓ できた" : "✏️ スコアを変える（途中からのとき）";
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
// チーム名：変えたら、さくせん盤の側にも
["teamUs", "teamThem"].forEach((key) =>
  $(key).addEventListener("input", () => {
    state[key] = $(key).value.trim();
    save();
    shareTeams();
  })
);

// チームの色：チーム名の枠の中の色の丸と、その下の選べる色（8色＋カスタム）。さくせん盤・アプリ版と同じ形。
// 一度に開くのは片方だけ。丸を押して開いたときは、決まった色を選ぶとたたむ（カスタムは選んでも開いたまま）。
// チーム名を入れているあいだも、そのチームの色を出す（色を選んでもたたまない。入れおわったらたたむ）。
// もう片方のチームと同じ色も選べるが、見分けにくいので薄くして斜めの線（並びは変えない）
let colorOpen = null; // 開いているチーム（"us"・"them"・null）
const colorKeyOf = (key) => (key === "us" ? "colorUs" : "colorThem");
// そのチームの名前の欄に入力中かを返す
const typingName = (key) => document.activeElement === $(key === "us" ? "teamUs" : "teamThem");
// チームの色を変えて、はじめの画面・撮る画面のボタン・プレビューに出す（さくせん盤の側にも）
function setTeamColor(key, hex) {
  state[colorKeyOf(key)] = hex;
  save();
  shareTeams();
  renderTeamColors();
  showTeamColors();
  drawPreview();
}
// 色の丸（チーム名の左）と、開いているチームの選べる色を描きなおす
function renderTeamColors() {
  document.querySelectorAll("[data-color-dot]").forEach((dot) => {
    const key = dot.dataset.colorDot;
    const open = colorOpen === key;
    dot.querySelector(".swatch").style.background = state[colorKeyOf(key)];
    dot.classList.toggle("is-open", open);
    dot.closest(".team-row").classList.toggle("is-open", open); // 枠のふちを緑に
    dot.setAttribute("aria-expanded", String(open));
    dot.setAttribute("aria-label", `${sideName(key)}の色を選ぶ（いま：${teamColorName(state[colorKeyOf(key)])}）`);
  });
  const palette = $("colorPalette");
  palette.hidden = !colorOpen;
  if (!colorOpen) return palette.replaceChildren();
  palette.setAttribute("aria-label", `${sideName(colorOpen)}の色`);
  palette.replaceChildren(...paletteItems(colorOpen));
  // しっぽ：押した丸のまん中を指す（⇄ で左右を入れかえても）
  const dot = document.querySelector(`[data-color-dot="${colorOpen}"]`);
  const x = dot.getBoundingClientRect().left + dot.offsetWidth / 2 - palette.getBoundingClientRect().left;
  palette.style.setProperty("--tail-x", `${Math.round(x)}px`);
}
// 選べる色の中身：決まった色（もう片方のチームと同じ色は、薄くして斜めの線）とカスタム
function paletteItems(key) {
  const title = sideName(key);
  const current = String(state[colorKeyOf(key)]).toLowerCase();
  const other = String(state[colorKeyOf(key === "us" ? "them" : "us")]).toLowerCase();
  const isPreset = TEAM_COLORS.some((c) => c.hex === current);
  // 色を選ぶ（close が true なら、名前を入れているときでなければたたむ）
  const pick = (hex, close) => {
    if (close && !typingName(key)) colorOpen = null;
    setTeamColor(key, hex);
  };
  // 色の丸（span.swatch）を作る
  const swatch = (className) => Object.assign(document.createElement("span"), { className: `swatch${className ? ` ${className}` : ""}` });
  const buttons = TEAM_COLORS.map((c) => {
    const taken = c.hex === other;
    const b = Object.assign(document.createElement("button"), { type: "button", className: "palette-item" });
    b.setAttribute("aria-pressed", String(current === c.hex));
    b.setAttribute("aria-label", `${title}：${c.label}` + (taken ? "（もう片方のチームと同じ色）" : ""));
    const sw = swatch(taken ? "is-taken" : "");
    sw.style.background = c.hex;
    b.append(sw);
    b.addEventListener("pointerdown", (e) => e.preventDefault()); // 名前を入れているときは、キーボードを出したまま色を選べるように
    b.addEventListener("click", () => pick(c.hex, true));
    return b;
  });
  // カスタム：自由な色（虹色の輪。選んでいる間は、まんなかをその色で塗る）。選んでも開いたまま
  const custom = Object.assign(document.createElement("label"), { className: "palette-item" });
  custom.setAttribute("aria-pressed", String(!isPreset));
  const sw = swatch("is-custom");
  if (!isPreset) sw.style.setProperty("--c", current);
  const input = Object.assign(document.createElement("input"), { type: "color", value: /^#[0-9a-f]{6}$/.test(current) ? current : "#ffffff" });
  input.setAttribute("aria-label", `${title}のカスタムの色`);
  input.addEventListener("change", () => pick(input.value, false));
  sw.append(input);
  custom.append(sw);
  return [...buttons, custom];
}
// 色の丸を押すと開く・たたむ
document.querySelectorAll("[data-color-dot]").forEach((dot) =>
  dot.addEventListener("click", () => {
    colorOpen = colorOpen === dot.dataset.colorDot ? null : dot.dataset.colorDot;
    renderTeamColors();
  })
);
// チーム名を入れているあいだは、そのチームの色を出す。入れおわったら（色を押しているときでなければ）たたむ
let pressingPalette = false;
document.addEventListener("pointerdown", (e) => (pressingPalette = $("colorPalette").contains(e.target)), true);
[["us", "teamUs"], ["them", "teamThem"]].forEach(([key, id]) => {
  $(id).addEventListener("focus", () => {
    colorOpen = key;
    renderTeamColors();
  });
  $(id).addEventListener("blur", () => {
    if (pressingPalette || colorOpen !== key) return;
    colorOpen = null;
    renderTeamColors();
  });
});

// ---- 左右の入れかえ（はじめの画面のチームの並び・得点板・撮る画面の ＋1） ----
// いま左にいるか右にいるかで呼ぶ（自分のチームの試合とはかぎらないので「自チーム・相手」とは呼ばない）
const sideName = (key) => ((key === "us") !== state.swapped ? "左のチーム" : "右のチーム");
// ＋1／−1 のボタンをチームの色に。字は色の明るさで白か黒（白いユニフォームなら黒い字）
function showTeamColors() {
  document.querySelectorAll(".side").forEach((el) => {
    const key = el.classList.contains("is-us") ? "us" : "them";
    const color = key === "us" ? state.colorUs : state.colorThem;
    el.style.setProperty("--team", color);
    el.style.setProperty("--team-ink", inkFor(color));
    // 左よせ・右よせ（縦2段）のときに ＋1 の上に出すチーム名
    el.querySelector(".side-name").textContent = (key === "us" ? state.teamUs : state.teamThem).trim() || sideName(key);
  });
}
// 左右の入れかえを、はじめの画面・撮る画面・ボタンの読み上げに出す
function showSides() {
  showTeamColors();
  document.querySelector(".teams").classList.toggle("is-swapped", state.swapped);
  renderTeamColors(); // 色の丸の読み上げ（左・右）と、しっぽの位置（並びを入れかえたあとで測る）
  $("studio").classList.toggle("is-swapped", state.swapped);
  document.querySelectorAll("[data-side-label]").forEach((el) => (el.textContent = sideName(el.dataset.sideLabel)));
  document.querySelectorAll("[data-side-aria]").forEach((el) => {
    const [key, rest] = el.dataset.sideAria.split(":");
    el.setAttribute("aria-label", sideName(key) + rest);
  });
  showSetupScore();
  showBoardMode();
}
// 得点板を出さないときは、チームを分けない：撮る画面の ＋1 は1つの「GOAL」（左のチームの点として覚える。数は出さない）。
// 撮った動画にの ＋1 も1つに（editor.js の renderEditScore）
function showBoardMode() {
  document.documentElement.classList.toggle("no-board", !state.board);
  document.querySelectorAll("#studio .side.is-us .plus").forEach((b) => {
    b.textContent = state.board ? "＋1" : "GOAL";
    if (!state.board) b.setAttribute("aria-label", "GOAL（ハイライトに入れる）");
  });
  document.querySelectorAll("#studio .side.is-us .minus").forEach((b) => {
    if (!state.board) b.setAttribute("aria-label", "GOAL を1つへらす");
  });
  if (!$("editor").hidden) {
    renderEditScore();
    renderEditEvents();
  }
}
$("swapSides").addEventListener("click", () => {
  state.swapped = !state.swapped;
  save();
  showSides();
  drawPreview();
});

// ---- GOAL のエフェクトを出すか・試す ----
// 得点板を出すか（出す／出さない）
document.querySelectorAll("[data-board]").forEach((b) =>
  b.addEventListener("click", () => {
    state.board = b.dataset.board === "on";
    save();
    showGoalFxSetting();
    showResultCardSetting(); // 得点板を出さないときは、結果の札も入らない
    showSides(); // ＋1 を1つの GOAL に（またはもどす）。ボタンの説明も付けなおす
    drawPreview();
  })
);
// 「得点板を出す」「GOAL の演出」の選んでいるほうと、たたんだ見出しの小さな字を出す
const showGoalFxSetting = () => {
  document.querySelectorAll("[data-board]").forEach((b) => b.setAttribute("aria-checked", String((b.dataset.board === "on") === state.board)));
  document.querySelectorAll("[data-goal-fx]").forEach((b) => b.setAttribute("aria-checked", String((b.dataset.goalFx === "on") === state.goalFx)));
  document.querySelectorAll("[data-nice-fx]").forEach((b) => b.setAttribute("aria-checked", String((b.dataset.niceFx === "on") === state.niceFx)));
  $("tryNice").disabled = !state.niceFx;
  // エフェクトを出さないときは、アイコン・文字の設定も出さない
  $("fxLabelRow").hidden = !state.goalFx;
  // たたんだ見出しに小さく：得点板を出さないときは「得点板なし」、GOAL のエフェクトを出すときは「ON」
  $("fxMeta").textContent = [state.board ? "" : "得点板なし", state.goalFx ? "演出ON" : ""].filter(Boolean).join("・");
  showEditFxMeta();
};
// ---- 保存の設定：5分をこえる動画を1本のままか、5分ごとに分けるか ----
document.querySelectorAll("[data-split]").forEach((b) =>
  b.addEventListener("click", () => {
    state.split = b.dataset.split === "on";
    save();
    showSplitSetting();
  })
);
// 選んでいるほうと、たたんだ見出しの小さな字（分けるときだけ「5分ごと」）を出す
function showSplitSetting() {
  document.querySelectorAll("[data-split]").forEach((b) => b.setAttribute("aria-checked", String((b.dataset.split === "on") === state.split)));
  // たたんだ見出しの小さな字：分けるときは「5分ごと」、ハイライトの長さを変えたときは「⚡5〜3秒」
  const custom = state.hlBefore !== HIGHLIGHT_DEFAULT.before || state.hlAfter !== HIGHLIGHT_DEFAULT.after;
  if ($("splitMeta")) $("splitMeta").textContent = [state.split ? "5分ごと" : "", custom ? `⚡${state.hlBefore}〜${state.hlAfter}秒` : ""].filter(Boolean).join("・"); // 前の index.html には、この欄がない
}
// ---- 結果の札：なし・最初・最後と、ハイライトだけ・全部にも ----
document.querySelectorAll("[data-result-card]").forEach((b) =>
  b.addEventListener("click", () => {
    state.resultCard = b.dataset.resultCard;
    save();
    showResultCardSetting();
  })
);
document.querySelectorAll("[data-result-full]").forEach((b) =>
  b.addEventListener("click", () => {
    state.resultOnFull = b.dataset.resultFull === "on";
    save();
    showResultCardSetting();
  })
);
// 選んでいるほうと、説明（得点板を出さないときは入らない・撮りながらの全部は最後に入る）を出す
function showResultCardSetting() {
  if (!$("resultHint")) return; // 前の index.html には、この欄がない
  document.querySelectorAll("[data-result-card]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.resultCard === state.resultCard)));
  document.querySelectorAll("[data-result-full]").forEach((b) => b.setAttribute("aria-checked", String((b.dataset.resultFull === "on") === state.resultOnFull)));
  $("resultFullRow").hidden = state.resultCard === "none";
  $("resultHint").textContent = !state.board
    ? "得点板を出さないときは、結果の札も入りません。"
    : state.resultCard === "none"
      ? ""
      : `${state.resultCard === "start" ? "「最初」にすると、LINE などのサムネに結果が出ます。" : ""}${state.resultOnFull && state.resultCard === "start" ? "撮りながらの全部は、最後に入ります（撮りはじめには結果が分からないため）。" : ""}`;
}
// LINE の中で開いているときは、Safari・Chrome で開きなおす道を出す（LINE の openExternalBrowser=1）
function showLineHint() {
  if (!inLine || !$("lineHint")) return;
  const url = new URL(location.href);
  url.searchParams.set("openExternalBrowser", "1");
  $("openOutside").href = url.href;
  $("lineHint").hidden = false;
}
document.querySelectorAll("[data-goal-fx]").forEach((b) =>
  b.addEventListener("click", () => {
    state.goalFx = b.dataset.goalFx === "on";
    save();
    showGoalFxSetting();
  })
);
// エフェクトのアイコン・文字（サッカー以外でも）。変えたら、試しに出して見せる
const showFxLabel = () => {
  document.querySelectorAll("[data-fx-icon]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.fxIcon === state.fxIcon)));
  $("fxCustom").value = state.fxCustom;
  $("fxCustom").classList.toggle("is-on", state.fxCustom !== "" && state.fxIcon === state.fxCustom);
  $("fxText").value = state.fxText;
  $("fxIconNow").textContent = state.fxIcon || "なし";
  $("fxIconBtn").classList.toggle("is-none", !state.fxIcon);
  $("fxIconBtn").setAttribute("aria-label", `アイコンを選ぶ（いま：${state.fxIcon || "なし"}）`);
  showEditFxMeta();
};
// アイコンを押すと、選べるアイコンを横に並べて出す（もう一度押すとたたむ）
const openFxPicker = (open) => {
  $("fxIconPicker").hidden = !open;
  $("fxIconBtn").setAttribute("aria-expanded", String(open));
};
$("fxIconBtn").addEventListener("click", () => openFxPicker($("fxIconPicker").hidden));
// 「撮った動画に」の「🎉 得点のエフェクト」の見出しの右：いまの字（⚽ GOAL!）か「出さない」
const showEditFxMeta = () => {
  $("editFxMeta").textContent = [state.board ? "" : "得点板なし", state.goalFx ? fxLabel() : "演出なし"].filter(Boolean).join("・");
};
// 2文字まで（絵文字は1つで1文字に数える）
const firstChars = (text, n) => {
  const t = text.trim();
  if (window.Intl?.Segmenter) return [...new Intl.Segmenter("ja", { granularity: "grapheme" }).segment(t)].slice(0, n).map((x) => x.segment).join("");
  return Array.from(t).slice(0, n).join("");
};
// 試しに出す（点は入れない。演出の下の行は「（お試し）」）
// ⭐ ナイスのエフェクト（出さない／出す／▶ 試す）
document.querySelectorAll("[data-nice-fx]").forEach((b) =>
  b.addEventListener("click", () => {
    state.niceFx = b.dataset.niceFx === "on";
    save();
    showGoalFxSetting();
    if (state.niceFx) tryNice();
  })
);
// ⭐ ナイスのエフェクトを試しに出す（プレビュー。撮った動画にの画面では動画の上）
const tryNice = () => {
  niceFx = { at: performance.now() };
  drawPreview();
};
$("tryNice").addEventListener("click", tryNice);
const tryFx = () => {
  goalFx = { side: "us", at: performance.now(), trial: true };
  drawPreview();
};
document.querySelectorAll("[data-fx-icon]").forEach((b) =>
  b.addEventListener("click", () => {
    state.fxIcon = b.dataset.fxIcon;
    save();
    showFxLabel();
    openFxPicker(false); // 選んだらたたむ（カスタムは打っている間は開いたまま）
    tryFx();
  })
);
// カスタム：入れたらそれを使う。押しただけでも、前に入れたものを選ぶ。消したら ⚽ にもどす
$("fxCustom").addEventListener("input", () => {
  const v = firstChars($("fxCustom").value, 2);
  if ($("fxCustom").value !== v) $("fxCustom").value = v;
  state.fxCustom = v;
  state.fxIcon = v || "⚽";
  save();
  showFxLabel();
  if (v) tryFx();
});
$("fxCustom").addEventListener("focus", () => {
  if (!state.fxCustom) return;
  state.fxIcon = state.fxCustom;
  save();
  showFxLabel();
  tryFx();
});
$("fxText").addEventListener("input", () => {
  state.fxText = $("fxText").value;
  save();
  tryFx();
});
// たたんだ欄を開いたら、プレビューを描き直す（たたんでいる間は大きさが測れないため）
$("previewFold").addEventListener("toggle", () => $("previewFold").open && drawPreview());
$("tryGoal").addEventListener("click", tryFx);

// ---- 得点板のプレビュー（はじめの画面）：芝のピッチの絵に、動画と同じ得点板・エフェクトを描く ----
const preview = $("preview");
const previewCtx = preview.getContext("2d");
let previewLoop = 0;
// プレビューの種類："shoot"（📹 撮る画面）・"saved"（💾 保存される動画）
let previewMode = "shoot";
let flowStart = 0; // 保存される動画の流れを始めた時刻
// 芝のピッチの絵（カメラの映像・動画の代わり）を描く
function drawPitch(c, w, h) {
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
}
// はじめの画面のプレビューを描く。動きがあるあいだ（エフェクト・保存される動画の流れ）は描きつづける
function drawPreview() {
  const c = previewCtx;
  const w = preview.width;
  const h = preview.height;
  cancelAnimationFrame(previewLoop);
  // 撮る画面の見本では「プレビュー」の札を出さない（右下の録画ボタンに重なるため。下の説明で見本と分かる）
  preview.closest(".preview-frame").classList.toggle("is-shoot", previewMode === "shoot");
  if (previewMode === "saved") return drawSavedFlow(c, w, h);
  drawPitch(c, w, h);
  drawScoreboard(w, h, c);
  drawGoalFx(w, h, c);
  drawNiceFx(w, h, c);
  drawStudioMock(c, w, h);
  $("previewCaption").textContent = "撮っているときの画面（録画中）。＋1 の位置は、撮る画面の右上の ●●● で変えられます。";
  if ((goalFx || niceFx) && $("studio").hidden) previewLoop = requestAnimationFrame(drawPreview);
}

// 📹 撮る画面の見本：録画中の赤い枠・時間、右上の ●●●、＋1／−1・⭐ ナイス・録画ボタン（＋1 の位置の設定どおり。撮る画面の style.css と同じ並び）
function drawStudioMock(c, w, h) {
  const k = h / 390; // スマホを横にしたときの高さ（390）で 1
  const font = (size) => `800 ${size * k}px "M PLUS Rounded 1c", "Hiragino Maru Gothic ProN", sans-serif`;
  // 丸いボタン（ふちつき）
  const circle = (x, y, r, fill, stroke, lw) => {
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.fillStyle = fill;
    c.fill();
    if (stroke) {
      c.lineWidth = lw;
      c.strokeStyle = stroke;
      c.stroke();
    }
  };
  // 角の丸い四角（ピル）
  const pill = (x, y, pw, ph, fill, stroke, lw) => {
    c.beginPath();
    if (c.roundRect) c.roundRect(x - pw / 2, y - ph / 2, pw, ph, ph / 2);
    else c.rect(x - pw / 2, y - ph / 2, pw, ph);
    c.fillStyle = fill;
    c.fill();
    if (stroke) {
      c.lineWidth = lw;
      c.strokeStyle = stroke;
      c.stroke();
    }
  };
  const text = (t, x, y, size, color) => {
    c.font = font(size);
    c.fillStyle = color;
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText(t, x, y);
  };
  c.save();
  // 録画中：赤い枠と、上のまん中に時間
  c.lineWidth = 5 * k;
  c.strokeStyle = "#e5484d";
  c.strokeRect(2.5 * k, 2.5 * k, w - 5 * k, h - 5 * k);
  pill(w / 2, 30 * k, 74 * k, 24 * k, "rgba(0, 0, 0, 0.45)");
  text("● 0:42", w / 2, 30 * k, 13, "#ffffff");
  // 右上：＋1 の位置（●●●）
  circle(w - 36 * k, 36 * k, 20 * k, "rgba(0, 0, 0, 0.5)");
  [-9, 0, 9].forEach((dx, i) => {
    const on = ["left", "center", "right"][i] === state.hand;
    circle(w - 36 * k + dx * k, 36 * k, 3 * k, on ? "#ffffff" : "rgba(255, 255, 255, 0.35)");
  });
  // チーム（左右の並び）。得点板を出さないときは1つの「GOAL」（芝の緑）
  const teams = inOrder({ key: "us", color: state.colorUs, name: state.teamUs }, { key: "them", color: state.colorThem, name: state.teamThem });
  const list = state.board ? teams : [{ key: "us", color: NEUTRAL_FX_COLOR, name: "" }];
  const plusLabel = state.board ? "＋1" : "GOAL";
  // ＋1（チームの色）
  const plus = (x, y, d, color) => {
    circle(x, y, d / 2, color, "rgba(255, 255, 255, 0.9)", 3 * k);
    text(plusLabel, x, y, state.board ? d * 0.29 / k : d * 0.25 / k, inkFor(color));
  };
  // −1（小さなピル）
  const minus = (x, y, color) => {
    pill(x, y, 52 * k, 32 * k, "rgba(0, 0, 0, 0.45)", color, 2 * k);
    text("−1", x, y, 14, "#ffffff");
  };
  // ⭐ ナイス
  const nice = (x, y) => {
    pill(x, y, 96 * k, 40 * k, "rgba(0, 0, 0, 0.55)", "#ffd64a", 2 * k);
    text("⭐ ナイス", x, y, 14, "#ffe082");
  };
  // 録画ボタン（録画中は角の丸い四角）
  const rec = (x, y) => {
    circle(x, y, 36 * k, "rgba(0, 0, 0, 0)", "#ffffff", 4 * k);
    c.fillStyle = "#e5484d";
    c.beginPath();
    if (c.roundRect) c.roundRect(x - 14 * k, y - 14 * k, 28 * k, 28 * k, 6 * k);
    else c.rect(x - 14 * k, y - 14 * k, 28 * k, 28 * k);
    c.fill();
  };
  const bottom = h - 16 * k;
  if (state.hand === "center") {
    // まんなか：⭐ の下に [＋1] ● [＋1]（−1 は ＋1 の下）
    const recY = bottom - 56 * k;
    rec(w / 2, recY);
    const plusY = bottom - 32 * k - 8 * k - 38 * k;
    const offset = 36 * k + 28 * k + 38 * k;
    list.forEach((t, i) => {
      const x = list.length === 1 ? w / 2 - offset : w / 2 + (i === 0 ? -offset : offset);
      plus(x, plusY, 76 * k, t.color);
      minus(x, bottom - 16 * k, t.color);
    });
    nice(w / 2, plusY - 38 * k - 10 * k - 20 * k);
  } else {
    // 左よせ・右よせ：持つ側に ⭐ と ＋1・−1 を縦に、録画ボタンは反対側
    const left = state.hand === "left";
    const edge = 20 * k;
    let y = bottom - 32 * k;
    [...list].reverse().forEach((t) => {
      const px = left ? edge + 32 * k : w - edge - 32 * k;
      const mx = left ? px + 32 * k + 10 * k + 26 * k : px - 32 * k - 10 * k - 26 * k;
      plus(px, y, 64 * k, t.color);
      minus(mx, y, t.color);
      y -= 64 * k + 14 * k;
    });
    nice(left ? edge + 48 * k : w - edge - 48 * k, y + 32 * k - 4 * k);
    rec(left ? w - edge - 44 * k : edge + 44 * k, bottom - 36 * k);
  }
  c.restore();
}

// 💾 保存される動画の見本：結果の札（最初）→ 試合 → GOAL → つなぎ目 → 試合 → 結果の札（最後）を、いまの設定どおりにくりかえす（⚡ ハイライトの見本）
function savedFlowSteps() {
  const card = resultCardPlace("highlight");
  const steps = [];
  if (card === "start") steps.push({ key: "cardStart", ms: 1800, label: "結果の札（最初の 2 秒。LINE などのサムネになる）" });
  steps.push({ key: "match0", ms: 1200, label: state.board ? "試合（左上に得点板）" : "試合（得点板なし）" });
  steps.push({ key: "goal", ms: state.goalFx ? GOAL_FX_MS : 900, label: state.goalFx ? "＋1 のところで GOAL の演出" : "＋1（演出なし）" });
  if (state.niceFx) steps.push({ key: "nice", ms: NICE_FX_MS, label: "⭐ ナイスのところで、得点板の下に小さく「⭐ ナイス！」" });
  if (transitionOf(state.transition).draw) steps.push({ key: "wipe", ms: TRANSITION_SEC * 1000, label: "つなぎ目の柄（ハイライトの場面と場面のあいだ）" });
  steps.push({ key: "match1", ms: 1200, label: "次の場面" });
  if (card === "end") steps.push({ key: "cardEnd", ms: 1800, label: "結果の札（最後の 2 秒）" });
  return steps;
}
function drawSavedFlow(c, w, h) {
  const steps = savedFlowSteps();
  const total = steps.reduce((sum, s) => sum + s.ms, 0);
  if (!flowStart) flowStart = performance.now();
  let t = (performance.now() - flowStart) % total;
  const i = steps.findIndex((s) => (t -= s.ms) < 0);
  const step = steps[i];
  const p = 1 + t / step.ms; // その場面の中の進みぐあい（0〜1）
  const after = { us: state.us + 1, them: state.them }; // 見本の得点（左のチームに 1 点）
  const result = { us: state.us + 1, them: state.them };
  drawPitch(c, w, h);
  if (step.key === "cardStart" || step.key === "cardEnd") {
    drawResultCard(w, h, c, result);
  } else {
    const score = step.key === "match0" ? { us: state.us, them: state.them } : after;
    drawScoreboard(w, h, c, { score });
    if (step.key === "goal" && state.goalFx) {
      // GOAL の演出：この場面のはじめから出す（drawGoalFx は時刻で動くので、はじめた時刻を合わせる）
      if (!goalFx || goalFx.flowStep !== flowStart + i) goalFx = { side: "us", at: performance.now() - p * GOAL_FX_MS, flowStep: flowStart + i };
      drawGoalFx(w, h, c);
    }
    if (step.key === "nice") drawNiceFxAt(w, h, c, p);
    if (step.key === "wipe") drawTransition(w, h, c, p);
  }
  $("previewCaption").textContent = `⚡ ハイライトの見本：${step.label}`;
  if ($("previewFold").open && $("studio").hidden && previewMode === "saved") previewLoop = requestAnimationFrame(drawPreview);
}
// プレビューの切りかえ（📹 撮る画面／💾 保存される動画）
document.querySelectorAll("[data-preview]").forEach((b) =>
  b.addEventListener("click", () => {
    previewMode = b.dataset.preview;
    flowStart = 0;
    goalFx = null;
    document.querySelectorAll("[data-preview]").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
    drawPreview();
  })
);
document.querySelectorAll(".team-col input").forEach((input) => input.addEventListener("input", drawPreview));

// ---- 使い方のタブ：撮る／撮った動画に（得点板をつける）（チーム・色・プレビュー・スコアは共通） ----
document.querySelectorAll("[data-mode]").forEach((tab) =>
  tab.addEventListener("click", () => {
    const mode = tab.dataset.mode;
    document.querySelectorAll("[data-mode]").forEach((t) => t.setAttribute("aria-selected", String(t === tab)));
    document.querySelectorAll("[data-mode-only]").forEach((el) => (el.hidden = el.dataset.modeOnly !== mode));
    showResume();
  })
);

// ---- ⚡ ハイライトのつなぎ目の柄を選ぶボタン（draw.js の TRANSITIONS から作る。有料の柄は 🔒 で、まだ選べない） ----
function renderTransitionChoices() {
  document.querySelectorAll("[data-transition-row] .transition-chips").forEach((box) => {
    box.replaceChildren(
      ...TRANSITIONS.map((tr) => {
        const b = Object.assign(document.createElement("button"), { type: "button", className: "chip", textContent: tr.premium ? `🔒 ${tr.label}` : tr.label });
        b.setAttribute("role", "radio");
        b.setAttribute("aria-checked", String(transitionOf(state.transition).id === tr.id));
        b.disabled = tr.premium;
        b.addEventListener("click", () => {
          state.transition = tr.id;
          save();
          renderTransitionChoices();
        });
        return b;
      })
    );
  });
}
