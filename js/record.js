// ろくが：録画（保存の設定で、5分ごとに分けても録れる）と、保存の画面（見返し・保存・共有・次はどうする？）。
// 読み込む順は index.html（page → store → draw → setup → studio → record → editor → render → app.js）。
"use strict";

// ---- 録画 ----
// はじめは止めるまで1本で録る。保存の設定で「5分ごとに分ける」にしたときだけ（LINE で送れる動画は 5分まで）、
// 5分ごとに MediaRecorder を新しくして、1本ずつの動画（clips）にする（あとから動画を切るのはブラウザでは難しいため）。
// 分けて5分を超えたときだけ、止めたあとの保存の画面で「全部（5分ごと）・最初の5分・最後の5分（最後の1本）」から選べる
// 1本の長さ（LINE の5分に少し余裕をもたせて 4分55秒）。確かめるときは ?segment=秒 で短くできる
const SEGMENT_MS = (Number(new URLSearchParams(location.search).get("segment")) || 295) * 1000;
let recorder = null;
let recording = false;
// 録り終えた動画 [{ blob, type, from, to, take, takeAt, file, url, saved }]。from・to はその回の録りはじめからの秒。
// 「スコアそのままで続きを撮る」で録りなおしても前の動画は消さず、続けて足していく（take が何回目の録画か）。
// 消すのは動画の行の 🗑 だけ（すぐ消して「元に戻す」で戻せる）
let clips = [];
let take = 0;
let startedAt = 0;
let tick = 0;
let segmentTimer = 0;
let recordStream = null;
const activeRecs = new Set(); // まだ止まりきっていない録画（区切った直後は、前の1本と次の1本が少し重なる）
let mimeType = "";
// canvas の録画に、いま描いた1コマを送る（書き出しで「描いたときだけ1コマ」録るとき。そうでなければ何もしない）
const pushFrame = () => recordStream?.getVideoTracks()[0]?.requestFrame?.();

// この端末で録れる形式（iPhone は mp4、Android・パソコンは webm のことが多い）
function pickMimeType() {
  const types = ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
  return types.find((t) => window.MediaRecorder?.isTypeSupported?.(t)) || "";
}

// 1本ぶんの録画をはじめる。止まったら clips に足し、続けるなら次の1本、終わりなら保存のシート
// 今回の録画の、いまの1本が何本目か・はじめた時刻（分けた各1本の最初に「1本目」の札を出すのに使う。draw.js の drawPieceBadge）
let clipNo = 0;
let clipStartedAt = 0;
function startClip() {
  clipNo += 1;
  clipStartedAt = performance.now();
  const rec = new MediaRecorder(recordStream, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: 6_000_000 });
  const parts = [];
  const now = () => (recClock ? recClock() : (Date.now() - startedAt) / 1000);
  const fromExact = now(); // 得点ハイライトで、得点の時間を動画の中の時間に直すのに使う
  const from = Math.round(fromExact);
  const kind = recKind;
  const label = recLabel;
  rec.addEventListener("dataavailable", (e) => e.data.size && parts.push(e.data));
  rec.addEventListener("stop", () => {
    activeRecs.delete(rec);
    const type = rec.mimeType || parts[0]?.type || "video/webm";
    const blob = new Blob(parts, { type });
    const toExact = now();
    const to = Math.round(toExact);
    if (blob.size) clips.push({ blob, type, from, to, fromExact, toExact, kind, label, take, takeAt: startedAt, saved: false });
    // 録画を止めて、すべての1本が止まりきったら保存のシート（止まる順がずれても、録った順に並べる）
    if (!recording && !activeRecs.size) {
      clips.sort((a, b) => a.take - b.take || a.from - b.from);
      showSaved();
    }
  });
  activeRecs.add(rec);
  try {
    rec.start(1000); // 1秒ごとに区切って受け取る（長く録っても途中で失いにくい）
  } catch (error) {
    activeRecs.delete(rec);
    throw error;
  }
  recorder = rec;
  clearTimeout(segmentTimer);
  if (!recSplit) return; // 分けないとき（はじめ）は、止めるまでこの1本
  segmentTimer = setTimeout(() => {
    rec.stop(); // 5分ごとに分ける：いまの1本を閉じて、すぐ次の1本
    try {
      startClip();
    } catch {
      stopRecording(); // 次の1本を始められなければ、そこまでで止めて保存の画面へ
    }
  }, SEGMENT_MS);
}

