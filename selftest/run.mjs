#!/usr/bin/env node
// selftest/run.mjs — the repo's smoke harness: `npm test`.
//
// Scope: fast, offline, zero-dependency. It guards the toolchain's PURE LOGIC
// (the shared libs every gate and crawler lean on) plus repo-level invariants
// (syntax of all 50+ scripts, the zero-dep discipline, doc link integrity).
// It does NOT drive Chrome or the network — those are the per-project gates'
// job, priced in browser launches and run inside rebuild projects, not here.
//
// Fixture philosophy: fixtures are GENERATED inline from the measured field
// cases recorded in the changelog (srcset candidates, escaped spellings,
// paren balance, spelling twins, …). Each assertion cites the version that
// bled for it, so a regression names the lesson it just unlearned.
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKILL = path.join(ROOT, "skills", "website-rebuild");
const TMP = path.join(ROOT, "selftest", ".tmp");
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

let pass = 0, fail = 0;
const ok = (name) => { pass++; console.log(`ok   ${name}`); };
const bad = (name, why) => { fail++; console.log(`FAIL ${name}${why ? ` — ${why}` : ""}`); };
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  g === w ? ok(name) : bad(name, `got ${g}, want ${w}`);
};
const truthy = (name, v, why = "") => (v ? ok(name) : bad(name, why));

// ---------------------------------------------------------------- 1. syntax
{
  const files = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== "node_modules") walk(p); }
      else if (/\.(mjs|js)$/.test(e.name)) files.push(p);
    }
  };
  walk(path.join(SKILL, "scripts"));
  walk(path.join(SKILL, "tools"));
  let broken = 0;
  for (const f of files) {
    try { execFileSync(process.execPath, ["--check", f], { stdio: "pipe" }); }
    catch (e) { broken++; bad(`syntax ${path.relative(SKILL, f)}`, String(e.stderr).split("\n")[0]); }
  }
  if (!broken) ok(`syntax — ${files.length} script(s) parse`);
}

// ------------------------------------------------------------- 2. zero-dep
{
  try {
    execFileSync(process.execPath, ["scripts/verify-zerodep.mjs"], { cwd: SKILL, stdio: "pipe" });
    ok("verify-zerodep — scripts/ imports only node:, gates import no producer");
  } catch (e) { bad("verify-zerodep", String(e.stdout || e.message).split("\n").pop()); }
}

// ------------------------------------------------- 3. lib/urlpath fixtures
{
  const { localRelPath, canonicalUrl, serveCandidates } = await import(path.join(SKILL, "scripts/lib/urlpath.mjs"));
  // v0.1.6/objectarchive: query variants are DISTINCT files.
  const a = localRelPath("https://x.com/i.jpg?width=320", "x.com");
  const b = localRelPath("https://x.com/i.jpg?width=1200", "x.com");
  truthy("urlpath — query variants stay distinct (v0.1.6)", a !== b, `${a} == ${b}`);
  // order-independent query key
  eq("urlpath — query order-independent", localRelPath("https://x.com/i.jpg?a=1&b=2", "x.com"), localRelPath("https://x.com/i.jpg?b=2&a=1", "x.com"));
  // v0.1.72: Storyblok path-past-file flattens on known asset extensions…
  truthy("urlpath — variant path flattened (v0.1.72)", localRelPath("https://a.storyblok.com/f/1/x.jpg/m/110x110/filters:quality(70)", "x.com").includes("@@"));
  // …and NEVER on dotted directories (hubtown decoders/1.5.5).
  truthy("urlpath — dotted dir not flattened (v0.1.72)", !localRelPath("https://x.com/decoders/1.5.5/d.wasm", "x.com").includes("@@"));
  // canonicalUrl strips default port + hash (v0.2.5 spelling twins).
  eq("urlpath — canonical default port (v0.2.5)", canonicalUrl("http://x.com:80/a"), "http://x.com/a");
  truthy("urlpath — serveCandidates flat form first (v0.1.72)", serveCandidates("/f/1/x.jpg/m/110x110/filters:quality(70)", "x.com").some((c) => c.includes("@@")));
}

