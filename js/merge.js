// ろくが：🔗 つなぐ。ハイライトなど、いくつかの動画を選んで1本につなぐ（撮った順に並べ、↑↓ で並べかえ・✕ で外す）。
// つなぎ目の柄・5分をこえたときの分け方（動画の途中で切らない／5分ごとに切る／分けない）・1/3 の札・ファイル名の通し番号（part1…）。
// 書き出し：つなぎ目なし・札なしで、mp4 の形式がそろっていれば、作り直さずに並べる（quickjoin.js。すぐ終わる）。
// 柄・札を入れるとき・5分ごとに切るとき・形式がちがうときは、撮った動画にと同じく流しながら録る（render.js の renderPieces。つないだ長さぶんかかる）。
// 読み込む順は index.html（page → store → draw → setup → studio → record → editor → render → quickjoin → merge → app.js）。
"use strict";

const mergeItems = []; // 選んだ動画 [{ id, file, url, name, duration, mp4 }]（mp4：quickjoin.js で読んだ目次。読めなければ null）
let mergeSplit = "video"; // 5分をこえたら：video（動画の途中で切らない）・time（5分ごとに切る）・none（分けない）
let mergeSeq = 0;

// 動画の長さ（秒）を調べる。ブラウザで録った webm は長さが入っていないことがあるので、いちど最後まで飛ばして調べる。読めなければ 0
const probeDuration = (url, wait = 8000) =>
  new Promise((resolve) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    const done = (d) => {
      v.removeAttribute("src");
      v.load();
      resolve(Number.isFinite(d) ? d : 0);
    };
    const timer = setTimeout(() => done(0), wait);
    v.addEventListener("error", () => (clearTimeout(timer), done(0)), { once: true });
    v.addEventListener("loadedmetadata", () => {
      if (Number.isFinite(v.duration)) return clearTimeout(timer), done(v.duration);
      v.addEventListener("durationchange", () => Number.isFinite(v.duration) && (clearTimeout(timer), done(v.duration)));
      v.currentTime = 1e101;
    }, { once: true });
    v.src = url;
  });

$("pickMerge").addEventListener("click", () => $("mergeFiles").click());
$("mergeFiles").addEventListener("change", async (e) => {
  const files = [...(e.target.files || [])].sort((a, b) => a.lastModified - b.lastModified); // 撮った順
  e.target.value = ""; // 同じ動画をもう一度選べるように
  if (!files.length) return;
  logUse("merge-pick", files.length);
  // 読みこみ中は、押したボタンに出す（何本目か）。終わったら renderMerge で元にもどる
  const pick = $("pickMerge");
  pick.disabled = true;
  $("mergeExport").disabled = true;
  for (const [i, file] of files.entries()) {
    pick.textContent = `動画を読みこんでいます…（${i + 1}/${files.length}）`;
    const url = URL.createObjectURL(file);
    // 長さは、まず mp4 の目次から読む（iPhone の Safari は、はじめて選んだ動画だと <video> で長さを読むのに時間がかかり、読めないことがある）。
    // mp4 でなければ <video> で調べる（読めなければ、待つ時間を長くしてもう一度）
    const mp4 = await readMp4(file);
    const duration = mp4?.seconds || (await probeDuration(url)) || (await probeDuration(url, 20000));
    if (!duration) {
      URL.revokeObjectURL(url);
      LineShareUI.toast(`「${file.name}」は読めませんでした`);
      continue;
    }
    mergeItems.push({ id: ++mergeSeq, file, url, name: file.name, duration, mp4, keys: mp4 ? mp4KeyTimes(mp4) : null });
  }
  renderMerge();
});

// 切る時刻：from 秒から limit 秒までのうち、いちばん遅いキーフレーム（作り直さずに切れる所）。なければ from+limit（流してつなぐときだけ使える）
function mergeCutAt(m, from, limit) {
  let best = null;
  for (const k of m.keys || []) if (k > from + 0.5 && k <= from + limit + 0.01) best = k;
  return best === null ? { t: from + limit, exact: false } : { t: best, exact: true };
}