// いまの1本を閉じて、すぐ次の1本を録りはじめる（🔗 つなぐで、決めた区切りごとに別の動画にする。一時停止中でも閉じられる）
function nextClip() {
  clearTimeout(segmentTimer);
  if (recorder && recorder.state !== "inactive") recorder.stop();
  startClip();
}

// 📹 録画ボタン：撮る画面の canvas と音で録画をはじめる（録れない端末・カメラがないときは知らせる）
function startRecording() {
  if (!window.MediaRecorder || !screen.captureStream) {
    notice("この端末のブラウザでは録画できません");
    return;
  }
  // カメラが使えていないとき（許可していない・ほかのアプリが使っている）は録画しない
  if (!cameraStream) {
    notice("カメラが使えません", "🏠 から、もう一度「カメラを開く」を押して、カメラとマイクを許可してね。");
    return;
  }
  if (!beginRecording(screen, cameraStream.getAudioTracks())) {
    notice("録画を始められませんでした", "この端末のブラウザでは録画できないようです。ほかのブラウザ（Safari・Chrome）で開いてね。");
    return;
  }
  $("record").classList.add("is-on");
  $("studio").classList.add("is-recording");
  $("record").setAttribute("aria-label", "録画を止める");
}

// 録画をはじめる（カメラの画面でも、撮った動画にの書き出しでも同じ）：canvas の絵と音を録る（保存の設定で5分ごとにも）
// kind：shot（カメラで撮る）・edit（撮った動画にの書き出し）・highlight（得点ハイライト）
let recKind = "shot";
// manualFrames：canvas を「描いたときだけ1コマ」録る（書き出しで、動画のコマごとに requestFrame する。editor.js の startFrameSync）
// 始められたら true。この端末の MediaRecorder が断ったら（形式・canvas を録れないなど）何も変えずに false
// split：5分ごとに分けるか（なければ「💾 保存の設定」のとおり）。label：動画の一覧に出す名前（✂️ 最初の5分 など）
// clock：録った動画の中の時間（秒）を返す関数（なければ、録りはじめからの時計。見ながら記録は動画の時間：一時停止のあいだは進まない）
let recSplit = false;
let recLabel = "";
let recClock = null;
function beginRecording(canvas, audioTracks, kind = "shot", { manualFrames = false, split = state.split, label = "", clock = null } = {}) {
  try {
    recKind = kind;
    recSplit = split;
    recLabel = label;
    recClock = clock;
    clipNo = 0;
    recordStream = canvas.captureStream(manualFrames ? 0 : 30);
    audioTracks.forEach((t) => recordStream.addTrack(t));
    mimeType = pickMimeType();
    take += 1; // 前の動画は消さない（続きを撮るとき）
    recording = true;
    startedAt = Date.now();
    startClip();
  } catch {
    if (recording) take -= 1;
    recording = false;
    recordStream = null;
    return false;
  }
  pick = "all";
  tick = setInterval(showElapsed, 500);
  showElapsed();
  return true;
}

// 撮った回ごとの、止めたときのスコア（⚡ 得点ハイライトの結果の札に使う）
const takeEnd = {};
let cardTimer = 0; // 結果の札を出して、止めるのを待っているところ
// 録画を止める（いまの1本を閉じると、保存の画面が出る）。時間の表示とボタンも元にもどす。
// カメラで撮っていて、全部にも結果の札を入れるときは、札を 2 秒録ってから止める（撮りながらの全部は、最初を選んでも最後に入る）。now：すぐ止める
function stopRecording(now = false) {
  if (recording && recKind === "shot") takeEnd[take] = { us: state.us, them: state.them };
  if (!now && recording && recKind === "shot" && resultCardPlace("full")) {
    if (cardTimer) return; // 札を出しているあいだにもう一度押しても、そのまま
    resultCard = { us: state.us, them: state.them };
    clearInterval(tick);
    $("elapsed").textContent = "結果の札を入れています…";
    cardTimer = setTimeout(() => stopRecording(true), RESULT_CARD_MS);
    return;
  }
  clearTimeout(cardTimer);
  cardTimer = 0;
  resultCard = null;
  clearTimeout(segmentTimer);
  if (recording) {
    recording = false;
    if (recKind === "shot") logUse("shot", Math.round((Date.now() - startedAt) / 1000)); // カメラで録った秒数
    if (recorder && recorder.state !== "inactive") recorder.stop(); // 書き出しの合間で一時停止中でも止める
  }
  clearInterval(tick);
  $("elapsed").textContent = "";
  $("record").classList.remove("is-on");
  $("studio").classList.remove("is-recording");
  $("record").setAttribute("aria-label", "録画をはじめる");
}

