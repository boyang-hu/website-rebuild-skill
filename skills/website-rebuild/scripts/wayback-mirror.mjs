#!/usr/bin/env node
/**
 * wayback-mirror.mjs — rescue a DEAD site out of the Wayback Machine into a
 * STANDARD mirror, so every downstream gate works unchanged.
 *
 * X-class targets (29% of award sites, measured) have no origin to crawl. The
 * Internet Archive holds captures, but raw material comes wrapped: replay URLs
 * are rewritten, a toolbar is injected, and the CDX index mixes eras — a
 * squatted domain's 2025 redirect junk sits next to the real site's 2020
 * captures. This tool turns that into the same artifact mirror-site.mjs
 * produces: mirror/ tree via lib/urlpath.mjs + mirror-manifest.json with
 * sha256 — verify-mirror, serve, sweep, the shell build all run as on a live
 * site.
 *
 * The three decisions that make the output evidence, not soup:
 *
 * 1. ⭐ RAW BYTES ONLY: every fetch uses the `id_` (identity) replay flag —
 *    `https://web.archive.org/web/<ts>id_/<original>` returns the capture's
 *    original bytes, no rewriting, no toolbar. Never mirror the replay HTML.
 * 2. ⭐ ONE COHERENT MOMENT: an --anchor timestamp (default: the root page's
 *    best-covered 200 capture) plus a --window (default 365 days each way)
 *    select, per URL, the in-window 200 capture CLOSEST to the anchor. A
 *    mirror stitched from arbitrary years is a site that never existed;
 *    out-of-window junk (squatter redirects) is excluded by construction.
 * 3. ⛔ HOLES ARE PERMANENT AND MUST BE HONEST: on a live site the closure
 *    gate demands ∅ and a re-crawl can fill gaps. A dead site's holes are
 *    facts — a reference the archive never captured stays missing forever.
 *    They land in mirror/wayback-holes.txt (URL + who references it), which
 *    doubles as the --allow-missing list for verify-mirror: the gate stays
 *    green over REGISTERED holes and red over unregistered ones.
 *
 * Provenance: mirror/wayback-provenance.json records anchor, window, and per
 * file the capture timestamp + CDX digest — the coordinate system a dead-site
 * rebuild cites instead of "the origin said so".
 *
 * Politeness: web.archive.org throttles hard. Default 2 workers, 350ms gap,
 * exponential backoff on 429/503. A rescue is not a race.
 *
 *   node scripts/wayback-mirror.mjs --origin https://darknetflix.io \
 *        [--hosts cdn.example.com] [--anchor 20200626202014 | auto]
 *        [--window-days 365] [--out mirror] [--workers 2] [--include-3xx]
 */
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { localRelPath, canonicalUrl } from "./lib/urlpath.mjs";
import { createRefExtractor, isTextRefSource } from "./lib/extract-refs.mjs";

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf("--" + n); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d; };
const KNOWN = new Set(["origin", "hosts", "anchor", "window-days", "out", "workers", "include-3xx", "limit", "seeds"]);
for (const a of args) if (a.startsWith("--") && !KNOWN.has(a.slice(2))) {
  console.error(`FATAL — unknown flag ${a}. Known: ${[...KNOWN].map((f) => "--" + f).join(" ")}`);
  process.exit(2);
}

const ORIGIN = (flag("origin", "") || "").replace(/\/$/, "");
if (!ORIGIN) { console.error("usage: wayback-mirror.mjs --origin https://dead.example [--hosts cdn.x] [--anchor auto] ..."); process.exit(2); }
const ORIGIN_HOST = new URL(ORIGIN).host;
const HOSTS = [ORIGIN_HOST, ...(flag("hosts", "") || "").split(",").map((s) => s.trim()).filter(Boolean)];
const OUT = path.resolve(flag("out", "mirror"));
const WINDOW_DAYS = Number(flag("window-days", "365"));
const WORKERS = Number(flag("workers", "2"));
const INCLUDE_3XX = args.includes("--include-3xx");
const LIMIT = Number(flag("limit", "0")); // 0 = no limit; for dry recon runs
const SEEDS_FILE = flag("seeds", null);

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tsToMs = (ts) => Date.parse(`${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}T${ts.slice(8, 10) || "00"}:${ts.slice(10, 12) || "00"}:${ts.slice(12, 14) || "00"}Z`);