// --------------------------------------------- 4. lib/extract-refs fixtures
{
  const { createRefExtractor, isTextRefSource } = await import(path.join(SKILL, "scripts/lib/extract-refs.mjs"));
  const extract = createRefExtractor({ origin: "https://x.com", originHost: "x.com", assetHosts: new Set(["x.com", "cdn.x.com"]), onOffHost: () => {} });
  const refs = (text, base = "https://x.com/index.html") => [...extract(text, base)];

  // v0.1.68/0.1.72: trailing parens by BALANCE, not blind trim.
  truthy("extract — quality(70) kept whole (v0.1.72)",
    refs(`<img src="https://cdn.x.com/f/x.jpg/m/1x1/filters:quality(70)">`).some((u) => u.endsWith("quality(70)")));
  // v0.1.73: url(...) overrun stops at unbalanced ')'.
  truthy("extract — );--aspect overrun cut (v0.1.73)",
    refs(`<div style="background:url(https://cdn.x.com/a.webp);--aspect:1.5">`).some((u) => u.endsWith("a.webp")));
  // v0.1.73: entity-decoded quotes re-obey the boundary.
  truthy("extract — &quot; boundary (v0.1.73)",
    refs(`&quot;image&quot;:&quot;https://cdn.x.com/m.webp&quot;,&quot;d&quot;:&quot;x`).some((u) => u.endsWith("m.webp")));
  // v0.1.42-era srcset lesson: EVERY candidate, not just the quoted first.
  const sr = refs(`<img srcset="https://cdn.x.com/a-320.jpg 320w, https://cdn.x.com/a-640.jpg 640w, https://cdn.x.com/a-960.jpg 960w">`);
  truthy("extract — srcset all candidates", sr.filter((u) => /a-\d+\.jpg$/.test(u)).length === 3, `got ${sr.length}`);
  // v0.1.66: template-literal prefixes are not addresses.
  truthy("extract — ${ prefix rejected (v0.1.66)",
    !refs("`https://cdn.x.com/${pkg}/x.wasm`").some((u) => u.includes("$%7B") || u.includes("${")));
  // v0.2.6 shape 6: document-relative attributes, with both guards.
  truthy("extract — ./relative attr resolved (v0.2.6)",
    refs(`<img src="./content/3.project/1.A/thumb.png">`, "https://x.com/index.html").includes("https://x.com/content/3.project/1.A/thumb.png"));
  truthy("extract — bare relative attr resolved (v0.2.6)",
    refs(`<a href="content/g/1.jpg">`, "https://x.com/index.html").includes("https://x.com/content/g/1.jpg"));
  truthy("extract — data-ease junk rejected (v0.2.6 guard 1)",
    !refs(`<div data-ease="power2.inOut" data-speed="0.35">`).some((u) => /inOut|0\.35/.test(u)));
  truthy("extract — js chunk-relative not guessed (v0.2.6 guard 2)",
    !refs(`x.src="img/deep.png"`, "https://x.com/chunk.js").some((u) => u.includes("deep.png")));
  // isTextRefSource: declared type is the oracle; octet-stream means "unknown".
  truthy("textref — declared css wins", isTextRefSource({ url: "https://x.com/f", contentType: "text/css", head: Buffer.from("a{}") }));
  truthy("textref — png bytes not text", !isTextRefSource({ url: "https://x.com/i.png", contentType: "image/png", head: Buffer.from([0x89, 0x50, 0x4e, 0x47]) }));
}

