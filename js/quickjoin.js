// ろくが：🔗 つなぐの「そのまま並べる」。mp4 の動画を作り直さずに（中身のコマをそのまま写して）1本に並べる。
// iPhone で撮った動画どうしのように、形式（コーデック・大きさ・向き・音）がそろっていれば、数秒で終わる。
// そろっていない・読めない動画があれば null を返し、merge.js が今までどおり流してつなぐ（つなぎ目の柄や 1/3 の札を入れるときも流してつなぐ）。
// 中身：動画の目次（moov）だけを読み、コマの場所と長さの表を足し合わせて、新しい目次を作る。コマのデータは File の切り出し（Blob）のまま並べるので、大きな動画でもメモリを使わない。
// 外の部品は使わない（電波がなくても使えるように）。読み込む順は index.html（… → render → quickjoin → merge → app.js）。
"use strict";

// ---- 読む ----
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

// コマの長さ（stts）を、コマごとに並べて返す
function mp4Durations(bytes, v, stts) {
  const durations = [];
  for (let i = 0, n = v.getUint32(stts.body + 4); i < n; i++) {
    const count = v.getUint32(stts.body + 8 + i * 8);
    const delta = v.getUint32(stts.body + 12 + i * 8);
    for (let k = 0; k < count; k++) durations.push(delta);
  }
  return durations;
}

// 表示のずれ（ctts。B フレームがあるとき）を、コマごとに並べて返す（なければ 0 ばかり）
function mp4Offsets(bytes, v, ctts, count) {
  const offsets = new Array(count).fill(0);
  if (!ctts) return offsets;
  let s = 0;
  for (let i = 0, n = v.getUint32(ctts.body + 4); i < n; i++) {
    const c = v.getUint32(ctts.body + 8 + i * 8);
    const off = v.getInt32(ctts.body + 12 + i * 8);
    for (let k = 0; k < c && s < count; k++) offsets[s++] = off;
  }
  return offsets;
}

// キーフレーム（stss）を、コマごとの true / false で返す。stss がなければ null（全部キーフレーム）
function mp4Sync(bytes, v, stss, count) {
  if (!stss) return null;
  const sync = new Array(count).fill(false);
  for (let i = 0, n = v.getUint32(stss.body + 4); i < n; i++) sync[v.getUint32(stss.body + 8 + i * 4) - 1] = true;
  return sync;
}

// かたまり（chunk）の表を返す：場所（stco・co64）と、かたまりごとのコマの数（stsc）から
// [{ offset, first（はじめのコマの番号）, count, size }]。コマの数が合わないときは null
function mp4Chunks(bytes, v, { stco, co64, stsc }, sizes) {
  const count = sizes.length;
  const chunkOffsets = [];
  for (let i = 0, n = v.getUint32((stco || co64).body + 4); i < n; i++) {
    chunkOffsets.push(stco ? v.getUint32(stco.body + 8 + i * 4) : Number(v.getBigUint64(co64.body + 8 + i * 8)));
  }
  const runs = [];
  for (let i = 0, n = v.getUint32(stsc.body + 4); i < n; i++) runs.push({ first: v.getUint32(stsc.body + 8 + i * 12) - 1, per: v.getUint32(stsc.body + 12 + i * 12) });
  const chunks = [];
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
  return s === count ? chunks : null;
}

// はじめの見せない部分（elst の media_time。B フレームのずれ・音の頭の詰めもの）と、見せる長さ（秒）を返す。
// elst がなければ { mediaTime: 0, shown: null }。読めない形（見せる所が2つ以上など）は null
function mp4Edit(bytes, v, elst, movieScale) {
  if (!elst) return { mediaTime: 0, shown: null };
  const v1 = bytes[elst.body] === 1;
  const entries = [];
  for (let i = 0, n = v.getUint32(elst.body + 4); i < n; i++) {
    const at = elst.body + 8 + i * (v1 ? 20 : 12);
    entries.push(v1 ? { dur: Number(v.getBigUint64(at)), time: Number(v.getBigInt64(at + 8)) } : { dur: v.getUint32(at), time: v.getInt32(at + 4) });
  }
  const real = entries.filter((e) => e.time >= 0);
  if (real.length !== 1 || entries.length > 2) return null; // 空き（time -1）を1つと、見せる所1つまで
  return { mediaTime: real[0].time, shown: real[0].dur / movieScale };
}