// Backoff-aware fetch: the archive answers 429/503 when displeased, and a
// rescue that hammers it gets the whole run blocked. Patience is a feature.
async function politeFetch(url, { tries = 5 } = {}) {
  for (let t = 0; t < tries; t++) {
    try {
      const r = await fetch(url, { redirect: "manual", headers: { "user-agent": "website-rebuild-skill/wayback-rescue (research; low-rate)" } });
      if (r.status === 429 || r.status === 503) { await sleep(2000 * 2 ** t); continue; }
      return r;
    } catch (e) {
      if (t === tries - 1) throw e;
      await sleep(1500 * 2 ** t);
    }
  }
  return null;
}

// Carry over an existing ledger (same promise as mirror-site.mjs: a gap-fill
// that forgets what it is being added to is not the same ledger).
let carried = {};
try { carried = JSON.parse(await readFile(path.join(OUT, "mirror-manifest.json"), "utf8")).files || {}; } catch {}
let carriedProv = {};
try { carriedProv = JSON.parse(await readFile(path.join(OUT, "wayback-provenance.json"), "utf8")); } catch {}

// ---- 0b. SEEDS MODE ---------------------------------------------------------
// The dead-site analogue of netcapture gap-fill: the probe's local-404 list
// names runtime-assembled URLs; `web/<anchor>id_/<url>` REDIRECTS to the
// nearest capture of that URL if the archive has one at all. Landed timestamp
// (parsed from the final URL) must sit in-window — the squatter era stays out
// here too.
if (SEEDS_FILE) {
  const anchor = flag("anchor", null) !== "auto" && flag("anchor", null) ? flag("anchor", null) : (carriedProv.anchor || null);
  if (!anchor) { console.error("FATAL — seeds mode needs --anchor or an existing wayback-provenance.json."); process.exit(2); }
  // Window precedence in seeds mode: an EXPLICIT --window-days beats the stored
// one — the stored window bounds the base selection, but a seed hunt may need
// to reach an asset captured at its own (much earlier) date: a stable file is
// crawled once and never again, so a 2018 page can legitimately depend on a
// JS whose only capture is 2015. The reach-back is a decision; record it.
const aMs = tsToMs(anchor), wMs = (args.includes("--window-days") ? WINDOW_DAYS : (carriedProv.windowDays || WINDOW_DAYS)) * 86400000;
if (args.includes("--window-days")) { carriedProv.seedWindowDays = WINDOW_DAYS; carriedProv.seedWindowNote = carriedProv.seedWindowNote || "seeds reach-back widened explicitly; per-file capture timestamps in files{} show the drift"; }
  const seeds = (await readFile(path.resolve(SEEDS_FILE), "utf8")).split("\n").map((x) => x.trim()).filter((x) => x.startsWith("http"));
  console.log(`  seeds mode: ${seeds.length} URL(s), anchor ${anchor}`);
  const manifest2 = carried;
  let got = 0;
  for (const u of seeds) {
    if (manifest2[u]) continue;
    const r = await politeFetch(`https://web.archive.org/web/${anchor}id_/${u}`, { tries: 4 });
    await sleep(350);
    if (!r) continue;
    let final = r;
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get("location");
      if (!loc) continue;
      final = await politeFetch(new URL(loc, "https://web.archive.org").href, { tries: 4 });
      await sleep(350);
    }
    if (!final || final.status !== 200) continue;
    const m2 = /\/web\/(\d{14})id_\//.exec(final.url || "");
    const landedTs = m2 ? m2[1] : anchor;
    if (Math.abs(tsToMs(landedTs) - aMs) > wMs) { console.log(`    OUT-OF-WINDOW ${u} @${landedTs} — skipped`); continue; }
    const buf = Buffer.from(await final.arrayBuffer());
    const rel = localRelPath(u, ORIGIN_HOST);
    await mkdir(path.dirname(path.join(OUT, rel)), { recursive: true });
    await writeFile(path.join(OUT, rel), buf);
    const type = (final.headers.get("x-archive-orig-content-type") || final.headers.get("content-type") || "").split(";")[0].trim();
    manifest2[u] = { path: rel, bytes: buf.length, sha256: sha256(buf), type };
    carriedProv.files = carriedProv.files || {}; carriedProv.files[u] = { timestamp: landedTs, digest: null, seeded: true };
    got++;
  }
  await writeFile(path.join(OUT, "mirror-manifest.json"), JSON.stringify({ origin: ORIGIN, mirroredAt: new Date().toISOString(), waybackAnchor: anchor, waybackWindowDays: carriedProv.windowDays || WINDOW_DAYS, files: manifest2 }, null, 2));
  await writeFile(path.join(OUT, "inventory.tsv"), ["SHA256", "BYTES", "PATH", "URL"].join("\t") + "\n" + Object.entries(manifest2).map(([u, m]) => [m.sha256, m.bytes, m.path, u].join("\t")).join("\n") + "\n");
  await writeFile(path.join(OUT, "wayback-provenance.json"), JSON.stringify(carriedProv, null, 2));
  console.log(`Done (seeds): ${got}/${seeds.length} rescued from the archive; ${seeds.length - got} have no in-window capture (register as holes).`);
  process.exit(0);
}