// ---------------------------------------------- 4b. lib/negotiate fixtures
{
  // v0.3.9 / basement D5: `auto=format` negotiates on Accept; `accept: */*`
  // landed 391 fallback-format variants (webp transcoded back to JPEG) while
  // every gate stayed green. These pin the one-yardstick contract.
  const { IMG_ACCEPT, imageAcceptFor, isNegotiated, sanityEvidence } =
    await import(path.join(SKILL, "scripts/lib/negotiate.mjs"));
  eq("negotiate — sanity image gets browser Accept (v0.3.9)",
    imageAcceptFor("https://cdn.sanity.io/images/9syto90m/production/ab-1920x833.webp?auto=format&w=1200"), IMG_ACCEPT);
  eq("negotiate — next/image proxy gets browser Accept (v0.3.9)",
    imageAcceptFor("https://x.com/_next/image?url=https%3A%2F%2Fcdn.sanity.io%2Fimages%2Fp%2Fd%2Fa.jpg&w=1200&q=75"), IMG_ACCEPT);
  eq("negotiate — CDP type hint outranks extensionless URL (v0.3.9)",
    imageAcceptFor("https://cdn.x.com/asset/4711", "Image"), IMG_ACCEPT);
  eq("negotiate — non-image keeps */* (allergy rung untouched)",
    imageAcceptFor("https://x.com/chunk.js"), "*/*");
  truthy("negotiate — Vary: origin, accept detected (v0.3.9)", isNegotiated("origin, accept"));
  truthy("negotiate — Vary without accept not flagged", !isNegotiated("origin, accept-encoding"));
  // sanityEvidence: all three spellings normalize (plain / \/ escaped / %2F encoded)
  const ev = sanityEvidence(
    `src="https://cdn.sanity.io/images/9syto90m/production/a-1x1.jpg?auto=format"` +
    ` {"u":"https:\\/\\/cdn.sanity.io\\/files\\/9syto90m\\/production\\/b.mp4"}` +
    ` /_next/image?url=https%3A%2F%2Fcdn.sanity.io%2Fimages%2Fdiak0tmr%2Fproduction%2Fc-2x2.png` +
    ` fetch("https://diak0tmr.apicdn.sanity.io/v2024-01-01/data/query/production?query=x")` +
    ` {"_key":"abc","_key":"def"}`);
  eq("negotiate — sanityEvidence projects across spellings (v0.3.9)",
    ev.projects.map((p) => `${p.projectId}:${p.n}`).sort(), ["9syto90m:2", "diak0tmr:1"]);
  eq("negotiate — sanityEvidence apicdn host seen", ev.apiHosts.map((h) => h.host), ["diak0tmr.apicdn.sanity.io"]);
  eq("negotiate — sanityEvidence counts", [ev.autoFormat, ev.keyFields], [1, 2]);
  // darkroom.engineering (v0.3.9): a flight :HC preconnect names the bare host
  // with NO asset path — Sanity is in the stack while the page shows zero
  // project refs. cdnRefs must catch it or the fingerprint prints "无".
  const hc = sanityEvidence(`:HC\\"https:\\/\\/cdn.sanity.io\\"`);
  truthy("negotiate — bare :HC preconnect counted, no fake project (v0.3.9)",
    hc.cdnRefs === 1 && hc.projects.length === 0, JSON.stringify(hc));
}

