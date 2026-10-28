// ろくが：録った動画・書き出した動画を、ページが読みなおされても残す。
// iPhone（Safari・Chrome）は「📤 保存・共有」から戻ったときなどに、ページを読みなおすことがあり、保存の画面の動画が消えていたため。
// 動画はこの端末の中（IndexedDB）に置くだけで、外には送らない。🗑 で消したら（元に戻せなくなったら）ここからも消す。7日たったものも消す。
// 読みなおしたら、残っていた動画を「🎞 録った動画（◯本）」にもどし、保存の画面を開いていたなら、もう一度開く。
// 読み込む順は index.html（… → merge → keep → app.js）。record.js の showSaved・deleteClip・markSaved・openSaveSheet・closeSaveSheet から呼ぶ
"use strict";

const KEEP_DAYS = 7;
const KEEP_SHEET = "roqga:sheetOpen"; // 保存の画面を開いているか（sessionStorage。読みなおしても同じタブなら残る）
const KEEP_SAVED = "roqga:keptSaved"; // 保存・共有ずみの印（localStorage。動画の中身を書きなおさずに済むように別に置く）
let keepSeq = 0;
let keepReady = false; // 端末の中に残せるか（入れ物が開けたら true）
// 1本がこれより大きい動画は残さない（iPhone で何百 MB もの動画を写すと、メモリが足りずにタブが落ちることがある）
const KEEP_MAX_BYTES = 600 * 1024 * 1024;
// 前に残している途中でタブが落ちた端末では、残さない（riskCrashed。page.js）
const keepCrashed = riskCrashed("keep");

// 入れ物を開く（使えないブラウザ・プライベートなどでは null。そのときは今までどおり、ページの中だけ）
let keepDbOpen = null;
function keepDb() {
  keepDbOpen ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open("roqga-keep", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("clips", { keyPath: "id" });
      req.onsuccess = () => ((keepReady = true), resolve(req.result));
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return keepDbOpen;
}
// ひとまとまりの読み書き。fn が返した要求の結果（なければ true）。うまくいかなければ null
async function keepTx(mode, fn) {
  const db = await keepDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction("clips", mode);
      const req = fn(tx.objectStore("clips"));
      tx.oncomplete = () => resolve(req?.result ?? true);
      tx.onerror = tx.onabort = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

const keepSavedIds = () => {
  try {
    return new Set(JSON.parse(localStorage.getItem(KEEP_SAVED) || "[]"));
  } catch {
    return new Set();
  }
};
const keepSavedWrite = (set) => {
  try {
    localStorage.setItem(KEEP_SAVED, JSON.stringify([...set]));
  } catch {
    // 残せなくても使える
  }
};

// まだ置いていない動画を、1本ずつ置く（大きい動画もあるので順に）
let keeping = Promise.resolve();
function keepClips() {
  if (keepCrashed) return;
  const list = clips.filter((c) => !c.keepId && c.file && c.blob.size <= KEEP_MAX_BYTES);
  list.forEach((c) => (c.keepId = `${Date.now()}-${++keepSeq}`));
  if (!list.length) return;
  const note = $("keepNote");
  note.hidden = false;
  note.textContent = "⏳ 読みなおしても消えないよう、この端末に残しています…（終わるまで、保存・共有は待ってね）";
  // 残しているあいだは、保存・共有を押せないように（同時に動画を読みこむと、iPhone ではメモリが足りずにタブが落ちることがある）
  document.body.classList.add("is-keeping");
  // 長くかかりすぎたら（入れ物が返事をしないなど）、待たずに押せるようにもどす
  const giveUp = setTimeout(() => document.body.classList.remove("is-keeping"), 90000);
  keeping = keeping.then(async () => {
    for (const c of list) {
      if (!clips.includes(c)) continue; // 置く前に消された
      const { blob, type, from, to, fromExact, toExact, kind, label, take, takeAt, keepId } = c;
      riskBegin("keep");
      const ok = await keepTx("readwrite", (s) => s.put({ id: keepId, blob, type, name: c.file.name, from, to, fromExact, toExact, kind, label, take, takeAt }));
      riskEnd("keep");
      if (!ok) c.keepId = null; // いっぱいなど：この動画はページの中だけ
    }
    const kept = list.every((c) => c.keepId || !clips.includes(c));
    note.textContent = kept ? "✓ この端末に残しました（保存・共有のあとにページが読みなおされても消えません）" : "";
    note.hidden = !kept;
    clearTimeout(giveUp);
    document.body.classList.remove("is-keeping");
  });
}

// 置いた動画を消す
function unkeepClip(c) {
  if (!c.keepId) return;
  const id = c.keepId;
  c.keepId = null;
  keeping = keeping.then(() => keepTx("readwrite", (s) => s.delete(id)));
  const saved = keepSavedIds();
  if (saved.delete(id)) keepSavedWrite(saved);
}

// 保存・共有ずみの印を残す
function keepMarkSaved(list) {
  const saved = keepSavedIds();
  list.forEach((c) => c.keepId && saved.add(c.keepId));
  keepSavedWrite(saved);
}

// 保存の画面を開いているか（読みなおしたら、もう一度開く）
function keepSheetOpen(open) {
  try {
    if (open) sessionStorage.setItem(KEEP_SHEET, "1");
    else sessionStorage.removeItem(KEEP_SHEET);
  } catch {
    // 残せなくても使える
  }
}

// 起きたとき：残っていた動画をもどす（7日たったものは消す）
async function restoreKept() {
  const list = await keepTx("readonly", (s) => s.getAll());
  if (!list?.length) return;
  const old = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
  const saved = keepSavedIds();
  const back = [];
  for (const rec of list.sort((a, b) => a.takeAt - b.takeAt || a.from - b.from)) {
    if (rec.takeAt < old || !rec.blob) {
      keepTx("readwrite", (s) => s.delete(rec.id));
      continue;
    }
    if (clips.some((c) => c.keepId === rec.id)) continue;
    const { id, name, ...rest } = rec;
    back.push({ ...rest, keepId: id, saved: saved.has(id), file: new File([rec.blob], name, { type: rec.type }), url: URL.createObjectURL(rec.blob) });
  }
  if (!back.length) return;
  // 回の番号は、いちばん新しい回をいまの回に（保存の画面に「今回の動画」として出る。次に録ると新しい回になる）
  const takes = [...new Set(back.map((c) => c.take))];
  back.forEach((c) => (c.take = take + takes.indexOf(c.take) - (takes.length - 1)));
  clips = [...back, ...clips];
  showOpenSaved();
  let reopen = false;
  try {
    reopen = sessionStorage.getItem(KEEP_SHEET) === "1";
  } catch {
    // 読めなければ開かない
  }
  if (reopen && $("saveSheet").hidden) openSaveSheet(false);
  LineShareUI.toast(`前の動画（${back.length}本）をもどしました`);
}
restoreKept();
