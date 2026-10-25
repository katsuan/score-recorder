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
    showSides(); // ＋1 を1つの GOAL に（またはもどす）。ボタンの説明も付けなおす
    drawPreview();
  })
);
// 「得点板を出す」「GOAL の演出」の選んでいるほうと、たたんだ見出しの小さな字を出す
const showGoalFxSetting = () => {
  document.querySelectorAll("[data-board]").forEach((b) => b.setAttribute("aria-checked", String((b.dataset.board === "on") === state.board)));
  document.querySelectorAll("[data-goal-fx]").forEach((b) => b.setAttribute("aria-checked", String((b.dataset.goalFx === "on") === state.goalFx)));
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
  if ($("splitMeta")) $("splitMeta").textContent = state.split ? "5分ごと" : ""; // 前の index.html には、この欄がない
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
// はじめの画面のプレビュー（芝の絵に、動画と同じ得点板とエフェクト）を描く。エフェクトが出ているあいだは描きつづける
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
