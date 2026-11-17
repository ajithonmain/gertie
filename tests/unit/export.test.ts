import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLottieArchive } from "../../src/export/lottie-archive.ts";
import { crc32, readZip, writeZip } from "../../src/export/zip.ts";
import { DESTINATIONS } from "../../src/export/destinations.ts";
import { encodeArgs, geometry, ladder, nearestGifRate, outputSize, parseFormats, unavailable, type Plan } from "../../src/export/formats.ts";

const plan = (o: Partial<Plan> = {}): Plan => ({ srcW: 256, srcH: 256, fps: 30, fw: 256, fh: 256, fitted: false, scale: false, bg: "0xffffff", ...o });

test("crc32 matches the standard check value", () => {
  assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
});

test("zip round trip keeps names and bytes, is deflated, and is stable across runs", () => {
  const entries = [
    { name: "manifest.json", data: Buffer.from('{"a":1}') },
    { name: "a/long.json", data: Buffer.from("x".repeat(5000)) },
    { name: "empty.txt", data: Buffer.alloc(0) },
    { name: "ünï/コード.json", data: Buffer.from("utf8 names") },
  ];
  const zip = writeZip(entries);
  assert.deepEqual(readZip(zip).map((e) => [e.name, e.data.toString()]), entries.map((e) => [e.name, e.data.toString()]));
  assert.ok(zip.length < 1000, "5000 repeated bytes deflate to a few bytes");
  assert.ok(writeZip(entries).equals(zip), "no timestamps, so identical output");
});

test("a corrupted archive is detected by its checksum", () => {
  const zip = writeZip([{ name: "a.txt", data: Buffer.from("hello world hello world") }]);
  zip[40] = (zip[40] as number) ^ 0xff;
  assert.throws(() => readZip(zip));
});

test("the .lottie archive holds a version 2 manifest and the animation under a/", () => {
  const z = readZip(buildLottieArchive("spin", '{"v":1}', "1.2.3"));
  assert.deepEqual(z.map((e) => e.name), ["manifest.json", "a/spin.json"]);
  assert.deepEqual(JSON.parse(z[0]!.data.toString()), { version: "2", generator: "gertie 1.2.3", animations: [{ id: "spin" }] });
});

test("format lists parse, and unknown names are reported", () => {
  assert.deepEqual(parseFormats("gif, WEBM,,lottie-zip"), { formats: ["gif", "webm", "lottie-zip"], unknown: [] });
  assert.deepEqual(parseFormats("gif,dotlottie").unknown, ["dotlottie"]);
});

test("GIF frame rates snap to the ones whole hundredths can express", () => {
  assert.equal(nearestGifRate(30), 25);
  assert.equal(nearestGifRate(24), 25);
  assert.equal(nearestGifRate(60), 50);
  assert.equal(nearestGifRate(12), 12.5);
});

test("odd sizes are padded to even only for formats that need it", () => {
  assert.deepEqual(outputSize(101, 55, "mp4"), { w: 102, h: 56, sw: 101, sh: 55, fitted: true, scale: false });
  assert.deepEqual(outputSize(101, 55, "gif"), { w: 101, h: 55, sw: 101, sh: 55, fitted: false, scale: false });
  assert.deepEqual(outputSize(256, 256, "webm", { w: 512, h: 512 }), { w: 512, h: 512, sw: 512, sh: 512, fitted: true, scale: true });
});

test("the geometry filter scales to fit and pads with transparency or the background", () => {
  assert.equal(geometry(plan(), true), "");
  const p = plan({ fw: 320, fh: 320, fitted: true, scale: true });
  assert.equal(geometry(p, true), "format=rgba,scale=320:320:force_original_aspect_ratio=decrease:flags=lanczos,pad=320:320:(ow-iw)/2:(oh-ih)/2:color=0x00000000");
  assert.match(geometry(p, false), /color=0xffffff$/);
});

