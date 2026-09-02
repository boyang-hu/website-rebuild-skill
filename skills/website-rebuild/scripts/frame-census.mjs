#!/usr/bin/env node
/**
 * frame-census.mjs — is this screenshot actually a rendered page?
 *
 * gate-failure-modes.md §1.8: every gate can be pointed at the same empty state
 * and report perfect agreement. A frozen A/B comparison that returns
 * meanAbsDiff 0 proves the two sides match; it does NOT prove they match on
 * something. If the determinism shim stopped the page before first paint, both
 * sides are the same blank canvas and every number is 0.
 *
 * So: count distinct colours and the non-background share. A blank frame has a
 * handful of colours and ~100% background; a rendered WebGL scene has thousands.
 *
 *   node scripts/frame-census.mjs docs/compare/mirror-home-frozen.png [...]
 */
import { readFile } from "node:fs/promises";
import { decodePng } from "./lib/png.mjs";
import { cli } from "./lib/cli.mjs";

cli({ file: import.meta.url, positional: "<frame.png> [...]" });

let worst = null;
for (const f of process.argv.slice(2)) {
  const { width, height, data } = decodePng(await readFile(f));
  const colours = new Set();
  const hist = new Map();
  for (let i = 0; i < data.length; i += 4) {
    const k = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    colours.add(k);
    hist.set(k, (hist.get(k) || 0) + 1);
  }
  let top = 0, topK = 0;
  for (const [k, n] of hist) if (n > top) { top = n; topK = k; }
  const px = width * height;
  const bgShare = (top / px) * 100;
  const hex = "#" + topK.toString(16).padStart(6, "0");
  const verdict = colours.size < 64 || bgShare > 97 ? "⛔ 看起来是空帧" : "ok 有内容";
  console.log(`  ${verdict}  ${f.split("/").pop().padEnd(30)} ${width}x${height}  distinct=${String(colours.size).padStart(6)}  dominant ${hex} ${bgShare.toFixed(1)}%`);
  if (!worst || colours.size < worst) worst = colours.size;
}
process.exit(worst !== null && worst >= 64 ? 0 : 1);
