#!/usr/bin/env node
/**
 * verify-mirror.mjs — THE MIRROR'S OWN GATE.
 *
 * WHY THIS SCRIPT EXISTS
 * ---------------------------------------------------------------------------
 * Every other gate in this toolchain asks a rendering question. probe.mjs asks
 * "any 404s, any console errors, any outbound request?". verify-offline.mjs
 * asks "does anything still name an external host?". pixelcompare.mjs asks
 * "do the two sides look the same?". verify-routes/verify-ssr ask "does the
 * rebuild restate the mirror?".
 *
 * NONE of them asks whether the mirror is the right bytes. So a mirror can be
 * wrong and every one of them goes green:
 *
 *   - a pathname-only url -> path mapping collapses `x.jpg?width=320|600|1200`
 *     into ONE file. The server answers every width with it, the srcset picks
 *     it, the page renders, zero 404s. (objectandarchive M0: 57 paths, 3-5
 *     variants each. See lib/urlpath.mjs.)
 *   - a quote-keyed srcset regex sees 1 of ~5 candidates per set. The ledger
 *     looks complete because the first candidate of every set is present.
 *   - a gap-filling run rewrites the manifest from scratch and drops the record
 *     of the 1,200 files already on disk; sha256 columns then describe files
 *     nobody can name.
 *
 * Downstream the symptom of all three is: nothing. That is what this gate is
 * for. It asks five questions of the mirror itself, and it fails loudly.
 *
 *   1  MAPPING INJECTIVITY — do two different URLs share one file?
 *      Checked twice: on the paths the ledger RECORDED (the collapse that
 *      actually happened on disk) and on the paths lib/urlpath.mjs computes
 *      TODAY (a mapping or a query policy that would collapse them now).
 *      A disagreement between the two is MAPPING DRIFT: the mirror was written
 *      under one policy and is being served/audited under another.
 *   2  LEDGER CONSISTENCY — does every manifest row's sha256/bytes match the
 *      bytes on disk, does inventory.tsv agree with the manifest, and does the
 *      set of ledger paths equal the set of files on disk (no orphans, no
 *      phantoms)?
 *   3  AUTHENTICITY — is what is on disk THE THING YOU ASKED FOR? Orthogonal
 *      to every other gate here: 1, 2 and 4 all check that the LEDGER AND THE
 *      DISK AGREE WITH EACH OTHER, and they can do that perfectly while every
 *      byte is a bot-challenge page. Two hard assertions plus one lead:
 *      interstitial bodies, declared-type vs magic bytes, small-response
 *      outliers among peers. See the block above the gate for the measurement.
 *   4  CLOSURE — reference set − disk set = ∅, using the SAME extractor the
 *      crawler used (lib/extract-refs.mjs), so the gate cannot inherit the
 *      crawler's blind spot. This is mirroring.md's "pass 4" as an executable
 *      gate. Deliberate non-files (base-URL literals) and accepted-degradation
 *      hosts get an allow-list: --allow-missing external.txt.
 *      TWO WAYS THIS GATE HAS GONE FALSELY GREEN, both about its INPUT rather
 *      than its assertion — the difference "= ∅" cannot tell you about:
 *        - the reference set was short a whole CLASS of references (escaped
 *          URL spellings; see lib/extract-refs.mjs). Fixed there, which is why
 *          the extractor is shared and not copied.
 *        - the excuse list was matched by PREFIX, so one "this base literal is
 *          not a file" line excused an entire subtree of real missing files.
 *          Excuses are now exact unless a trailing "*" declares otherwise.
 *        - the SET OF FILES IT OPENS was an extension whitelist, so whole text
 *          formats (.atom/.xml/.rss/.txt) were never scanned by either side.
 *          Also fixed in lib/extract-refs.mjs (isTextRefSource), for the same
 *          reason: the crawler and the gate must delimit "text" identically.
 *   5  RESAMPLE (optional, OFF by default) — re-request a few URLs from the
 *      live origin and compare sha256 against the ledger. Off by default so a
 *      routine gate run never touches the source site; when on it is
 *      deliberately slow (--resample-delay, default 1500 ms).
 *
 * Usage:
 *   node verify-mirror.mjs --mirror mirror
 *   node verify-mirror.mjs --mirror mirror --allow-missing mirror/external.txt
 *   node verify-mirror.mjs --mirror mirror --resample 8 --resample-delay 2000
 *
 *   [--origin https://example.com]  default: the manifest's own `origin`
 *   [--hosts a,b]                   extra hosts for the closure pass (default:
 *                                   every host that appears in the ledger)
 *   [--allow-missing FILE]          newline list of registered excuses ("#"
 *                                   comments ok). A host-only line excuses that
 *                                   whole host; a full URL excuses EXACTLY
 *                                   itself; a trailing "*" declares a prefix
 *                                   and is printed on every run
 *   [--skip mapping,ledger,authenticity,closure,resample]
 *   [--interstitial-extra FILE]     newline list of EXTRA challenge/block-body
 *                                   regexes (one JS regex source per line, "#"
 *                                   comments ok) — the built-in table is a
 *                                   starting set, not a closed one
 *   [--resample N] [--resample-delay MS] [--resample-seed N] [--resample-html]
 *   [--max-report 25]
 *
 * Exit code 0 = all selected gates pass, 1 = at least one failed, 2 = usage.
 *
 * New in this toolchain (objectandarchive-rebuild M0 wrote the lessons; the
 * TODO list has carried a site-coupled careers-kimi ancestor since the start).
 */
