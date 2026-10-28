// ろくが：🔗 つなぐの「1/3」の札を、すぐ終わるまま入れる。
// 札が出る最初の約2秒（そのあとの最初のキーフレームまで）だけを、WebCodecs で読んで札を描き、作りなおす。残りはそのまま並べる（quickjoin.js）。
// 作りなおしたところはコーデックの設定（SPS・PPS）がちがうので、その頭に新しい設定を、そのあとのそのままのところの頭にもとの設定を、コマの中に入れる。
// WebCodecs がない・その形式を作りなおせない・うまくいかないときは null を返し、merge.js が流してつなぐ。
// 読み込む順は index.html（… → quickjoin → quickbadge → merge → …）
"use strict";

// 前に作りなおしの途中でタブが落ちた端末では使わない（riskCrashed。page.js）
const quickBadgeCrashed = riskCrashed("badge");
const quickBadgeReady = () => !quickBadgeCrashed && typeof VideoEncoder === "function" && typeof VideoDecoder === "function" && typeof VideoFrame === "function";

const concatBytes = (a, b) => {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
};
const hex2 = (n) => n.toString(16).padStart(2, "0");

// 映像トラックのコーデックの設定：WebCodecs の codec の文字（avc1.64001f・hvc1.1.6.L93.B0 など）と、avcC・hvcC の中身
function videoCodecOf(track) {
  const entry = track.stsd.subarray(16);
  const type = fourcc(entry, 4);
  const cfg = mp4Boxes(entry, 86, entry.length).find((b) => b.type === "avcC" || b.type === "hvcC");
  if (!cfg) return null;
  const d = entry.subarray(cfg.body, cfg.end);
  const v = new DataView(entry.buffer, entry.byteOffset, entry.byteLength);
  const size = { width: v.getUint16(32), height: v.getUint16(34) };
  if (cfg.type === "avcC") return { ...size, codec: `${type}.${hex2(d[1])}${hex2(d[2])}${hex2(d[3])}`, description: d, cfg, entry, avc: true };
  // HEVC：profile_space・tier・profile_idc、互換の印（ビットを逆に）、レベル、制約の印（最後の 0 は書かない）
  const space = d[1] >> 6;
  const tier = (d[1] >> 5) & 1;
  let compat = ((d[2] << 24) | (d[3] << 16) | (d[4] << 8) | d[5]) >>> 0;
  let rev = 0;
  for (let i = 0; i < 32; i++) (rev = (rev << 1) | (compat & 1)), (compat >>>= 1);
  const cons = Array.from(d.subarray(6, 12));
  while (cons.length && !cons[cons.length - 1]) cons.pop();
  const codec = [`${type}`, `${["", "A", "B", "C"][space]}${d[1] & 31}`, (rev >>> 0).toString(16), `${tier ? "H" : "L"}${d[12]}`, ...cons.map((c) => c.toString(16).toUpperCase())].join(".");
  return { ...size, codec, description: d, cfg, entry, avc: false };
}

// avcC・hvcC の中の SPS・PPS（など）と、コマの中の長さの書き方（何バイトか）
function paramSets(description, avc) {
  const d = description;
  const nalus = [];
  let at;
  let lengthSize;
  if (avc) {
    lengthSize = (d[4] & 3) + 1;
    at = 5;
    for (let n = d[at++] & 31; n > 0; n--) (nalus.push(d.subarray(at + 2, at + 2 + ((d[at] << 8) | d[at + 1]))), (at += 2 + ((d[at] << 8) | d[at + 1])));
    for (let n = d[at++]; n > 0; n--) (nalus.push(d.subarray(at + 2, at + 2 + ((d[at] << 8) | d[at + 1]))), (at += 2 + ((d[at] << 8) | d[at + 1])));
  } else {
    lengthSize = (d[21] & 3) + 1;
    at = 23;
    for (let arrays = d[22]; arrays > 0; arrays--) {
      at += 1; // NAL の種類
      for (let n = (d[at] << 8) | d[at + 1], k = (at += 2, 0); k < n; k++) {
        const len = (d[at] << 8) | d[at + 1];
        nalus.push(d.subarray(at + 2, at + 2 + len));
        at += 2 + len;
      }
    }
  }
  // コマの頭に入れる形（長さ＋中身）
  const parts = nalus.map((u) => {
    const b = new Uint8Array(lengthSize + u.length);
    for (let i = 0; i < lengthSize; i++) b[i] = (u.length >> (8 * (lengthSize - 1 - i))) & 255;
    b.set(u, lengthSize);
    return b;
  });
  const prefix = new Uint8Array(parts.reduce((s, b) => s + b.length, 0));
  parts.reduce((o, b) => (prefix.set(b, o), o + b.length), 0);
  return { lengthSize, prefix };
}