// ------------------------------------- 5. verify-mirror end-to-end fixture
{
  // A miniature mirror: ledger-consistent, closure-complete. PASS expected;
  // then corrupt one byte and expect the bytes gate to go red (v0.1.14 family).
  const { createHash } = await import("node:crypto");
  const M = path.join(TMP, "mini-mirror");
  mkdirSync(M, { recursive: true });
  const page = `<html><img src="/a.png"></html>`;
  const img = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  writeFileSync(path.join(M, "index.html"), page);
  writeFileSync(path.join(M, "a.png"), img);
  const sha = (b) => createHash("sha256").update(b).digest("hex");
  const files = {
    "https://mini.test/": { path: "index.html", bytes: Buffer.byteLength(page), sha256: sha(Buffer.from(page)), type: "text/html" },
    "https://mini.test/a.png": { path: "a.png", bytes: img.length, sha256: sha(img), type: "image/png" },
  };
  writeFileSync(path.join(M, "mirror-manifest.json"), JSON.stringify({ origin: "https://mini.test", files }, null, 2));
  writeFileSync(path.join(M, "inventory.tsv"), "SHA256\tBYTES\tPATH\tURL\n" + Object.entries(files).map(([u, r]) => [r.sha256, r.bytes, r.path, u].join("\t")).join("\n") + "\n");
  writeFileSync(path.join(M, "redirects.tsv"), "CODE\tFROM\tTO\n");
  const run = () => {
    try { execFileSync(process.execPath, [path.join(SKILL, "scripts/verify-mirror.mjs"), "--mirror", M], { stdio: "pipe" }); return true; }
    catch { return false; }
  };
  truthy("verify-mirror — consistent mini mirror passes", run());
  // v0.3.9/darkroom: the DELIBERATE 404 template carries flight slot names
  // (`"forbidden":"$undefined"`) and is the smallest HTML on a Next site —
  // weak "refusal wording" must NOT fire on it; a strong WAF body there must.
  const t404 = `<html><body>not found<script>self.__next_f.push("\\"notFound\\":\\"$undefined\\",\\"forbidden\\":\\"$undefined\\"")</script></body></html>`;
  writeFileSync(path.join(M, "a.png"), img); // restore
  writeFileSync(path.join(M, "404.html"), t404);
  files["https://mini.test/__404probe"] = { path: "404.html", bytes: Buffer.byteLength(t404), sha256: sha(Buffer.from(t404)), type: "text/html (404 template)" };
  writeFileSync(path.join(M, "mirror-manifest.json"), JSON.stringify({ origin: "https://mini.test", files }, null, 2));
  writeFileSync(path.join(M, "inventory.tsv"), "SHA256\tBYTES\tPATH\tURL\n" + Object.entries(files).map(([u, r]) => [r.sha256, r.bytes, r.path, u].join("\t")).join("\n") + "\n");
  truthy("verify-mirror — 404 template flight slot names not a weak interstitial (v0.3.9)", run());
  const waf404 = `<html><body><h1>Attention Required! | Cloudflare</h1></body></html>`;
  writeFileSync(path.join(M, "404.html"), waf404);
  files["https://mini.test/__404probe"] = { path: "404.html", bytes: Buffer.byteLength(waf404), sha256: sha(Buffer.from(waf404)), type: "text/html (404 template)" };
  writeFileSync(path.join(M, "mirror-manifest.json"), JSON.stringify({ origin: "https://mini.test", files }, null, 2));
  writeFileSync(path.join(M, "inventory.tsv"), "SHA256\tBYTES\tPATH\tURL\n" + Object.entries(files).map(([u, r]) => [r.sha256, r.bytes, r.path, u].join("\t")).join("\n") + "\n");
  truthy("verify-mirror — WAF body in the 404 template still reds (strong marker)", !run());
  writeFileSync(path.join(M, "a.png"), Buffer.concat([img, Buffer.from([9])]));
  truthy("verify-mirror — one corrupted byte goes red (v0.1.14)", !run());
}

