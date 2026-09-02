#!/usr/bin/env node
/**
 * make-standalone.mjs — give src/ everything it needs to run somewhere else.
 *
 * ⛔ The no-copy policy REVERSES at this stage. Through M(n) the mirror is the
 * one asset store and nothing duplicates it, because two copies of an asset is
 * two things that can disagree with the evidence. The deliverable has the
 * opposite requirement: copy src/ anywhere, run it, and the site comes up.
 *
 * ⚠ Copy what the built page REFERENCES, not the whole mirror. The mirror also
 * holds forensic material — the beautified bundles, the ledgers, the origin's
 * own bundle that this port replaces — and shipping those would put the thing
 * the port replaced right back next to it.
 *
 *   node tools/make-standalone.mjs --shell site/airpods-pro/index.html --out src
 */
import { readFile, writeFile, mkdir, readdir, cp, stat } from "node:fs/promises";
import * as fssync from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { localRelPath, loadPolicy } from "../scripts/lib/urlpath.mjs";

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf("--" + n); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d; };
// ⛔ NOT one page. A whole-site port has as many shells as it has routes, and a
// default naming a previous project's page is how a tool teaches you the wrong
// shape. --shell takes a FILE, a comma list, or a DIRECTORY (walked for .html).
// ⛔ NO DEFAULT. `--shell` used to default to "site", so a bare invocation to
// read the usage EXECUTED the defaults and copied a 1.27 GB mirror into
// src/public/ (14islands F15). A tool that writes gigabytes must be told to.
const SHELL = flag("shell", null);
const NO_BUILD = process.argv.includes("--no-build");
// --keep-own: the port's own paths are EXPECTED (not mirror holes) but the
// shells are NOT rewritten to a single BUILD_OUT. The rewrite semantics assume
// one bundled build output; a verbatim multi-chunk port (25 re-emitted webpack
// chunks) has none — with --own alone every <script src> was pointed at the
// FIRST own path, ten chunks loaded instead of 25, the first paint was blank,
// and probe reported CLEAN with zero failed requests (14islands F17: only the
// pixel gate's non-empty-frame precondition spoke). Verbatim-chunk ports use
// this mode.
const KEEP_OWN = process.argv.includes("--keep-own");
if (!SHELL) {
  console.error("usage: make-standalone.mjs --shell <file|a,b|dir> [--out src] [--own /path,...] [--keep-own] [--no-build] [--build-out /app.js] [--replaced /old.js] [--externals a,b] [--allow mirror/external.txt] [--stub-ext-hosts h,h] [--ext-hosts h,h] [--origin-host h] [--name n] [--serve-port n]");
  process.exit(2);
}
// ⭐ `--mirror a,b,c` is a CHAIN, same contract as serve.mjs --fallback-root:
// the negotiated-variant tree sits above the read-only mirror, and the copy
// must take each file from the FIRST root that holds it — otherwise the
// deliverable ships the `*/*` fallback bytes the browser never sees
// (raycastkbd: 42 next/image rungs live in mirror-negotiated/).
const MIRRORS = flag("mirror", "mirror").split(",").map((s) => s.trim()).filter(Boolean).map((p) => path.resolve(p));
const MIRROR = MIRRORS[0];
const OUT = path.resolve(flag("out", "src"));
// The origin bundle this port replaces. ⛔ It must not travel with the
// deliverable: shipping the thing you replaced next to its replacement makes
// "which one is running" a question the reader has to answer by experiment.
const REPLACED = flag("replaced", "");
// Paths this project PRODUCES rather than mirrors — the port's build output, and
// anything else the shell config lists under `extras`. They are not expected in
// the mirror and must not be reported as missing.
// ⚠ Pass the same values the transform table writes. If the two drift apart,
// this tool reports the port's own bundle as a hole in the deliverable.
const OWN = flag("own", "").split(",").map((x) => x.trim()).filter(Boolean);
// Where the deliverable's own build lands INSIDE public/, and what esbuild must
// leave unresolved. Both are per-project facts; defaults suit a project whose
// port is served at /app.js.
const BUILD_OUT = flag("build-out", OWN[0] || "/app.js");
const EXTERNALS = flag("externals", "").split(",").map((x) => x.trim()).filter(Boolean);
const SERVE_PORT = flag("serve-port", "6190");
const STUB_HOSTS = flag("stub-ext-hosts", "").split(",").map((x) => x.trim()).filter(Boolean);
const EXT_HOSTS_FLAG = flag("ext-hosts", "").split(",").map((x) => x.trim()).filter(Boolean);
const ORIGIN_HOST_FLAG = flag("origin-host", "");
// The deliverable's own name: the project directory unless told otherwise.
const NAME = flag("name", path.basename(process.cwd()).replace(/-rebuild$/, "") + "-src");
// --allow FILE — the registered-deviation list the mirror gates consume
// (mirror/external.txt): a URL the ORIGIN ITSELF answers 404 is a recorded
// deviation, not a hole for this tool to invent a file for. Exact pathname
// match only, same contract as verify-refs-served.
const ALLOW = new Set();
{
  const f = flag("allow", null);
  if (f && fssync.existsSync(f)) {
    for (const line of fssync.readFileSync(f, "utf8").split("\n")) {
      const s = line.trim();
      if (!s || s.startsWith("#")) continue;
      try { ALLOW.add(new URL(s).pathname); } catch { if (s.startsWith("/")) ALLOW.add(s); }
    }
  }
}
const PUBLIC = path.join(OUT, "public");