import { createReadStream } from "node:fs";
import { open, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { localRelPath, loadPolicy, describePolicy, canonicalUrl } from "./lib/urlpath.mjs";
// Both halves come from the same module on purpose: the SHAPES a reference can
// take, and WHICH FILES get scanned for them. A gate that carries its own copy
// of either one inherits exactly the blind spot it is auditing.
import { createRefExtractor, textRefVerdict, sniffTextBytes } from "./lib/extract-refs.mjs";

const args = process.argv.slice(2);
const flag = (n, d) => {
  const i = args.indexOf("--" + n);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d;
};

const ROOT = path.resolve(flag("mirror", "mirror"));
const SKIP = new Set(flag("skip", "").split(",").map((s) => s.trim()).filter(Boolean));
const MAX_REPORT = Number(flag("max-report", 25));
const RESAMPLE = Number(flag("resample", 0));
const RESAMPLE_DELAY = Number(flag("resample-delay", 1500));
const RESAMPLE_SEED = Number(flag("resample-seed", 1));
const RESAMPLE_HTML = args.includes("--resample-html");
const ALLOW_FILE = flag("allow-missing", null);
const INTERSTITIAL_FILE = flag("interstitial-extra", null);
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

// Files that are the ledger, not the mirror; plus the two TOP-LEVEL toolchain
// output dirs and dotfiles. The prefixes are matched only at the root on
// purpose: plenty of origins serve real assets out of `_next/`, `_nuxt/`,
// `_astro/`, and excluding those would quietly shrink both the coverage check
// and the set of files the closure gate scans.
const LEDGER_FILES = new Set([
  "mirror-manifest.json",
  // The closure gate WRITES closure-gap.txt into the mirror so --seeds can reach
  // it - which made the coverage check report the gate own artefact as an orphan
  // one run later. A gate must not fail on what it itself wrote.
  "closure-gap.txt",
  "inventory.tsv",
  "redirects.tsv",
  "netcapture.tsv",
  "external.txt",
  "urlpath-policy.json",
  // Archival rescues (wayback-mirror.mjs) add two ledger companions: the
  // permanent-holes register and the per-file capture provenance.
  "wayback-holes.txt",
  "wayback-provenance.json",
]);
const TOOL_DIRS = ["_pretty/", "_scripts/"];
const isBookkeeping = (rel) =>
  LEDGER_FILES.has(rel) ||
  TOOL_DIRS.some((d) => rel.startsWith(d)) ||
  rel.split("/").some((seg) => seg.startsWith("."));

// "Which files are worth opening" is NOT defined here — it is defined once, in
// lib/extract-refs.mjs, next to the shapes, and the crawler uses that same
// definition. It used to be an extension whitelist written out twice, and both
// copies stopped at html|css|js|mjs|json|svg: `.atom` feeds full of asset URLs
// were opened by neither side, so the closure gate reported "= ∅" over a set of
// files it had itself decided not to read (objectarchive N13).
const readHead = async (abs, n = 4096) => {
  let fh;
  try {
    fh = await open(abs, "r");
    const buf = Buffer.alloc(n);
    const { bytesRead } = await fh.read(buf, 0, n, 0);
    return buf.subarray(0, bytesRead);
  } catch {
    return null;
  } finally {
    await fh?.close();
  }
};

const startsWith = (buf, sig, off = 0) => {
  if (!buf || buf.length < off + sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (buf[off + i] !== sig[i]) return false;
  return true;
};

let failures = 0;
const fail = (gate, msg) => {
  failures++;
  console.log(`  FAIL ${gate} — ${msg}`);
};
const ok = (gate, msg) => console.log(`  ok   ${gate} — ${msg}`);
const list = (rows, render) => {
  for (const r of rows.slice(0, MAX_REPORT)) console.log(render(r));
  if (rows.length > MAX_REPORT) console.log(`         ... ${rows.length - MAX_REPORT} more`);
};

// --- load the ledgers -------------------------------------------------------

let manifest;
try {
  manifest = JSON.parse(await readFile(path.join(ROOT, "mirror-manifest.json"), "utf8"));
} catch (e) {
  console.error(`FATAL: cannot read ${path.join(ROOT, "mirror-manifest.json")}: ${e.message}`);
  console.error("       verify-mirror.mjs audits a mirror produced by mirror-site.mjs.");
  process.exit(2);
}
const ORIGIN = (flag("origin", manifest.origin || "") || "").replace(/\/+$/, "");
if (!ORIGIN) {
  console.error("FATAL: no origin — pass --origin https://example.com (the manifest has none).");
  process.exit(2);
}
const ORIGIN_HOST = new URL(ORIGIN).hostname;
const POLICY = await loadPolicy(ROOT);
const FILES = manifest.files || {};
const entries = Object.entries(FILES);
const saved = entries.filter(([, f]) => f && f.path);
const failedRows = entries.filter(([, f]) => f && !f.path);
// The 404 template is stored under a name that is NOT its URL's mapping (the
// crawler probes /no-such-page and files the body as 404.html on purpose), so
// it is exempt from the recomputed-mapping checks — not from the byte checks.
const isTemplate = ([, f]) => f.path === "404.html";

const norm = (p) => String(p).split(path.sep).join("/");

// rel path -> what the ORIGIN said this file is. The declared content-type is
// the oracle for both the authenticity gate and the "is this text?" question;
// an extension is the origin's naming choice and promises nothing (measured:
// one origin serves `font/woff2` bytes at a `....woff` URL).
const ledgerByPath = new Map();
for (const [url, f] of saved) ledgerByPath.set(norm(f.path), { url, type: f.type || "" });

console.log(`=== verify-mirror  ${ROOT} ===`);
console.log(`  origin        ${ORIGIN}`);
console.log(`  ledger        ${saved.length} files recorded, ${failedRows.length} failed rows`);
console.log(`  ${describePolicy(POLICY)}`);

// --- gate 1: mapping injectivity -------------------------------------------

if (!SKIP.has("mapping")) {
  console.log(`\n--- gate MAPPING INJECTIVITY ---`);

  // (a) the collapse as it actually happened: two URLs, one recorded path.
  // URLs are canonicalised first (fragment stripped). RFC 3986: the fragment
  // never reaches the server, so two spellings that differ only there are ONE
  // resource and one set of bytes — reporting them as a collapse is a false
  // red, and a loud false red on the mirror gate is expensive: it teaches you
  // to skim this gate's output. Everything else is compared verbatim.
  const byRecorded = new Map();
  for (const [url, f] of saved) {
    const key = norm(f.path);
    if (!byRecorded.has(key)) byRecorded.set(key, new Set());
    byRecorded.get(key).add(canonicalUrl(url));
  }
  const collided = [...byRecorded].map(([p, s]) => [p, [...s]]).filter(([, urls]) => urls.length > 1);
  if (collided.length) {
    fail(
      "recorded",
      `${collided.length} disk file(s) are claimed by more than one URL — the mirror is ` +
        `NOT a restatement of the origin's URL space; whichever fetch finished last won:`,
    );
    list(collided, ([p, urls]) => `         ${p}\n${urls.map((u) => `           <- ${u}`).join("\n")}`);
  } else {
    ok("recorded", `${saved.length} ledger rows -> ${byRecorded.size} distinct files, injective on canonical URLs`);
  }

  // (b) the mapping as it stands today, under the mirror's stored policy.
  const byComputed = new Map();
  const drift = [];
  for (const [url, f] of saved) {
    if (isTemplate([url, f])) continue;
    let rel;
    try {
      rel = localRelPath(url, ORIGIN_HOST, POLICY);
    } catch {
      continue;
    }
    if (!byComputed.has(rel)) byComputed.set(rel, new Set());
    byComputed.get(rel).add(canonicalUrl(url));
    if (rel !== norm(f.path)) drift.push({ url, recorded: norm(f.path), computed: rel });
  }
  const wouldCollide = [...byComputed].map(([p, s]) => [p, [...s]]).filter(([, urls]) => urls.length > 1);
  if (wouldCollide.length) {
    fail(
      "computed",
      `${wouldCollide.length} path(s) would be shared by several URLs under the CURRENT policy ` +
        `— re-mirroring now would collapse them (${describePolicy(POLICY)}):`,
    );
    list(wouldCollide, ([p, urls]) => `         ${p}\n${urls.map((u) => `           <- ${u}`).join("\n")}`);
  } else {
    ok("computed", `lib/urlpath.mjs maps those URLs to ${byComputed.size} distinct paths`);
  }

  if (drift.length) {
    fail(
      "drift",
      `${drift.length} file(s) sit at a path the current mapping would NOT choose. The mirror ` +
        `was written under a different mapping or query policy than the one in force now; ` +
        `serving it this way answers requests with the wrong file or a 404:`,
    );
    list(drift, (d) => `         ${d.url}\n           on disk: ${d.recorded}\n           mapping: ${d.computed}`);
  } else {
    ok("drift", "recorded paths agree with the mapping in force");
  }
}

// --- gate 2: ledger consistency --------------------------------------------

function sha256File(p) {
  return new Promise((resolve, reject) => {
    const h = createHash("sha256");
    const s = createReadStream(p);
    s.on("error", reject);
    s.on("data", (c) => h.update(c));
    s.on("end", () => resolve(h.digest("hex")));
  });
}

async function* walk(dir) {
  let ents;
  try {
    ents = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const d of ents) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) yield* walk(p);
    else if (d.isFile()) yield p;
  }
}

