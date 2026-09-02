#!/usr/bin/env node
// verify-routes.mjs — routing / redirect / <head> contract gate. Compares the
// rebuild's route surface field-by-field against mirror files (never
// against expectations typed out by hand) and asserts the redirect table
// measured on the origin — status CODE included: Next.js `permanent: true`
// emits 308 where origins often emit 301, and only asserting the Location
// would let that slip. Exits non-zero on any mismatch, so it slots into CI.
//
// Usage: fill in CONFIG below per project, then
//   node verify-routes.mjs                    (server already running), or
//   set CONFIG.server to have the gate boot it first.
//
// Measure redirects on the ORIGIN with `curl -sI` / fetch(redirect:"manual")
// before filling in CONFIG.redirects — server-side routing behavior leaves
// zero trace in the client-side build output.
//
// Adapted from careers-kimi-rebuild/scripts/verify-routes.mjs. Site-specific
// sections of the original (assetPrefix assertion, locale-spelling quirks) were
// dropped; append per-project quirk checks at the bottom as needed.

import fs from "node:fs/promises";
import path from "node:path";
import { labelPort, resolvePort } from "./lib/ports.mjs";
// The booted server gets spawned as a PROCESS GROUP and reaped on every exit
// path. `server.kill()` signals only the direct child, and CONFIG.server.cmd is
// usually a launcher (`npm run dev` execs node): the launcher dies, the actual
// server keeps the port, and the next run of this gate reports "port taken" —
// or worse, silently measures yesterday's build. Ctrl-C during the gate had the
// same effect, since nothing was registered on SIGINT at all.
import { spawnReaped } from "./lib/chrome.mjs";
import { cli } from "./lib/cli.mjs";

// No flags: everything this gate asserts lives in CONFIG below. cli() still
// runs so --help works and a stray --flag fails loudly instead of being ignored.
cli({ known: [], file: import.meta.url });

// ---------------------------------------------------------------------------
// CONFIG — EDIT PER PROJECT. Everything the gate asserts lives here.
// ---------------------------------------------------------------------------
// Port: allocated per workspace on the rebuild side (scripts/lib/ports.mjs), so
// this gate cannot land on the mirror server's port or on another checkout's —
// which would make it assert the rebuild's route contract against a different
// server entirely. PORT=... still overrides.
const { port: PORT, label: PORT_LABEL } = resolvePort({
  lane: "verify-routes.server",
  side: "rebuild",
  env: process.env.PORT || null,
});
const CONFIG = {
  // Base URL of the server under test.
  base: `http://127.0.0.1:${PORT}`,

  // Optional boot command; null = assume the server is already running.
  // Example (Next.js): { cmd: "npx", args: ["next", "start", "--port", String(PORT)], env: {} }
  server: null,

  // Where the pristine mirror lives (the comparison baseline).
  mirrorDir: "mirror",

  // [route, mirror file relative to mirrorDir] — head + <main> + favicon are
  // compared field-by-field against these files.
  pages: [
    ["/", "index.html"],
  ],

  // [from, expected status code, expected Location (path or absolute URL)] —
  // the origin's measured redirect surface, replayed as assertions.
  redirects: [
    // ["/old-path", 301, "/new-path"],
  ],

  // Routes that must 404 (unsupported locales, unknown slugs, ...).
  notFound: [
    // "/fr",
  ],

  // Static files that must serve 200 through the rebuild.
  publicAssets: [
    // "/robots.txt",
  ],
};
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];

function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok && detail) console.log(`        ${detail}`);
}

/** The head fields the source's HTML commits to. Extend per project. */
function readHead(html) {
  const one = (re) => html.match(re)?.[1] ?? null;
  return {
    title: one(/<title>(.*?)<\/title>/s),
    description: one(/<meta name="description" content="(.*?)"\s*\/?>/s),
    canonical: one(/<link rel="canonical" href="(.*?)"\s*\/?>/),
    "hreflang:x-default": one(/<link rel="alternate" hreflang="x-default" href="(.*?)"\s*\/?>/i),
    htmlLang: one(/<html lang="(.*?)"/),
    bodyClass: one(/<body class="(.*?)"/),
  };
}

/** `<main ...>` with its attributes normalized so attribute order can't matter. */
function readMain(html) {
  const tag = html.match(/<main[^>]*>/)?.[0];
  if (!tag) return null;
  const attrs = {};
  for (const m of tag.matchAll(/([a-zA-Z-]+)="([^"]*)"/g)) attrs[m[1]] = m[2];
  if (attrs.class) attrs.class = attrs.class.trim().split(/\s+/).sort().join(" ");
  if (attrs.style) attrs.style = attrs.style.split(";").map((s) => s.trim()).filter(Boolean).sort().join(";");
  return attrs;
}

