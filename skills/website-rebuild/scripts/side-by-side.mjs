#!/usr/bin/env node
// side-by-side.mjs — the reviewable deliverable of a byte/pixel gate run.
// Consumes the PNG pairs verification gates write under <dir>/*-check/
// (mirror-<pose>.png + rebuild-<pose>.png), and for each pair renders a single
// composite — [ mirror | rebuild | diff heatmap ] — into <dir>/side-by-side/,
// plus a summary table from lib/png.mjs's compare(). The heatmap amplifies
// per-pixel absolute difference 8x into red; a byte-identical pair renders
// pure black.
//
// No servers, no browser: this is a pure post-processing pass over whatever
// the gates last captured. Run the gates first if the artifacts are stale.
// (Nothing here spawns a process, so the process-group reaping in
// lib/chrome.mjs does not apply — but the gate that PRODUCED these pairs does
// spawn one, and it is the thing that has to reap it.)
//
// WHERE THE PAIRS COME FROM, AND WHY THEY MAY BE JPEG: the capturing gate pulls
// each frame through CDP as one base64 WebSocket message, and Node's built-in
// WebSocket dies above ~2.4 M chars — roughly a 1500x900 PNG (see
// lib/chrome.mjs). Above that the capture side must fall back to JPEG q92, and
// this script's per-pixel heatmap then measures encoder noise as well as real
// difference. Prefer PNG pairs for byte gates; if a pair had to be JPEG, read
// the heatmap as "where", not as "how much".
//
// Usage: node side-by-side.mjs [--dir docs] [--out docs/side-by-side]
//   Expects pairs named mirror-<pose>.png / rebuild-<pose>.png inside
//   directories matching <dir>/*-check/.
//
// Adapted from careers-kimi-rebuild/scripts/side-by-side.mjs.

import fs from "node:fs/promises";
import path from "node:path";

import { compare, decodePng, encodePng } from "./lib/png.mjs";
import { cli } from "./lib/cli.mjs";

cli({ known: ["dir", "out"], file: import.meta.url });

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf("--" + name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : dflt;
};
const SCAN_DIR = flag("dir", "docs");
const OUT_DIR = flag("out", path.join(SCAN_DIR, "side-by-side"));
const GAP = 8;

async function findPairs() {
  const pairs = [];
  const entries = await fs.readdir(SCAN_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.endsWith("-check")) continue;
    const dir = path.join(SCAN_DIR, entry.name);
    const files = await fs.readdir(dir);
    for (const file of files) {
      const m = /^mirror-(.+)\.png$/.exec(file);
      if (!m) continue;
      const rebuild = `rebuild-${m[1]}.png`;
      if (!files.includes(rebuild)) continue;
      pairs.push({
        check: entry.name.replace(/-check$/, ""),
        pose: m[1],
        mirrorPath: path.join(dir, file),
        rebuildPath: path.join(dir, rebuild),
      });
    }
  }
  return pairs.sort((a, b) => (a.check + a.pose).localeCompare(b.check + b.pose));
}

function composite(a, b) {
  const width = a.width * 3 + GAP * 2;
  const height = a.height;
  const out = Buffer.alloc(width * height * 4);
  // gaps: mid grey so panel edges read against both light and dark content
  for (let i = 0; i < out.length; i += 4) {
    out[i] = out[i + 1] = out[i + 2] = 34;
    out[i + 3] = 255;
  }
  // flatten the two content panels onto black: canvas dumps carry real
  // transparency, which viewers would otherwise show as white
  const flatten = (src, dst, dstOff, srcOff, count) => {
    for (let i = 0; i < count; i += 4) {
      const alpha = src[srcOff + i + 3] / 255;
      dst[dstOff + i] = Math.round(src[srcOff + i] * alpha);
      dst[dstOff + i + 1] = Math.round(src[srcOff + i + 1] * alpha);
      dst[dstOff + i + 2] = Math.round(src[srcOff + i + 2] * alpha);
      dst[dstOff + i + 3] = 255;
    }
  };
  for (let y = 0; y < height; y += 1) {
    const rowA = y * a.width * 4;
    const rowOut = y * width * 4;
    flatten(a.data, out, rowOut, rowA, a.width * 4);
    flatten(b.data, out, rowOut + (a.width + GAP) * 4, rowA, a.width * 4);
    const heatBase = rowOut + (a.width + GAP) * 2 * 4;
    for (let x = 0; x < a.width; x += 1) {
      const i = rowA + x * 4;
      const d =
        (Math.abs(a.data[i] - b.data[i]) +
          Math.abs(a.data[i + 1] - b.data[i + 1]) +
          Math.abs(a.data[i + 2] - b.data[i + 2])) /
        3;
      const o = heatBase + x * 4;
      out[o] = Math.min(255, Math.round(d * 8));
      out[o + 1] = 0;
      out[o + 2] = 0;
      out[o + 3] = 255;
    }
  }
  return { width, height, data: out };
}

const pairs = await findPairs();
if (pairs.length === 0) {
  console.error(`no mirror/rebuild pairs found under ${SCAN_DIR}/*-check/ — run the gates first`);
  process.exit(1);
}

await fs.mkdir(OUT_DIR, { recursive: true });
console.log(`pose                                   size        meanAbsDiff  similarity`);
let worstPair = null;
for (const pair of pairs) {
  const a = decodePng(await fs.readFile(pair.mirrorPath));
  const b = decodePng(await fs.readFile(pair.rebuildPath));
  if (a.width !== b.width || a.height !== b.height) {
    console.log(`${(pair.check + "/" + pair.pose).padEnd(38)} SIZE MISMATCH ${a.width}x${a.height} vs ${b.width}x${b.height}`);
    continue;
  }
  const stats = compare(a, b);
  const merged = composite(a, b);
  await fs.writeFile(path.join(OUT_DIR, `${pair.check}-${pair.pose}.png`), encodePng(merged.width, merged.height, merged.data));
  console.log(
    `${(pair.check + "/" + pair.pose).padEnd(38)} ${`${a.width}x${a.height}`.padEnd(11)} ${String(stats.meanAbsDiff).padEnd(12)} ${stats.similarityPct}%`,
  );
  if (!worstPair || stats.meanAbsDiff > worstPair.meanAbsDiff) {
    worstPair = { name: `${pair.check}/${pair.pose}`, meanAbsDiff: stats.meanAbsDiff };
  }
}
console.log(`\n${pairs.length} pairs rendered into ${OUT_DIR}/`);
if (worstPair) console.log(`worst pair: ${worstPair.name} (meanAbsDiff ${worstPair.meanAbsDiff})`);
