#!/usr/bin/env node
/**
 * mirror-site.mjs — BFS crawler: snapshot a live site into a byte-faithful
 * local mirror. Pages land at <out>/<path>/index.html, cross-host assets at
 * <out>/assets/<host>/<path>; every fetched text file is rescanned for asset
 * URLs until no new ones appear. Three ledgers are written next to the bytes:
 * <out>/mirror-manifest.json (url -> local path, size, sha256, type),
 * <out>/inventory.tsv (SHA256 BYTES PATH URL) and <out>/redirects.tsv
 * (CODE FROM TO — replayed by serve.mjs). A fourth file, <out>/urlpath-policy.json,
 * records the url -> path mapping policy these bytes were written under.
 *
 * Usage:
 *   node mirror-site.mjs --origin https://example.com [--out mirror]
 *     [--hosts cdn.example.com,media.example.net]  extra asset hosts to follow
 *     [--pages /pricing,/contact]                  extra seed pages
 *     [--probe-404 /no-such-page-mirror-probe]     fetch origin 404 template -> 404.html
 *     [--seeds urls.txt]                           newline-delimited extra asset URLs
 *     [--rounds 4] [--workers 8]
 *     [--scope /path/]                             restrict the PAGE queue to a path prefix (assets unaffected)
 *     [--query-ignore v,cb]                        params that do NOT change the bytes
 *     [--query-only width,height]                  the only params that do
 *
 * NOTE a static crawl always misses three classes of URL: worker-fetched WASM,
 * lazy-loaded assets, and runtime-concatenated paths. Follow up with
 * netcapture.mjs (real-browser CDP capture + disk diff) to find the gaps.
 * Then audit the mirror itself with verify-mirror.mjs — the render-level gates
 * downstream cannot tell a right mirror from a wrong one.
 *
 * Adapted from landonorris-rebuild/scripts/mirror-site.mjs.
 * Lineage: rogierdeboeve-rebuild (BFS regex crawler + manifest, ~250 lines)
 *   -> storytellingnoomo-rebuild ("Adapted from rogierdeboeve-rebuild": same-origin
 *      absolute paths, css url() refs, glTF buffer/image URIs)
 *   -> landonorris-rebuild (asset-host whitelist, same-origin Referer header for
 *      asset CDNs that require it, 404-template probe)
 *   -> shopifydesign-rebuild (redirect:"manual" + redirects.tsv instead of
 *      following — the script used to violate its own red line; per-file sha256
 *      in the manifest + inventory.tsv; --seeds so URLs solved out of bundles
 *      and payloads go through the same downloader and land in the same ledger)
 *   -> objectandarchive-rebuild (query-aware url -> path mapping shared through
 *      lib/urlpath.mjs; srcset candidate lists extracted per candidate).
 */
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { sha256 } from './lib/hash.mjs';
// The three ledgers are read and written by lib/ledger.mjs — one row format,
// one merge, shared with netcapture / reconcile-gaps / wayback-mirror and every
// gate that reads them back.
import { readManifest, readRedirects, writeLedgers as writeLedgerFiles } from './lib/ledger.mjs';
// The url -> local-path mapping is QUERY-AWARE and lives in one module shared
// with netcapture.mjs, serve.mjs and verify-mirror.mjs. Read its header once:
// a pathname-only mapping collapses `x.jpg?width=320|600|1200` into one file on
// every query-parameterised image CDN, and nothing downstream can see it —
// the page renders from whichever variant landed last.
import {
  localRelPath,
  loadPolicy,
  policyFromArgs,
  savePolicy,
  describePolicy,
} from './lib/urlpath.mjs';
// The reference extractor is shared with verify-mirror.mjs's closure gate, so
// the gate cannot inherit a blind spot from the crawler it audits. `isTextRefSource`
// is the other half of the same module: WHICH files get rescanned at all. It
// used to be an extension whitelist written out twice (here and in the gate),
// both stopping at html|css|js|mjs|json|svg — so `.atom` / `.xml` / `.rss` /
// `.txt` feeds full of asset URLs were opened by neither side, and the closure
// gate could not report it because the blind spot was shared (objectarchive
// N13: 16 feeds, reference set 3,109 -> 3,521).
import { createRefExtractor, isTextRefSource } from './lib/extract-refs.mjs';
import { BROWSER_UA, fetchLadder } from './lib/negotiate.mjs';
import { cli } from './lib/cli.mjs';

