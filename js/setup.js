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

// チームの色：緑・黄・白の丸いボタンと、カスタム（自由な色）。さくせん盤と同じ形。
// もう片方のチームと同じ色も選べるが、見分けにくいので薄くする（並びは変えない）
function setTeamColor(key, hex) {
  state[key === "us" ? "colorUs" : "colorThem"] = hex;
  save();
  shareTeams();
  renderColorChips();
  showTeamColors();
  drawPreview();
}
// はじめの画面のチームの色の丸（緑・黄・白とカスタム）を、いまの色で描きなおす
function renderColorChips() {
  document.querySelectorAll("[data-colors]").forEach((box) => {
    const key = box.dataset.colors;
    const current = String(key === "us" ? state.colorUs : state.colorThem).toLowerCase();
    const other = String(key === "us" ? state.colorThem : state.colorUs).toLowerCase();
    const isPreset = TEAM_COLORS.some((c) => c.hex === current);
    const buttons = TEAM_COLORS.map((c) => {
      const b = Object.assign(document.createElement("button"), { type: "button", className: "chip color" });
      b.style.background = c.hex;
      b.setAttribute("aria-pressed", String(current === c.hex));
      b.classList.toggle("is-taken", c.hex === other);
      b.setAttribute("aria-label", c.hex === other ? `${c.label}（もう片方のチームと同じ色）` : c.label);
      b.addEventListener("click", () => setTeamColor(key, c.hex));
      return b;
    });
    // カスタム：選んでいる間は、その色で丸を塗る
    const custom = document.createElement("label");
    custom.className = "chip color is-custom";
    custom.setAttribute("aria-label", "カスタム（自由な色）");
    custom.setAttribute("aria-pressed", String(!isPreset));
    if (!isPreset) custom.style.background = current;
    const input = Object.assign(document.createElement("input"), { type: "color", value: /^#[0-9a-f]{6}$/.test(current) ? current : "#ffffff" });
    input.addEventListener("change", () => setTeamColor(key, input.value));
    custom.append(input);
    box.replaceChildren(...buttons, custom);
  });
}

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