// 区切り（part）ごとの部分：[[{ src, a, b, item }], …]。
// 途中で切らない：4分55秒に収まるところまで動画を詰める（1本で5分をこえる動画だけ、その中を切る）。5分ごとに切る：つないだ時間で 4分55秒ごと。
// 切るところは、作り直さずに切れるキーフレームにそろえる（そろえられない所があれば inexact）
function mergeParts() {
  const max = SEGMENT_MS / 1000;
  const parts = [];
  let part = [];
  let len = 0;
  let inexact = false;
  const close = () => {
    if (part.length) parts.push(part);
    part = [];
    len = 0;
  };
  const add = (m, a, b) => {
    part.push({ src: m.url, a, b, item: m });
    len += b - a;
  };
  for (const m of mergeItems) {
    const d = m.duration;
    if (mergeSplit === "none") {
      add(m, 0, d);
      continue;
    }
    if (mergeSplit === "video") {
      if (d <= max) {
        if (len + d > max) close();
        add(m, 0, d);
        continue;
      }
      close(); // 1本で5分をこえる：その動画だけで切る
    }
    // いまの part の残りに入るところまで入れ、あふれたら切って次の part へ
    let a = 0;
    while (d - a > max - len + 0.01) {
      const cut = mergeCutAt(m, a, max - len);
      if (cut.t - a < 1 && part.length) {
        close(); // 入るところがほとんどない：次の part から
        continue;
      }
      inexact ||= !cut.exact;
      add(m, a, cut.t);
      close();
      a = cut.t;
    }
    add(m, a, d);
    if (mergeSplit === "video") close();
  }
  close();
  parts.inexact = inexact;
  return parts;
}

// 作り直さずに並べられるか。できないときは、そのわけ（画面に出す）。null ならできる
function mergeSlowReason() {
  const max = SEGMENT_MS / 1000;
  const total = mergeItems.reduce((sum, m) => sum + m.duration, 0);
  const parts = mergeParts();
  if (transitionOf(state.mergeTransition).draw) return "つなぎ目の柄を入れるので";
  if (parts.length > 1 && state.mergeBadge) return `「1/${parts.length}」の札を入れるので`;
  if (!window.Blob || !mp4Joinable(mergeItems.map((m) => m.mp4))) return "そのまま並べられない動画（形式がちがうなど）があるので";
  if (parts.inexact) return "そのままでは切れないところがあるので";
  return null;
}