// ------------------------------- 5b. flight decode + semantic gate (v0.3.0)
{
  // Synthetic RSC wire covering the measured trip-points: a T row (length-
  // prefixed, no terminator), an EMPTY-ID :HL row (the first walker broke its
  // chain here), an I row (module ref), and a row-0 router payload.
  const mkStream = (opts) => {
    const { moduleId = 123, chunk = "abc12345", text = "hello", moduleId2 = null } = opts || {};
    const tHex = Buffer.byteLength(text).toString(16);
    const kids = [["$", "$L2", null, {}]];
    if (moduleId2 != null) kids.push(["$", "$L6", null, {}]); // second ref, same export name
    kids.push(["$", "p", null, { children: "$3" }]);
    const row0 = {
      P: null, b: "BUILDX", c: ["", ""], q: "", i: false,
      f: [[
        ["", { children: ["__PAGE__", {}] }, "$undefined", "$undefined", true],
        ["$", "$1", "c", { children: ["$", "html", null, { children: ["$", "body", null, { children: kids }] }] }],
        ["$", "$1", "h", { children: ["$", "meta", null, { charSet: "utf-8" }] }],
        false,
      ]],
      m: "$undefined", G: null, S: true,
    };
    return [
      `1:"$Sreact.fragment"`,
      `2:I[${moduleId},["/_next/static/chunks/${chunk}.js"],"Logo"]`,
      ...(moduleId2 != null ? [`6:I[${moduleId2},["/_next/static/chunks/${chunk}.js"],"Logo"]`] : []),
      `:HL["/_next/static/chunks/deadbeef.css","style"]`,
      `3:T${tHex},${text}`,
      // React 19 streaming sentinels (measured on basement.studio): X starts an
      // async iterable, C stops a stream — bare tag char, NOT JSON. The first
      // decoder JSON.parse'd every non-I/HL/T row and crashed the whole doc here.
      `4:X`,
      `5:C`,
      `0:${JSON.stringify(row0)}`,
    ].join("\n") + "\n";
  };
  const wrap = (stream) => `<html><body><script>self.__next_f.push([1,${JSON.stringify(stream)}])</script></body></html>`;

  const MIR = path.join(TMP, "flight-mirror");
  const BUILT = path.join(TMP, "flight-built");
  mkdirSync(MIR, { recursive: true });
  mkdirSync(BUILT, { recursive: true });
  writeFileSync(path.join(MIR, "index.html"), wrap(mkStream({})));
  // Built side: DIFFERENT module id and chunk hash (the N1/N4 namespaces the
  // gate must normalize), same behavior-bearing content.
  writeFileSync(path.join(BUILT, "index.html"), wrap(mkStream({ moduleId: 456, chunk: "fedcba98" })));

  // decode: T text resolved, empty-id HL survives, module export named
  const DEC = path.join(TMP, "flight-docs");
  try {
    execFileSync(process.execPath, [path.join(SKILL, "scripts/flight-decode.mjs"), "--mirror", MIR, "--out", DEC], { stdio: "pipe" });
    const doc = JSON.parse(readFileSync(path.join(DEC, "index.json"), "utf8"));
    truthy("flight-decode — T row resolved into tree (v0.3.0)", JSON.stringify(doc.tree).includes('"hello"'));
    truthy("flight-decode — empty-id :HL row does not break the walk (v0.3.0)", doc.hints.length === 1);
    truthy("flight-decode — I row export name surfaces (v0.3.0)", JSON.stringify(doc.modules).includes('"Logo"'));
    // basement.studio: X/C streaming sentinels must not crash the decode.
    truthy("flight-decode — X/C stream sentinels do not crash decode (v0.3.1)", doc && doc.tree != null);
  } catch (e) { bad("flight-decode — mini stream", String(e.stderr || e.message).split("\n")[0]); }

  // gate: hash namespaces normalized away = PASS; a one-character text change = red
  const gate = () => {
    // cwd in TMP so the gate's docs/flight-gate-report.txt lands there and is
    // swept with the rest of the fixtures, not left at the repo root.
    try { execFileSync(process.execPath, [path.join(SKILL, "scripts/verify-flight.mjs"), "--mirror", MIR, "--built", BUILT], { stdio: "pipe", cwd: TMP }); return true; }
    catch { return false; }
  };
  truthy("verify-flight — hash namespaces normalized, ids bijective (v0.3.0)", gate());
  writeFileSync(path.join(BUILT, "index.html"), wrap(mkStream({ moduleId: 456, chunk: "fedcba98", text: "hellp" })));
  truthy("verify-flight — one text byte goes red (v0.3.0)", !gate());
  // v0.3.2: the audit itself must not be vacuous. The old pairing collected by
  // resolve order, gated on total-count equality — platform-stripped refs put the
  // two sides off by one, every route skipped pairing, and 144 basement routes
  // "passed" with 0 pairs on the books. Pairing now walks the two equal
  // normalized trees in parallel, so it is position-exact and always collects.
  const gateOut = () => {
    try { return { ok: true, out: execFileSync(process.execPath, [path.join(SKILL, "scripts/verify-flight.mjs"), "--mirror", MIR, "--built", BUILT], { stdio: "pipe", cwd: TMP }).toString() }; }
    catch (e) { return { ok: false, out: String(e.stdout || "") }; }
  };
  writeFileSync(path.join(MIR, "index.html"), wrap(mkStream({ moduleId: 123, moduleId2: 123 })));
  writeFileSync(path.join(BUILT, "index.html"), wrap(mkStream({ moduleId: 456, chunk: "fedcba98", moduleId2: 456 })));
  truthy("verify-flight — bijection audit actually collects pairs (v0.3.2)", (() => { const g = gateOut(); return g.ok && /双射:1 对/.test(g.out); })());
  // One origin module answered by two rebuild modules (basement 528233: a single
  // source file exporting SocialLinks/InternalLinks/Copyright, regenerated as
  // three files) — trees equal, bijection violated, gate must go red.
  writeFileSync(path.join(BUILT, "index.html"), wrap(mkStream({ moduleId: 456, chunk: "fedcba98", moduleId2: 789 })));
  truthy("verify-flight — one origin module split in two goes red (v0.3.2)", (() => { const g = gateOut(); return !g.ok && g.out.includes("123"); })());
}