// 向き（tkhd の行列）：映像の絵（コマの向き）→ 見える向きへの写し方と、見える大きさ
function displayTransform(track, w, h) {
  const v = new DataView(track.tkhdTail.buffer, track.tkhdTail.byteOffset, 44);
  const [a, b, c, d] = [0, 4, 12, 16].map((at) => Math.round(v.getInt32(at) / 65536));
  // 4すみを写して、見える側の左上が 0 になるようにずらす
  const pts = [[0, 0], [w, 0], [0, h], [w, h]].map(([x, y]) => [a * x + c * y, b * x + d * y]);
  const tx = -Math.min(...pts.map((p) => p[0]));
  const ty = -Math.min(...pts.map((p) => p[1]));
  return { a, b, c, d, tx, ty, dw: Math.abs(a * w + c * h), dh: Math.abs(b * w + d * h) };
}

// 動画 info の from 秒〜to 秒（キーフレームの時刻か終わり）を、札を入れた最初の部分と、そのままの残りに分ける。
// 返すのは [{ file, info }]（buildMp4 にそのまま渡せる）。できなければ null
async function quickBadgePieces(file, info, keys, from, to, label) {
  if (!quickBadgeReady()) return null;
  let decoder = null;
  let encoder = null;
  riskBegin("badge");
  try {
    const video0 = info.tracks.find((t) => t.kind === "vide");
    const codec = videoCodecOf(video0);
    if (!codec) return null;
    const until = keys.find((k) => k >= from + PIECE_BADGE_MS / 1000 - 0.01 && k < to - 0.01) ?? to;
    const head = mp4Slice(info, from, until);
    const v = head.tracks.find((t) => t.kind === "vide");
    const n = v.sizes.length;
    if (!n) return null;
    const ts = v.timescale;
    const dts = mp4Dts(v);
    const pts = dts.map((d, i) => d + v.offsets[i]);
    // 映像のデータ（この部分の束を、まとめて1回で読む）
    const start = Math.min(...v.chunks.map((c) => c.offset));
    const end = Math.max(...v.chunks.map((c) => c.offset + c.size));
    const bytes = new Uint8Array(await file.slice(start, end).arrayBuffer());
    const samples = [];
    v.chunks.forEach((c) => {
      let at = c.offset - start;
      for (let k = 0; k < c.count; k++) {
        const i = c.first + k;
        samples[i] = bytes.subarray(at, at + v.sizes[i]);
        at += v.sizes[i];
      }
    });
    const seconds = v.durations.reduce((s, x) => s + x, 0) / ts;
    const decodeConfig = { codec: codec.codec, description: codec.description, codedWidth: codec.width, codedHeight: codec.height };
    const encodeConfig = {
      codec: codec.codec,
      width: codec.width,
      height: codec.height,
      bitrate: Math.max(2_000_000, Math.round(((v.sizes.reduce((s, x) => s + x, 0) * 8) / Math.max(seconds, 0.1)) * 1.3)),
      framerate: Math.round(n / Math.max(seconds, 0.1)),
      ...(codec.avc ? { avc: { format: "avc" } } : { hevc: { format: "hevc" } })
    };
    if (!(await VideoDecoder.isConfigSupported(decodeConfig)).supported) return null;
    if (!(await VideoEncoder.isConfigSupported(encodeConfig)).supported) return null;

    // 札の絵（見える向きで描き、コマの向きに写して重ねる）
    const t = displayTransform(video0, codec.width, codec.height);
    const badge = Object.assign(document.createElement("canvas"), { width: t.dw, height: t.dh });
    drawBadgeLabel(t.dw, t.dh, badge.getContext("2d"), label);
    const det = t.a * t.d - t.b * t.c;
    const inv = [t.d / det, -t.b / det, -t.c / det, t.a / det];
    const canvas = Object.assign(document.createElement("canvas"), { width: codec.width, height: codec.height });
    const ctx = canvas.getContext("2d");

    const out = [];
    let description = null;
    let failed = null;
    let made = 0;
    encoder = new VideoEncoder({
      output: (chunk, meta) => {
        if (meta?.decoderConfig?.description) description = new Uint8Array(meta.decoderConfig.description.slice ? meta.decoderConfig.description.slice(0) : meta.decoderConfig.description);
        const b = new Uint8Array(chunk.byteLength);
        chunk.copyTo(b);
        out.push({ b, ts: chunk.timestamp, key: chunk.type === "key" });
      },
      error: (e) => (failed = e)
    });
    encoder.configure(encodeConfig);
    decoder = new VideoDecoder({
      output: (frame) => {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(frame, 0, 0, codec.width, codec.height);
        // 見える向き → コマの向き：行列の逆
        ctx.setTransform(inv[0], inv[1], inv[2], inv[3], -(inv[0] * t.tx + inv[2] * t.ty), -(inv[1] * t.tx + inv[3] * t.ty));
        ctx.drawImage(badge, 0, 0);
        const next = new VideoFrame(canvas, { timestamp: frame.timestamp, duration: frame.duration ?? undefined });
        frame.close();
        encoder.encode(next, { keyFrame: made === 0 });
        next.close();
        made += 1;
      },
      error: (e) => (failed = e)
    });
    decoder.configure(decodeConfig);
    const us = (x) => Math.round((x / ts) * 1e6);
    // 一度にたくさん流しこまない（iPhone で 4K のコマが何十枚もたまると、メモリが足りずにタブが落ちる）。
    // 読む側・作る側の待ちが 2 枚をこえたら、減るまで待つ
    const settle = async () => {
      while (!failed && (decoder.decodeQueueSize > 2 || encoder.encodeQueueSize > 2)) await new Promise((r) => setTimeout(r, 5));
    };
    for (let i = 0; i < n; i++) {
      await settle();
      if (failed) break;
      decoder.decode(new EncodedVideoChunk({ type: i === 0 || (v.sync && v.sync[i]) ? "key" : "delta", timestamp: us(pts[i]), duration: us(v.durations[i]), data: samples[i] }));
    }
    await decoder.flush();
    await encoder.flush();
    if (failed || out.length !== n || !description || !out[0].key) return null;
    // 作りなおしたコマは見える順に並ぶ（B フレームなし）。デコードの時刻はもとのまま、見える時刻はもとの見える時刻を小さい順に
    const sorted = [...pts].sort((x, y) => x - y);
    const offsets = sorted.map((p, j) => p - dts[j]);
    if (offsets.some((o) => o < 0) || out.some((o, j) => j && o.ts <= out[j - 1].ts)) return null;
    // 設定（SPS・PPS）の入れ方：コーデックの設定（stsd）はもとのまま1つにして、作りなおしたところの頭に新しい設定を、
    // そのあとのそのままのところの頭にもとの設定を、コマの中に入れる（設定を2つ並べる書き方は、Mac の Chrome の H.264 で止まったため）
    const mine = paramSets(description, codec.avc);
    const theirs = paramSets(codec.description, codec.avc);
    if (mine.lengthSize !== theirs.lengthSize) return null;
    out[0].b = concatBytes(mine.prefix, out[0].b);
    const blob = new Blob(out.map((o) => o.b));
    const sizes = out.map((o) => o.b.length);
    const madeVideo = {
      ...v,
      offsets,
      sizes,
      sync: out.map((o) => o.key),
      chunks: [{ offset: 0, first: 0, count: n, size: sizes.reduce((s, x) => s + x, 0), file: blob }]
    };
    const pieces = [{ file, info: { ...head, tracks: head.tracks.map((x) => (x === v ? madeVideo : x)) } }];
    if (until < to - 0.01) {
      // 残りの最初のコマ（キーフレーム）の頭に、もとの設定を入れる
      const rest = mp4Slice(info, until, to);
      const rv = rest.tracks.find((x) => x.kind === "vide");
      const c0 = rv.chunks[0];
      const size0 = rv.sizes[0];
      const first = new Blob([theirs.prefix, file.slice(c0.offset, c0.offset + size0)]);
      const chunks = [{ offset: 0, first: 0, count: 1, size: theirs.prefix.length + size0, file: first }];
      if (c0.count > 1) chunks.push({ offset: c0.offset + size0, first: 1, count: c0.count - 1, size: c0.size - size0 });
      chunks.push(...rv.chunks.slice(1));
      const fixed = { ...rv, sizes: [theirs.prefix.length + size0, ...rv.sizes.slice(1)], chunks };
      pieces.push({ file, info: { ...rest, tracks: rest.tracks.map((x) => (x === rv ? fixed : x)) } });
    }
    return pieces;
  } catch {
    return null;
  } finally {
    // 読む側・作る側は、うまくいってもいかなくても閉じる（閉じないとメモリが残る）
    for (const c of [decoder, encoder]) if (c && c.state !== "closed") c.close();
    riskEnd("badge");
  }
}