// ---- 1. CDX enumeration -----------------------------------------------------
console.log(`=== wayback-mirror  ${ORIGIN} (+${HOSTS.length - 1} asset host(s)) ===`);
const captures = []; // {original, timestamp, status, mimetype, digest, host}
for (const host of HOSTS) {
  const cdxUrl = `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(host + "/*")}&output=json&fl=original,timestamp,statuscode,mimetype,digest`;
  const r = await politeFetch(cdxUrl, { tries: 6 });
  if (!r || r.status !== 200) { console.error(`FATAL — CDX query failed for ${host} (${r?.status}).`); process.exit(4); }
  const rows = JSON.parse(await r.text());
  for (const [original, timestamp, statuscode, mimetype, digest] of rows.slice(1)) {
    captures.push({ original, timestamp, status: statuscode, mimetype, digest, host });
  }
  console.log(`  CDX ${host}: ${rows.length - 1} capture row(s)`);
  await sleep(400);
}

// ---- 2. anchor + window -----------------------------------------------------
let ANCHOR = flag("anchor", "auto");
if (ANCHOR === "auto") {
  // The root page's 200 captures vote; the era with the most of them wins,
  // and the anchor is that era's median capture. This is what keeps a
  // squatter's 301 flood (a different era, a different status) out of power.
  const roots = captures.filter((c) => c.status === "200" && new URL(c.original).pathname === "/" && c.host === ORIGIN_HOST)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  if (!roots.length) { console.error("FATAL — no 200 capture of the root page; give --anchor explicitly."); process.exit(4); }
  const byYear = new Map();
  for (const c of roots) { const y = c.timestamp.slice(0, 4); byYear.set(y, (byYear.get(y) || []).concat(c)); }
  const bestYear = [...byYear.entries()].sort((a, b) => b[1].length - a[1].length)[0][1];
  ANCHOR = bestYear[Math.floor(bestYear.length / 2)].timestamp;
}
const anchorMs = tsToMs(ANCHOR);
const windowMs = WINDOW_DAYS * 86400000;
console.log(`  anchor ${ANCHOR} (±${WINDOW_DAYS}d window)`);