test("each recipe carries the options that keep its alpha and quality", () => {
  const frames = "f_%04d.png";
  const args = (f: Parameters<typeof encodeArgs>[0], p = plan(), q = {}) => encodeArgs(f, p, q, frames, "out", { transparentGif: true }).join(" ");
  assert.match(args("webm"), /scale=out_color_matrix=bt709:out_range=tv,format=yuva420p,setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv -c:v libvpx-vp9 -b:v 0 -crf 30 -row-mt 1 -auto-alt-ref 0 -an/);
  assert.match(args("prores"), /format=yuva444p10le,setparams=colorspace=bt709.* -c:v prores_ks -profile:v 4444 -alpha_bits 16 -vendor apl0/);
  assert.match(args("hevc"), /hevc_videotoolbox -allow_sw 1 -alpha_quality 0.75 -q:v 65 -tag:v hvc1 -pix_fmt bgra/);
  assert.match(args("apng"), /-plays 0 -pred mixed/);
  assert.match(args("webp"), /-c:v libwebp_anim -lossless 0 -q:v 80 -loop 0/);
  assert.ok(!args("webp").includes("compression_level"), "compression_level 6 ran for minutes in testing");
  assert.match(args("gif", plan(), { fps: 25, colors: 256 }), /reserve_transparent=1:stats_mode=full:max_colors=256.*alpha_threshold=128.*-gifflags -offsetting -loop 0/);
  assert.match(encodeArgs("gif", plan(), { fps: 25 }, frames, "out", { transparentGif: false }).join(" "), /overlay=shortest=1,fps=25.*sierra2_4a/);
  assert.match(args("mp4"), /overlay=shortest=1:format=rgb,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv -c:v libx264 -crf 18 -preset slow -tune animation -movflags \+faststart -an/);
});

test("a lowered frame rate is a filter, and an unchanged one is not", () => {
  assert.ok(!encodeArgs("apng", plan(), { fps: 30 }, "f", "o", { transparentGif: true }).join(" ").includes("fps="));
  assert.match(encodeArgs("apng", plan(), { fps: 20 }, "f", "o", { transparentGif: true }).join(" "), /-vf fps=20/);
});

test("quality ladders start at the best step and never raise the frame rate above the cap", () => {
  const g = ladder("gif", 30, Infinity);
  assert.deepEqual(g[0], { fps: 25, colors: 256 });
  assert.ok(g.every((s, i) => i === 0 || (s.fps as number) <= (g[i - 1]!.fps as number)));
  assert.ok(ladder("webm", 60, 30).every((s) => (s.fps as number) <= 30));
  assert.ok(ladder("webm", 30, Infinity).every((s, i, a) => i === 0 || (s.crf as number) > (a[i - 1]!.crf as number)));
});

test("destination limits match the platforms' published ones", () => {
  const d = DESTINATIONS;
  assert.deepEqual(d["telegram"]!.formats[0]!.target!(256, 256), { w: 512, h: 512 });
  assert.deepEqual(d["telegram"]!.formats[0]!.target!(300, 200), { w: 512, h: 342 }, "long side 512, other side even");
  assert.equal(d["telegram"]!.formats[0]!.maxBytes, 256 * 1024);
  assert.equal(d["telegram"]!.formats[0]!.maxSeconds, 3);
  assert.equal(d["telegram"]!.formats[0]!.maxFps, 30);
  assert.deepEqual(d["discord-sticker"]!.formats[0]!.target!(1, 1), { w: 320, h: 320 });
  assert.equal(d["discord-sticker"]!.formats[0]!.maxBytes, 512 * 1024);
  assert.equal(d["slack-emoji"]!.formats[0]!.maxFrames, 50);
  assert.ok(d["slack-emoji"]!.formats[0]!.maxBytes! < 128 * 1024);
  assert.equal(d["whatsapp"]!.formats[0]!.maxBytes, 500 * 1024);
  assert.deepEqual(d["reel"]!.formats[0]!.target!(1, 1), { w: 1080, h: 1920 });
  assert.equal(d["reel"]!.formats[0]!.solid, true);
});

test("a missing encoder names the format, why, and what to use instead", () => {
  const ff = { version: "7", encoders: new Set(["gif", "apng"]) };
  assert.equal(unavailable("gif", ff), undefined);
  assert.equal(unavailable("lottie-zip", null), undefined, "no ffmpeg needed");
  assert.match(unavailable("webm", ff)!.reason, /libvpx-vp9/);
  assert.match(unavailable("hevc", ff)!.reason, /macOS/);
  assert.match(unavailable("gif", null)!.reason, /ffmpeg/);
});