const diskFiles = new Set();
for await (const f of walk(ROOT)) {
  const rel = norm(path.relative(ROOT, f));
  if (!isBookkeeping(rel)) diskFiles.add(rel);
}

if (!SKIP.has("ledger")) {
  console.log(`\n--- gate LEDGER CONSISTENCY ---`);

  const badHash = [];
  const badSize = [];
  const absent = [];
  for (const [url, f] of saved) {
    const rel = norm(f.path);
    const abs = path.join(ROOT, f.path);
    let st;
    try {
      st = await stat(abs);
    } catch {
      absent.push({ url, rel });
      continue;
    }
    if (typeof f.bytes === "number" && st.size !== f.bytes) {
      badSize.push({ url, rel, ledger: f.bytes, disk: st.size });
    }
    if (f.sha256) {
      const disk = await sha256File(abs);
      if (disk !== f.sha256) badHash.push({ url, rel, ledger: f.sha256, disk });
    }
  }

  if (absent.length) {
    fail("on-disk", `${absent.length} ledger row(s) name a file that does not exist:`);
    list(absent, (a) => `         ${a.rel}  <- ${a.url}`);
  } else {
    ok("on-disk", `all ${saved.length} ledger rows resolve to a file`);
  }

  if (badSize.length || badHash.length) {
    fail(
      "bytes",
      `${badHash.length} sha256 mismatch(es), ${badSize.length} size mismatch(es) — the ledger ` +
        `describes bytes that are not the bytes on disk:`,
    );
    list(badHash, (b) => `         ${b.rel}\n           ledger ${b.ledger}\n           disk   ${b.disk}`);
    list(badSize, (b) => `         ${b.rel}  ledger ${b.ledger} B, disk ${b.disk} B`);
  } else {
    ok("bytes", `sha256 + size verified against disk for ${saved.filter(([, f]) => f.sha256).length} files`);
  }

  const ledgerPaths = new Set(saved.map(([, f]) => norm(f.path)));
  const orphans = [...diskFiles].filter((p) => !ledgerPaths.has(p)).sort();
  if (orphans.length) {
    fail(
      "coverage",
      `${diskFiles.size} files on disk vs ${ledgerPaths.size} in the ledger — ${orphans.length} ` +
        `file(s) nobody can name a URL for (fetched off the books, or a ledger overwritten by a ` +
        `later partial run):`,
    );
    list(orphans, (p) => `         ${p}`);
  } else {
    ok("coverage", `${diskFiles.size} files on disk, all named by the ledger`);
  }

  // inventory.tsv is the human-readable half of the same ledger; if the two
  // disagree, every later citation of "the inventory" is citing a fiction.
  try {
    const tsv = await readFile(path.join(ROOT, "inventory.tsv"), "utf8");
    const rows = tsv.trim().split("\n").slice(1).filter(Boolean);
    const invBad = [];
    const seenUrls = new Set();
    for (const line of rows) {
      const [sha, bytes, p, url] = line.split("\t");
      seenUrls.add(url);
      const f = FILES[url];
      if (!f || !f.path) invBad.push({ url, why: "not in mirror-manifest.json" });
      else if (norm(f.path) !== norm(p)) invBad.push({ url, why: `path ${p} != manifest ${f.path}` });
      else if (f.sha256 && f.sha256 !== sha) invBad.push({ url, why: "sha256 differs from manifest" });
      else if (String(f.bytes) !== String(bytes)) invBad.push({ url, why: "bytes differ from manifest" });
    }
    const missingRows = saved.filter(([url]) => !seenUrls.has(url));
    if (invBad.length || missingRows.length) {
      fail(
        "inventory",
        `inventory.tsv disagrees with mirror-manifest.json: ${invBad.length} bad row(s), ` +
          `${missingRows.length} manifest file(s) absent from the inventory:`,
      );
      list(invBad, (b) => `         ${b.url}\n           ${b.why}`);
      list(missingRows, ([url]) => `         (missing row) ${url}`);
    } else {
      ok("inventory", `inventory.tsv agrees with the manifest on ${rows.length} rows`);
    }
  } catch {
    fail("inventory", "no inventory.tsv next to the bytes (mirror-site.mjs writes one)");
  }

  if (failedRows.length) {
    console.log(
      `  info ${failedRows.length} ledger row(s) record a FAILED fetch — each must be a registered ` +
        `deviation or be re-fetched (--seeds), not a silent hole:`,
    );
    list(failedRows, ([url, f]) => `         ${url}  (${f.error || "no error recorded"})`);
  }
}