// --------------- 5c. module graph: turbopack merged/async shapes (v0.3.3)
{
  // The three shapes basement.studio bled for: scope hoisting registers a merged
  // sub-module via e.s([exports], subId); e.A(id) is the async-loader edge; and
  // an e.v(cb) loader stub resolves cb(<id>) after pulling sibling chunks. Miss
  // any of them and the closure is silently blind — the site's entire 3D scene
  // sat two hops behind an e.A / e.v pair.
  const CH = path.join(TMP, "graph-chunk.js");
  writeFileSync(CH, `(globalThis.TURBOPACK = globalThis.TURBOPACK || []).push([
  "object" == typeof document ? document.currentScript : void 0,
  111, (e, t, r) => {
    "use strict";
    var a = e.i(222);
    e.A(444);
    e.s(["Foo", () => 1], 111);
    e.s(["Bar", () => 2], 333);
  },
  222, (e, t, r) => {
    "use strict";
    t.exports = {};
  },
  444, e => {
    e.v(s => Promise.all(["static/chunks/x.js"].map(c => e.l(c))).then(() => s(555)));
  },
  555, (e, t, r) => {
    "use strict";
    var a = e.i(333);
  }
]);\n`);
  const MMOUT = path.join(TMP, "graph-map.json");
  try {
    execFileSync(process.execPath, [path.join(SKILL, "scripts/module-map.mjs"), "--in", CH, "--out", MMOUT], { stdio: "pipe" });
    const mm = JSON.parse(readFileSync(MMOUT, "utf8"));
    const m111 = mm.modules.find((m) => String(m.id) === "111");
    const m444 = mm.modules.find((m) => String(m.id) === "444");
    truthy("module-map — scope-hoisted e.s(…, subId) lands in aliases (v0.3.3)", !!m111 && (m111.aliases || []).map(String).includes("333"));
    truthy("module-map — e.A async edge + e.v stub resolve target are requires (v0.3.3)",
      !!m111 && m111.requires.map(String).includes("444") && !!m444 && m444.requires.map(String).includes("555"));
    const out = execFileSync(process.execPath, [path.join(SKILL, "scripts/closure.mjs"), "--seed", "111", "--map", MMOUT, "--out", path.join(TMP, "graph-closure.json")], { stdio: "pipe" }).toString();
    truthy("closure — alias require resolves and dedups to the owning module (v0.3.3)", /4 module\(s\)/.test(out) && /1 alias id\(s\) folded in/.test(out));
  } catch (e) { bad("module graph — turbopack shapes", String(e.stderr || e.stdout || e.message).split("\n")[0]); }
}

