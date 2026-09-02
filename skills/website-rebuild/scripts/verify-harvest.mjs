#!/usr/bin/env node
/**
 * verify-harvest.mjs — the B side of a harvested baseline.
 *
 * harvest-cases.mjs records what the SOURCE's own objects hold. That is only
 * half a gate: a baseline diffed against itself is a change detector. This
 * feeds the harvested facts to the port and asserts the port reproduces them.
 *
 * The comparison here is on IDENTITIES THE SOURCE DOES NOT SPELL OUT. The
 * motivating case: every easing function in the source bundle is an anonymous
 * expression whose `.name` is the empty string, so no name can be compared —
 * but a curve sampled at fixed points IS its identity, and it is
 * condition-independent, so the two sides can be matched by behaviour.
 *
 * ⭐ Matching by behaviour also recovers the names. The port's module exports
 * its easings under readable keys; the source's are anonymous. Matching
 * fingerprints tells you WHICH named curve the source was using — a fact the
 * source page cannot tell you directly.
 *
 * ⛔ Every harvested identity must match, and match EXACTLY ONE thing on the
 * port. A harvested curve matching two port curves means the port has
 * duplicates and the mapping is ambiguous; matching none means it is missing.
 *
 *   node scripts/verify-harvest.mjs --baseline docs/case-baseline.json \
 *        --b <port-url> --config scripts/harvest.config.mjs [--probe scripts/probe.mjs]
 */
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { cli } from "./lib/cli.mjs";

cli({ known: ["baseline", "b", "config", "probe"], bools: [], file: import.meta.url });

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf("--" + n); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d; };
const BASELINE = flag("baseline", "docs/case-baseline.json");
const B = flag("b", null);
const CONFIG = flag("config", "scripts/harvest.config.mjs");
const PROBE = flag("probe", "scripts/probe.mjs");
if (!B) { console.error("usage: verify-harvest.mjs --baseline <file> --b <port-url> [--config <file>]"); process.exit(2); }

let cfg;
try { cfg = await import(pathToFileURL(path.resolve(CONFIG)).href); }
catch (e) { console.error(`FATAL — cannot load config ${CONFIG}: ${e.message}`); process.exit(5); }
if (typeof cfg.harvestedIdentities !== "function" || typeof cfg.portIdentities !== "function") {
  console.error(`FATAL — config must export harvestedIdentities(baseline) and portIdentities().`);
  process.exit(5);
}

const base = JSON.parse(await readFile(path.resolve(BASELINE), "utf8"));
const wanted = cfg.harvestedIdentities(base); // Map/obj: key -> fingerprint array

const evalOn = (url, expr) =>
  new Promise((res) => {
    const p = spawn("node", [PROBE, url, "--eval", expr], { stdio: ["ignore", "pipe", "pipe"] });
    let o = "";
    p.stdout.on("data", (d) => (o += d));
    p.stderr.on("data", (d) => (o += d));
    p.on("close", () => {
      const m = o.match(/^EVAL: (.*)$/m);
      if (!m) return res({ error: "no EVAL line", raw: o.slice(-400) });
      try { res(JSON.parse(JSON.parse(m[1]))); } catch (e) { res({ error: String(e), raw: m[1].slice(0, 240) }); }
    });
  });

console.log(`=== verify-harvest — ${cfg.name || "unnamed"} ===`);
console.log(`  A  ${base.source}  (harvested)`);
console.log(`  B  ${B}\n`);

const entries = Object.entries(wanted);
if (entries.length === 0) {
  console.error(`FATAL — the baseline yielded no identities to check. A gate with nothing to`);
  console.error(`        compare passes unconditionally, which is worse than no gate.`);
  process.exit(5);
}

const b = await evalOn(B, cfg.portIdentities());
if (b.error) { console.error(`FATAL B: ${b.error}`); if (b.raw) console.error(String(b.raw).slice(0, 400)); process.exit(5); }
const portMap = b.identities || b;
const portEntries = Object.entries(portMap).filter(([, v]) => Array.isArray(v));

let fail = 0;
const eq = (x, y) => Array.isArray(x) && Array.isArray(y) && x.length === y.length && x.every((v, i) => Math.abs(v - y[i]) <= 1e-6);

console.log(`  ${entries.length} harvested identity(ies) vs ${portEntries.length} on the port\n`);
for (const [key, fp] of entries) {
  const matches = portEntries.filter(([, pv]) => eq(fp, pv)).map(([pk]) => pk);
  if (matches.length === 1) {
    console.log(`  ok   ${key.padEnd(22)} -> ${matches[0].padEnd(20)} ${JSON.stringify(fp)}`);
  } else if (matches.length === 0) {
    fail++;
    console.log(`  FAIL ${key.padEnd(22)} -> (nothing on the port reproduces it)  ${JSON.stringify(fp)}`);
  } else {
    fail++;
    console.log(`  FAIL ${key.padEnd(22)} -> AMBIGUOUS: ${matches.join(", ")}`);
    console.log(`       The port has duplicate behaviours, so this mapping is not a fact.`);
  }
}

// ⚠ Coverage is not correctness, but it is worth saying: a port that defines 20
// curves while the page uses 3 is carrying 17 unexercised ones, and this gate
// says nothing about those.
const used = new Set(entries.flatMap(([, fp]) => portEntries.filter(([, pv]) => eq(fp, pv)).map(([pk]) => pk)));
console.log(`\n  ⚠    ${used.size}/${portEntries.length} port identity(ies) are exercised by the harvest;`);
console.log(`       the rest are untested by this gate.`);

console.log(fail ? `\nFAIL — ${fail} harvested identity(ies) unmatched.` : `\nPASS — all ${entries.length} harvested identity(ies) matched exactly one on the port.`);
process.exit(fail ? 1 : 0);