// --- gate 3: authenticity ---------------------------------------------------
//
// AN HTTP 200 IS NOT EVIDENCE THAT YOU GOT THE RESOURCE【objectarchive N11】
// ---------------------------------------------------------------------------
// Every other assertion in this file compares THE LEDGER WITH THE DISK. This
// one is orthogonal to all of them: it asks whether the bytes on disk are the
// thing you asked for. Nothing else here can ask that, and the difference is
// not academic —
//
//   Measured (objectandarchive M0b): a whole-site re-crawl at 3 workers tripped
//   the origin's bot challenge. THE CRAWLER WROTE 43 CHALLENGE PAGES UNDER THE
//   URLS OF THE REAL DOCUMENTS, including the one PDP the entire project's
//   reverse engineering was based on. Every one of them was HTTP 200 +
//   text/html, so nothing objected: this gate stayed PASS 0 AND WAS RIGHT ON
//   ITS OWN TERMS — the ledger's sha256 matched the challenge page exactly.
//   A LEDGER RECORDS WHAT YOU FETCHED. IT NEVER RECORDS WHETHER IT IS THE THING
//   YOU ASKED FOR. The files were 9.5 KB where the real documents are 300 KB+,
//   and no assertion anywhere was looking at that.
//
//   The only thing in the whole pipeline that noticed was the BUILD layer's
//   per-transform hit floor (dom-shell-strategies.md §2 step 3): one registered
//   transform reported 4 hits against a floor of 5, because the challenge page
//   does not contain the platform script that transform rewrites. A guard
//   written for an entirely different purpose was the sole objection to the
//   evidence base being swapped out. Do not rely on that happening again.
//
// mirroring.md §9 has carried "catch-all fake 200" and "small-response alarm"
// as prose for four projects. This is their executable form:
//
//   1. INTERSTITIAL — challenge / consent / block bodies carry markers no real
//      page has. Narrow anchors, hard fail, EXTENSIBLE (--interstitial-extra):
//      the table below is a starting set and every vendor invents new ones.
//   2. TYPE CONFUSION — the precise half. A refusal page, a login wall or an
//      SPA fallback served under an image/font/script URL is HTML in a file
//      named .jpg, and magic bytes settle it with no threshold at all.
//      THE ORACLE IS THE LEDGER'S CONTENT-TYPE, NOT THE URL'S EXTENSION. The
//      first version of this keyed on the extension and produced a failure that
//      was not one: that origin serves `font/woff2` bytes at a `.woff` URL. The
//      extension is the origin's own naming choice and promises nothing; what
//      the origin DECLARED does. Keying on the declaration removed the false
//      red and made the assertion stricter at the same time.
//   3. SIZE OUTLIER — a LEAD, printed, never a failure. It is what catches the
//      interstitials nobody has a marker for yet (9.5 KB among 300 KB peers is
//      two orders of magnitude, not a judgement call). It does not FAIL because
//      "peer" is never exactly right on a query-parameterised CDN — a flat
//      swatch and a photograph share ?width=1200 and differ 200x for honest
//      reasons — and making it fail buys one tuning knob and one excuse list,
//      the two things §4 of verification-gates.md says gates go wrong by
//      acquiring. The peer key therefore carries the transform's own size
//      parameters, and the test only runs where a median means something.

