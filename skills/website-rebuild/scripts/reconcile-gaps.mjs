// reconcile-gaps.mjs — fetch every runtime-discovered gap into the mirror,
// with per-URL error tolerance and a HEADER LADDER.  [v0.3 R&D, skill backfill]
//
// WHY (two lessons this run paid for):
//  1. netcapture --fetch aborts its whole loop on the first thrown fetch
//     (no per-URL try/catch): everything it already wrote stays OFF-BOOKS —
//     the exact state its appendLedger comment promises to prevent. This
//     reconciler is idempotent and ledgers per batch.
//  2. Header allergies point BOTH ways (landonorris needs Referer;
//     video.twimg.com 403s on it). So: try the mirror's standard profile,
//     then fall back to a bare profile before declaring failure.
//
// Inputs: --urls <file(s), comma-sep>  (netcapture.tsv rows or plain URL lines)
// Usage:  node scripts/reconcile-gaps.mjs --out mirror --urls docs/netcapture.tsv,docs/next-image-urls.txt
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { sha256 } from "./lib/hash.mjs";
import { localRelPath, loadPolicy } from "./lib/urlpath.mjs";
import { fetchProfiles } from "./lib/negotiate.mjs";
// The ledgers are read and written through lib/ledger.mjs — mirror-site's row
// format and sort, not a second spelling of them.
import { readManifest, writeManifest, writeInventory } from "./lib/ledger.mjs";
import { cli } from "./lib/cli.mjs";

cli({ known: ["out", "urls"], file: import.meta.url });

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const OUT = opt("--out", "mirror");
const LISTS = (opt("--urls") || "").split(",").filter(Boolean);
if (!LISTS.length) {
  console.error("usage: reconcile-gaps.mjs --out mirror --urls <file,file,...>");
  process.exit(2);
}

// The whole document is kept and written back as-is (shape unchanged); a
// missing manifest is fatal — there is nothing to reconcile INTO.
const doc = await readManifest(OUT);
if (!doc) {
  console.error(`FATAL: no mirror-manifest.json under ${OUT} — reconcile-gaps appends to an existing mirror's ledger`);
  process.exit(1);
}
const manifest = doc.files;
const ORIGIN = doc.origin;
const ORIGIN_HOST = new URL(ORIGIN).host;
const POLICY = await loadPolicy(OUT);

const urls = new Set();
const typeHints = new Map(); // url -> CDP resource type (netcapture TSV col 5)
for (const f of LISTS) {
  const text = await readFile(f, "utf8");
  for (const line of text.split("\n")) {
    const cols = line.split("\t");
    // netcapture.tsv: STATUS CODE BYTES URL TYPE — take GAP rows; plain lists: the line
    const u = cols.length >= 4 ? (cols[0] === "GAP" ? cols[3] : null) : line.trim();
    if (u && /^https?:\/\//.test(u)) {
      urls.add(u);
      if (cols.length >= 5 && cols[4]) typeHints.set(u, cols[4]);
    }
  }
}
console.log(`candidate urls: ${urls.size}`);

// Image URLs get the browser's own image Accept on the std rung: `auto=format`
// CDNs negotiate the format on it, and `accept: */*` lands the FALLBACK bytes
// (basement D5 — 391 variants all fallback, sampled 6/6 divergent from what a
// browser receives, every gate green). The bare rung keeps `*/*`: it exists
// for header allergies, and staying minimal is its job. The rungs are
// lib/negotiate.mjs `fetchProfiles` (same UA and headers as the crawler); the
// climb below stays local because it differs from `fetchLadder` — a 3xx is a
// failure here, and any non-2xx (not only 401/403) falls through to bare.
const profilesFor = (url) => fetchProfiles(url, { origin: ORIGIN, typeHint: typeHints.get(url) || "" });

async function flush() {
  await writeManifest(OUT, doc);
  await writeInventory(OUT, manifest);
}

let saved = 0, had = 0, failed = 0, n = 0;
const failures = [];
for (const url of [...urls].sort()) {
  n++;
  if (manifest[url]) {
    had++;
    continue;
  }
  let res = null, lastErr = "", usedProfile = "";
  for (const p of profilesFor(url)) {
    try {
      const r = await fetch(url, { headers: p.headers, redirect: "manual" });
      if (r.ok) {
        res = r;
        usedProfile = p.name;
        break;
      }
      lastErr = `HTTP ${r.status} (${p.name})`;
      if (r.status >= 300 && r.status < 400) break; // redirects are source behavior; record as failure here
    } catch (e) {
      lastErr = `${e.message} (${p.name})`;
    }
  }
  if (!res) {
    failures.push(`${url}\t${lastErr}`);
    failed++;
    continue;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const rel = localRelPath(url, ORIGIN_HOST, POLICY);
  const p = join(OUT, rel);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, buf);
  const vary = res.headers.get("vary") || "";
  manifest[url] = {
    path: rel,
    bytes: buf.length,
    sha256: sha256(buf),
    type: (res.headers.get("content-type") || "").split(";")[0] || "",
    // Profile + Vary on record: a negotiated response (Vary: accept) is
    // otherwise indistinguishable from a plain one in the ledger (basement D5).
    ...(usedProfile ? { profile: usedProfile } : {}),
    ...(vary ? { vary } : {}),
  };
  saved++;
  if (saved % 100 === 0) {
    await flush(); // ledger per batch: a crash cannot strand what's on disk
    console.log(`  ...${saved} saved (${n}/${urls.size})`);
  }
  await new Promise((r) => setTimeout(r, 120));
}
await flush();
if (failures.length) await writeFile("docs/reconcile-failures.txt", failures.join("\n") + "\n");
console.log(`saved ${saved}, already-had ${had}, failed ${failed} (docs/reconcile-failures.txt)`);