// 録画中の時間。5分を超えて分けはじめたら「（2本目）」
function showElapsed() {
  const sec = Math.floor((Date.now() - startedAt) / 1000);
  const done = takeClips().length;
  const note = done ? `（${done + 1}本目）` : "";
  $("elapsed").textContent = `${clock(sec)}${note}`;
}

// ---- 保存の画面 ----
// 止めたら：見返し・保存・共有（何本かあるときは1本ずつ、またはまとめて）
function showSaved() {
  // 「続きを撮る」に、いまのスコアを（左右の並びで）
  const [l, r] = inOrder(state.us, state.them);
  $("nextKeep").textContent = `いまの ${l} - ${r} のまま（後半など）`;
  // 今回の録画の動画に名前をつける（前の回の動画は、もう名前がついている）
  const now = takeClips();
  now.forEach((c, i) => {
    c.file = new File([c.blob], clipFileName(c, i, now.length), { type: c.type });
    c.url = URL.createObjectURL(c.blob);
  });
  // 今回の録画が5分を超えていたら（2本以上）、どれを残すか選ぶ：全部・最初の5分・最後の5分
  $("pickClips").hidden = now.length < 2;
  // 撮った動画にの書き出しのあとは「次はどうする？」（撮る画面向け）は出さず、閉じるだけ
  openSaveSheet(!exportMode);
  exportMode = false;
  // 画面を離れて止まったときは、そう知らせる（studio.js）
  if (stoppedByLeaving) {
    stoppedByLeaving = false;
    $("saveInfo").textContent = `画面を離れたので、そこで録画を止めました。${$("saveInfo").textContent}`;
  }
}

// 保存の画面を出す。withNextShot：撮る画面のあとの「次はどうする？」を出すか（出さないときは「閉じる」だけ）
function openSaveSheet(withNextShot) {
  $("nextShot").hidden = !withNextShot;
  $("closeSheetOnly").hidden = withNextShot;
  $("sharedNote").hidden = true;
  $("restartSave").classList.remove("is-suggest");
  showSaveGuide();
  renderClips();
  $("saveSheet").hidden = false;
}

