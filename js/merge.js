// ろくが：🔗 つなぐ。ハイライトなど、いくつかの動画を選んで1本につなぐ（撮った順に並べ、↑↓ で並べかえ・✕ で外す）。
// つなぎ目の柄・5分をこえたときの分け方（動画の途中で切らない／5分ごとに切る／分けない）・1/3 の札・ファイル名の通し番号（part1…）。
// 書き出し：mp4 の形式がそろっていれば、作り直さずに並べる（quickjoin.js。すぐ終わる。切るところはキーフレームにそろえる）。
// 「1/3」の札は、札が出る最初だけ作りなおす（quickbadge.js）。
// 柄を入れるとき・形式がちがうとき・すぐつなげなかったときは、撮った動画にと同じく流しながら録る（render.js の renderPieces。つないだ長さぶんかかる）。
// 読み込む順は index.html（page → store → draw → setup → studio → record → editor → render → quickjoin → quickbadge → merge → keep → app.js）。
"use strict";

const mergeItems = []; // 選んだ動画 [{ id, file, url, name, duration, mp4, keys }]（mp4：quickjoin.js で読んだ目次・keys：キーフレームの時刻。読めなければ null）
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
  const pickBtn = $("pickMerge");
  pickBtn.disabled = true;
  $("mergeExport").disabled = true;
  for (const [i, file] of files.entries()) {
    pickBtn.textContent = `動画を読みこんでいます…（${i + 1}/${files.length}）`;
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
  mergeChanged();
});

// 並べる動画が変わった（足す・並べかえ・外す）：すぐつなぐのがうまくいかなかった印を消して（もう一度試す）、描きなおす
function mergeChanged() {
  mergeQuickFailed = null;
  renderMerge();
}

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

// すぐつなぐのがうまくいかなかったとき：badge（札を入れたまま作れなかった）・join（並べられなかった）。動画を選びなおすまで覚えておく
let mergeQuickFailed = null;

// 作り直さずに並べられるか。できないときは、そのわけ（画面に出す）。null ならできる
function mergeSlowReason(parts = mergeParts()) {
  if (transitionOf(state.mergeTransition).draw) return "つなぎ目の柄を入れるので";
  if (parts.length > 1 && state.mergeBadge && (!quickBadgeReady() || mergeQuickFailed === "badge")) {
    return `この端末では「1/${parts.length}」の札を入れたまま すぐにはつなげないので（札を「入れない」にすると、すぐ終わります）`;
  }
  if (mergeQuickFailed === "join") return "この動画は そのままではつなげなかったので";
  if (!window.Blob || !mp4Joinable(mergeItems.map((m) => m.mp4))) return "そのまま並べられない動画（形式がちがうなど）があるので";
  if (parts.inexact) return "そのままでは切れないところがあるので";
  return null;
}