cli({
  known: ['origin', 'out', 'hosts', 'pages', 'probe-404', 'seeds', 'rounds', 'workers', 'scope', 'query-ignore', 'query-only'],
  file: import.meta.url,
});

// ---------------------------------------------------------------------------
// CONFIG — per-project constants; site specifics come from the CLI instead.
// ---------------------------------------------------------------------------

// Generic third-party CDN hosts worth following by default (fonts and library
// CDNs show up in most sites). Site-specific CDNs go in via --hosts.
const DEFAULT_ASSET_HOSTS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'unpkg.com',
  'cdn.jsdelivr.net',
  'cdnjs.cloudflare.com',
];

// Same-origin path prefixes that must NOT be crawled as pages, e.g. analytics
// reverse-proxy blobs (landonorris had Webflow GA proxies at /nvhc, /avljl).
const SKIP_PAGE_PREFIXES = [];

// Desktop UA for all requests (some origins vary or block on UA): the one
// string in lib/negotiate.mjs, so every fetcher's ledger describes the same UA.

// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : dflt;
};
const ORIGIN_RAW = flag('origin', null);
if (!ORIGIN_RAW) {
  console.error('usage: mirror-site.mjs --origin https://example.com [--out mirror] [--hosts a,b] [--pages /x,/y] [--probe-404 /slug] [--seeds urls.txt] [--rounds 4] [--workers 8] [--scope /path/] [--query-ignore v,cb | --query-only width,height]');
  process.exit(2);
}
const ORIGIN = ORIGIN_RAW.replace(/\/+$/, '');
const ORIGIN_HOST = new URL(ORIGIN).hostname;
// resolve(), not join(cwd, …): an ABSOLUTE --out (`--out /tmp/m`) was glued
// under the cwd as <cwd>/tmp/m, without a word.
const OUT = resolve(flag('out', 'mirror'));
// ⛔ A non-numeric --rounds/--workers used to become NaN — zero rounds and zero
// workers — and the crawl fetched nothing and still printed "Done".
const intFlag = (name, dflt) => {
  const raw = flag(name, dflt);
  const v = Number(raw);
  if (!Number.isInteger(v) || v < 1) {
    console.error(`usage: --${name} must be an integer >= 1 (got ${JSON.stringify(String(raw))})`);
    process.exit(2);
  }
  return v;
};
const ROUNDS = intFlag('rounds', 4);
const WORKERS = intFlag('workers', 8);
const PROBE_404 = flag('probe-404', null);
const SEEDS_FILE = flag('seeds', null);
// Query policy: CLI wins, else whatever this mirror was already written with,
// else the conservative default (every param is part of the path key). A
// gap-filling run therefore inherits the first run's policy automatically —
// re-fetching a handful of URLs under a different mapping would scatter them
// next to, instead of over, the files they are meant to replace.
await mkdir(OUT, { recursive: true });
const QUERY_POLICY = policyFromArgs(args) ?? (await loadPolicy(OUT));
await savePolicy(OUT, QUERY_POLICY);
console.log(`[urlpath] ${describePolicy(QUERY_POLICY)}`);

const ASSET_HOSTS = new Set([
  ...DEFAULT_ASSET_HOSTS,
  ...flag('hosts', '').split(',').filter(Boolean),
  ORIGIN_HOST, // same-origin assets (css/js/media referenced by absolute or root-relative URL)
]);