// ファイル名に使えない字（/ \\ : * ? " < > | と空白のはし）を除く
const safeName = (t) => String(t || "").trim().replace(/[\\/:*?"<>|]/g, "").slice(0, 20);
// 動画のファイル名：score-20261024-1530.mp4（5分ごとに分けたときは -1・-2、ハイライトは -highlight）
function clipFileName(c, index, count) {
  const d = new Date(c.takeAt);
  const stamp = `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}`;
  const ext = c.type.includes("mp4") ? "mp4" : "webm";
  // 🔗 つないだ動画：「ハイライト_20261028_part1.mp4」（名前は つなぐ のファイルの名前。分けたときだけ part の通し番号）
  if (c.kind === "merge") return `${safeName(c.label) || "ハイライト"}_${stamp.slice(0, 8)}${count > 1 ? `_part${index + 1}` : ""}.${ext}`;
  const tail = c.kind === "highlight" ? "-highlight" : c.kind === "cut" ? `-cut${count > 1 ? `-${index + 1}` : ""}` : count > 1 ? `-${index + 1}` : "";
  return `score-${stamp}${tail}.${ext}`;
}

// 保存のしかた：iPhone・iPad は共有から「ビデオを保存」で写真へ。共有できる端末は LINE などへ、できなければ ⬇️ で保存
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
// 保存の画面の、保存のしかたの案内（iPhone は「ビデオを保存」、ほかは共有かダウンロード）を出す
function showSaveGuide() {
  const canShare = clips.length && navigator.canShare?.({ files: [clips[0].file] });
  $("saveGuide").hidden = !clips.length;
  $("saveGuide").textContent = isIOS && canShare
    ? "📱 写真へは「📤 保存・共有」→「ビデオを保存」。"
    : canShare
      ? "📱 「📤 保存・共有」で LINE などへ。端末には ⬇️。"
      : "⬇️ で端末に保存。";
  $("saveGuide").textContent += "ページを閉じると消えます。";
  // LINE の中では、1本保存するとページが開きなおされ、残りが消えることがある
  if (inLine && clips.length > 1)
    $("saveGuide").textContent += canShare
      ? "LINE 版では1本ずつ保存すると残りが消えることがあるので、「📤 まとめて保存・共有」で。"
      : "LINE 版では1本保存すると残りが消えることがあります。Safari・Chrome で撮るのがおすすめです。";
}

// state の「どれを残すか」に合う動画（clips の番号）
let pick = "all";
// 今回の録画（いちばん新しい回）の動画
const takeClips = () => clips.filter((c) => c.take === take);
// 出す動画（clips の番号）：前の回の動画は全部、今回の録画は「どれを残すか」に合うもの
const pickedIndexes = () => {
  const now = clips.map((c, i) => (c.take === take ? i : -1)).filter((i) => i >= 0);
  const earlier = clips.map((c, i) => (c.take !== take ? i : -1)).filter((i) => i >= 0);
  const chosen = pick === "first" ? now.slice(0, 1) : pick === "last" ? now.slice(-1) : now;
  return [...earlier, ...chosen];
};

// 保存の画面の動画の一覧（見る・保存・共有・ダウンロード・消す）を描きなおし、いちばん新しい動画を見られるようにする
function renderClips() {
  showHighlightButton();
  showCutRow();
  document.querySelectorAll("[data-pick]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.pick === pick)));
  const shown = pickedIndexes();
  const list = $("clipList");
  list.replaceChildren(
    ...shown.map((i) => {
      const c = clips[i];
      const row = document.createElement("div");
      row.className = "clip";
      const sameTake = clips.filter((x) => x.take === c.take);
      const size = `（${(c.blob.size / 1024 / 1024).toFixed(1)}MB）${c.saved ? "　✓" : ""}`;
      const label =
        c.kind === "highlight"
          ? `⚡ ハイライト　${clock(c.to - c.from)}${size}`
          : c.kind === "merge"
            ? `🔗 ${c.label || "ハイライト"}　${sameTake.length > 1 ? `${sameTake.indexOf(c) + 1}/${sameTake.length}　` : ""}${clock(c.to - c.from)}${size}`
          : c.kind === "cut"
            ? `✂️ ${c.label}　${sameTake.length > 1 ? `${sameTake.indexOf(c) + 1}本目　` : ""}${clock(c.to - c.from)}${size}`
          : c.kind === "edit"
            ? `🎞 撮った動画に得点板をつけた動画　${sameTake.length > 1 ? `${sameTake.indexOf(c) + 1}本目　` : ""}${clock(c.from)}〜${clock(c.to)}${size}`
            : `${shotTakes().length > 1 ? `${takeNumber(c.take)}回目　` : ""}${sameTake.length > 1 ? `${sameTake.indexOf(c) + 1}本目　` : ""}${clock(c.from)}〜${clock(c.to)}${size}`;
      const play = Object.assign(document.createElement("button"), { type: "button", className: "clip-play", textContent: label });
      play.addEventListener("click", () => showClip(i));
      const share = Object.assign(document.createElement("button"), { type: "button", className: "clip-btn", textContent: "📤 保存・共有" });
      share.hidden = !navigator.canShare?.({ files: [c.file] });
      share.addEventListener("click", () => shareFiles([c]));
      const down = Object.assign(document.createElement("a"), { className: "clip-btn", href: c.url, download: c.file.name, textContent: "⬇️" });
      down.setAttribute("aria-label", `${c.file.name} をダウンロード`);
      down.addEventListener("click", () => markSaved([c]));
      row.dataset.index = String(i);
      const del = Object.assign(document.createElement("button"), { type: "button", className: "clip-btn", textContent: "🗑" });
      del.setAttribute("aria-label", `${c.file.name} を消す`);
      del.addEventListener("click", () => deleteClip(c));
      row.append(play, share, down, del);
      return row;
    })
  );
  const files = shown.map((i) => clips[i].file);
  const now = takeClips();
  const earlier = clips.length - now.length;
  $("shareAll").hidden = files.length < 2 || !navigator.canShare?.({ files });
  $("saveInfo").textContent = [
    now.length > 1 ? `トークで送れるよう、5分ずつ ${now.length}本に分けました。` : now.length ? "" : "録れませんでした。もう一度撮ってみてね。",
    // 1本のままで5分をこえたら：LINE のトークでは送れないことがある（同じ画面の「LINE で送る用」（cutRow）で5分までを作れる）
    now.length === 1 && now[0].to - now[0].from > 300 ? "5分をこえているので、LINE のトークでは送れないことがあります。下の「LINE で送る用」で、5分までの動画を作れます。" : "",
    earlier ? `前の動画（${earlier}本）も下にあります。` : ""
  ].filter(Boolean).join("");
  if (shown.length) showClip(shown[shown.length - 1]);
}
document.querySelectorAll("[data-pick]").forEach((b) =>
  b.addEventListener("click", () => {
    pick = b.dataset.pick;
    renderClips();
  })
);

// i 番目の動画を見返しの枠に入れ、一覧のその行に印をつける
function showClip(i) {
  $("playback").src = clips[i].url;
  document.querySelectorAll(".clip").forEach((row) => row.classList.toggle("is-current", row.dataset.index === String(i)));
}

// 共有は動画だけ（題名や文字をつけると、LINE などで別のメッセージとして届くことがあるため）
async function shareFiles(list) {
  try {
    await navigator.share({ files: list.map((c) => c.file) });
    logUse("share", list.length);
    markSaved(list);
    markShared();
  } catch {
    // やめたときは何もしない
  }
}
// 動画を消す（🗑）：確かめずに消して、トーストの「元に戻す」で同じ場所にもどす（動画の中身は少しのあいだ残しておく）。
// 消したら一覧を出しなおし、なくなったら閉じる
function deleteClip(c) {
  const at = clips.indexOf(c);
  clips = clips.filter((x) => x !== c);
  showOpenSaved();
  if (clips.length) renderClips();
  else closeSaveSheet();
  LineShareUI.toast("動画を消しました", {
    actionLabel: "元に戻す",
    onAction: () => {
      clips.splice(Math.min(at, clips.length), 0, c);
      showOpenSaved();
      if (!$("saveSheet").hidden) renderClips();
    }
  });
  // 元に戻せなくなったら（トーストが消えたら）、中身を手放す
  setTimeout(() => {
    if (!clips.includes(c) && c.url) URL.revokeObjectURL(c.url);
  }, 8000);
}
// 保存・共有した動画に印（✓）
function markSaved(list) {
  list.forEach((c) => (c.saved = true));
  renderClips();
}
// 何回目の録画か（カメラで撮ったものだけで数える）
const shotTakes = () => [...new Set(clips.filter((c) => c.kind === "shot").map((c) => c.take))].sort((a, b) => a - b);
// その録画が、カメラで撮った何回目か（1 から）を返す
const takeNumber = (t) => shotTakes().indexOf(t) + 1;

// 共有がすんだら：「✓ 共有できました」と、「0 - 0 から撮りなおす」を目立たせる（次の試合へ）
function markShared() {
  $("sharedNote").textContent = seasonal("✓ 共有できました");
  $("sharedNote").hidden = false;
  $("restartSave").classList.add("is-suggest");
}
$("shareAll").addEventListener("click", () => shareFiles(pickedIndexes().map((i) => clips[i])));
// 保存の画面を閉じる（見返しの動画も止める）
const closeSaveSheet = () => {
  $("saveSheet").hidden = true;
  $("playback").pause();
};
// 続きを撮る：同じチーム・スコアそのままで、撮る画面にもどる（後半など）
$("closeSave").addEventListener("click", closeSaveSheet);
// はじめの画面へ（チーム・色を変える）。カメラを止める。動画は消さない（0 - 0 から撮りなおすまで残る）
$("toSetup").addEventListener("click", () => {
  closeSaveSheet();
  closeCamera();
  showOpenSaved();
});
// はじめの画面の「🎞 録った動画（◯本）」：録った動画があるときだけ出し、押すと保存の画面（閉じるだけ）
function showOpenSaved() {
  $("openSaved").hidden = !clips.length;
  $("openSaved").textContent = `🎞 録った動画（${clips.length}本）`;
}
$("openSaved").addEventListener("click", () => openSaveSheet(false));
$("closeSheetOnly").addEventListener("click", () => {
  closeSaveSheet();
  showOpenSaved();
});
// 0 - 0 にして、撮る画面にもどる（次の試合など）。動画は消さない（消すのは動画の行の 🗑）
$("restartSave").addEventListener("click", () => {
  state.us = 0;
  state.them = 0;
  save();
  showSetupScore();
  closeSaveSheet();
});
// 録画ボタン：タップで録画をはじめる・止める