// TWO STRENGTHS, and the split is what keeps this gate readable.
//   STRONG — vendor markers that only ever appear IN a challenge body. Applied
//            to every text file regardless of size.
//   WEAK   — markers that also appear on perfectly real pages: a contact form
//            embeds reCAPTCHA, a protected site loads its WAF's own script, a
//            real page mentions its bot vendor. Applied ONLY when the whole
//            document is smaller than WEAK_MAX (a challenge page IS the whole
//            document; a real page that merely contains a captcha widget is
//            not). A false red here is expensive in a specific way: it teaches
//            you to skim this gate's output, which is exactly how the 43
//            challenge pages would survive the next run.
// Region blocks and consent WALLS are deliberately absent: their bodies are not
// distinguishable from a real page's cookie banner by text alone. They are the
// size-outlier lead's job, and --interstitial-extra's once you have seen the
// one your origin serves.
const WEAK_MAX = 32 * 1024;
// Does this body present as an HTML document at all? Cheap and decisive: a
// challenge page is served as a page. Anything that opens with a packer's
// container, an ESM import, or "use strict" is code that happens to contain a
// word, not a refusal.
const looksLikeDocument = (text) => {
  const head = text.slice(0, 2048).trimStart();
  if (/^(?:<!doctype|<html|<\?xml)/i.test(head)) return true;
  return /<html[\s>]/i.test(head) && /<body[\s>]/i.test(text.slice(0, 8192));
};
const INTERSTITIAL = [
  [/_cf_chl_opt|cf-browser-verification|cf_chl_prog|__cf_chl_/, "Cloudflare challenge"],
  [/<title>\s*Just a moment/i, "Cloudflare 'Just a moment'"],
  [/Checking your browser before accessing/i, "browser check"],
  [/Attention Required!\s*\|\s*Cloudflare/i, "Cloudflare block"],
  [/Enable JavaScript and cookies to continue/i, "JS/cookie wall"],
  [/You don't have permission to access|Error 1020|Ray ID:/i, "access denied page"],
  [/_Incapsula_Resource|\/_Incapsula_|Request unsuccessful\. Incapsula/i, "Imperva/Incapsula"],
  [/Reference #[0-9a-f]{2}\.[0-9a-f]{8}\.\d+\.[0-9a-f]+|AkamaiGHost/i, "Akamai block"],
  [/Sucuri WebSite Firewall|sucuri_cloudproxy/i, "Sucuri WAF"],
  [/_pxCaptcha|Please verify you are a human/i, "PerimeterX/HUMAN challenge"],
  [/Pardon Our Interruption|are you a robot/i, "generic bot interstitial"],
  [/unusual traffic from your computer network/i, "rate-limit interstitial"],
  // ⛔ DOMAIN-PARKING LOTS ANSWER 200 AND WEAR THE URL. On a dead-site rescue a
  // parked capture is bytes that honestly hash, honestly close, and are the
  // wrong site entirely — twice measured (Sedo in-window at one target, a
  // Rakko lot overwriting a rescued root at another) with every other gate
  // green. Parking is an interstitial: the page under the URL is not the site.
  [/sedoparking\.com|parkingcrew|hugedomains\.com|rakkoid\.com|domain-parking|dan\.com\/buy/i, "domain-parking lot"],
  [/domain (is )?for sale|buy this domain|売り出し中のドメイン/i, "domain-for-sale page", true],
  // weak — small documents only
  [/g-recaptcha|hcaptcha\.com\/captcha|challenges\.cloudflare\.com\/turnstile/i, "CAPTCHA widget", true],
  [/PerimeterX|DataDome|ddos-guard|incap_ses|ak_bmsc/i, "bot-vendor marker", true],
  [/Access Denied|Forbidden|Rate ?limit/i, "refusal wording", true],
];

if (!SKIP.has("authenticity")) {
  console.log(`\n--- gate AUTHENTICITY (a 200 is not proof you got the resource) ---`);

  const patterns = [...INTERSTITIAL];
  if (INTERSTITIAL_FILE) {
    try {
      let n = 0;
      for (const line of (await readFile(INTERSTITIAL_FILE, "utf8")).split("\n")) {
        const t = line.trim();
        if (!t || t.startsWith("#")) continue;
        // Extra patterns are STRONG: you added them because you saw the body.
        patterns.push([new RegExp(t, "i"), `extra pattern: ${t}`, false]);
        n++;
      }
      console.log(`  info ${n} extra interstitial pattern(s) from ${INTERSTITIAL_FILE}`);
    } catch (e) {
      console.log(`  info could not read --interstitial-extra ${INTERSTITIAL_FILE}: ${e.message}`);
    }
  }

  // 1 + 3 share one walk over the disk.
  const hits = [];
  const sizes = new Map(); // peer group -> [{rel, bytes}]
  for (const rel of diskFiles) {
    const abs = path.join(ROOT, rel);
    let st;
    try {
      st = await stat(abs);
    } catch {
      continue;
    }
    const base = rel.split("/").pop();
    const m = /\.([A-Za-z0-9]{1,6})$/.exec(base);
    const ext = m ? m[1].toLowerCase() : "(none)";
    // PEER GROUP = extension + whatever query parameters legitimately move the
    // size on a transform CDN. Without them, thumbnails read as refusals: keyed
    // on extension alone the first version flagged 24 files, every one of them a
    // real `?width=165` thumbnail two orders of magnitude below the `.jpg`
    // median. A false alarm that size is not a tuning problem, it is the
    // assertion measuring the wrong population.
    const stem = base.replace(/\.[A-Za-z0-9]{1,6}$/, "");
    const dims = [...stem.matchAll(/[?&@](width|height|w|h|size|dpr|quality|q|format|fm)=([\w.-]+)/gi)]
      .map((d) => `${d[1].toLowerCase()}=${d[2].toLowerCase()}`)
      .sort()
      .join("&");
    const group = dims ? `${ext}@${dims}` : ext;
    if (!sizes.has(group)) sizes.set(group, []);
    sizes.get(group).push({ rel, bytes: st.size });

    // Interstitials are HTML/text and small; skipping the rest keeps this cheap.
    const led = ledgerByPath.get(rel);
    const verdict = textRefVerdict({ url: rel, contentType: led?.type || "" });
    if (verdict === false) continue;
    if (st.size > 512 * 1024) continue;
    const head = await readHead(abs, 8192);
    if (!head || !sniffTextBytes(head)) continue;
    const text = head.toString("utf8");
    for (const [re, what, weak] of patterns) {
      // ⛔ A weak marker may only fire on something that could BE a challenge
      // page, and a challenge page is an HTML DOCUMENT. Size alone is not that
      // test: a 28 KB JavaScript chunk is under WEAK_MAX, and Next.js ships
      // `forbidden()` as an API name plus HTTP status constants, so "refusal
      // wording" matched a perfectly real bundle. ⚠ A false red here is
      // expensive in a specific way — it teaches you to skim this gate, which is
      // exactly how the 43 real challenge pages would survive the next run.
      //
      // ⭐ Strong markers still apply to every text file: a challenge body
      // served at a .js path is precisely the case they exist for.
      if (weak && (st.size > WEAK_MAX || !looksLikeDocument(text))) continue;
      if (re.test(text)) {
        hits.push(`${rel} — ${what}${weak ? ` (weak marker, ${st.size} B document)` : ""}`);
        break;
      }
    }
  }

  if (hits.length) {
    fail(
      "interstitial",
      `${hits.length} mirrored file(s) are a GATE, not the resource — the origin answered with a ` +
        `challenge/consent/block page under HTTP 200 and it was written at the resource's own path:`,
    );
    list(hits, (h) => `         ${h}`);
    console.log(
      `         Re-fetch them slowly (mirror-site.mjs --seeds urls.txt --workers 1) and re-run.\n` +
        `         If the origin only ever answers a challenge there, that is a MIRRORING FAILURE\n` +
        `         to register — not a file to keep. A challenge body sitting at a real document's\n` +
        `         path is a FABRICATED FILE in the sense of mirroring.md §2, exactly like a\n` +
        `         followed 301: the origin never served that body at that URL.`,
    );
  } else {
    ok("interstitial", `no mirrored file matches a known challenge/block body (${patterns.length} patterns)`);
  }

  // 2. TYPE CONFUSION — declared type vs magic bytes.
  const SIGS = {
    png: (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    jpeg: (b) => startsWith(b, [0xff, 0xd8, 0xff]),
    gif: (b) => startsWith(b, [0x47, 0x49, 0x46, 0x38]),
    webp: (b) => startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x45, 0x42, 0x50], 8),
    bmp: (b) => startsWith(b, [0x42, 0x4d]),
    ico: (b) => startsWith(b, [0x00, 0x00, 0x01, 0x00]),
    avif: (b) => startsWith(b, [0x66, 0x74, 0x79, 0x70], 4),
    woff2: (b) => startsWith(b, [0x77, 0x4f, 0x46, 0x32]),
    woff: (b) => startsWith(b, [0x77, 0x4f, 0x46, 0x46]),
    otf: (b) => startsWith(b, [0x4f, 0x54, 0x54, 0x4f]),
    // ⚠ "OTTO" too: an OpenType/CFF font served under a .ttf name with
    // `font/ttf` is the ORIGIN'S labeling habit, not corruption — the bytes are
    // a real font. Measured on hubtown: commit-mono-bold.ttf is OTTO/CFF, and
    // rejecting it told the operator to re-fetch a file that was already right.
    ttf: (b) => startsWith(b, [0x00, 0x01, 0x00, 0x00]) || startsWith(b, [0x74, 0x72, 0x75, 0x65]) || startsWith(b, [0x4f, 0x54, 0x54, 0x4f]),
    // ⚠ MP4 is a BOX format, not one magic. A whole file opens with `ftyp` at
    // offset 4, but fragmented-MP4 HLS segments (.m4s) open with `styp`, a bare
    // `moof`/`sidx`/`prft`, or an `emsg` box — same family, no `ftyp` anywhere.
    // Measured on rauchg: 45 real twimg .m4s segments declared video/mp4 were
    // flagged "not mp4" and the gate demanded a refetch of already-right bytes.
    mp4: (b) => {
      const box = Buffer.from(b.subarray(4, 8)).toString("latin1");
      return ["ftyp", "styp", "moof", "sidx", "prft", "emsg", "free", "skip", "mdat", "moov"].includes(box);
    },
    webm: (b) => startsWith(b, [0x1a, 0x45, 0xdf, 0xa3]),
    ogg: (b) => startsWith(b, [0x4f, 0x67, 0x67, 0x53]),
    wav: (b) => startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x41, 0x56, 0x45], 8),
    wasm: (b) => startsWith(b, [0x00, 0x61, 0x73, 0x6d]),
    gz: (b) => startsWith(b, [0x1f, 0x8b]),
    zip: (b) => startsWith(b, [0x50, 0x4b, 0x03, 0x04]),
    pdf: (b) => startsWith(b, [0x25, 0x50, 0x44, 0x46]),
    glb: (b) => startsWith(b, [0x67, 0x6c, 0x54, 0x46]),
  };
  // Declared type -> which signature must match. Order matters: woff2 before
  // woff, avif before the generic image types.
  const KIND_BY_TYPE = [
    [/woff2/, "woff2"],
    [/woff/, "woff"],
    [/otf|opentype/, "otf"],
    [/ttf|truetype/, "ttf"],
    [/avif|heic/, "avif"],
    [/png/, "png"],
    [/jpe?g/, "jpeg"],
    [/gif/, "gif"],
    [/webp/, "webp"],
    [/x-icon|vnd\.microsoft\.icon/, "ico"],
    [/bmp/, "bmp"],
    [/mp4|quicktime/, "mp4"],
    [/webm|matroska/, "webm"],
    [/ogg/, "ogg"],
    [/wav/, "wav"],
    [/wasm/, "wasm"],
    [/gzip/, "gz"],
    [/zip/, "zip"],
    [/pdf/, "pdf"],
    [/model\/gltf-binary/, "glb"],
  ];
  const EXT_KIND = { jpg: "jpeg", jpeg: "jpeg", htm: null, html: null, svg: null, tif: null };
  const declaredKind = (type, rel) => {
    const t = String(type || "").toLowerCase();
    if (t) {
      for (const [re, kind] of KIND_BY_TYPE) if (re.test(t)) return kind;
      return null; // declared, but not a signature we check
    }
    // NO DECLARATION AT ALL is the only case where the extension is consulted.
    const m = /\.([A-Za-z0-9]{1,6})$/.exec(rel);
    const e = m ? m[1].toLowerCase() : "";
    if (e in EXT_KIND) return EXT_KIND[e];
    return SIGS[e] ? e : null;
  };
  const BINARY_DECL = /^(image|font|audio|video|model)\//i;
  const CODE_DECL = /(javascript|ecmascript|\/css)/i;
  const HTMLISH = /^\s*(<!doctype html|<html|<\?xml[^>]*\?>\s*<html)/i;

  const confused = [];
  for (const [url, f] of saved) {
    const rel = f.path && norm(f.path);
    if (!rel || !diskFiles.has(rel)) continue;
    const type = String(f.type || "");
    const kind = declaredKind(type, rel);
    // SVG is an image that is text — never magic-byte it.
    if (/svg/i.test(type)) continue;
    const isBinary = BINARY_DECL.test(type) || kind !== null;
    const isCode = CODE_DECL.test(type) || (!type && /\.(js|mjs|cjs|css)$/i.test(rel));
    if (!isBinary && !isCode) continue;
    const head = await readHead(path.join(ROOT, rel), 512);
    if (!head || !head.length) continue;
    if (kind && SIGS[kind] && !SIGS[kind](head)) {
      // ⚠ Like OTTO under .ttf above: bytes that are a REAL image of another
      // known format, declared image/*, are the ORIGIN'S labeling habit, not a
      // refusal body. Measured on a Strapi bucket: a 2.8 MB GIF uploaded as
      // .jpg, served as image/jpeg, byte-identical on refetch. The gate exists
      // to catch HTML under an asset URL, not to police extension hygiene —
      // so this downgrades to a lead the operator can read, not a failure.
      const IMG_KINDS = ["png", "jpeg", "gif", "webp", "avif", "bmp", "ico"];
      const actual = IMG_KINDS.find((k) => SIGS[k](head));
      if (BINARY_DECL.test(type) && /^image\//i.test(type) && actual) {
        console.log(`  info cross-image mislabel — ${rel} declared ${type}, bytes are ${actual} (origin's own labeling; refetch to confirm identical bytes)`);
      } else confused.push(
        `${rel}\n           declared ${type || "(nothing — extension used)"}, bytes are not ${kind}  <- ${url}`,
      );
    } else if (!kind && HTMLISH.test(head.toString("utf8"))) {
      confused.push(`${rel}\n           declared ${type || "(none)"}, body is an HTML document  <- ${url}`);
    }
  }
  if (confused.length) {
    fail("type-confusion", `${confused.length} file(s) do not contain the kind of bytes the origin declared:`);
    list(confused, (c) => `         ${c}`);
    console.log(
      `         An HTML body under an image / font / script URL is a refusal page, a login wall\n` +
        `         or an SPA catch-all — not the asset. Re-fetch (Referer? cookies? rate limit?)\n` +
        `         or register the URL as unfetchable; do not leave the wrong bytes on disk.`,
    );
  } else {
    ok("type-confusion", "every declared image / font / media / script body matches its own magic bytes");
  }

  // 3. SIZE OUTLIER — a lead to read, never a verdict.
  const outliers = [];
  for (const [group, files] of sizes) {
    if (files.length < 8) continue; // a median needs a population
    const sorted = [...files].sort((a, b) => a.bytes - b.bytes);
    const median = sorted[Math.floor(sorted.length / 2)].bytes;
    if (median < 4096) continue; // tiny-file groups (icons, stubs) have no useful floor
    for (const f of files) if (f.bytes < median * 0.05) outliers.push({ ...f, group, median });
  }
  if (outliers.length) {
    console.log(
      `  info ${outliers.length} small-response lead(s) — far below their peers. NOT a failure: read\n` +
        `       each one and confirm it is honestly small (a swatch, a stub, a short feed) rather\n` +
        `       than a refusal body nobody has a pattern for yet:`,
    );
    list(outliers, (o) => `         ${o.rel}  ${o.bytes} B  (peer group ${o.group}, median ${o.median} B)`);
  } else {
    ok("size-outlier", "no file is a small-response outlier among its peers");
  }
}

