// ろくが：🔗 つなぐの「そのまま並べる」。mp4 の動画を作り直さずに（中身のコマをそのまま写して）1本に並べる。
// iPhone で撮った動画どうしのように、形式（コーデック・大きさ・向き・音）がそろっていれば、数秒で終わる。
// そろっていない・読めない動画があれば null を返し、merge.js が今までどおり流してつなぐ（つなぎ目の柄や 1/3 の札を入れるときも流してつなぐ）。
// 中身：動画の目次（moov）だけを読み、コマの場所と長さの表を足し合わせて、新しい目次を作る。コマのデータは File の切り出し（Blob）のまま並べるので、大きな動画でもメモリを使わない。
// 外の部品は使わない（電波がなくても使えるように）。読み込む順は index.html（… → render → quickjoin → merge → app.js）。
"use strict";

// ---- 読む ----
const MP4_CONTAINERS = new Set(["moov", "trak", "mdia", "minf", "stbl", "edts", "dinf"]);
const fourcc = (b, at) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);

// bytes[start, end) の中の箱（box）を順に返す：{ type, start（箱のはじめ）, body（中身のはじめ）, end }
function mp4Boxes(bytes, start = 0, end = bytes.length) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const list = [];
  let at = start;
  while (at + 8 <= end) {
    let size = v.getUint32(at);
    const type = fourcc(bytes, at + 4);
    let body = at + 8;
    if (size === 1) {
      size = Number(v.getBigUint64(at + 8));
      body = at + 16;
    } else if (size === 0) size = end - at;
    if (size < 8 || at + size > end) break;
    list.push({ type, start: at, body, end: at + size });
    at += size;
  }
  return list;
}
const mp4Child = (bytes, box, type) => mp4Boxes(bytes, box.body, box.end).find((b) => b.type === type);
// 箱の道すじをたどる（"mdia/minf/stbl/stsd" など）
const mp4Path = (bytes, box, path) => path.split("/").reduce((b, t) => b && mp4Child(bytes, b, t), box);

