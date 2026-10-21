// ろくが：はじめの画面（スコア・左右の入れかえ・GOAL の設定・プレビュー・保存したチーム・使い方のタブ）。
// 読み込む順は index.html（core → draw → setup → studio → record → editor → render → main）。
"use strict";

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
[["teamUs", "teamUs"], ["teamThem", "teamThem"], ["colorUs", "colorUs"], ["colorThem", "colorThem"]].forEach(([id, key]) =>
  $(id).addEventListener("input", () => {
    state[key] = $(id).value.trim();
    save();
  })
);

// ---- 左右の入れかえ（はじめの画面のチームの並び・得点板・撮る画面の ＋1） ----
// いま左にいるか右にいるかで呼ぶ（自分のチームの試合とはかぎらないので「自チーム・相手」とは呼ばない）
const sideName = (key) => ((key === "us") !== state.swapped ? "左のチーム" : "右のチーム");
// ＋1／−1 のボタンをチームの色に。字は色の明るさで白か黒（白いユニフォームなら黒い字）
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

// ---- 使い方のタブ：撮る／あとから付ける（チーム・色・プレビュー・スコアは共通） ----
document.querySelectorAll("[data-mode]").forEach((tab) =>
  tab.addEventListener("click", () => {
    const mode = tab.dataset.mode;
    document.querySelectorAll("[data-mode]").forEach((t) => t.setAttribute("aria-selected", String(t === tab)));
    document.querySelectorAll("[data-mode-only]").forEach((el) => (el.hidden = el.dataset.modeOnly !== mode));
  })
);