const offHostRefs = new Map(); // host -> {n, sample} for hosts NOT on ASSET_HOSTS

// ⭐ The ledger is CUMULATIVE, not per-run. It used to start empty, so a
// gap-filling run (--seeds) rewrote mirror-manifest.json with only the URLs it
// happened to touch: the files from earlier runs stayed on disk while their
// rows vanished, and verify-mirror reported them as orphans — "files nobody can
// name a URL for". Measured: a 238-row mirror came back from a 224-URL seeds
// run with 255 files on disk and 31 orphans.
//
// That also broke this script's own promise. --seeds exists so gap-filling
// "goes through the one downloader and lands in the same ledger"; a ledger that
// forgets what it is being added to is not the same ledger.
//
// Rows are preloaded but NOT marked fetched: a full re-crawl still re-fetches
// and OVERWRITES each row, so a stale row can never survive a run that visits
// its URL. Only rows this run never visits are carried over.
// ⛔ A manifest that EXISTS but cannot be read is fatal (lib/ledger.mjs throws),
// not an empty ledger: starting fresh over it would overwrite it at the end.
const manifest = ((await readManifest(OUT)) || { files: {} }).files;
const carriedOver = Object.keys(manifest).length;
if (carriedOver) console.log(`[ledger] carrying over ${carriedOver} row(s) from the existing manifest`);
const fetched = new Set();
// Redirects are SOURCE-SITE BEHAVIOR, not crawler bookkeeping: they get their
// own ledger and are never collapsed into the source path's file.
const redirects = []; // {from, status, to}
// ⛔ The redirect ledger must ACCUMULATE like the manifest does. A later run
// (`--scope` to add a page family, `--seeds` to fill a gap) rebuilt this array
// from scratch and wrote a file with only the header: the first crawl's
// `/work 308 -> /` was gone, and the payload gate found out by hitting a 404
// on /work (14islands F6). Same promise as the manifest carry-over above — a
// ledger that forgets what it is being added to is not the same ledger.
{
  for (const r of await readRedirects(OUT)) redirects.push(r);
  if (redirects.length) console.log(`[ledger] carrying over ${redirects.length} redirect row(s) from the existing redirects.tsv`);
}

// Delegated to lib/urlpath.mjs so the crawler, the capture pass, the server and
// the mirror gate cannot drift apart on where a URL lives — and so the query
// string is part of the answer (lib/urlpath.mjs header for the measured case).
function localPathFor(url) {
  return join(OUT, localRelPath(url, ORIGIN_HOST, QUERY_POLICY));
}

async function save(url, buf, contentType, extra = {}) {
  const p = localPathFor(url);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, buf);
  manifest[url] = {
    path: relative(OUT, p),
    bytes: buf.length,
    sha256: sha256(buf),
    type: contentType || '',
    // Ledger blind spot closed (basement D5): without the fetch profile and
    // the Vary header on record, a negotiated response is indistinguishable
    // from a plain one and the divergence is invisible to every audit.
    ...(extra.profile ? { profile: extra.profile } : {}),
    ...(extra.vary ? { vary: extra.vary } : {}),
  };
  if (++savedSinceFlush >= FLUSH_EVERY) {
    savedSinceFlush = 0;
    await writeLedgers();
  }
}