// トラック1つ（trak）の表を返す。映像・音でなければ undefined（写さない）、読めない形なら null
function mp4Track(bytes, v, trak, movieScale) {
  const u32 = (at) => v.getUint32(at);
  const hdlr = mp4Path(bytes, trak, "mdia/hdlr");
  const handler = hdlr ? fourcc(bytes, hdlr.body + 8) : "";
  if (handler !== "vide" && handler !== "soun") return undefined; // 字幕・時刻などのトラックは写さない
  const tkhd = mp4Child(bytes, trak, "tkhd");
  const mdhd = mp4Path(bytes, trak, "mdia/mdhd");
  const stbl = mp4Path(bytes, trak, "mdia/minf/stbl");
  const stsd = stbl && mp4Child(bytes, stbl, "stsd");
  if (!tkhd || !mdhd || !stbl || !stsd || u32(stsd.body + 4) !== 1) return null;
  const timescale = u32(mdhd.body + (bytes[mdhd.body] === 1 ? 20 : 12));
  const tkhdTail = tkhd.body + (bytes[tkhd.body] === 1 ? 52 : 40); // 向き（matrix 36）と大きさ（幅・高さ 各4）
  const table = (type) => mp4Child(bytes, stbl, type);
  const stts = table("stts");
  if (!stts) return null;
  const durations = mp4Durations(bytes, v, stts);
  const count = durations.length;
  const offsets = mp4Offsets(bytes, v, table("ctts"), count);
  // 大きさ（stsz）
  const stsz = table("stsz");
  if (!stsz || u32(stsz.body + 8) !== count) return null;
  const fixed = u32(stsz.body + 4);
  const sizes = Array.from({ length: count }, (_, i) => (fixed ? fixed : u32(stsz.body + 12 + i * 4)));
  const sync = mp4Sync(bytes, v, table("stss"), count);
  const where = { stco: table("stco"), co64: table("co64"), stsc: table("stsc") };
  if ((!where.stco && !where.co64) || !where.stsc) return null;
  const chunks = mp4Chunks(bytes, v, where, sizes);
  if (!chunks) return null;
  const edit = mp4Edit(bytes, v, mp4Path(bytes, trak, "edts/elst"), movieScale);
  if (!edit) return null;
  const mediaSeconds = durations.reduce((a, b) => a + b, 0) / timescale;
  const header = mp4Child(bytes, mp4Path(bytes, trak, "mdia/minf"), handler === "vide" ? "vmhd" : "smhd");
  return {
    kind: handler,
    timescale,
    language: v.getUint16(mdhd.body + (bytes[mdhd.body] === 1 ? 32 : 20)),
    tkhdTail: bytes.slice(tkhdTail, tkhdTail + 44),
    hdlr: bytes.slice(hdlr.start, hdlr.end),
    header: header ? bytes.slice(header.start, header.end) : null,
    stsd: bytes.slice(stsd.start, stsd.end),
    codec: fourcc(bytes, stsd.body + 12),
    durations,
    offsets,
    sizes,
    sync,
    chunks,
    mediaTime: edit.mediaTime,
    seconds: edit.shown ?? Math.max(0, mediaSeconds - edit.mediaTime / timescale)
  };
}