// 目次（moov）の中身から、トラックごとの表を作る。読めない形（分けて書いた mp4・中身の種類が2つ以上など）は null
function parseMoov(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u32 = (at) => v.getUint32(at);
  const moov = mp4Boxes(bytes).find((b) => b.type === "moov");
  if (!moov) return null;
  if (mp4Child(bytes, moov, "mvex")) return null; // 分けて書いた mp4（fragmented）：目次にコマがない
  const mvhd = mp4Child(bytes, moov, "mvhd");
  if (!mvhd) return null;
  const movieScale = u32(mvhd.body + (bytes[mvhd.body] === 1 ? 20 : 12));
  const tracks = [];
  for (const trak of mp4Boxes(bytes, moov.body, moov.end).filter((b) => b.type === "trak")) {
    const hdlr = mp4Path(bytes, trak, "mdia/hdlr");
    const handler = hdlr ? fourcc(bytes, hdlr.body + 8) : "";
    if (handler !== "vide" && handler !== "soun") continue; // 字幕・時刻などのトラックは写さない
    const tkhd = mp4Child(bytes, trak, "tkhd");
    const mdhd = mp4Path(bytes, trak, "mdia/mdhd");
    const stbl = mp4Path(bytes, trak, "mdia/minf/stbl");
    const stsd = stbl && mp4Child(bytes, stbl, "stsd");
    if (!tkhd || !mdhd || !stbl || !stsd || u32(stsd.body + 4) !== 1) return null;
    const timescale = u32(mdhd.body + (bytes[mdhd.body] === 1 ? 20 : 12));
    const tkhdTail = tkhd.body + (bytes[tkhd.body] === 1 ? 52 : 40); // 向き（matrix 36）と大きさ（幅・高さ 各4）
    const table = (type) => mp4Child(bytes, stbl, type);
    // コマの長さ（stts）
    const durations = [];
    const stts = table("stts");
    if (!stts) return null;
    for (let i = 0, n = u32(stts.body + 4); i < n; i++) {
      const count = u32(stts.body + 8 + i * 8);
      const delta = u32(stts.body + 12 + i * 8);
      for (let k = 0; k < count; k++) durations.push(delta);
    }
    const count = durations.length;
    // 表示のずれ（ctts。B フレームがあるとき）
    const offsets = new Array(count).fill(0);
    const ctts = table("ctts");
    if (ctts) {
      let s = 0;
      for (let i = 0, n = u32(ctts.body + 4); i < n; i++) {
        const c = u32(ctts.body + 8 + i * 8);
        const off = v.getInt32(ctts.body + 12 + i * 8);
        for (let k = 0; k < c && s < count; k++) offsets[s++] = off;
      }
    }
    // 大きさ（stsz）
    const stsz = table("stsz");
    if (!stsz || u32(stsz.body + 8) !== count) return null;
    const fixed = u32(stsz.body + 4);
    const sizes = Array.from({ length: count }, (_, i) => (fixed ? fixed : u32(stsz.body + 12 + i * 4)));
    // キーフレーム（stss。なければ全部）
    const stss = table("stss");
    let sync = null;
    if (stss) {
      sync = new Array(count).fill(false);
      for (let i = 0, n = u32(stss.body + 4); i < n; i++) sync[u32(stss.body + 8 + i * 4) - 1] = true;
    }
    // かたまり（chunk）の場所（stco・co64）と、かたまりごとのコマの数（stsc）
    const stco = table("stco");
    const co64 = table("co64");
    if (!stco && !co64) return null;
    const chunkOffsets = [];
    for (let i = 0, n = u32((stco || co64).body + 4); i < n; i++) {
      chunkOffsets.push(stco ? u32(stco.body + 8 + i * 4) : Number(v.getBigUint64(co64.body + 8 + i * 8)));
    }
    const stsc = table("stsc");
    if (!stsc) return null;
    const runs = [];
    for (let i = 0, n = u32(stsc.body + 4); i < n; i++) runs.push({ first: u32(stsc.body + 8 + i * 12) - 1, per: u32(stsc.body + 12 + i * 12) });
    const chunks = []; // [{ offset, first（はじめのコマの番号）, count, size }]
    let s = 0;
    runs.forEach((run, r) => {
      const last = r + 1 < runs.length ? runs[r + 1].first : chunkOffsets.length;
      for (let c = run.first; c < last && s < count; c++) {
        const n = Math.min(run.per, count - s);
        let size = 0;
        for (let k = 0; k < n; k++) size += sizes[s + k];
        chunks.push({ offset: chunkOffsets[c], first: s, count: n, size });
        s += n;
      }
    });
    if (s !== count) return null;
    // はじめの見せない部分（elst の media_time。B フレームのずれ・音の頭の詰めもの）と、見せる長さ
    let mediaTime = 0;
    let shown = null;
    const elst = mp4Path(bytes, trak, "edts/elst");
    if (elst) {
      const v1 = bytes[elst.body] === 1;
      const entries = [];
      for (let i = 0, n = u32(elst.body + 4); i < n; i++) {
        const at = elst.body + 8 + i * (v1 ? 20 : 12);
        entries.push(v1 ? { dur: Number(v.getBigUint64(at)), time: Number(v.getBigInt64(at + 8)) } : { dur: u32(at), time: v.getInt32(at + 4) });
      }
      const real = entries.filter((e) => e.time >= 0);
      if (real.length !== 1 || entries.length > 2) return null; // 空き（time -1）を1つと、見せる所1つまで
      mediaTime = real[0].time;
      shown = real[0].dur / movieScale;
    }
    const mediaSeconds = durations.reduce((a, b) => a + b, 0) / timescale;
    const minf = mp4Path(bytes, trak, "mdia/minf");
    tracks.push({
      kind: handler,
      timescale,
      language: v.getUint16(mdhd.body + (bytes[mdhd.body] === 1 ? 32 : 20)),
      tkhdTail: bytes.slice(tkhdTail, tkhdTail + 44),
      hdlr: bytes.slice(hdlr.start, hdlr.end),
      header: (() => {
        const h = mp4Child(bytes, minf, handler === "vide" ? "vmhd" : "smhd");
        return h ? bytes.slice(h.start, h.end) : null;
      })(),
      stsd: bytes.slice(stsd.start, stsd.end),
      codec: fourcc(bytes, stsd.body + 12),
      durations,
      offsets,
      sizes,
      sync,
      chunks,
      mediaTime,
      seconds: shown ?? Math.max(0, mediaSeconds - mediaTime / timescale)
    });
  }
  const video = tracks.find((t) => t.kind === "vide");
  if (!video || tracks.filter((t) => t.kind === "vide").length > 1 || tracks.filter((t) => t.kind === "soun").length > 1) return null;
  return { tracks, seconds: video.seconds };
}