async function shellList(spec) {
  const out = [];
  for (const part of spec.split(",").map((x) => x.trim()).filter(Boolean)) {
    const abs = path.resolve(part);
    const st = await stat(abs).catch(() => null);
    if (!st) { console.error(`FATAL: --shell names ${part}, which does not exist`); process.exit(2); }
    if (st.isFile()) { out.push({ abs, root: path.dirname(abs) }); continue; }
    const walk = async (d) => {
      for (const e of await readdir(d, { withFileTypes: true })) {
        const p2 = path.join(d, e.name);
        if (e.isDirectory()) await walk(p2);
        else if (e.name.endsWith(".html")) out.push({ abs: p2, root: abs });
      }
    };
    await walk(abs);
  }
  return out;
}
const SHELLS = await shellList(SHELL);
if (!SHELLS.length) { console.error(`FATAL: --shell ${SHELL} matched no .html`); process.exit(2); }
console.log(`  ${SHELLS.length} shell(s) from ${SHELL}`);
const htmls = await Promise.all(SHELLS.map((s2) => readFile(s2.abs, "utf8")));
const html = htmls.join("\n");   // one view, for the reference report only

// ⛔ COPY FROM THE LEDGER, NOT FROM THE DOCUMENT. Scanning the document's own
// src/href/srcset finds what the HTML names — and misses everything a script
// requests at runtime. Measured: the document scan copied 491 files and the
// out-of-repo copy came up with 17 page errors while the in-repo build had 1.
// "It built" said nothing, exactly as the gate warns.
//
// The ledger is the authority on completeness (asset-management.md §0.5), so the
// deliverable takes every mirrored file except the forensic material — the
// beautified bundles, the ledgers themselves, and the origin bundle this port
// replaces, which must not travel back alongside its own replacement.
const EXCLUDE = [/^_pretty\//, /^mirror-manifest\.json$/, /^inventory\.tsv$/, /^netcapture\.tsv$/, /^redirects\.tsv$/, /^urlpath-policy\.json$/, /^external\.txt$/];

// The document's own references are still collected — not to decide what to
// copy, but to report what it names that the mirror does not have.
const refs = new Set();
// ⛔ HTML attribute values are ENTITY-ENCODED. A srcset candidate reads
// `…?auto=format&amp;w=3840` in the document and `…&w=3840` on disk; without
// decoding, 628 present variants were reported as "page links outside the
// mirror" (14islands F15). Same decode the mirror gates apply.
const decodeEntities = (v) => v.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
// ⛔ KEEP THE QUERY. The mirror's url->path mapping is query-aware
// (lib/urlpath.mjs), so `/x.woff2?dpl=…` and `/x.woff2` are different files —
// and dropping the query here reported 524 present fonts as missing, every one
// of them sitting on disk under its query-suffixed name.
for (const m of html.matchAll(/(?:src|href|content|data-[\w-]*)="(\/[^"#]+)/g)) refs.add(decodeEntities(m[1]));
for (const m of html.matchAll(/url\((["']?)(\/[^)"']+)/g)) refs.add(decodeEntities(m[2]));
for (const m of html.matchAll(/(?:srcset|data-srcset)="([^"]+)"/g)) {
  for (const part of m[1].split(",")) {
    const u = decodeEntities(part.trim().split(/\s+/)[0]);
    if (u.startsWith("/")) refs.add(u);
  }
}

// --- copy the ledger ---------------------------------------------------------
// Manifests merge FIRST-ROOT-WINS per URL; the ledger is the union of every
// root's inventory, each rel path remembered with the root that owns it.
const MANIFEST = { files: {} };
const OWNER = new Map(); // rel path -> root dir that holds it (first wins)
for (const root of MIRRORS) {
  const mf = JSON.parse(await readFile(path.join(root, "mirror-manifest.json"), "utf8").catch(() => "{}"));
  if (mf.origin && !MANIFEST.origin) MANIFEST.origin = mf.origin;
  for (const [u, rec] of Object.entries(mf.files || {})) if (!(u in MANIFEST.files)) MANIFEST.files[u] = rec;
  const inv = await readFile(path.join(root, "inventory.tsv"), "utf8").catch(() => "");
  for (const l of inv.split("\n").slice(1)) { const rel = l.split("\t")[2]; if (rel && !OWNER.has(rel)) OWNER.set(rel, root); }
}
const ORIGIN_URL = (MANIFEST.origin || "https://example.invalid").replace(/\/$/, "") + "/";
const ORIGIN_HOST = new URL(ORIGIN_URL).hostname;
const POLICY = await loadPolicy(MIRROR);
const inRoots = (rel) => MIRRORS.map((r) => path.join(r, rel));

const ledger = [...OWNER.keys()];

// ⭐ BYTE MANIFEST — the deliverable carries its own per-file sha256 ledger,
// and the generated check/build/serve scripts re-verify it EVERY run. Between
// "copied at M(n+1)" and "used months later" nothing else re-reads a byte:
// runtime gates ask "does it render", never "are the bytes still the ones that
// were verified" — a silently edited JS or a bit-rotted image passes every
// probe. Measured pattern (hashgraphvc, Codex runtime): verify-then-materialize
// on every build turns the copy from "audited once" into "self-auditing".
// The hash is taken from the DESTINATION file after the copy — it pins what
// actually landed, not what was intended to land.
const BYTE_MANIFEST = {};
// Only a project that HAS an own build gets unpinned paths — without --own,
// BUILD_OUT is a default that names no real file, and listing it makes the
// checker report a phantom "own-build path" on every verbatim-only project.
const UNVERIFIED = new Set((OWN.length ? (KEEP_OWN ? OWN : OWN.concat(BUILD_OUT)) : []).map((p2) => "public" + (p2.startsWith("/") ? p2 : "/" + p2)));
const posixRel = (rel) => rel.split(path.sep).join("/");
const hashFile = (p2) => new Promise((res, rej) => {
  const h = createHash("sha256");
  fssync.createReadStream(p2).on("data", (c) => h.update(c)).on("end", () => res(h.digest("hex"))).on("error", rej);
});
const recordCopy = async (to, relUnderPublic, size) => {
  const key = "public/" + posixRel(relUnderPublic);
  // The port's own build output is REBUILT by `npm run build` — pinning its
  // hash would fail the very next build. It is listed as unverified instead.
  if (UNVERIFIED.has(key)) return;
  BYTE_MANIFEST[key] = { sha256: await hashFile(to), bytes: size };
};

let copied = 0, bytes = 0, skipped = 0;
for (const rel of ledger) {
  if (EXCLUDE.some((re) => re.test(rel))) { skipped++; continue; }
  if (rel === REPLACED.replace(/^\//, "")) { skipped++; continue; }
  const from = path.join(OWNER.get(rel) || MIRROR, rel);
  const st = await stat(from).catch(() => null);
  if (!st || !st.isFile()) continue;
  const to = path.join(PUBLIC, rel);
  await mkdir(path.dirname(to), { recursive: true });
  await cp(from, to);
  await recordCopy(to, rel, st.size);
  copied++; bytes += st.size;
}

let missing = [];
for (const ref of refs) {
  // ⛔ NOT a hardcoded path. The first version skipped `/assets/js/` because that
  // is where one project happened to put its build; on the next project, whose
  // build lands in `/_next/static/chunks/`, the port's own output was reported
  // as a missing ASSET — as a hole in the deliverable. It IS the deliverable.
  // Anything this project emits is declared with --own.
  if (OWN.some((o) => ref === o || ref.startsWith(o.endsWith("/") ? o : o + "/"))) continue;
  // ⚠ A directory-style URL is a PAGE, not a missing file. `/at/airpods-pro/`
  // resolves to that directory's index.html the way the crawler stored it, and
  // treating it as absent reported 185 "missing" references that were mostly
  // the locale switcher's hreflang alternates.
  // ⭐ Resolve through the SAME mapping the crawler and the server use. A naive
  // path join is a second implementation of url->path, and a second
  // implementation is a disagreement waiting to be reported as a hole.
  const mapped = (() => {
    try { return localRelPath(new URL(ref, ORIGIN_URL).href, ORIGIN_HOST, POLICY); } catch { return null; }
  })();
  const bare = ref.split("?")[0].replace(/^\//, "");
  // ⚠ `/ext/<host>/…` is the SERVING convention for a mirrored external host;
  // on disk that host's files live under `assets/<host>/…`. The two spellings
  // are the same asset, and only the server knew it — which is why 92 images
  // that are present were reported as holes in the deliverable.
  // ⚠ A bare `/ext/<host>` with NO path is a LOCALIZED CONNECTION HINT — a
  // preconnect/dns-prefetch whose href was a host root. A connection is not a
  // file; reporting it as a hole tells the operator to mirror nothing. (The
  // host's TLD also reads as a file extension to the page/asset classifier —
  // `.com` passes /\.[a-z0-9]{2,5}$/ — so it lands on the ASSET side there.)
  if (/^ext\/[^/]+\/?$/.test(bare)) continue;
  const extForm = /^ext\/([^/]+)\/(.*)$/.exec(bare);
  // ⚠ A STUBBED host's reference is answered by the SERVER (empty body), not by
  // a file — that is the entire point of --stub-ext-hosts. Reporting it as a
  // hole in the deliverable tells the operator to go mirror a tracking script
  // that was deliberately excluded and registered.
  if (extForm && STUB_HOSTS.includes(extForm[1])) continue;
  const candidates = [
    ...(mapped ? [...inRoots(mapped), ...inRoots(path.join(mapped, "index.html"))] : []),
    ...(ref.endsWith("/") ? inRoots(path.join(bare, "index.html"))
                          : [...inRoots(bare), ...inRoots(path.join(bare, "index.html"))]),
    ...(extForm ? inRoots(path.join("assets", extForm[1], extForm[2])) : []),
  ].flatMap((c) => {
    // ⚠ A reference is PERCENT-ENCODED; the file on disk is not. `Group%20633683.svg`
    // and `Group 633683.svg` are the same asset, and 36 of them were reported
    // missing purely for being spelled the way a URL must spell them.
    let dec = null;
    try { dec = decodeURIComponent(c); } catch {}
    return dec && dec !== c ? [c, dec] : [c];
  });
  let from = null, st = null;
  for (const c of candidates) {
    const s2 = await stat(c).catch(() => null);
    if (s2 && s2.isFile()) { from = c; st = s2; break; }
  }
  if (!from) { if (!ALLOW.has(ref.split("?")[0])) missing.push(ref); continue; }
}

// ⭐ When --shell named a DIRECTORY, that directory is the port's build output:
// the shells AND whatever sits beside them (here, 23 verbatim chunks the shells
// reference by name). Copying only the .html would ship a site whose every page
// asks for a script that did not travel.
for (const root of new Set(SHELLS.map((s2) => s2.root))) {
  const st = await stat(root).catch(() => null);
  if (!st || !st.isDirectory()) continue;
  const walk = async (d) => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const p2 = path.join(d, e.name);
      if (e.isDirectory()) { await walk(p2); continue; }
      if (e.name.endsWith(".html")) continue;   // shells are written below, rewritten
      const to = path.join(PUBLIC, path.relative(root, p2));
      await mkdir(path.dirname(to), { recursive: true });
      await cp(p2, to);
      const sz = (await stat(p2)).size;
      await recordCopy(to, path.relative(root, p2), sz);
      copied++; bytes += sz;
    }
  };
  await walk(root);
}

// The shells themselves, at their own paths, with the port's bundle beside them.
// ⛔ The rewrite below used to name `/assets/js/app.js` literally — the FOURTH
// hardcoded previous-project path in this one file, three lines under a comment
// complaining about the third. It is driven by --own now, like the others.
await mkdir(PUBLIC, { recursive: true });
for (let i = 0; i < SHELLS.length; i++) {
  let doc = htmls[i];
  for (const own of KEEP_OWN ? [] : OWN) {
    const esc = own.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    doc = doc.replace(new RegExp(`(<script\\b[^>]*\\bsrc=")${esc}(")`), `$1${BUILD_OUT.startsWith("/") ? BUILD_OUT : "/" + BUILD_OUT}$2`);
  }
  const rel = path.relative(SHELLS[i].root, SHELLS[i].abs) || "index.html";
  const to = path.join(PUBLIC, rel);
  await mkdir(path.dirname(to), { recursive: true });
  await writeFile(to, doc);
  const buf = Buffer.from(doc);
  BYTE_MANIFEST["public/" + posixRel(rel)] = { sha256: createHash("sha256").update(buf).digest("hex"), bytes: buf.length };
}

// The manifest and its checker travel WITH the deliverable. The checker is
// zero-dependency and self-contained: a copy of src/ proves its own integrity
// anywhere, with no reference back to this repo, its mirror, or its ledgers.
await writeFile(path.join(OUT, "byte-manifest.json"), JSON.stringify({
  note: "Per-file sha256 of the verbatim deliverable, pinned at generation time. `npm run check` re-verifies; build/serve refuse to run on a mismatch.",
  generatedAt: new Date().toISOString(),
  unverified: [...UNVERIFIED].sort(),
  files: Object.fromEntries(Object.entries(BYTE_MANIFEST).sort(([a], [b]) => a.localeCompare(b))),
}, null, 1));
await writeFile(path.join(OUT, "verify-bytes.mjs"), `#!/usr/bin/env node
// verify-bytes.mjs — GENERATED by make-standalone.mjs. Re-hashes every pinned
// file against byte-manifest.json. Runtime gates ask "does it render"; this
// asks "are these still the bytes that were verified" — the two are
// independent, and only this one notices a silently edited file or bit rot.
import { createHash } from "node:crypto";
import { createReadStream, promises as fsp } from "node:fs";
import path from "node:path";
const HERE = path.dirname(new URL(import.meta.url).pathname);
const m = JSON.parse(await fsp.readFile(path.join(HERE, "byte-manifest.json"), "utf8"));
const hashFile = (p) => new Promise((res, rej) => {
  const h = createHash("sha256");
  createReadStream(p).on("data", (c) => h.update(c)).on("end", () => res(h.digest("hex"))).on("error", rej);
});
const bad = [];
let n = 0;
for (const [rel, want] of Object.entries(m.files)) {
  const p = path.join(HERE, rel);
  const st = await fsp.stat(p).catch(() => null);
  if (!st) { bad.push(\`MISSING   \${rel}\`); continue; }
  if (st.size !== want.bytes) { bad.push(\`SIZE      \${rel} (\${st.size} != \${want.bytes})\`); continue; }
  if ((await hashFile(p)) !== want.sha256) { bad.push(\`MISMATCH  \${rel}\`); continue; }
  n++;
}
for (const b of bad.slice(0, 20)) console.error("  " + b);
if (bad.length > 20) console.error(\`  ... \${bad.length - 20} more\`);
if (bad.length) {
  console.error(\`FAIL — \${bad.length} file(s) are not the bytes that were verified. This copy has drifted; do not serve it as the deliverable.\`);
  process.exit(1);
}
console.log(\`byte-manifest: \${n}/\${n} file(s) verified\${m.unverified.length ? \` (\${m.unverified.length} own-build path(s) rebuilt each run, unpinned)\` : ""}.\`);
`);

await writeFile(path.join(OUT, "package.json"), JSON.stringify({
  // ⛔ Derived, not carried over. A generated file that hardcodes the previous
  // project's name is how a deliverable ends up introducing itself as something
  // else — third instance of this in one stage, after the own-build path and the
  // build script's outfile/externals.
  name: NAME,
  private: true,
  version: "1.0.0",
  type: "module",
  description: "Readable source for an unofficial study rebuild. Private, noindex, never deployed.",
  scripts: {
    // ⛔ The output path and externals are THIS project's, not the last one's.
    // A generated package.json carrying the first project's `public/app.js` and
    // its `--external:@marcom/…` is a hardcoded value wearing the costume of a
    // generated one — the same mistake as a hardcoded own-build path.
    // ⛔ Only when there IS something to build. A whole-site port ships the
    // packer's own chunks verbatim beside the shells — there is no entry module
    // and no bundle step, and a `build` script naming an index.js that does not
    // exist is the previous project's shape wearing this project's name. The
    // deliverable declares its own output with --own; no --own, no build.
    // ⭐ check/build/serve all re-verify the byte manifest first: the copy is
    // self-auditing on every use, not audited once at generation.
    check: "node verify-bytes.mjs",
    // ⛔ …and only when an entry module EXISTS. A verbatim-chunk port has --own
    // (its chunks) but no index.js; generating `esbuild index.js` for it is a
    // build step with nothing to build (readable-source §9.2), and --own's first
    // item was silently taken as BUILD_OUT (14islands F15). --no-build forces it off.
    ...(OWN.length && !NO_BUILD && !KEEP_OWN && fssync.existsSync(path.join(OUT, "index.js")) ? {
      build: `node verify-bytes.mjs && esbuild index.js --bundle --format=iife --outfile=public${BUILD_OUT}` +
        EXTERNALS.map((e) => ` --external:${e}`).join(""),
    } : {}),
    // ⭐ The deliverable ships its own server. readable-source.md §2.4: without a
    // verification hook travelling with it, "it builds" is the whole of what can
    // be said about a copy — and building is not running.
    // ⛔ THE COPY'S SERVER MUST BE CONFIGURED LIKE THE PROJECT'S. serve.mjs is
    // not a plain static server: --stub-ext-hosts is what answers a stubbed
    // third-party script with an empty body instead of letting the page fetch
    // it. Shipping the server without the flag produces a deliverable that
    // makes outbound calls the in-repo copy does not — the same failure shape
    // as shipping serve.mjs without probe-shim.js, one layer over.
    serve: `node verify-bytes.mjs && node serve.mjs --root public --port ${SERVE_PORT}` +
      (EXT_HOSTS_FLAG.length ? ` --ext-hosts ${EXT_HOSTS_FLAG.join(",")}` : "") +
      (STUB_HOSTS.length ? ` --stub-ext-hosts ${STUB_HOSTS.join(",")}` : "") +
      (ORIGIN_HOST_FLAG ? ` --origin-host ${ORIGIN_HOST_FLAG}` : ""),
  },
  ...(OWN.length ? { devDependencies: { esbuild: "^0.25.0" } } : {}),
}, null, 2) + "\n");

// The zero-dependency server travels with the deliverable, AND SO DOES THE
// DETERMINISM SHIM. ⛔ serve.mjs injects probe-shim.js for `?__probe` requests
// and looks for it beside itself; shipping the server without it produced a copy
// that served fine and could not be MEASURED — nine checkpoints of
// "window.__pump never appeared". A verification hook that travels half-way is
// a verification hook that does not travel (readable-source.md §2.4).
for (const f of ["serve.mjs", "probe-shim.js"]) await cp(path.resolve("scripts", f), path.join(OUT, f));
await cp(path.resolve("scripts/lib"), path.join(OUT, "lib"), { recursive: true });

console.log(`=== make-standalone ===`);
console.log(`  ${copied} file(s) copied into ${path.relative(process.cwd(), PUBLIC)}  (${(bytes / 1048576).toFixed(1)} MB)`);
if (OWN.length) console.log(`  own build path(s), excluded from the mirror check: ${OWN.join(", ")}`);
console.log(`  ${skipped} ledger row(s) skipped: forensic material${REPLACED ? " + the replaced origin bundle" : ""}`);
// ⛔ One undifferentiated "missing" list is unusable. The classes have different
// meanings and only one of them is a defect:
//   • a PAGE outside the declared scope is expected — the scope is a declared
//     boundary, and a link crossing it is a link, not a hole;
//   • an ASSET with no file is a real hole in the deliverable.
// ⚠ `.html` is a page, extension or not. Testing only "has no extension" filed
// a registered out-of-scope PAGE under missing ASSETS and produced a FAIL that
// was really a naming mistake in the classifier.
const isPage = (r) => r.endsWith("/") || /\.x?html?$/i.test(r) || !/\.[a-z0-9]{2,5}$/i.test(r);
const pages = missing.filter(isPage);
const assets = missing.filter((r) => !isPage(r));
if (pages.length) {
  console.log(`\n  ⚠ ${pages.length} PAGE link(s) point outside the mirrored scope (locale alternates,`);
  console.log(`    site-wide nav, query-parameterised endpoints stored under encoded names).`);
  console.log(`    Expected — but the scope they fall outside of must be stated in the plan:`);
  for (const m of pages.slice(0, 5)) console.log(`      ${m}`);
  if (pages.length > 5) console.log(`      … ${pages.length - 5} more`);
}
if (assets.length) {
  console.log(`\n  FAIL ${assets.length} ASSET(s) referenced with no file in the mirror. Unlike a page`);
  console.log(`    link, this is a hole in the deliverable — it will 404 wherever this is copied:`);
  for (const m of assets.slice(0, 10)) console.log(`      ${m}`);
}
console.log(assets.length ? `\n  FAIL — ${assets.length} asset(s) missing.` : `\n  ok   every referenced ASSET is present.`);
console.log(`\n  ⚠ This copies what the DOCUMENT references. Assets a script builds at runtime`);
console.log(`    are invisible to it — walk the built copy with a probe before believing it.`);
// ⛔ A FAIL line with exit 0 is a gate that does not gate: CI and the loop
// runner read the code, not the prose, and "N asset(s) missing" scrolled past
// as a pass. Pages outside the declared scope stay a warning (they are a
// boundary, not a hole); a missing ASSET is the hole and exits 1.
process.exit(assets.length ? 1 : 0);