// ---- 3. per-URL snapshot choice --------------------------------------------
// In-window 200s only; among them, the capture closest to the anchor. A
// `warc/revisit` row has no bytes of its own — but an in-window 200 with a
// real digest exists whenever the URL was truly there; revisits are skipped
// and the earlier identical capture wins through normal selection.
// ⛔ SPELLING TWINS COLLIDE ON DISK. The archive stores `http://x/` and
// `http://x:80/` as two originals; `f.eot` and `f.eot?` (the IE eot hack)
// likewise — each pair maps to ONE local path, and whichever fetch lands last
// wins while the ledger describes the loser. Dedup on the CANONICAL spelling
// (lib/urlpath.canonicalUrl — default ports, hash) plus a bare trailing "?",
// keeping the capture closest to the anchor; the KEPT row keeps its canonical
// original so the ledger and the disk agree by construction.
const canon = (u) => canonicalUrl(u).replace(/\?$/, "");
const byUrl = new Map();
for (const c of captures) {
  if (c.status !== "200" && !(INCLUDE_3XX && /^3\d\d$/.test(c.status))) continue;
  if (c.mimetype === "warc/revisit") continue;
  if (Math.abs(tsToMs(c.timestamp) - anchorMs) > windowMs) continue;
  const key = canon(c.original);
  if (!byUrl.has(key)) byUrl.set(key, []);
  byUrl.get(key).push({ ...c, original: key });
}
for (const [, arr] of byUrl) arr.sort((a, b) => Math.abs(tsToMs(a.timestamp) - anchorMs) - Math.abs(tsToMs(b.timestamp) - anchorMs));
// ⛔ TRAILING-SLASH TWINS COLLIDE. A live crawl sees `/en` 301 to `/en/` and
// fetches one; the archive holds BOTH as 200 documents, and both map to
// en/index.html — whichever fetch lands last wins, and the ledger then
// describes the loser (measured: injectivity + sha mismatch in one shot).
// Keep the slash form (the directory convention the mapping encodes), drop
// the bare twin, and record the collapse in provenance.
const collapsedVariants = [];
for (const [u] of [...byUrl]) {
  if (!u.endsWith("/") && byUrl.has(u + "/")) { collapsedVariants.push(u); byUrl.delete(u); }
}
if (collapsedVariants.length) console.log(`  collapsed ${collapsedVariants.length} trailing-slash twin(s) (slash form kept)`);
let chosen = [...byUrl.values()]; // each entry: candidate list, nearest-to-anchor first
if (LIMIT > 0) chosen = chosen.slice(0, LIMIT);
console.log(`  ${chosen.length} distinct URL(s) selected in-window (of ${captures.length} capture rows)`);

// ---- 4. fetch raw bytes -----------------------------------------------------
const manifest = {};
const failures = [];
let done = 0, bytes = 0;
let idx = 0;
// ⛔ A DOMAIN CAN DIE INSIDE THE WINDOW. Parking services answer 200, so the
// status filter cannot see them, and a parked capture nearest the anchor WINS
// selection — measured: a root page whose 2018-12 "200" was a Sedo lot while
// the real site lived eight months earlier in the same window. Every fetched
// body is checked against parking signatures; a hit falls back to the
// NEXT-nearest candidate of the same URL (up to 4), then registers a failure.
const PARKING = /sedoparking|parkingcrew|hugedomains|dan\.com\/buy|domain (is )?for sale|buy this domain|\u58f2\u308a\u51fa\u3057\u4e2d/i;
await Promise.all(Array.from({ length: WORKERS }, async () => {
  while (idx < chosen.length) {
    const cands = chosen[idx++];
    let picked = null, buf = null, r = null;
    for (const cc of cands.slice(0, 4)) {
      const rawUrl = `https://web.archive.org/web/${cc.timestamp}id_/${cc.original}`;
      r = await politeFetch(rawUrl);
      await sleep(350);
      if (!r || r.status >= 400 || r.status >= 300) continue;
      const b = Buffer.from(await r.arrayBuffer());
      if (PARKING.test(b.subarray(0, 8192).toString("utf8"))) {
        failures.push(`PARKED ${cc.original} @${cc.timestamp} — skipped, trying earlier capture`);
        continue;
      }
      picked = cc; buf = b; break;
    }
    if (!picked) { const c0 = cands[0]; failures.push(`${r?.status ?? "ERR"} ${c0.original} @${c0.timestamp}`); continue; }
    const c = picked;
    const rel = localRelPath(c.original, ORIGIN_HOST);
    const p = path.join(OUT, rel);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, buf);
    // Content-type: prefer the capture's stored header (x-archive-orig-*),
    // fall back to CDX mimetype — the ledger's type drives serve + the gates.
    const type = r.headers.get("x-archive-orig-content-type") || r.headers.get("content-type") || c.mimetype || "";
    manifest[c.original] = { path: rel, bytes: buf.length, sha256: sha256(buf), type: type.split(";")[0].trim(), wayback: { timestamp: c.timestamp, digest: c.digest } };
    done++; bytes += buf.length;
    if (done % 25 === 0) console.log(`  ${done}/${chosen.length} fetched (${(bytes / 1048576).toFixed(1)} MB)`);
  }
}));
console.log(`  fetched ${done}/${chosen.length}; ${failures.length} failure(s)`);