// File（または Blob）の目次だけを読む。読めない・mp4 でないときは null
async function readMp4(file) {
  try {
    let at = 0;
    while (at + 8 <= file.size) {
      const head = new Uint8Array(await file.slice(at, at + 16).arrayBuffer());
      const v = new DataView(head.buffer);
      let size = v.getUint32(0);
      const type = fourcc(head, 4);
      if (at === 0 && type !== "ftyp") return null;
      if (size === 1) size = Number(v.getBigUint64(8));
      else if (size === 0) size = file.size - at;
      if (size < 8) return null;
      if (type === "moof") return null; // 分けて書いた mp4
      if (type === "moov") {
        if (size > 200 * 1024 * 1024) return null;
        return parseMoov(new Uint8Array(await file.slice(at, at + size).arrayBuffer()));
      }
      at += size;
    }
  } catch {
    // 読めないときは流してつなぐ
  }
  return null;
}

// コーデックの中身の目印（stsd の中の、映像の大きさ・avcC/hvcC・色の箱、音の数・速さ・AudioSpecificConfig）。
// ビットレートの目安（btrt・esds の中の数）は動画ごとにちがうので比べない
function mp4CodecKey(t) {
  const b = t.stsd;
  const entry = 16; // stsd の箱（8）＋ 版（4）＋ 数（4）
  const type = fourcc(b, entry + 4);
  const video = t.kind === "vide";
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const parts = [type, video ? `${v.getUint16(entry + 32)}x${v.getUint16(entry + 34)}` : `${v.getUint16(entry + 24)}ch${v.getUint32(entry + 32)}`];
  const end = entry + v.getUint32(entry);
  for (const box of mp4Boxes(b, entry + (video ? 86 : 36), end)) {
    if (box.type === "btrt") continue;
    if (box.type === "esds") {
      // DecoderSpecificInfo（タグ 5）だけ
      const body = b.subarray(box.body + 4, box.end);
      const at = body.indexOf(5);
      parts.push(`esds:${Array.from(body.subarray(at)).join(",").slice(0, 200)}`);
      continue;
    }
    parts.push(`${box.type}:${b.subarray(box.body, box.end).join(",")}`);
  }
  return parts.join(";");
}

// そのまま並べられるか：トラックの種類・コーデックの中身・時間の目盛り・向きと大きさが、全部の動画でそろっているか
function mp4Joinable(infos) {
  if (infos.length < 1 || infos.some((m) => !m)) return false;
  const key = (m) => m.tracks.map((t) => `${t.kind}:${t.timescale}:${mp4CodecKey(t)}:${t.kind === "vide" ? t.tkhdTail.join(",") : ""}`).join("|");
  const first = key(infos[0]);
  return infos.every((m) => key(m) === first);
}

// ---- 書く ----
// 箱を作る（中身は Uint8Array か数の並び）
function mp4Box(type, ...parts) {
  const body = parts.map((p) => (p instanceof Uint8Array ? p : Uint8Array.from(p)));
  const size = 8 + body.reduce((a, b) => a + b.length, 0);
  const out = new Uint8Array(size);
  const v = new DataView(out.buffer);
  v.setUint32(0, size);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  let at = 8;
  body.forEach((b) => (out.set(b, at), (at += b.length)));
  return out;
}
// 数を何バイトかで書く（大きい順）
function mp4Ints(list) {
  const out = new Uint8Array(list.reduce((a, [, n]) => a + n, 0));
  const v = new DataView(out.buffer);
  let at = 0;
  list.forEach(([x, n]) => {
    if (n === 1) v.setUint8(at, x);
    else if (n === 2) v.setUint16(at, x);
    else if (n === 4) x < 0 ? v.setInt32(at, x) : v.setUint32(at, x);
    else v.setBigUint64(at, BigInt(x));
    at += n;
  });
  return out;
}
const MP4_MATRIX = [0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000].map((x) => [x, 4]);