// --- boot (optional) --------------------------------------------------------

let server = null;
if (CONFIG.server) {
  server = spawnReaped({
    bin: CONFIG.server.cmd,
    args: CONFIG.server.args,
    role: "verify-routes-server",
    port: PORT,
    tool: "verify-routes.mjs",
    options: {
      env: { ...process.env, ...(CONFIG.server.env || {}) },
      stdio: ["ignore", "ignore", "pipe"],
    },
  });
  let serverErr = "";
  server.child.stderr.on("data", (d) => (serverErr += d.toString()));
  let up = false;
  for (let i = 0; i < 80; i += 1) {
    try {
      await fetch(CONFIG.base + "/", { redirect: "manual" });
      up = true;
      break;
    } catch {
      await sleep(250);
    }
  }
  if (!up) {
    console.error("server never came up\n" + serverErr.slice(-2000));
    server.reap();
    process.exit(1);
  }
} else {
  try {
    await fetch(CONFIG.base + "/", { redirect: "manual" });
  } catch {
    console.error(`no server at ${CONFIG.base} — start it first or set CONFIG.server`);
    console.error(`  this gate's port is ${labelPort(PORT)}; override with PORT=...`);
    process.exit(1);
  }
}

try {
  // --- 1. page routes: head + <main> + favicon must match the mirror --------

  for (const [route, mirrorFile] of CONFIG.pages) {
    const res = await fetch(CONFIG.base + route, { redirect: "manual" });
    const html = await res.text();
    check(`${route} responds 200`, res.status === 200, `got ${res.status}`);

    const mirrorHtml = await fs.readFile(path.join(CONFIG.mirrorDir, mirrorFile), "utf8");
    const mirror = readHead(mirrorHtml);
    const got = readHead(html);
    for (const [field, want] of Object.entries(mirror)) {
      check(`${route} head.${field}`, got[field] === want, `want ${JSON.stringify(want)}\n        got  ${JSON.stringify(got[field])}`);
    }

    // Full attribute-set comparison, not a fixed field list. (careers-kimi
    // lesson: an early version checked only aria-label/class/style and let two
    // invented data-* attributes through — an attribute the source lacks must
    // FAIL this gate.)
    const wantMain = readMain(mirrorHtml);
    const gotMain = readMain(html);
    const attrNames = [...new Set([...Object.keys(wantMain ?? {}), ...Object.keys(gotMain ?? {})])].sort();
    for (const attr of attrNames) {
      check(
        `${route} <main> ${attr}`,
        gotMain?.[attr] === wantMain?.[attr],
        `want ${JSON.stringify(wantMain?.[attr])}\n        got  ${JSON.stringify(gotMain?.[attr])}`,
      );
    }

    const wantIcon = mirrorHtml.match(/<link rel="icon"[^>]*>/)?.[0] ?? null;
    const gotIcon = html.match(/<link rel="icon"[^>]*>/)?.[0] ?? null;
    check(`${route} favicon link`, gotIcon === wantIcon, `want ${wantIcon}\n        got  ${gotIcon}`);
  }

  // --- 2. the redirect surface ---------------------------------------------

  for (const [from, wantCode, wantTo] of CONFIG.redirects) {
    const res = await fetch(CONFIG.base + from, { redirect: "manual" });
    const got = res.headers.get("location") || "";
    const gotPath = got.startsWith("http") && !got.startsWith(CONFIG.base) ? got : got.replace(CONFIG.base, "") || "/";
    const ok = res.status === wantCode && gotPath === wantTo;
    check(`${from} -> ${wantCode} ${wantTo}`, ok, `got ${res.status} ${gotPath || "(none)"}`);
  }

  // --- 3. routes that must 404 ---------------------------------------------

  for (const p of CONFIG.notFound) {
    const res = await fetch(CONFIG.base + p, { redirect: "manual" });
    check(`${p} -> 404`, res.status === 404, `got ${res.status}`);
  }

  // --- 4. public assets reachable ------------------------------------------

  for (const p of CONFIG.publicAssets) {
    const res = await fetch(CONFIG.base + p);
    check(`public asset ${p}`, res.status === 200, `got ${res.status}`);
  }

  // --- 5. per-project quirk checks go here ---------------------------------
  // (e.g. careers-kimi asserted its assetPrefix and a locale-spelling quirk;
  //  those belong to the project, not the template.)
} finally {
  server?.reap();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks pass`);
process.exit(failed.length ? 1 : 0);