// ---- 5. ledgers (same shape as mirror-site.mjs) ----------------------------
await mkdir(OUT, { recursive: true });
await writeFile(path.join(OUT, "mirror-manifest.json"), JSON.stringify({
  origin: ORIGIN, mirroredAt: new Date().toISOString(),
  waybackAnchor: ANCHOR, waybackWindowDays: WINDOW_DAYS,
  files: Object.fromEntries(Object.entries(manifest).map(([u, m]) => [u, { path: m.path, bytes: m.bytes, sha256: m.sha256, type: m.type }])),
}, null, 2));
await writeFile(path.join(OUT, "inventory.tsv"),
  ["SHA256", "BYTES", "PATH", "URL"].join("\t") + "\n" + Object.entries(manifest).map(([u, m]) => [m.sha256, m.bytes, m.path, u].join("\t")).join("\n") + "\n");
await writeFile(path.join(OUT, "redirects.tsv"), "CODE\tFROM\tTO\n");
await writeFile(path.join(OUT, "wayback-provenance.json"), JSON.stringify({
  anchor: ANCHOR, windowDays: WINDOW_DAYS, hosts: HOSTS,
  files: Object.fromEntries(Object.entries(manifest).map(([u, m]) => [u, m.wayback])),
  fetchFailures: failures,
  collapsedVariants,
}, null, 2));