// The three ledgers, written from the SAME merged state every time: carried-over
// rows plus this run's rows in `manifest`, prior plus new rows in `redirects`.
// One function for the periodic flush, the SIGINT flush and the final write, so
// the three cannot drift on merge semantics. Row formats, redirect dedupe and
// the CODE FROM TO column order serve.mjs replays live in lib/ledger.mjs.
async function writeLedgersNow() {
  await writeLedgerFiles(OUT, { origin: ORIGIN, files: manifest, redirects });
}
// Serialised: a periodic flush and a SIGINT flush must never interleave two
// truncating writes to one file.
let ledgerWrite = Promise.resolve();
function writeLedgers() {
  ledgerWrite = ledgerWrite.then(writeLedgersNow, writeLedgersNow);
  return ledgerWrite;
}
// ⭐ FLUSH EVERY N SAVES AND ON CTRL-C. The ledgers were written once, at the
// end: a multi-hour crawl interrupted at hour three left every byte on disk and
// ZERO rows — the off-the-books state verify-mirror reports as orphans and no
// gate can bless. Same cadence reconcile-gaps.mjs uses.
const FLUSH_EVERY = 100;
let savedSinceFlush = 0;
// `once`, so a second Ctrl-C during a slow flush falls through to the default
// handler and exits immediately instead of waiting on the write.
process.once('SIGINT', () => {
  console.error('\n[ledger] SIGINT — flushing ledgers before exit (Ctrl-C again to abort the flush)');
  writeLedgers()
    .catch((e) => console.error(`[ledger] flush failed: ${e.message}`))
    .finally(() => process.exit(130));
});