// ----------------------------------------- 5b. off-host census contract (v0.3.4)
// extract-refs reports off-list hosts as onOffHost(host, href) — a BARE host.
// wayback-mirror consumed it as a URL: new URL("fonts.googleapis.com") throws,
// the catch {} swallowed every call, and the census printed nothing for a page
// that references Google Fonts and a Vimeo player. This pins the contract the
// way the fixed consumer uses it: first arg counts as a host, no URL parse.
{
  const { createRefExtractor } = await import(path.join(SKILL, "scripts/lib/extract-refs.mjs"));
  const census = new Map();
  const extract = createRefExtractor({
    origin: "http://x.com", originHost: "x.com", assetHosts: new Set(["x.com"]),
    onOffHost: (host) => census.set(host, (census.get(host) || 0) + 1),
  });
  [...extract('<link href="http://fonts.googleapis.com/css?family=F"><iframe src="//player.vimeo.com/video/1"></iframe>', "http://x.com/")];
  truthy("extract-refs — onOffHost hands a bare host and the census counts it (v0.3.4)",
    census.get("fonts.googleapis.com") === 1 && census.get("player.vimeo.com") === 1,
    `census=${JSON.stringify([...census])}`);
}

// ---------------------------------- 5c. standalone gate: comments are prose (v0.3.4)
// A Compass/SASS build stamps `/* line N, ../../x.scss */` provenance comments
// into its CSS output — content bytes a rebuild must not edit. The gate's
// comment-skip regex missed lines OPENING a block comment, so a 2013 target
// produced 5 false positives; meanwhile a real escaping import must still red.
{
  const FX = path.join(TMP, "standalone-fx");
  mkdirSync(path.join(FX, "css"), { recursive: true });
  writeFileSync(path.join(FX, "package.json"), JSON.stringify({ name: "fx", private: true }));
  writeFileSync(path.join(FX, "css", "screen.css"), "/* line 17, ../../../../Applications/Fire.app/lib/compass/_utilities.scss */\nbody { color: red; }\n");
  writeFileSync(path.join(FX, "app.mjs"), 'import x from "../outside-the-tree.js";\n');
  let out = "";
  try { out = execFileSync(process.execPath, [path.join(SKILL, "scripts/verify-standalone.mjs"), "--src", FX], { cwd: SKILL, stdio: "pipe" }).toString(); }
  catch (e) { out = String(e.stdout || ""); }
  truthy("verify-standalone — block-comment prose is not an escape (v0.3.4)", !out.includes("screen.css"), "flagged the Compass comment");
  truthy("verify-standalone — a real ../ import outside src still reds (v0.3.4)", out.includes("app.mjs") && /FAIL/.test(out), "missed the real escape");
}

// -------------------------------------------------------- 6. doc integrity
{
  let dangling = 0;
  for (const f of readFileSync(path.join(SKILL, "SKILL.md"), "utf8").matchAll(/\]\((references\/[a-z0-9-]+\.md)/g)) {
    if (!existsSync(path.join(SKILL, f[1]))) { dangling++; bad(`doc link ${f[1]}`, "referenced by SKILL.md but missing"); }
  }
  for (const f of readFileSync(path.join(SKILL, "SKILL.md"), "utf8").matchAll(/`?scripts\/([a-z0-9-]+\.mjs)`?/g)) {
    if (!existsSync(path.join(SKILL, "scripts", f[1])) && f[1] !== "verify-decls.mjs") { dangling++; bad(`doc script ref ${f[1]}`, "named by SKILL.md but missing"); }
  }
  if (!dangling) ok("docs — SKILL.md references resolve (verify-decls exempt by design)");
}

// ---------------------------------------------------------------- summary
rmSync(TMP, { recursive: true, force: true });
console.log(`\n${fail ? "FAIL" : "PASS"} — ${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