// ---- 6. the honest-holes account -------------------------------------------
// Closure over what we HAVE, against what the archive EVER had. A reference
// that resolves to no in-window file is a permanent hole: registered with its
// referrers, never silently dropped. This file is verify-mirror's
// --allow-missing input — the gate then stays green over what is REGISTERED
// and red over anything that is not.
const offHostCensus = new Map();
// The extractor must SEE every host the ledger holds (verify-mirror's closure
// does exactly this) — a site self-references under www./bare spellings, and
// an extractor scoped to the bare host silently drops the www refs before the
// hole filter ever sees them.
const LEDGER_HOSTS = new Set(HOSTS);
for (const u of Object.keys(manifest)) { try { LEDGER_HOSTS.add(new URL(u).host); } catch {} }
const extract = createRefExtractor({
  origin: ORIGIN,
  originHost: ORIGIN_HOST,
  assetHosts: LEDGER_HOSTS,
  // ⛔ The extractor's contract is onOffHost(host, href) — a BARE host, not a
  // URL. The first version here did `new URL(u).host` on it, which THROWS on a
  // bare host, and the catch {} swallowed every call: the census printed
  // nothing for a page that references fonts.googleapis.com and player.vimeo.com
  // (measured on first-launch.com — the fonts were only caught by reading the
  // HTML by hand). A silent catch around an interface is how a census dies.
  onOffHost: (host) => { offHostCensus.set(host, (offHostCensus.get(host) || 0) + 1); },
});
const holeRefs = new Map(); // url -> [referrers]
for (const [u, m] of Object.entries(manifest)) {
  const p = path.join(OUT, m.path);
  const buf = await readFile(p);
  if (!isTextRefSource({ url: u, contentType: m.type, head: buf })) continue;
  for (const ref of extract(buf.toString("utf8"), u)) {
    if (manifest[ref] || manifest[canon(ref)]) continue;
    // ⚠ A site references itself under www./bare spellings interchangeably,
    // and the Wayback urlkey treats them as one — so must the hole register:
    // an unregistered cross-spelling hole fails closure while looking foreign.
    try {
      const h = new URL(ref).host;
      const norm = (x) => x.replace(/^www\./, "");
      if (![...LEDGER_HOSTS].some((k) => norm(k) === norm(h))) continue;
    } catch { continue; }
    holeRefs.set(ref, (holeRefs.get(ref) || []).concat(m.path));
  }
}
if (offHostCensus.size) {
  console.log("  off-list hosts referenced (census — decide each; a dead site's CDN may hold the art):");
  for (const [h, n] of [...offHostCensus].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`    x ${String(n).padStart(3)}  ${h}`);
}
// ---- 6b. alias fill ---------------------------------------------------------
// ⭐ THE ARCHIVE MAY KNOW A HOLE BY ANOTHER NAME. Measured: a site referenced
// icons under a cache-busting prefix (`/version/<ts>/js/menu.svg`) the crawler
// never captured — while `/menu.svg` sits in the archive, in-window, 200. For
// each hole, one CDX basename query; an in-window 200 whose basename matches
// exactly gets fetched and stored AT THE REFERENCED PATH so the reference
// resolves — and the provenance records `archivedAs`, because "same basename,
// different path" is an INFERENCE, not a capture: it is registered as
// FILLED-BY-ALIAS, never passed off as the real thing. Weigh any doubt by
// looking at the file.
const aliasFilled = new Map(); // referencedAs -> {archivedAs, timestamp}
for (const [holeUrl] of [...holeRefs]) {
  const base = holeUrl.split("/").pop().split("?")[0];
  if (!base || base.length < 5) continue;
  const q = `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(new URL(holeUrl).host + "/*")}&output=json&filter=original:.*/${encodeURIComponent(base).replace(/\./g, "\\.")}$&fl=original,timestamp,statuscode&limit=50`;
  const r = await politeFetch(q); await sleep(350);
  if (!r || r.status !== 200) continue;
  let rows; try { rows = JSON.parse(await r.text()); } catch { continue; }
  const cands = rows.slice(1)
    .filter(([o, ts, st]) => st === "200" && o.split("/").pop().split("?")[0] === base && Math.abs(tsToMs(ts) - anchorMs) <= windowMs)
    .sort((a, b) => Math.abs(tsToMs(a[1]) - anchorMs) - Math.abs(tsToMs(b[1]) - anchorMs));
  if (!cands.length) continue;
  const [archivedAs, ts] = cands[0];
  const fr = await politeFetch(`https://web.archive.org/web/${ts}id_/${archivedAs}`); await sleep(350);
  if (!fr || fr.status !== 200) continue;
  const buf = Buffer.from(await fr.arrayBuffer());
  // ⛔ AN ALIAS CANDIDATE CAN BE A CATCH-ALL SHELL. Measured: an SPA answered
  // 200 with its index.html on EVERY path — the archive dutifully captured
  // `/reddit.svg` whose body is the app shell, and the first alias fill wrote
  // 82 identical-looking "SVGs" that were all HTML. The bytes must be
  // PLAUSIBLE for the referenced extension before the inference is accepted:
  // non-HTML targets reject HTML-shaped bodies, .svg must actually contain
  // <svg. (Same hazard class as verify-mirror's type-confusion gate.)
  const holeExt = (holeUrl.split("/").pop().split("?")[0].split(".").pop() || "").toLowerCase();
  const headText = buf.subarray(0, 4096).toString("utf8");
  const looksHtml = /^\s*(?:<!doctype html|<html)/i.test(headText);
  if (holeExt !== "html" && holeExt !== "htm" && looksHtml) continue;
  if (holeExt === "svg" && !/<svg[\s>]/i.test(headText)) continue;
  const aliasType = (fr.headers.get("x-archive-orig-content-type") || fr.headers.get("content-type") || "").split(";")[0].trim();
  if (/^text\/html$/i.test(aliasType) && holeExt !== "html" && holeExt !== "htm") continue;
  const rel = localRelPath(holeUrl, ORIGIN_HOST);
  const p = path.join(OUT, rel);
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, buf);
  manifest[holeUrl] = { path: rel, bytes: buf.length, sha256: sha256(buf), type: aliasType, wayback: { timestamp: ts, digest: null, aliasOf: archivedAs } };
  aliasFilled.set(holeUrl, { archivedAs, timestamp: ts });
  holeRefs.delete(holeUrl);
}
if (aliasFilled.size) {
  console.log(`  alias-filled ${aliasFilled.size} hole(s) from same-basename in-window captures`);
  // Re-write the ledgers with the filled entries included.
  await writeFile(path.join(OUT, "mirror-manifest.json"), JSON.stringify({
    origin: ORIGIN, mirroredAt: new Date().toISOString(),
    waybackAnchor: ANCHOR, waybackWindowDays: WINDOW_DAYS,
    files: Object.fromEntries(Object.entries(manifest).map(([u, m]) => [u, { path: m.path, bytes: m.bytes, sha256: m.sha256, type: m.type }])),
  }, null, 2));
  await writeFile(path.join(OUT, "inventory.tsv"),
    ["SHA256", "BYTES", "PATH", "URL"].join("\t") + "\n" + Object.entries(manifest).map(([u, m]) => [m.sha256, m.bytes, m.path, u].join("\t")).join("\n") + "\n");
  await writeFile(path.join(OUT, "wayback-provenance.json"), JSON.stringify({
    anchor: ANCHOR, windowDays: WINDOW_DAYS, hosts: HOSTS,
    files: Object.fromEntries(Object.entries(manifest).map(([u, m]) => [u, m.wayback])),
    fetchFailures: failures,
  }, null, 2));
}