// ⚠ HEADER LADDER — the same 403 has two OPPOSITE cures. One CDN family
// refuses requests WITHOUT a same-origin Referer (landonorris), another
// refuses requests WITH browser-shaped headers (video.twimg.com served a
// bare curl and 403'd the polite profile — measured on rauchg). So a 4xx on
// the standard profile gets ONE retry on a minimal profile before the URL is
// declared failed. Redirects are handled before any retry: they are source
// behavior, not a header allergy. The rungs, their headers (browser UA, the
// browser's own image Accept, same-origin Referer) and the climb rules are
// lib/negotiate.mjs `fetchLadder` — the same ladder netcapture --fetch and
// reconcile-gaps climb, so their rows are indistinguishable from this one's.
async function get(url) {
  // RED LINE (references/mirroring.md §2): never follow. A followed 301
  // writes the target's body at the source path and fabricates a file the
  // origin never served at that URL. fetchLadder defaults to redirect:
  // 'manual' and hands a 3xx back as-is; record it and re-queue the target so
  // it lands at its own place in URL space instead.
  const { res, profile, error } = await fetchLadder(url, { origin: ORIGIN });
  // Failed rows keep the `HTTP <status>` spelling every earlier ledger carries;
  // the rung stays in the message only for transport errors.
  if (!res) throw new Error(error.replace(/^(HTTP \d+) \((?:std|bare)\)$/, '$1'));
  if (res.status >= 300 && res.status < 400) {
    const to = res.headers.get('location') || '';
    redirects.push({ from: url, status: res.status, to });
    return { redirectTo: to ? new URL(to, url).href : null };
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  // Vary:accept in the ledger = this URL's bytes depend on the request
  // profile; the census in sanity-platform.md §1.2 reads it back.
  return {
    buf,
    type: res.headers.get('content-type') || '',
    vary: res.headers.get('vary') || '',
    profile,
  };
}

// Absolute / protocol-relative / root-relative / srcset-candidate / css-url()
// extraction now lives in lib/extract-refs.mjs, shared with verify-mirror.mjs's
// closure gate. Its header records why srcset needs per-candidate extraction:
// only the first candidate of a list is preceded by a quote, so a quote-keyed
// regex sees 1 of ~5 and the ledger still looks complete.
const extractAssetUrls = createRefExtractor({
  origin: ORIGIN,
  originHost: ORIGIN_HOST,
  assetHosts: ASSET_HOSTS,
  // Census of every reference pointing at a host the allow-list does not
  // follow. Printed at the end: a mirror that looks finished while one
  // unfollowed host holds all the artwork is the failure this catches.
  onOffHost: (host, href) => {
    let e = offHostRefs.get(host);
    if (!e) offHostRefs.set(host, (e = { n: 0, sample: href }));
    e.n += 1;
  },
});

// --scope <prefix>: restrict the PAGE queue to a path prefix. Step 0 grades a
// TARGET PATH ("existence at path granularity"), and plenty of targets are a
// microsite living under a bigger host — an anniversary site at /50th/ on a
// corporate WordPress domain, a campaign page under a CMS. Without this the
// crawler follows the host's own nav out of the project's scope and puts load
// on an origin that never agreed to it.
// ⛔ PAGES ONLY, NEVER ASSETS. A scoped microsite still references fonts and
// images that live elsewhere on the host; cutting those by prefix would be
// using a scope argument to punch a hole in mirror completeness.
const SCOPE = flag('scope', null);
const inScope = (p) => !SCOPE || p === SCOPE.replace(/\/$/, '') || p.startsWith(SCOPE);

function extractPageLinks(html) {
  const pages = new Set();
  for (const m of html.matchAll(/href="(\/[^"#?]*)"/g)) {
    const p = m[1];
    if (!inScope(p)) continue;
    // Not pages. Feeds and data documents (.atom/.rss/.json) are still FETCHED
    // — shape 3 of the extractor sees `href="/collections/all.atom"` and queues
    // them as assets, and they are rescanned for references like any other text
    // file; they just do not belong in the PAGE queue.
    if (/\.(css|js|mjs|png|jpg|webp|svg|ico|xml|atom|rss|json|txt|woff2?)$/i.test(p)) continue;
    if (SKIP_PAGE_PREFIXES.some((pre) => p.startsWith(pre))) continue;
    pages.add(p.replace(/\/$/, '') || '/');
  }
  return pages;
}

// The '/' seed is unconditional without --scope; under it, seed the scope root
// instead, or the host's homepage nav drags the whole site back in.
const pageQueue = [SCOPE || '/', ...flag('pages', '').split(',').filter(Boolean)];
if (PROBE_404) pageQueue.push(PROBE_404);
const pagesDone = new Set();
let assetQueue = new Set();

// Extra seeds: URLs solved out of escaped payloads / bundle string literals,
// which the HTML-attribute regexes structurally cannot see. Feeding them here
// (rather than fetching them by hand) keeps one downloader and one ledger.
if (SEEDS_FILE) {
  const lines = (await readFile(SEEDS_FILE, 'utf8')).split('\n').map((s) => s.trim());
  let n = 0;
  for (const l of lines) {
    if (!l || l.startsWith('#')) continue;
    try { new URL(l); assetQueue.add(l); n += 1; } catch {}
  }
  console.log(`[seeds] ${n} urls from ${SEEDS_FILE}`);
}

// ⛔ A same-origin HTML document is a PAGE, not an asset, and letting the
// asset queue take it punches straight through --scope. The asset extractor
// asks only "does this have an extension", and `.html` says yes — so
// `href="/legal/…/site.html"` was blocked by the page guard and then fetched
// anyway through the asset path, rescanned as text, and pulled an entire
// cross-locale legal tree behind it. Measured: a 5-page microsite crawl
// became 1,492 files and 239 MB.
//
// Out of scope it is dropped; in scope (or with no scope at all) it goes to
// the PAGE queue where it belongs. Cross-origin documents keep the old
// behaviour — they are not this origin's pages and have no page queue.
//
// ONE router for every extracted reference — the page loop's AND the asset
// rounds' rescans. The rescans used to push straight into assetQueue, so the
// same `.html` the page guard had just refused was fetched anyway the moment
// a chunk or a JSON payload mentioned it: the hole, one caller over.
function enqueueRef(u) {
  let doc = null;
  try {
    const parsed = new URL(u);
    if (parsed.hostname === ORIGIN_HOST && /\.x?html?($|\?)/i.test(parsed.pathname)) doc = parsed.pathname;
  } catch {}
  if (doc === null) { if (!fetched.has(u)) assetQueue.add(u); return; }
  if (!inScope(doc)) return;
  if (!pagesDone.has(doc)) pageQueue.push(doc);
}

// --- crawl pages ---
// A function, not a one-shot loop: asset rounds discover pages too (see
// enqueueRef), and those are crawled HERE — same scope guard, same page-link
// extraction, same ledger row — before the next asset round.
async function crawlPages() {
  while (pageQueue.length) {
    const path = pageQueue.shift();
    if (pagesDone.has(path)) continue;
    pagesDone.add(path);
    const url = ORIGIN + (path === '/' ? '/' : path);
    try {
      const res = await fetch(url, { headers: { 'user-agent': BROWSER_UA }, redirect: 'manual' });
      if (res.status >= 300 && res.status < 400) {
        const to = res.headers.get('location') || '';
        redirects.push({ from: url, status: res.status, to });
        console.log(`[page REDIRECT ${res.status}] ${path} -> ${to}`);
        if (to && new URL(to, url).hostname === ORIGIN_HOST) {
          const p2 = new URL(to, url).pathname;
          if (!pagesDone.has(p2)) pageQueue.push(p2);
        }
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      const html = buf.toString('utf8');
      const isNotFoundProbe = PROBE_404 !== null && path === PROBE_404;
      if (isNotFoundProbe) {
        // Save the origin's 404 template so serve.mjs can replay 404 semantics.
        await mkdir(OUT, { recursive: true });
        await writeFile(join(OUT, '404.html'), buf);
        manifest[url] = {
          path: '404.html',
          bytes: buf.length,
          sha256: sha256(buf),
          type: 'text/html (404 template)',
        };
      } else {
        await save(url, buf, res.headers.get('content-type'));
      }
      console.log(`[page] ${path} (${buf.length}b${res.ok ? '' : `, HTTP ${res.status}`})`);
      for (const u of extractAssetUrls(html, url)) enqueueRef(u);
      if (!isNotFoundProbe) {
        for (const p of extractPageLinks(html)) if (!pagesDone.has(p)) pageQueue.push(p);
      }
    } catch (e) {
      console.error(`[page FAIL] ${path}: ${e.message}`);
    }
  }
}
await crawlPages();

// --- download assets, rescanning text assets until fixpoint ---
for (let round = 1; round <= ROUNDS && (assetQueue.size || pageQueue.length); round++) {
  // Pages a rescan found (a route's .html named in a chunk) are crawled first,
  // through the page path, and feed this round's asset queue like any page.
  if (pageQueue.length) await crawlPages();
  const batch = [...assetQueue].filter((u) => !fetched.has(u));
  assetQueue = new Set();
  console.log(`--- asset round ${round}: ${batch.length} urls ---`);
  let i = 0;
  const workers = Array.from({ length: WORKERS }, async () => {
    while (i < batch.length) {
      const url = batch[i++];
      if (fetched.has(url)) continue;
      fetched.add(url);
      try {
        const { buf, type, vary, profile, redirectTo } = await get(url);
        if (redirectTo !== undefined) {
          console.log(`[asset REDIRECT] ${url.slice(0, 90)} -> ${redirectTo}`);
          if (redirectTo && !fetched.has(redirectTo)) assetQueue.add(redirectTo);
          continue;
        }
        await save(url, buf, type, { vary, profile });
        console.log(`[asset] ${url.slice(0, 110)} (${buf.length}b)`);
        // Declared type first, then extension, then a sniff of the bytes we
        // already hold — so an extensionless route or a feed the extension
        // table never heard of still gets rescanned (lib/extract-refs.mjs).
        if (isTextRefSource({ url, contentType: type, head: buf })) {
          for (const u of extractAssetUrls(buf.toString('utf8'), url)) enqueueRef(u);
        }
      } catch (e) {
        console.error(`[asset FAIL] ${url}: ${e.message}`);
        // ⚠ Never downgrade a carried-over GOOD row to an error row while its
        // file is still on disk. A transient failure (reset, timeout, a CDN
        // blip) used to overwrite the row with `path: null`, and the next
        // verify-mirror reported the file as an orphan nobody can name a URL
        // for. The bytes are still what the origin once served and the row
        // still names them; the failure is logged, the row is kept.
        const prev = manifest[url];
        const onDisk = prev && prev.path ? await access(join(OUT, prev.path)).then(() => true, () => false) : false;
        if (onDisk) console.error(`[asset FAIL] keeping the carried-over row for ${url} (${prev.path} is still on disk)`);
        else manifest[url] = { path: null, error: e.message };
      }
    }
  });
  await Promise.all(workers);
}

// ⚠ A carried-over FAILED row records "the origin refused this reference". If
// no reference produced its URL this run — every attempted URL lands in
// `fetched`, success or failure — the row memorializes a reference that no
// longer exists (usually an extractor artifact a fix just removed), and
// carrying it forward turns one buggy crawl into a permanent red mark.
// Measured: 98 phantom `x.webp);--aspect` rows outliving the extractor fix
// through two full re-crawls. Rows with a file on disk are never pruned here,
// and a --seeds gap-fill never prunes at all: it visits only its seed list, so
// "nothing referenced this URL" is not a fact a seeds run can establish.
if (!SEEDS_FILE) {
  let pruned = 0;
  for (const [u, row] of Object.entries(manifest)) {
    if (row && row.path === null && !fetched.has(u)) { delete manifest[u]; pruned++; }
  }
  if (pruned) console.log(`[ledger] pruned ${pruned} failed row(s) whose URL nothing referenced this run`);
}
// Pruning is a whole-crawl fact, so it happens once, here; the write itself is
// the same one the periodic flush uses.
await writeLedgers();
const ok = Object.values(manifest).filter((f) => f.path).length;
const fail = Object.values(manifest).filter((f) => !f.path).length;
// Off-host census BEFORE the summary line, so it cannot be read as a footnote
// to a successful run. A reference the allow-list does not follow is not an
// error — plenty are analytics or outbound links — but it is a DECISION, and a
// decision nobody was told about is the shape this crawler used to fail in.
if (offHostRefs.size) {
  const rows = [...offHostRefs].sort((a, b) => b[1].n - a[1].n);
  const total = rows.reduce((t, [, e]) => t + e.n, 0);
  console.log(`\nreferences to hosts NOT followed (${total} across ${rows.length} host(s)) — each is a decision:`);
  for (const [host, e] of rows.slice(0, 12)) console.log(`  x${String(e.n).padStart(4)}  ${host}   e.g. ${e.sample.slice(0, 110)}`);
  // Only suggest hosts that LOOK like asset hosts — the sample URL ends in a
  // file extension. Namespace identifiers (www.w3.org) and outbound social
  // links are in the census for completeness, but telling someone to mirror
  // instagram.com would be worse advice than saying nothing.
  const assetish = rows.filter(([, e]) => {
    try {
      const u = new URL(e.sample);
      return /\.[a-z0-9]{2,5}($|\?)/i.test(u.pathname + (u.search || ""));
    } catch { return false; }
  });
  // No unfollowed host looks like an asset host -> nothing to warn about. The
  // warning exists for "an unfollowed host is holding the media"; firing it on
  // a namespace identifier (www.w3.org appears 84x in any SVG-heavy site) would
  // train the reader to ignore it, which is worse than not printing it.
  const top = assetish[0];
  if (top && top[1].n >= 20 && !/googletagmanager|google-analytics|doubleclick|facebook|clarity|hotjar/i.test(top[0])) {
    console.log(
      `\n!! ${top[0]} alone accounts for ${top[1].n} references and does not look like telemetry.\n` +
        `!! If the site's media lives there, this mirror is INCOMPLETE no matter how green the\n` +
        `!! counts above look. Re-run with:  --hosts ${assetish.slice(0, 3).map(([h]) => h).join(",")}`,
    );
  }
}

console.log(`\nDone: ${ok} files saved, ${fail} failed, ${redirects.length} redirects. Ledgers written.`);