// 目次（moov）の中身から、トラックごとの表を作る。読めない形（分けて書いた mp4・中身の種類が2つ以上など）は null
function parseMoov(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const moov = mp4Boxes(bytes).find((b) => b.type === "moov");
  if (!moov) return null;
  if (mp4Child(bytes, moov, "mvex")) return null; // 分けて書いた mp4（fragmented）：目次にコマがない
  const mvhd = mp4Child(bytes, moov, "mvhd");
  if (!mvhd) return null;
  const movieScale = v.getUint32(mvhd.body + (bytes[mvhd.body] === 1 ? 20 : 12));
  const tracks = [];
  for (const trak of mp4Boxes(bytes, moov.body, moov.end).filter((b) => b.type === "trak")) {
    const track = mp4Track(bytes, v, trak, movieScale);
    if (track === null) return null;
    if (track) tracks.push(track);
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

// ---- 切る ----
// コマごとの時刻（デコードの順の時刻 dts）
const mp4Dts = (t) => {
  const out = new Array(t.durations.length);
  let at = 0;
  t.durations.forEach((d, i) => ((out[i] = at), (at += d)));
  return out;
};

// キーフレームの見える時刻（秒・小さい順）。ここでなら作り直さずに切れる
function mp4KeyTimes(info) {
  const t = info.tracks.find((x) => x.kind === "vide");
  const dts = mp4Dts(t);
  const times = [];
  dts.forEach((d, i) => (!t.sync || t.sync[i]) && times.push((d + t.offsets[i] - t.mediaTime) / t.timescale));
  return times.sort((a, b) => a - b);
}

// 動画の from 秒〜to 秒（どちらもキーフレームの時刻か、はじめ・終わり。to は Infinity でもよい）だけを取り出した目次を作る（buildMp4 に渡せる形）
function mp4Slice(info, from, to = Infinity) {
  const video = info.tracks.find((x) => x.kind === "vide");
  const keyIndex = (sec) => {
    // その時刻にいちばん近いキーフレームの番号
    const dts = mp4Dts(video);
    let best = 0;
    let gap = Infinity;
    dts.forEach((d, i) => {
      if (video.sync && !video.sync[i]) return;
      const g = Math.abs((d + video.offsets[i] - video.mediaTime) / video.timescale - sec);
      if (g < gap) (gap = g), (best = i);
    });
    return best;
  };
  const vFrom = from > 0 ? keyIndex(from) : 0;
  const vTo = to < Infinity ? keyIndex(to) : video.durations.length;
  const tracks = info.tracks.map((t) => {
    let i0;
    let i1;
    let mediaTime;
    if (t === video) {
      i0 = vFrom;
      i1 = vTo;
      mediaTime = from > 0 ? t.offsets[i0] : t.mediaTime;
    } else {
      // 音：コマのまん中が [from, to) に入るもの
      const dts = mp4Dts(t);
      const mid = (i) => (dts[i] + t.durations[i] / 2 - t.mediaTime) / t.timescale;
      i0 = 0;
      while (i0 < dts.length && mid(i0) < from) i0++;
      i1 = i0;
      while (i1 < dts.length && mid(i1) < to) i1++;
      mediaTime = from > 0 ? 0 : t.mediaTime;
    }
    const chunks = [];
    t.chunks.forEach((c) => {
      const a = Math.max(c.first, i0);
      const b = Math.min(c.first + c.count, i1);
      if (a >= b) return;
      let skip = 0;
      for (let k = c.first; k < a; k++) skip += t.sizes[k];
      let size = 0;
      for (let k = a; k < b; k++) size += t.sizes[k];
      chunks.push({ offset: c.offset + skip, first: a - i0, count: b - a, size });
    });
    const durations = t.durations.slice(i0, i1);
    return {
      ...t,
      durations,
      offsets: t.offsets.slice(i0, i1),
      sizes: t.sizes.slice(i0, i1),
      sync: t.sync ? t.sync.slice(i0, i1) : null,
      chunks,
      mediaTime,
      seconds: Math.max(0, (durations.reduce((s, d) => s + d, 0) - mediaTime) / t.timescale)
    };
  });
  const end = Math.min(to, info.seconds);
  return { tracks, seconds: Math.max(0, end - from) };
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

// 並べた動画を作る。list：[{ file, info }]（mp4Joinable がそろっているもの）。Blob を返す。
// 札を入れた最初のところ（quickbadge.js）は、コーデックの設定（stsd）がちがうので、2つめの設定として入れる（コマの束ごとに、どの設定かを書く）。
// コマの束（chunk）に file があれば、その束のデータはその File（Blob）から取る（札を入れて作りなおした映像など）
function buildMp4(list) {
  const movieScale = 1000;
  // 動画ごとの、つないだ動画の中での始まり（秒）
  const starts = [];
  let total = 0;
  list.forEach(({ info }) => (starts.push(total), (total += info.seconds)));
  const tracks = mp4JoinTracks(list, starts);
  // データの並び：動画ごとに、もとの場所の順（音と映像が交互になっているのをそのまま）
  // （同じ動画の中では、作りなおした映像を先に）
  const order = tracks.flatMap((t, ti) => t.chunks.map((c) => ({ ...c, ti }))).sort((a, b) => a.file - b.file || (a.blob ? 0 : 1) - (b.blob ? 0 : 1) || a.src - b.src);
  const dataSize = order.reduce((a, c) => a + c.size, 0);
  const big = dataSize > 0xfffffff0; // 4GB をこえるとき
  const ftyp = mp4Box("ftyp", [...[..."isom"].map((c) => c.charCodeAt(0)), 0, 0, 2, 0, ...[..."isomiso2mp41"].map((c) => c.charCodeAt(0))]);

  // 目次を作る（chunkBase：データの始まりの位置。目次の大きさが決まってから、もう一度作る）
  const makeMoov = (chunkBase) => {
    let at = chunkBase;
    order.forEach((c) => ((c.dst = at), (at += c.size)));
    const duration = Math.round(total * movieScale);
    const mvhd = mp4Box("mvhd", mp4Ints([[0, 4], [0, 4], [0, 4], [movieScale, 4], [duration, 4], [0x10000, 4], [0x100, 2], [0, 2], [0, 4], [0, 4], ...MP4_MATRIX, ...new Array(6).fill([0, 4]), [tracks.length + 1, 4]]));
    return mp4Box("moov", mvhd, ...tracks.map((t, ti) => mp4Trak(t, ti, duration, big)));
  };
  const mdatHead = big ? 16 : 8;
  // chunk に dst を持たせるため、order の中のものと tracks の中のものを同じにする
  tracks.forEach((t, ti) => (t.chunks = order.filter((c) => c.ti === ti)));
  let moov = makeMoov(0);
  moov = makeMoov(ftyp.length + moov.length + mdatHead); // 目次の大きさはデータの位置で変わらない（同じ幅の数）
  const mdat = big ? mp4Ints([[1, 4], [0x6d646174, 4], [dataSize + 16, 8]]) : mp4Ints([[dataSize + 8, 4], [0x6d646174, 4]]);
  return new Blob([ftyp, moov, mdat, ...mp4DataPieces(order, list)], { type: "video/mp4" });
}

// トラックごとに、動画のコマの表（長さ・ずれ・大きさ・キーフレーム・かたまり・中身の種類）を足していく。
// 前の動画の音・映像が少し短くて、すき間があくときは、前の最後のコマを長くして詰める
function mp4JoinTracks(list, starts) {
  const first = list[0].info;
  return first.tracks.map((t0, ti) => {
    const out = { t0, durations: [], offsets: [], sizes: [], sync: t0.sync ? [] : null, chunks: [], entries: [] };
    const entryOf = (stsd) => {
      const key = stsd.join(",");
      let i = out.entries.findIndex((e) => e.key === key);
      if (i < 0) i = out.entries.push({ key, bytes: stsd.subarray(16) }) - 1; // stsd の箱（8）＋ 版（4）＋ 数（4）のあとが中身
      return i + 1;
    };
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
      const sdi = entryOf(t.stsd);
      t.chunks.forEach((c) => out.chunks.push({ file: k, blob: c.file || null, src: c.offset, size: c.size, count: c.count, first: firstSample + c.first, sdi }));
      dts += t.durations.reduce((a, b) => a + b, 0);
    });
    out.mediaDuration = dts;
    return out;
  });
}

// トラック1つの目次（trak：tkhd・edts・mdhd・hdlr・minf の中の表）を作る。duration はつないだ動画の長さ（1/1000 秒）
function mp4Trak(t, ti, duration, big) {
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
  chunks.forEach((c, i) => (!stsc.length || stsc[stsc.length - 1][1] !== c.count || stsc[stsc.length - 1][2] !== c.sdi) && stsc.push([i + 1, c.count, c.sdi]));
  const stscBox = mp4Box("stsc", mp4Ints([[0, 4], [stsc.length, 4], ...stsc.flatMap(([f, n, d]) => [[f, 4], [n, 4], [d, 4]])]));
  const stszBox = mp4Box("stsz", mp4Ints([[0, 4], [0, 4], [t.sizes.length, 4], ...t.sizes.map((s) => [s, 4])]));
  const stcoBox = big
    ? mp4Box("co64", mp4Ints([[0, 4], [chunks.length, 4], ...chunks.map((c) => [c.dst, 8])]))
    : mp4Box("stco", mp4Ints([[0, 4], [chunks.length, 4], ...chunks.map((c) => [c.dst, 4])]));
  const dinf = mp4Box("dinf", mp4Box("dref", mp4Ints([[0, 4], [1, 4]]), mp4Box("url ", mp4Ints([[1, 4]]))));
  const header = t0.header || (video ? mp4Box("vmhd", mp4Ints([[1, 4], [0, 2], [0, 2], [0, 2], [0, 2]])) : mp4Box("smhd", mp4Ints([[0, 4], [0, 2], [0, 2]])));
  const stsdBox = t.entries.length === 1 ? t0.stsd : mp4Box("stsd", mp4Ints([[0, 4], [t.entries.length, 4]]), ...t.entries.map((e) => e.bytes));
  const stbl = mp4Box("stbl", stsdBox, sttsBox, cttsBox, stssBox, stscBox, stszBox, stcoBox);
  return mp4Box("trak", tkhd, edts, mp4Box("mdia", mdhd, t0.hdlr, mp4Box("minf", header, dinf, stbl)));
}

// データ：もとの File の切り出し（となり合うものはまとめて切り出す）を並べて返す
function mp4DataPieces(order, list) {
  const pieces = [];
  let run = null;
  order.forEach((c) => {
    const file = c.blob || list[c.file].file;
    if (run && run.file === file && run.end === c.src) run.end += c.size;
    else {
      if (run) pieces.push(run.file.slice(run.start, run.end));
      run = { file, start: c.src, end: c.src + c.size };
    }
  });
  if (run) pieces.push(run.file.slice(run.start, run.end));
  return pieces;
}

if (typeof module !== "undefined") module.exports = { parseMoov, readMp4, mp4Joinable, buildMp4, mp4Boxes, mp4Box, mp4KeyTimes, mp4Slice };