// 一覧・分け方・見本（part ごとの長さ）・書き出すボタンを描きなおす
function renderMerge() {
  $("mergeList").replaceChildren(
    ...mergeItems.map((m, i) => {
      const li = Object.assign(document.createElement("li"), { className: "merge-item" });
      // ファイル名（iPhone では IMG_1234.MOV や長い記号の名前で、せまい画面では見分けにくい）は出さず、長さと撮った日時（ファイルの日時）で見分ける
      const d = new Date(m.file.lastModified);
      const when = Number.isFinite(d.getTime()) && m.file.lastModified ? `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${pad2(d.getMinutes())}` : "";
      const name = Object.assign(document.createElement("span"), { className: "merge-name", textContent: clock(Math.round(m.duration)) });
      if (when) name.append(Object.assign(document.createElement("small"), { textContent: when }));
      name.title = m.name;
      // ボタン（↑・↓・✕）を作る
      const btn = (text, label, disabled, onClick) => {
        const b = Object.assign(document.createElement("button"), { type: "button", textContent: text, disabled });
        b.setAttribute("aria-label", `${i + 1}本目の動画を${label}`);
        b.addEventListener("click", onClick);
        return b;
      };
      const move = (dir) => () => {
        mergeItems.splice(i, 1);
        mergeItems.splice(i + dir, 0, m);
        mergeChanged();
      };
      li.append(
        name,
        btn("↑", "上へ", i === 0, move(-1)),
        btn("↓", "下へ", i === mergeItems.length - 1, move(1)),
        btn("✕", "外す", false, () => {
          mergeItems.splice(i, 1);
          URL.revokeObjectURL(m.url);
          mergeChanged();
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
  const parts = mergeParts();
  const slow = mergeSlowReason(parts);
  $("mergeExport").textContent = !mergeItems.length
    ? "🔗 つないで書き出す"
    : slow
      ? `🔗 ${mergeItems.length}本をつないで書き出す（約 ${clock(Math.ceil(total))}）`
      : `🔗 ${mergeItems.length}本をつなぐ（すぐ終わります）`;
  // 分けたときの見本：part ごとの長さ
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
        ? parts.length > 1 && state.mergeBadge
          ? "札が出る最初の数秒だけ作りなおし、あとはそのまま並べるので、すぐ終わります（できない端末では、流しながら作ります）。"
          : "動画を作り直さずに並べるので、すぐ終わります（画質もそのまま）。"
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

// できた動画を、at 秒（札を入れて作りなおしたところと、そのままのところのつなぎ目）の少し前から流して、こえて映りつづけるか確かめる。
// この端末で読めない書き方なら false（流してつなぐ）
const mergePlayable = (blob, at) =>
  new Promise((resolve) => {
    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    const url = URL.createObjectURL(blob);
    const done = (ok) => {
      clearTimeout(timer);
      v.pause();
      v.removeAttribute("src");
      v.load();
      URL.revokeObjectURL(url);
      resolve(ok);
    };
    const timer = setTimeout(() => done(false), 8000);
    v.addEventListener("error", () => done(false), { once: true });
    v.addEventListener("loadedmetadata", () => (v.currentTime = Math.max(0, at - 0.4)), { once: true });
    v.addEventListener("seeked", () => v.play().catch(() => done(false)), { once: true });
    v.addEventListener("timeupdate", () => v.currentTime >= Math.min(at + 0.5, v.duration - 0.05) && done(!v.error && v.videoWidth > 0));
    v.src = url;
  });

// 作り直さずに並べる：part ごとに1本の mp4 を作り、長さが合っているか確かめてから保存の画面へ。うまくいかなければ false（流してつなぐ）
async function mergeQuick(parts, label) {
  $("mergeExport").disabled = true;
  $("mergeNote").textContent = "つないでいます…";
  try {
    const made = [];
    const badge = state.mergeBadge && parts.length > 1;
    for (const [pi, part] of parts.entries()) {
      // 動画の一部だけのときは、キーフレームで切って取り出す
      const end = (p) => (p.b < p.item.duration - 0.05 ? p.b : Infinity);
      const list = part.map((p) => ({
        file: p.item.file,
        info: p.a > 0.01 || end(p) < Infinity ? mp4Slice(p.item.mp4, p.a, end(p)) : p.item.mp4
      }));
      // 「1/3」の札：最初の動画の、札が出るところだけ作りなおす（できなければ流してつなぐ）
      if (badge) {
        const p = part[0];
        $("mergeNote").textContent = `「${pi + 1}/${parts.length}」の札を入れています…`;
        const head = await quickBadgePieces(p.item.file, p.item.mp4, p.item.keys || [], p.a, end(p), `${pi + 1}/${parts.length}`);
        if (!head) return "badge";
        list.splice(0, 1, ...head);
      }
      const blob = buildMp4(list);
      const want = list.reduce((s, x) => s + x.info.seconds, 0);
      const url = URL.createObjectURL(blob);
      const got = await probeDuration(url);
      URL.revokeObjectURL(url);
      if (Math.abs(got - want) > 1.5) return false; // 長さがちがう：うまく並んでいない
      if (badge && list.length > 1 && !(await mergePlayable(blob, list[0].info.seconds))) return "badge"; // 札のあとのつなぎ目が読めない
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
  if (!mergeSlowReason(parts)) {
    logUse("merge-quick", mergeItems.length);
    const done = await mergeQuick(parts, label);
    if (done === true) return;
    // うまくいかなかった：だまって長い書き出しを始めず、わけと選べること（札をやめる・流しながら作る）を出して、もう一度押してもらう
    mergeQuickFailed = done === "badge" ? "badge" : "join";
    logUse("merge-quick-failed", mergeQuickFailed);
    renderMerge();
    LineShareUI.toast("すぐにはつなげませんでした。ボタンの下を見てね");
    $("mergeNote").scrollIntoView({ block: "center", behavior: "smooth" });
    return;
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
