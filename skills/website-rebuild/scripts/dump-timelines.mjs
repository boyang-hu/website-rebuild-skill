#!/usr/bin/env node
// dump-timelines.mjs — dump every animation curve in baked-timeline GLB files
// to JSON numeric ledgers, so a rebuild's scrub/animation system can be
// verified against SOURCE DATA numerically instead of visually
// (careers-kimi lesson: compare recorded values, not screenshots).
//
// Kept as the exemplar of the "numeric baseline first" discipline: before
// porting any animation system, dump the source's authoritative numbers to a
// ledger and gate the rebuild against those. The GLB parser is format-specific;
// the pattern (hand-rolled parser -> JSON ledger -> numeric gate) generalizes
// to any baked data format.
//
//   node dump-timelines.mjs <file.glb> [...more.glb] [--out docs/timeline-baseline]
//
// Zero dependencies: hand-written GLB (glTF binary) chunk + accessor reader.
// Adapted from storytellingnoomo-rebuild/scripts/dump-timelines.mjs.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { cli } from "./lib/cli.mjs";

cli({ known: ["out"], bools: [], file: import.meta.url, positional: "<file.glb> [...more.glb]" });

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf("--" + name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : dflt;
};
const FILES = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--out");
if (FILES.length === 0) {
  console.error("usage: dump-timelines.mjs <file.glb> [...more.glb] [--out docs/timeline-baseline]");
  process.exit(2);
}
const outDir = path.resolve(flag("out", "docs/timeline-baseline"));
await mkdir(outDir, { recursive: true });

const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const ARRAYS = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };

function parseGlb(buf) {
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.slice(20, 20 + jsonLen).toString());
  let bin = null;
  let off = 20 + jsonLen;
  while (off < buf.length) {
    const len = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    if (type === 0x004e4942) bin = buf.slice(off + 8, off + 8 + len);
    off += 8 + len;
  }
  return { json, bin };
}

function readAccessor(json, bin, idx) {
  const acc = json.accessors[idx];
  const bv = json.bufferViews[acc.bufferView];
  const Arr = ARRAYS[acc.componentType];
  const comps = COMPONENTS[acc.type];
  const start = (bv.byteOffset || 0) + (acc.byteOffset || 0);
  const arr = new Arr(bin.buffer, bin.byteOffset + start, acc.count * comps);
  return { values: Array.from(arr), comps };
}

for (const file of FILES) {
  const src = path.resolve(file);
  const name = path.basename(src).replace(/\.glb$/i, "");
  const buf = await readFile(src);
  const { json, bin } = parseGlb(buf);
  const nodeName = (i) => json.nodes[i]?.name ?? `node${i}`;
  const out = { source: path.relative(process.cwd(), src), animations: [] };
  for (const anim of json.animations || []) {
    const tracks = [];
    for (const ch of anim.channels) {
      const sampler = anim.samplers[ch.sampler];
      const input = readAccessor(json, bin, sampler.input);
      const output = readAccessor(json, bin, sampler.output);
      tracks.push({
        node: nodeName(ch.target.node),
        path: ch.target.path,
        interpolation: sampler.interpolation || "LINEAR",
        keyframes: input.values.length,
        times: input.values,
        components: output.comps,
        values: output.values,
      });
    }
    const duration = Math.max(...tracks.map((t) => t.times[t.times.length - 1] ?? 0));
    out.animations.push({ name: anim.name, duration, tracks });
  }
  const dest = path.join(outDir, `${name}.json`);
  await writeFile(dest, JSON.stringify(out));
  const nTracks = out.animations.reduce((s, a) => s + a.tracks.length, 0);
  console.log(`${name}: ${out.animations.length} clips, ${nTracks} tracks -> ${path.relative(process.cwd(), dest)}`);
}
