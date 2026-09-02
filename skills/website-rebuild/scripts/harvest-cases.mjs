#!/usr/bin/env node
/**
 * harvest-cases.mjs — take the gate's cases FROM THE SOURCE, not from your head.
 *
 * A numeric gate needs (inputs, expected output) pairs. Writing them by hand is
 * how a suite ends up proving nothing: six hand-written cases on one target all
 * landed on the same easing curve and all went green, because the field that
 * names the curve was not the field that had been set. Hand-written cases
 * encode what you BELIEVE the engine's parameters are.
 *
 * ⭐ When the source page keeps its engine reachable — a registry, a back
 * reference stashed on a DOM node, a global — the cases can be harvested from
 * the running original instead: drive it to N states and record what its own
 * objects hold. Every case is then a fact about the source, and the port has to
 * reproduce it.
 *
 * ⛔ Harvesting does not make the gate two-sided by itself. It produces the A
 * side. Something still has to feed the same inputs to the port and compare —
 * see verify-crossside.mjs. A baseline recorded from one side and diffed
 * against itself later is a change detector, not a correctness gate.
 *
 * ⚠ Record the RESOLVED values (numbers the engine computed), not the source
 * text it started from. The text is a claim about intent; the numbers are what
 * ran. Both sides can then be compared without re-implementing the parser.
 *
 *   node scripts/harvest-cases.mjs --url <source-url> --config scripts/harvest.config.mjs \
 *        --out docs/case-baseline.json [--steps 9] [--probe scripts/probe.mjs]
 *
 * The config supplies the target-specific part:
 *
 *   export const name = "keyframes";
 *   export function states(steps) { … }        // → [{label, js}] driving statements
 *   export function collect() { … }            // → JS expression string returning the record
 */
import { writeFile, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { cli } from "./lib/cli.mjs";

cli({ known: ["url", "config", "out", "steps", "probe"], bools: [], file: import.meta.url });

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf("--" + n); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d; };
const URL_ = flag("url", null);
const CONFIG = flag("config", "scripts/harvest.config.mjs");
const OUT = path.resolve(flag("out", "docs/case-baseline.json"));
const STEPS = Number(flag("steps", "9"));
const PROBE = flag("probe", "scripts/probe.mjs");

if (!URL_) { console.error("usage: harvest-cases.mjs --url <source-url> [--config <file>] [--out <file>] [--steps N]"); process.exit(2); }

let cfg;
try { cfg = await import(pathToFileURL(path.resolve(CONFIG)).href); }
catch (e) { console.error(`FATAL — cannot load config ${CONFIG}: ${e.message}`); process.exit(5); }
if (typeof cfg.states !== "function" || typeof cfg.collect !== "function") {
  console.error(`FATAL — config must export states(steps) and collect().`);
  process.exit(5);
}

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

const states = cfg.states(STEPS);
console.log(`=== harvest-cases — ${cfg.name || "unnamed"} ===`);
console.log(`  ${URL_}`);
console.log(`  ${states.length} state(s)\n`);

// ⛔ One page load, all states. Reloading per state would let a state depend on
// load order without anyone noticing, and it is what makes this slow enough to
// be run rarely — which is how a baseline goes stale.
// ⛔ The JSON.stringify goes INSIDE the async function. Outside it, what gets
// serialised is the pending Promise — `{}` — and the caller receives a
// well-formed empty answer rather than an error.
const SCRIPT = `(async()=>{
  const out = [];
  const collect = () => (${cfg.collect()});
  const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  ${cfg.setup ? `try { ${cfg.setup()} } catch (e) { return JSON.stringify({ error: "setup: " + String(e).slice(0,160) }); }` : ""}
  for (const s of ${JSON.stringify(states)}) {
    try {
      eval(s.js);
      await frame();
      out.push({ label: s.label, ...collect() });
    } catch (e) { out.push({ label: s.label, error: String(e).slice(0, 160) }); }
  }
  return JSON.stringify({ states: out });
})()`;

const r = await evalOn(URL_, `(${SCRIPT})`);
if (r.error) {
  console.error(`FATAL — ${r.error}`);
  if (r.raw) console.error(String(r.raw).slice(0, 500));
  process.exit(5);
}

const errs = (r.states || []).filter((s) => s.error);
const rows = (r.states || []).filter((s) => !s.error);
for (const s of rows) console.log(`  ok   ${String(s.label).padEnd(18)} ${cfg.summarize ? cfg.summarize(s) : ""}`);
for (const s of errs) console.log(`  FAIL ${String(s.label).padEnd(18)} ${s.error}`);

// ⛔ A baseline where every state is identical proves the driving never worked.
// This is the harvest-time form of "a suite of cases that all land on one path".
const fingerprints = new Set(rows.map((s) => JSON.stringify({ ...s, label: undefined })));
if (rows.length > 1 && fingerprints.size === 1) {
  console.error(`\nFATAL — all ${rows.length} states recorded identical values. The driving statements did`);
  console.error(`        not move anything, so this baseline says the same thing ${rows.length} times.`);
  process.exit(5);
}
if (rows.length === 0) { console.error(`\nFATAL — nothing harvested.`); process.exit(5); }

await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify({ source: URL_, harvestedFrom: cfg.name || null, states: r.states }, null, 2) + "\n");
console.log(`\n  ${fingerprints.size} distinct state(s) out of ${rows.length} — the driving moved something.`);
console.log(`  -> ${path.relative(process.cwd(), OUT)}`);
console.log(`  ⚠ This is the A side only. Feed the same inputs to the port and compare (verify-crossside.mjs).`);
process.exit(errs.length ? 1 : 0);
