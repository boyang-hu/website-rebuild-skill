// selftest/harness.mjs — the primitives both selftest lanes share.
//
// run.mjs (offline, `npm test`) and browser.mjs (`npm run test:browser`) import
// from here, so an assertion, a fixture writer, a script runner and a loopback
// serve.mjs are one spelling in both lanes, and the summary line is one shape.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const SKILL = path.join(ROOT, "skills", "website-rebuild");

/** import() of an absolute path — ESM wants a file:// URL, because on Windows `D:\…` parses as scheme `d:`
 *  (ERR_UNSUPPORTED_ESM_URL_SCHEME). pathToFileURL is the one spelling that works on every platform. */
export const importAbs = (p) => import(pathToFileURL(p).href);

/** A lane's scratch directory — wiped on entry; finish() wipes it again. */
export function scratch(name) {
  const d = path.join(ROOT, "selftest", name);
  rmSync(d, { recursive: true, force: true });
  mkdirSync(d, { recursive: true });
  return d;
}

let pass = 0, fail = 0;
export const ok = (name) => { pass++; console.log(`ok   ${name}`); };
export const bad = (name, why) => { fail++; console.log(`FAIL ${name}${why ? ` — ${why}` : ""}`); };
export const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  g === w ? ok(name) : bad(name, `got ${g}, want ${w}`);
};
export const truthy = (name, v, why = "") => (v ? ok(name) : bad(name, why));
export function finish(tmp) {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${fail ? "FAIL" : "PASS"} — ${pass} passed, ${fail} failed.`);
  process.exit(fail ? 1 : 0);
}

/** Run a skill script to completion. Never throws: the exit code IS the result, and
 *  `out` carries stdout AND stderr whatever the code — a warning printed on the way to
 *  exit 0 ("--max-mean is ignored under --self") is a semantic to assert, too. */
export function run(script, argv, opts = {}) {
  const r = spawnSync(process.execPath, [path.join(SKILL, script), ...argv], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, ...opts });
  return { code: r.status ?? 1, out: String(r.stdout || "") + String(r.stderr || "") };
}
/** A gate must exit 0 AND say so; a gate must exit `code` AND name the defect. */
export const green = (name, r, re = /PASS/) => truthy(name, r.code === 0 && re.test(r.out), `exit ${r.code}: ${r.out.slice(-240)}`);
export const red = (name, r, re, code = 1) => truthy(name, r.code === code && re.test(r.out), `exit ${r.code}: ${r.out.slice(-240)}`);

/** Write a fixture tree { "rel/path": contents } under dir. Returns dir. */
export function W(dir, files = {}) {
  mkdirSync(dir, { recursive: true });
  for (const [f, c] of Object.entries(files)) { mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); writeFileSync(path.join(dir, f), c); }
  return dir;
}

/** serve.mjs on loopback with an explicit port; resolves once /__wrs/identity answers. */
export async function serveOn(port, root, extra = []) {
  const sv = spawn(process.execPath, [path.join(SKILL, "scripts/serve.mjs"), "--root", root, "--port", String(port), ...extra], { stdio: "pipe" });
  let up = false;
  for (let i = 0; i < 40 && !up; i++) { try { await fetch(`http://127.0.0.1:${port}/__wrs/identity`); up = true; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  if (!up) { sv.kill("SIGTERM"); throw new Error(`serve.mjs did not come up on ${port}`); }
  return { base: `http://127.0.0.1:${port}`, stop: () => { sv.kill("SIGTERM"); return new Promise((r) => sv.once("exit", r)); } };
}