const holeLines = [
  "# wayback-holes.txt — 永久洞登记(死站抢救)",
  `# 锚点 ${ANCHOR} ±${WINDOW_DAYS}d;引用存在于镜像文本里,但存档在窗口内没有该 URL 的 200 捕获。`,
  "# ⛔ 死站的洞是既成事实:补不回来,只能登记。本文件同时是 verify-mirror 的 --allow-missing 清单。",
  "#",
  ...(aliasFilled.size ? [
    "# ---- 别名回填(FILLED BY ALIAS — 字节来自存档的同名异路捕获,路径映射是推断,逐个目验) ----",
    ...[...aliasFilled.entries()].map(([u, a]) => `#   ${u}\n#     <= ${a.archivedAs} @${a.timestamp}`),
    "#",
    "# ---- 真·永久洞 ----",
  ] : []),
  ...[...holeRefs.entries()].map(([u, refs]) => `${u}\n#   <- ${[...new Set(refs)].slice(0, 3).join(", ")}`),
];
await writeFile(path.join(OUT, "wayback-holes.txt"), holeLines.join("\n") + "\n");

console.log(`\n  ledgers written; ${holeRefs.size} PERMANENT HOLE(S) registered in wayback-holes.txt`);
if (failures.length) {
  console.log(`  ${failures.length} fetch failure(s) recorded in wayback-provenance.json:`);
  for (const f of failures.slice(0, 8)) console.log(`    ${f}`);
}
console.log(`Done: ${done} files, ${(bytes / 1048576).toFixed(1)} MB, anchored at ${ANCHOR}.`);