// 一覧・分け方・見本（part ごとの長さ）・書き出すボタンを描きなおす
function renderMerge() {
  $("mergeList").replaceChildren(
    ...mergeItems.map((m, i) => {
      const li = Object.assign(document.createElement("li"), { className: "merge-item" });
      const name = Object.assign(document.createElement("span"), { className: "merge-name", textContent: m.name });
      name.append(Object.assign(document.createElement("small"), { textContent: clock(Math.round(m.duration)) }));
      // ボタン（↑・↓・✕）を作る
      const btn = (text, label, disabled, onClick) => {
        const b = Object.assign(document.createElement("button"), { type: "button", textContent: text, disabled });
        b.setAttribute("aria-label", `${m.name} を${label}`);
        b.addEventListener("click", onClick);
        return b;
      };
      const move = (dir) => () => {
        mergeItems.splice(i, 1);
        mergeItems.splice(i + dir, 0, m);
        renderMerge();
      };
      li.append(
        name,
        btn("↑", "上へ", i === 0, move(-1)),
        btn("↓", "下へ", i === mergeItems.length - 1, move(1)),
        btn("✕", "外す", false, () => {
          mergeItems.splice(i, 1);
          URL.revokeObjectURL(m.url);
          renderMerge();
        })
      );
      return li;
    })
  );
  document.querySelectorAll("[data-merge-split]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.mergeSplit === mergeSplit)));
  const total = mergeItems.reduce((sum, m) => sum + m.duration, 0);
  $("pickMerge").disabled = false;
  $("pickMerge").textContent = mergeItems.length ? "＋ 動画を足す" : "＋ 動画を選ぶ（いくつでも）";
  $("mergeExport").disabled = mergeItems.length < 2;
  const slow = mergeSlowReason();
  $("mergeExport").textContent = !mergeItems.length
    ? "🔗 つないで書き出す"
    : slow
      ? `🔗 ${mergeItems.length}本をつないで書き出す（約 ${clock(Math.ceil(total))}）`
      : `🔗 ${mergeItems.length}本をつなぐ（すぐ終わります）`;
  // 分けたときの見本：part ごとの長さ
  const parts = mergeParts();
  const max = SEGMENT_MS / 1000;
  // 「1/4」の札：分けるときだけ選べる（見出しの数は、いまの本数）
  $("mergeBadgeRow").hidden = parts.length < 2;
  $("mergeBadgeLabel").textContent = `分けた各1本の最初に「1/${Math.max(2, parts.length)}」の札`;
  document.querySelectorAll("[data-merge-badge]").forEach((b) => b.setAttribute("aria-checked", String((b.dataset.mergeBadge === "on") === state.mergeBadge)));
  $("mergePlan").textContent =
    !mergeItems.length || total <= max
      ? ""
      : mergeSplit === "none"
        ? "5分をこえるので、LINE のトークでは送れないことがあります"
        : mergeSplit === "time" && slow
          ? `4分55秒ごとに、約 ${Math.ceil(total / max)}本に分けます（動画の途中でも切れます）`
          : parts.map((p, i) => `${i + 1}/${parts.length}　${clock(Math.max(1, Math.round(p.reduce((s, x) => s + x.b - x.a, 0))))}`).join("　・　");
  // 待ち時間の目安（流しながら録るときは、つないだ長さぶんかかる）。長いときはアプリをすすめる
  $("mergeNote").textContent =
    mergeItems.length < 2
      ? ""
      : !slow
        ? "動画を作り直さずに並べるので、すぐ終わります（画質もそのまま）。"
        : `${slow}、流しながら作ります。つないだ長さぶん（約 ${clock(Math.ceil(total))}）かかるので、そのあいだ画面はそのままで。${total > 30 * 60 ? "30分をこえるときは、アプリのほうが速く、とちゅうで止まりにくいです。" : ""}`;
}
document.querySelectorAll("[data-merge-split]").forEach((b) =>
  b.addEventListener("click", () => {
    mergeSplit = b.dataset.mergeSplit;
    renderMerge();
  })
);
document.querySelectorAll("[data-merge-badge]").forEach((b) =>
  b.addEventListener("click", () => {
    state.mergeBadge = b.dataset.mergeBadge === "on";
    save();
    renderMerge();
  })
);

// 作り直さずに並べる：part ごとに1本の mp4 を作り、長さが合っているか確かめてから保存の画面へ。うまくいかなければ false（流してつなぐ）
async function mergeQuick(parts, label) {
  $("mergeExport").disabled = true;
  $("mergeNote").textContent = "つないでいます…";
  try {
    const made = [];
    for (const part of parts) {
      // 動画の一部だけのときは、キーフレームで切って取り出す
      const list = part.map((p) => ({
        file: p.item.file,
        info: p.a > 0.01 || p.b < p.item.duration - 0.05 ? mp4Slice(p.item.mp4, p.a, p.b < p.item.duration - 0.05 ? p.b : Infinity) : p.item.mp4
      }));
      const blob = buildMp4(list);
      const want = list.reduce((s, x) => s + x.info.seconds, 0);
      const url = URL.createObjectURL(blob);
      const got = await probeDuration(url);
      URL.revokeObjectURL(url);
      if (Math.abs(got - want) > 1.5) return false; // 長さがちがう：うまく並んでいない
      made.push({ blob, seconds: want });
    }
    // 保存の画面に出す（撮った動画にの書き出しと同じく、新しい回として足す）
    take += 1;
    startedAt = Date.now();
    pick = "all";
    let from = 0;
    made.forEach(({ blob, seconds }) => {
      clips.push({ blob, type: "video/mp4", from: Math.round(from), to: Math.round(from + seconds), fromExact: from, toExact: from + seconds, kind: "merge", label, take, takeAt: startedAt, saved: false });
      from += seconds;
    });
    exportMode = true;
    showSaved();
    return true;
  } catch {
    return false;
  } finally {
    renderMerge();
  }
}

// つないで書き出す：並べられるなら作り直さずに並べる。そうでなければ選んだ順に流して1本に録る。
// 動画の途中で切らないときは、part の区切りで別の動画にする。終わったら保存の画面（閉じるだけ）
$("mergeExport").addEventListener("click", async () => {
  if (mergeItems.length < 2) return;
  const parts = mergeParts();
  const label = $("mergeName").value.trim() || "ハイライト";
  if (!mergeSlowReason()) {
    logUse("merge-quick", mergeItems.length);
    if (await mergeQuick(parts, label)) return;
    LineShareUI.toast("そのままではつなげなかったので、流しながら作ります");
  }
  // 5分ごとに切る：流しながら 4分55秒ごとに録りなおす。ほかは part の区切りで別の動画にする
  const timed = mergeSplit === "time";
  const pieces = timed ? mergeItems.map((m) => ({ src: m.url, a: 0, b: m.duration })) : parts.flat();
  // 各 part のはじめの部分の番号（0 番は入れない）
  const starts = new Set();
  let n = 0;
  parts.forEach((p, i) => {
    if (i) starts.add(n);
    n += p.length;
  });
  exportMode = true;
  logUse("merge", mergeItems.length);
  renderPieces(pieces, {
    overlay: false,
    kind: "merge",
    title: `🔗 ${mergeItems.length}本をつないでいます…`,
    split: timed,
    label,
    partStarts: timed ? null : starts,
    transition: state.mergeTransition,
    badge: state.mergeBadge
  });
});
renderMerge();