// --- gate 4: closure --------------------------------------------------------

if (!SKIP.has("closure")) {
  console.log(`\n--- gate CLOSURE (reference set − disk set = ∅) ---`);

  // AN EXCUSE'S MATCHING GRANULARITY IS ITS OWN FAILURE MODE【objectarchive N9】
  // ---------------------------------------------------------------------
  // This list used to be matched by PREFIX, every line. Registering "this
  // base-URL literal is not a file" then silently registered "nothing missing
  // under this directory needs reporting". Measured: one
  // `NOTFILE …/8914/files` line — the base a compositor concatenates onto —
  // sat exactly above the shop's own uploaded assets, and excused a whole
  // subtree (fonts + 122 frame PNGs) from the closure gate. A gate's excuse
  // list is easier to make too wide than its assertion is.
  //
  // So an excuse now means exactly what it is written as:
  //   host only  (`telemetry.example.net`, `https://telemetry.example.net/`)
  //              -> the whole host is excused. That is what "accepted
  //                 degradation / stubbed vendor" decides, at host scope.
  //   full URL   (`https://cdn.example.com/a/8914/files`)
  //              -> EXACT. It excuses itself and nothing below it.
  //   trailing * (`https://cdn.example.com/legacy/pack/*`)
  //              -> prefix, DECLARED. Listed loudly on every run, because each
  //                 one is a subtree nobody is checking any more.
  const exact = new Set(); // scheme-stripped, fragment-stripped URLs
  const hostWide = new Set();
  const prefixes = []; // { bare, raw } — opt-in via trailing "*"
  // Compare without scheme: the same asset is written http:// and https:// in
  // different files, and an excuse is about the asset, not the scheme.
  const bare = (s) => String(s).replace(/^https?:\/\//i, "").replace(/^\/\//, "").split("#")[0];
  if (ALLOW_FILE) {
    try {
      for (const line of (await readFile(ALLOW_FILE, "utf8")).split("\n")) {
        const t = line.trim();
        if (!t || t.startsWith("#")) continue;
        // external.txt has no single fixed column order in the wild. This
        // toolchain's own template writes "<DECISION> | <target> | why", the
        // older shape was "<url or host> <decision> …". Splitting on BOTH the
        // pipe and whitespace and taking the first URL-or-host-looking token
        // reads either. Measured: with the old first-token-only rule, a whole
        // external.txt parsed to ZERO prefixes and the gate silently ran with
        // an empty allow-list, so its CLOSURE failures could never be excused
        // no matter what the file said.
        //
        // A MIRROR decision is deliberately NOT an excuse: that decision says
        // "this host's files are on disk", so a missing one is a real hole.
        // Only the not-a-file / degraded / stubbed / content decisions excuse.
        // Decisions outside the vocabulary (a project may add its own —
        // OUTSCOPE, NOTFETCHED…) fall through and are read as excuses, with
        // the same exact-unless-declared granularity.
        const cells = t.split(/[|\s]+/).filter(Boolean);
        const decision = /^(MIRROR|STUB|DEGRADE|CONTENT|LATENT|NOTFILE)$/i.exec(cells[0] || "");
        if (decision && /^MIRROR$/i.test(decision[0])) continue;
        const tok = cells.find(
          (c) => /^https?:\/\//i.test(c) || /^[a-z0-9.-]+\.[a-z]{2,}(\/|$|\*)/i.test(c),
        );
        if (!tok) continue;
        const b = bare(tok);
        if (b.endsWith("*")) prefixes.push({ bare: b.slice(0, -1), raw: tok });
        else if (!b.replace(/\/+$/, "").includes("/")) hostWide.add(b.replace(/\/+$/, "").toLowerCase());
        else exact.add(b);
      }
      console.log(
        `  info excuses from ${ALLOW_FILE}: ${exact.size} exact URL(s), ${hostWide.size} whole-host, ` +
          `${prefixes.length} declared prefix(es)`,
      );
      // Each declared prefix is a piece of the mirror this gate stops auditing.
      // Say so every run: an unread excuse is how the subtree hole got in.
      for (const p of prefixes) {
        console.log(`       prefix excuse (subtree NOT audited): ${p.raw}`);
      }
    } catch (e) {
      console.log(`  info could not read --allow-missing ${ALLOW_FILE}: ${e.message}`);
    }
  }
  const allowed = (url) => {
    const b = bare(canonicalUrl(url));
    if (exact.has(b)) return true;
    if (hostWide.has(b.split("/")[0].toLowerCase())) return true;
    return prefixes.some((p) => b.startsWith(p.bare));
  };

  // Hosts worth resolving: every host the ledger already contains, plus --hosts.
  const hosts = new Set([ORIGIN_HOST, ...flag("hosts", "").split(",").map((s) => s.trim()).filter(Boolean)]);
  for (const [url] of saved) {
    try {
      hosts.add(new URL(url).hostname);
    } catch {}
  }
  const extract = createRefExtractor({ origin: ORIGIN, originHost: ORIGIN_HOST, assetHosts: hosts });

  // A mirrored file's own URL is its base, so relative refs (CSS url()) resolve
  // the way the browser resolved them.
  const pathToUrl = new Map();
  for (const [url, f] of saved) pathToUrl.set(norm(f.path), url);

  const refs = new Map(); // url -> Set(referrer)
  let scanned = 0;
  let sniffed = 0;
  for (const rel of diskFiles) {
    const abs = path.join(ROOT, rel);
    // Declared type (the origin's own statement, via the ledger) beats the
    // extension; the bytes are consulted only when neither can rule — an
    // extensionless route, an orphan file, application/octet-stream.
    // The extension hint comes from the LOCAL PATH, not the URL: the mapping
    // preserves extensions and adds `/index.html` for extension-less pages, so
    // the path is never less informative than the URL and often more.
    const led = ledgerByPath.get(rel);
    let isText = textRefVerdict({ url: rel, contentType: led?.type || "" });
    if (isText === null) {
      isText = sniffTextBytes(await readHead(abs));
      if (isText) sniffed++;
    }
    if (!isText) continue;
    const st = await stat(abs);
    if (st.size > 16 * 1024 * 1024) continue;
    scanned++;
    const base = pathToUrl.get(rel) || ORIGIN + "/" + rel;
    for (const u of extract(await readFile(abs, "utf8"), base)) {
      if (!refs.has(u)) refs.set(u, new Set());
      refs.get(u).add(rel);
    }
  }

  const missing = [];
  for (const [url, from] of refs) {
    if (allowed(url)) continue;
    let rel;
    try {
      rel = localRelPath(url, ORIGIN_HOST, POLICY);
    } catch {
      continue;
    }
    if (!diskFiles.has(rel)) missing.push({ url, rel, from: [...from].slice(0, 2) });
  }

  console.log(
    `  info scanned ${scanned} text files (${sniffed} of them identified by sniffing the bytes, ` +
      `not by extension), ${refs.size} distinct references`,
  );
  if (missing.length) {
    const byHost = new Map();
    for (const m of missing) {
      const h = new URL(m.url).hostname;
      if (!byHost.has(h)) byHost.set(h, []);
      byHost.get(h).push(m);
    }
    fail("closure", `${missing.length} reference(s) resolve to nothing on disk:`);
    for (const [h, rows] of [...byHost].sort((a, b) => b[1].length - a[1].length)) {
      console.log(`         ${h}  (${rows.length})`);
      list(rows, (m) => `           ${m.url}\n             <- ${m.from.join(", ")}`);
    }
    // ⭐ The console listing is TRUNCATED (MAX_REPORT), and the natural next
    // step is "pipe the missing URLs into mirror-site --seeds" — which, fed
    // from the truncated listing, seeds the same first page of the gap every
    // round while the gate keeps failing. Measured: four seed rounds at a
    // constant 32 URLs against a 384-reference gap, converging on nothing.
    // The ACTIONABLE artefact must be complete, so it goes to a file.
    const gapFile = path.join(ROOT, "closure-gap.txt");
    await writeFile(gapFile, missing.map((m) => m.url).join("\n") + "\n");
    console.log(`         complete list -> ${path.relative(process.cwd(), gapFile)}  (${missing.length} URLs, ready for --seeds)`);
    console.log(
      `         Each must be fetched (mirror-site.mjs --seeds) or get a line in the mirror's\n` +
        `         external.txt and be excused here with --allow-missing. One line excuses one\n` +
        `         URL: a base-literal excuse does NOT cover the files under it. Write the\n` +
        `         prefix as "<base>/*" only when you mean "stop auditing this subtree".`,
    );
  } else {
    ok("closure", "reference set − disk set = ∅");
  }
}

// --- gate 5: sampled re-fetch (opt-in) --------------------------------------

if (!SKIP.has("resample") && RESAMPLE > 0) {
  console.log(`\n--- gate RESAMPLE (${RESAMPLE} URLs, ${RESAMPLE_DELAY} ms apart) ---`);
  // Deterministic sample so a failing run can be repeated exactly; change the
  // set with --resample-seed.
  let s = RESAMPLE_SEED >>> 0 || 1;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const pool = saved
    .filter(([, f]) => f.sha256)
    .filter(([, f]) => RESAMPLE_HTML || !/\.html?$/i.test(f.path))
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const picked = [];
  const used = new Set();
  while (picked.length < Math.min(RESAMPLE, pool.length)) {
    const i = Math.floor(rnd() * pool.length);
    if (used.has(i)) continue;
    used.add(i);
    picked.push(pool[i]);
  }
  if (!RESAMPLE_HTML) {
    console.log(`  info HTML excluded (nonces/session tokens make it differ every request); --resample-html to include`);
  }

  const differ = [];
  const errored = [];
  for (const [url, f] of picked) {
    try {
      const res = await fetch(url, {
        headers: { "user-agent": UA, accept: "*/*", referer: ORIGIN + "/" },
        redirect: "manual",
      });
      if (res.status >= 300) {
        errored.push({ url, why: `HTTP ${res.status}` });
      } else {
        const buf = Buffer.from(await res.arrayBuffer());
        const sha = createHash("sha256").update(buf).digest("hex");
        if (sha !== f.sha256) differ.push({ url, ledger: f.sha256, live: sha, bytes: [f.bytes, buf.length] });
      }
    } catch (e) {
      errored.push({ url, why: e.message });
    }
    await new Promise((r) => setTimeout(r, RESAMPLE_DELAY));
  }

  if (differ.length) {
    fail("resample", `${differ.length}/${picked.length} sampled URL(s) no longer match the ledger:`);
    list(
      differ,
      (d) =>
        `         ${d.url}\n           ledger ${d.ledger} (${d.bytes[0]} B)\n           live   ${d.live} (${d.bytes[1]} B)`,
    );
    console.log(
      `         A transform CDN may legitimately re-encode over time — but a DIFFER on a\n` +
        `         content-hashed or versioned URL means the mirror and the origin have parted.`,
    );
  } else {
    ok("resample", `${picked.length}/${picked.length} sampled URLs still byte-identical to the ledger`);
  }
  if (errored.length) {
    console.log(`  info ${errored.length} sample(s) could not be compared:`);
    list(errored, (e) => `         ${e.url}  (${e.why})`);
  }
} else if (!SKIP.has("resample")) {
  console.log(`\n--- gate RESAMPLE — skipped (--resample N to re-check N URLs against the live origin) ---`);
}

// ---------------------------------------------------------------------------

console.log(
  `\n${failures ? "FAIL" : "PASS"} — ${failures} mirror-level problem(s). ` +
    `A green run here is what makes the downstream render-level gates mean something.`,
);
process.exit(failures ? 1 : 0);
