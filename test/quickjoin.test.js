// 🔗 つなぐの「作り直さずに並べる」（js/quickjoin.js）：並べた mp4 の目次が、もとの動画のコマを正しく指しているか。node --test test/
const test = require("node:test");
const assert = require("node:assert");
const { parseMoov, readMp4, mp4Joinable, buildMp4, mp4Box, mp4KeyTimes, mp4Slice } = require("../js/quickjoin.js");

// 小さな mp4 を手で作る：映像だけ・コマは frames 個（中身は 1 バイトずつ、値は fill）
function fakeMp4(frames, fill, keys = [1]) {
  const ints = (...xs) => {
    const b = new Uint8Array(xs.length * 4);
    const v = new DataView(b.buffer);
    xs.forEach((x, i) => v.setUint32(i * 4, x));
    return b;
  };
  const avcc = mp4Box("avcC", [1, 66, 0, 30, 255, 225, 0, 0, 1, 0, 0]);
  const entry = mp4Box("avc1", new Uint8Array(6), [0, 1], new Uint8Array(16), [0x02, 0x80, 0x01, 0x68], new Uint8Array(50), avcc);
  const tkhd = mp4Box("tkhd", ints(3, 0, 0, 1, 0, 0, 0, 0, 0, 0), ints(0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000, 640 << 16, 360 << 16));
  const build = (dataAt) =>
    mp4Box("moov",
      mp4Box("mvhd", ints(0, 0, 0, 1000, frames * 100, 0x10000, 0x01000000, 0, 0, 0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000, 0, 0, 0, 0, 0, 0, 2)),
      mp4Box("trak", tkhd, mp4Box("mdia",
        mp4Box("mdhd", ints(0, 0, 0, 30, frames * 3), [0x55, 0xc4, 0, 0]),
        mp4Box("hdlr", ints(0, 0), [..."vide"].map((c) => c.charCodeAt(0)), ints(0, 0, 0), [0]),
        mp4Box("minf", mp4Box("stbl",
          mp4Box("stsd", ints(0, 1), entry),
          mp4Box("stts", ints(0, 1, frames, 3)),
          mp4Box("stss", ints(0, keys.length, ...keys)),
          mp4Box("stsc", ints(0, 1, 1, frames, 1)),
          mp4Box("stsz", ints(0, 1, frames)),
          mp4Box("stco", ints(0, 1, dataAt))
        )))));
  const ftyp = mp4Box("ftyp", [..."isom"].map((c) => c.charCodeAt(0)), [0, 0, 2, 0]);
  const moov = build(0);
  const mdat = mp4Box("mdat", Uint8Array.from({ length: frames }, (_, i) => fill + i));
  return new Blob([ftyp, build(ftyp.length + moov.length + 8), mdat]);
}

test("同じ形式の2本を並べると、コマの数・長さがたされ、データはもとの順に並ぶ", async () => {
  const a = fakeMp4(4, 0xaa);
  const b = fakeMp4(6, 0xbb);
  const infos = [await readMp4(a), await readMp4(b)];
  assert.equal(infos[0].seconds, 0.4);
  assert.ok(mp4Joinable(infos));
  const out = buildMp4([{ file: a, info: infos[0] }, { file: b, info: infos[1] }]);
  const bytes = new Uint8Array(await out.arrayBuffer());
  const joined = parseMoov(bytes);
  const t = joined.tracks[0];
  assert.equal(t.sizes.length, 10);
  assert.equal(joined.seconds, 1);
  // かたまりの場所が指すデータ：はじめの4コマは aa、あとの6コマは bb
  const data = t.chunks.flatMap((c) => [...bytes.subarray(c.offset, c.offset + c.size)]);
  assert.deepEqual(data, [0xaa, 0xab, 0xac, 0xad, 0xbb, 0xbc, 0xbd, 0xbe, 0xbf, 0xc0]);
  // キーフレームは、それぞれの動画のはじめ
  assert.deepEqual(t.sync.map((s, i) => (s ? i : -1)).filter((i) => i >= 0), [0, 4]);
});

test("mp4 でない・読めない動画があれば、並べない（流してつなぐ）", async () => {
  assert.equal(await readMp4(new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0])])), null); // webm
  assert.equal(mp4Joinable([await readMp4(fakeMp4(2, 1)), null]), false);
});

test("キーフレームで切ると、その動画の途中から作り直さずに取り出せる", async () => {
  const a = fakeMp4(6, 0x10, [1, 4]); // 0.1 秒ずつ 6 コマ、キーフレームは 0 秒と 0.3 秒
  const info = await readMp4(a);
  assert.deepEqual(mp4KeyTimes(info).map((t) => t.toFixed(1)), ["0.0", "0.3"]);
  const head = mp4Slice(info, 0, 0.3);
  const tail = mp4Slice(info, 0.3);
  assert.equal(head.tracks[0].sizes.length, 3);
  assert.equal(tail.tracks[0].sizes.length, 3);
  assert.equal(tail.tracks[0].sync[0], true);
  const bytes = new Uint8Array(await buildMp4([{ file: a, info: tail }]).arrayBuffer());
  const t = parseMoov(bytes).tracks[0];
  assert.deepEqual(t.chunks.flatMap((c) => [...bytes.subarray(c.offset, c.offset + c.size)]), [0x13, 0x14, 0x15]);
});