// 並べた動画を作る。list：[{ file, info }]（mp4Joinable がそろっているもの）。Blob を返す
function buildMp4(list) {
  const movieScale = 1000;
  const first = list[0].info;
  // 動画ごとの、つないだ動画の中での始まり（秒）
  const starts = [];
  let total = 0;
  list.forEach(({ info }) => (starts.push(total), (total += info.seconds)));
  // トラックごとに、コマの表を足していく
  const tracks = first.tracks.map((t0, ti) => {
    const out = { t0, durations: [], offsets: [], sizes: [], sync: t0.sync ? [] : null, chunks: [] };
    let dts = 0; // つないだトラックの中の時刻（目盛りは最初の動画のまま）
    list.forEach(({ info }, k) => {
      const t = info.tracks[ti];
      const base = Math.round(starts[k] * t0.timescale) + t0.mediaTime - t.mediaTime;
      // 前の動画の音・映像が少し短くて、すき間があくときは、前の最後のコマを長くして詰める（少し長いときは、そのまま後ろに続ける）
      if (k && base > dts && out.durations.length) {
        out.durations[out.durations.length - 1] += base - dts;
        dts = base;
      }
      const firstSample = out.sizes.length;
      out.durations.push(...t.durations);
      out.offsets.push(...t.offsets);
      out.sizes.push(...t.sizes);
      if (out.sync) out.sync.push(...(t.sync || t.durations.map(() => true)));
      t.chunks.forEach((c) => out.chunks.push({ file: k, src: c.offset, size: c.size, count: c.count, first: firstSample + c.first }));
      dts += t.durations.reduce((a, b) => a + b, 0);
    });
    out.mediaDuration = dts;
    return out;
  });
  // データの並び：動画ごとに、もとの場所の順（音と映像が交互になっているのをそのまま）
  const order = tracks.flatMap((t, ti) => t.chunks.map((c) => ({ ...c, ti }))).sort((a, b) => a.file - b.file || a.src - b.src);
  const dataSize = order.reduce((a, c) => a + c.size, 0);
  const big = dataSize > 0xfffffff0; // 4GB をこえるとき
  const ftyp = mp4Box("ftyp", [...[..."isom"].map((c) => c.charCodeAt(0)), 0, 0, 2, 0, ...[..."isomiso2mp41"].map((c) => c.charCodeAt(0))]);

  // 目次を作る（chunkBase：データの始まりの位置。目次の大きさが決まってから、もう一度作る）
  const makeMoov = (chunkBase) => {
    let at = chunkBase;
    order.forEach((c) => ((c.dst = at), (at += c.size)));
    const duration = Math.round(total * movieScale);
    const mvhd = mp4Box("mvhd", mp4Ints([[0, 4], [0, 4], [0, 4], [movieScale, 4], [duration, 4], [0x10000, 4], [0x100, 2], [0, 2], [0, 4], [0, 4], ...MP4_MATRIX, ...new Array(6).fill([0, 4]), [tracks.length + 1, 4]]));
    const traks = tracks.map((t, ti) => {
      const { t0 } = t;
      const video = t0.kind === "vide";
      const tkhd = mp4Box("tkhd", mp4Ints([[3, 4], [0, 4], [0, 4], [ti + 1, 4], [0, 4], [duration, 4], [0, 4], [0, 4], [0, 2], [0, 2], [video ? 0 : 0x100, 2], [0, 2]]), t0.tkhdTail);
      const edts = t0.mediaTime ? mp4Box("edts", mp4Box("elst", mp4Ints([[0, 4], [1, 4], [duration, 4], [t0.mediaTime, 4], [0x10000, 4]]))) : new Uint8Array(0);
      const mdhd = mp4Box("mdhd", mp4Ints([[0, 4], [0, 4], [0, 4], [t0.timescale, 4], [Math.min(t.mediaDuration, 0xffffffff), 4], [t0.language, 2], [0, 2]]));
      // コマの長さ（同じ長さが続くところはまとめる）
      const runs = (arr) => arr.reduce((r, x) => (r.length && r[r.length - 1][1] === x ? r[r.length - 1][0]++ : r.push([1, x]), r), []);
      const stts = runs(t.durations);
      const sttsBox = mp4Box("stts", mp4Ints([[0, 4], [stts.length, 4], ...stts.flatMap(([n, d]) => [[n, 4], [d, 4]])]));
      const hasCtts = t.offsets.some((x) => x);
      const ctts = runs(t.offsets);
      const cttsBox = hasCtts ? mp4Box("ctts", mp4Ints([[t.offsets.some((x) => x < 0) ? 0x01000000 : 0, 4], [ctts.length, 4], ...ctts.flatMap(([n, d]) => [[n, 4], [d, 4]])])) : new Uint8Array(0);
      const keys = t.sync ? t.sync.map((s, i) => (s ? i + 1 : 0)).filter(Boolean) : null;
      const stssBox = keys ? mp4Box("stss", mp4Ints([[0, 4], [keys.length, 4], ...keys.map((k) => [k, 4])])) : new Uint8Array(0);
      // かたまりごとのコマの数（同じ数が続くところはまとめる）
      const chunks = t.chunks;
      const stsc = [];
      chunks.forEach((c, i) => (!stsc.length || stsc[stsc.length - 1][1] !== c.count) && stsc.push([i + 1, c.count]));
      const stscBox = mp4Box("stsc", mp4Ints([[0, 4], [stsc.length, 4], ...stsc.flatMap(([f, n]) => [[f, 4], [n, 4], [1, 4]])]));
      const stszBox = mp4Box("stsz", mp4Ints([[0, 4], [0, 4], [t.sizes.length, 4], ...t.sizes.map((s) => [s, 4])]));
      const stcoBox = big
        ? mp4Box("co64", mp4Ints([[0, 4], [chunks.length, 4], ...chunks.map((c) => [c.dst, 8])]))
        : mp4Box("stco", mp4Ints([[0, 4], [chunks.length, 4], ...chunks.map((c) => [c.dst, 4])]));
      const dinf = mp4Box("dinf", mp4Box("dref", mp4Ints([[0, 4], [1, 4]]), mp4Box("url ", mp4Ints([[1, 4]]))));
      const header = t0.header || (video ? mp4Box("vmhd", mp4Ints([[1, 4], [0, 2], [0, 2], [0, 2], [0, 2]])) : mp4Box("smhd", mp4Ints([[0, 4], [0, 2], [0, 2]])));
      const stbl = mp4Box("stbl", t0.stsd, sttsBox, cttsBox, stssBox, stscBox, stszBox, stcoBox);
      return mp4Box("trak", tkhd, edts, mp4Box("mdia", mdhd, t0.hdlr, mp4Box("minf", header, dinf, stbl)));
    });
    return mp4Box("moov", mvhd, ...traks);
  };
  const mdatHead = big ? 16 : 8;
  // chunk に dst を持たせるため、order の中のものと tracks の中のものを同じにする
  tracks.forEach((t, ti) => (t.chunks = order.filter((c) => c.ti === ti)));
  let moov = makeMoov(0);
  moov = makeMoov(ftyp.length + moov.length + mdatHead); // 目次の大きさはデータの位置で変わらない（同じ幅の数）
  const mdat = big ? mp4Ints([[1, 4], [0x6d646174, 4], [dataSize + 16, 8]]) : mp4Ints([[dataSize + 8, 4], [0x6d646174, 4]]);
  // データ：もとの File の切り出し（となり合うものはまとめて切り出す）
  const pieces = [];
  let run = null;
  order.forEach((c) => {
    const file = list[c.file].file;
    if (run && run.file === file && run.end === c.src) run.end += c.size;
    else {
      if (run) pieces.push(run.file.slice(run.start, run.end));
      run = { file, start: c.src, end: c.src + c.size };
    }
  });
  if (run) pieces.push(run.file.slice(run.start, run.end));
  return new Blob([ftyp, moov, mdat, ...pieces], { type: "video/mp4" });
}

if (typeof module !== "undefined") module.exports = { parseMoov, readMp4, mp4Joinable, buildMp4, mp4Boxes, mp4Box };
