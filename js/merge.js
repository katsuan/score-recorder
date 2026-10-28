// ろくが：🔗 つなぐ。ハイライトなど、いくつかの動画を選んで1本につなぐ（撮った順に並べ、↑↓ で並べかえ・✕ で外す）。
// つなぎ目の柄・5分をこえたときの分け方（動画の途中で切らない／5分ごとに切る／分けない）・1/3 の札・ファイル名の通し番号（part1…）。
// 書き出しは撮った動画にと同じく、流しながら録る（render.js の renderPieces。つないだ長さぶんかかる）。
// 読み込む順は index.html（page → store → draw → setup → studio → record → editor → render → merge → app.js）。
"use strict";

const mergeItems = []; // 選んだ動画 [{ id, file, url, name, duration }]
let mergeSplit = "video"; // 5分をこえたら：video（動画の途中で切らない）・time（5分ごとに切る）・none（分けない）
let mergeSeq = 0;

// 動画の長さ（秒）を調べる。ブラウザで録った webm は長さが入っていないことがあるので、いちど最後まで飛ばして調べる。読めなければ 0
const probeDuration = (url) =>
  new Promise((resolve) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    const done = (d) => {
      v.removeAttribute("src");
      v.load();
      resolve(Number.isFinite(d) ? d : 0);
    };
    const timer = setTimeout(() => done(0), 8000);
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
  $("mergeNote").textContent = "動画を読みこんでいます…";
  for (const file of files) {
    const url = URL.createObjectURL(file);
    const duration = await probeDuration(url);
    if (!duration) {
      URL.revokeObjectURL(url);
      LineShareUI.toast(`「${file.name}」は読めませんでした`);
      continue;
    }
    mergeItems.push({ id: ++mergeSeq, file, url, name: file.name, duration });
  }
  renderMerge();
});

// 区切り（part）ごとの部分：[[{ src, a, b }], …]。動画の途中で切らない：4分55秒に収まるところまで動画を詰める（1本で5分をこえる動画だけ、その中を時間で切る）
function mergeParts() {
  const max = SEGMENT_MS / 1000;
  const all = mergeItems.map((m) => ({ src: m.url, a: 0, b: m.duration }));
  if (mergeSplit !== "video") return [all];
  const parts = [];
  let part = [];
  let len = 0;
  all.forEach((p) => {
    const d = p.b - p.a;
    if (d > max) {
      // 1本で5分をこえる：いまの part を閉じて、その動画を時間で切る
      if (part.length) parts.push(part);
      for (let a = 0; a < d - 0.5; a += max) parts.push([{ src: p.src, a, b: Math.min(d, a + max) }]);
      part = [];
      len = 0;
      return;
    }
    if (len + d > max && part.length) {
      parts.push(part);
      part = [];
      len = 0;
    }
    part.push(p);
    len += d;
  });
  if (part.length) parts.push(part);
  return parts;
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
  $("pickMerge").textContent = mergeItems.length ? "＋ 動画を足す" : "＋ 動画を選ぶ（いくつでも）";
  $("mergeExport").disabled = mergeItems.length < 2;
  $("mergeExport").textContent = mergeItems.length ? `🔗 ${mergeItems.length}本をつないで書き出す（約 ${clock(Math.ceil(total))}）` : "🔗 つないで書き出す";
  // 分けたときの見本：part ごとの長さ
  const parts = mergeParts();
  const max = SEGMENT_MS / 1000;
  $("mergePlan").textContent =
    !mergeItems.length || total <= max
      ? ""
      : mergeSplit === "video"
        ? parts.map((p, i) => `${i + 1}/${parts.length}　${clock(Math.ceil(p.reduce((s, x) => s + x.b - x.a, 0)))}`).join("　・　")
        : mergeSplit === "time"
          ? `4分55秒ごとに、約 ${Math.ceil(total / max)}本に分けます（動画の途中でも切れます）`
          : "5分をこえるので、LINE のトークでは送れないことがあります";
  // 待ち時間の目安（ブラウザは流しながら録るので、つないだ長さぶんかかる）。長いときはアプリをすすめる
  $("mergeNote").textContent = !mergeItems.length
    ? ""
    : `書き出しには、つないだ長さぶん（約 ${clock(Math.ceil(total))}）かかります。そのあいだ画面はそのままで。${total > 30 * 60 ? "30分をこえるときは、アプリのほうが速く、とちゅうで止まりにくいです。" : ""}`;
}
document.querySelectorAll("[data-merge-split]").forEach((b) =>
  b.addEventListener("click", () => {
    mergeSplit = b.dataset.mergeSplit;
    renderMerge();
  })
);

// つないで書き出す：選んだ順に流して1本に録る。動画の途中で切らないときは、part の区切りで別の動画にする。終わったら保存の画面（閉じるだけ）
$("mergeExport").addEventListener("click", () => {
  if (mergeItems.length < 2) return;
  const parts = mergeParts();
  const pieces = parts.flat();
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
    split: mergeSplit === "time",
    label: $("mergeName").value.trim() || "ハイライト",
    partStarts: mergeSplit === "video" ? starts : null
  });
});
renderMerge();
