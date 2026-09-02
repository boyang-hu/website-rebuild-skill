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
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, statSync } from "node:fs";
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
  // v0.3.16: EXACT candidates for a path-past-file URL. The old assertion passed
  // `"x.com"` as the SEARCH argument, so it became a query suffix and the
  // `.some(includes("@@"))` check was true of every answer. The crawler's form
  // (`<flat>/index.html` — the flattened tail ends in `)`, so the writer calls it
  // a page) comes first; it was never emitted, and serve 404'd on every
  // Storyblok transform it had on disk.
  eq("urlpath — serveCandidates flat form first, exact (v0.1.72/v0.3.16)",
    serveCandidates("/f/1/x.jpg/m/110x110/filters:quality(70)", ""),
    ["/f/1/x.jpg@@m@@110x110@@filters:quality(70)/index.html", "/f/1/x.jpg@@m@@110x110@@filters:quality(70)", "/f/1/x.jpg/m/110x110/filters:quality(70)"]);
  // The lookup reaches what the writer wrote — one implementation, both spellings.
  for (const [url, p, q] of [
    ["https://x.com/x.jpg/m/110x110/filters:quality(70)", "/x.jpg/m/110x110/filters:quality(70)", ""],
    ["https://x.com/x.jpg/m/y.png?w=1", "/x.jpg/m/y.png", "?w=1"],
  ]) {
    truthy(`urlpath — serveCandidates reaches localRelPath for ${p}${q} (v0.3.16)`,
      serveCandidates(p, q).map((c) => c.replace(/^\//, "")).includes(localRelPath(url, "x.com")),
      `${localRelPath(url, "x.com")} not in ${JSON.stringify(serveCandidates(p, q))}`);
  }
  // …and the plain cases are untouched (serve.mjs completes a page path itself).
  eq("urlpath — plain page candidates unchanged (v0.3.16)", serveCandidates("/about", ""), ["/about"]);
  eq("urlpath — query asset candidates unchanged (v0.3.16)", serveCandidates("/i.jpg", "?width=320"), ["/i@@width=320.jpg", "/i.jpg"]);
  eq("urlpath — directory + query candidates unchanged (v0.3.16)", serveCandidates("/c/", "?page=2"), ["/c@@page=2/", "/c/@@page=2", "/c/"]);
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
  // v0.3.15 (raycastkbd): an image-optimiser PROXY has no extension and never
  // will — `/_next/image?url=…&w=640` in a srcset, in imageSrcSet, or in a
  // plain src. The page-vs-asset heuristic dropped all of them for eight
  // versions (42 rungs in the HTML, 19 on disk, closure ∅). A page with a query
  // string must still be a page.
  const px = refs(`<link rel="preload" as="image" imageSrcSet="/_next/image?url=%2Fbg.webp&amp;w=640&amp;q=70 640w, /_next/image?url=%2Fbg.webp&amp;w=1080&amp;q=70 1080w">` +
    `<img srcSet="/_next/image?url=%2Fkb.png&amp;w=828&amp;q=95 828w" src="/_next/image?url=%2Fkb.png&amp;w=1920&amp;q=95"><a href="/about?tab=2">x</a>`);
  eq("extract — next/image srcset + imageSrcSet + src rungs are assets (v0.3.15)",
    px.filter((u) => u.includes("/_next/image?")).length, 4);
  truthy("extract — a page with a query string is still a page (v0.3.15)", !px.some((u) => u.includes("/about?")));
  truthy("extract — the proxied source image is still extracted alongside (v0.3.15)", px.includes("https://x.com/bg.webp"));
  // v0.2.6 shape 6: document-relative attributes, with both guards.
  truthy("extract — ./relative attr resolved (v0.2.6)",
    refs(`<img src="./content/3.project/1.A/thumb.png">`, "https://x.com/index.html").includes("https://x.com/content/3.project/1.A/thumb.png"));
  truthy("extract — bare relative attr resolved (v0.2.6)",
    refs(`<a href="content/g/1.jpg">`, "https://x.com/index.html").includes("https://x.com/content/g/1.jpg"));
  truthy("extract — data-ease junk rejected (v0.2.6 guard 1)",
    !refs(`<div data-ease="power2.inOut" data-speed="0.35">`).some((u) => /inOut|0\.35/.test(u)));
  truthy("extract — js chunk-relative not guessed (v0.2.6 guard 2)",
    !refs(`x.src="img/deep.png"`, "https://x.com/chunk.js").some((u) => u.includes("deep.png")));
  // v0.3.16: ONE extension cap, lib/urlpath.mjs's {1,12}. The extractor carried
  // `{2,5}` in five places, so `.webmanifest` (11) and `.jsonld` (6) were pages
  // to it — never queued — while the mapper called them assets.
  const lx = refs(`<link rel="manifest" href="/site.webmanifest"><link href="/a.jsonld"><link href="/f.woff2"><a href="/about">x</a>`);
  eq("extract — .webmanifest/.jsonld/.woff2 root-relative refs are assets (v0.3.16)",
    ["https://x.com/site.webmanifest", "https://x.com/a.jsonld", "https://x.com/f.woff2"].filter((u) => lx.includes(u)).length, 3);
  truthy("extract — /about is still a page, not an asset (v0.3.16)", !lx.some((u) => u.endsWith("/about")), JSON.stringify(lx));
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
  eq("negotiate — MIME-form hint also counts (14islands TSV carries image/png)",
    imageAcceptFor("https://cdn.x.com/asset/4711", "image/png"), IMG_ACCEPT);
  eq("negotiate — video MIME hint stays */*",
    imageAcceptFor("https://cdn.x.com/asset/4711", "video/mp4"), "*/*");
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
    const { moduleId = 123, chunk = "abc12345", text = "hello", moduleId2 = null, cls = null, slot = null } = opts || {};
    const tHex = Buffer.byteLength(text).toString(16);
    const kids = [["$", "$L2", null, {}]];
    if (moduleId2 != null) kids.push(["$", "$L6", null, {}]); // second ref, same export name
    kids.push(["$", "p", null, { ...(cls ? { className: cls } : {}), children: "$3" }]);
    if (slot) kids.push(["$", "div", null, { loading: slot, children: "x" }]);
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
  // v0.3.12 / darkroom: Turbopack css-module hashes are not always 8 hex (a 7-hex
  // next/font class with an underscore-led local segment read as "behavior"), and a
  // LayoutRouter loading/notFound tuple keeps an EMPTY styles slot on the rebuild
  // side after N5 stripped the mirror's — [tree] vs [tree, []] must be equal.
  writeFileSync(path.join(MIR, "index.html"), wrap(mkStream({ cls: "mono_5da033d2-module__n1AzdG__variable", slot: [["$", "span", null, {}], []] })));
  writeFileSync(path.join(BUILT, "index.html"), wrap(mkStream({ moduleId: 456, chunk: "fedcba98", cls: "mono_39c065e-module___Kbuzq__variable", slot: [["$", "span", null, {}]] })));
  truthy("verify-flight — 7-hex css-module hash + empty loading styles slot normalize (v0.3.12)", gate());
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

// ------------------------------ 5a2. webpack push container + token gates (v0.3.10)
{
  // 14islands F1: a three.js-style export map with MORE `key: function` props
  // than the container has modules used to be picked as the container. The
  // webpackChunk push signature is positive evidence; the count is not.
  const WP = path.join(TMP, "wp-chunk.js");
  const bigMap = Array.from({ length: 12 }, (_, i) => `K${i}:function(){return ${i}}`).join(",");
  writeFileSync(WP, `(self.webpackChunk_N_E=self.webpackChunk_N_E||[]).push([[2888],{\n` +
    `  10:function(e,t,n){"use strict";n.d(t,{${bigMap}});var a=n(20);t.exports={a}},\n` +
    `  20:function(e,t,n){"use strict";t.exports=1},\n` +
    `  30:function(e,t,n){"use strict";var z=n(10)}\n` +
    `}]);\n`);
  const WPOUT = path.join(TMP, "wp-map.json");
  try {
    const out = execFileSync(process.execPath, [path.join(SKILL, "scripts/module-map.mjs"), "--in", WP, "--out", WPOUT], { stdio: "pipe" }).toString();
    const mm = JSON.parse(readFileSync(WPOUT, "utf8"));
    eq("module-map — webpackChunk push object is the container, not the bigger export map (v0.3.10)",
      mm.modules.map((m) => String(m.id)).sort(), ["10", "20", "30"]);
    truthy("module-map — push signature reported", /push signature/.test(out));
  } catch (e) { bad("module-map — webpack push container", String(e.stderr || e.stdout || e.message).split("\n")[0]); }

  // v0.3.11 / 14islands F12+F13: a SINGLE-factory push chunk is a container
  // (it used to fall through the `< 2` threshold into the array reader, which
  // counted a worker's `[function(){…}, …]` table as 31 modules), and a
  // MINIFIED one-line chunk must not trip the overlap rule (F11: 652 correct
  // modules all on line 1 — the invariant is characters, not lines).
  const WP1 = path.join(TMP, "wp-single.js");
  writeFileSync(WP1, `"use strict";(self.webpackChunk_N_E=self.webpackChunk_N_E||[]).push([[7871],{87871:function(e,t,r){var q=[function(){return 1},function(){return 2},function(){return 3}];t.exports=q}}]);`);
  const WP2 = path.join(TMP, "wp-minified.js");
  writeFileSync(WP2, `(self.webpackChunk_N_E=self.webpackChunk_N_E||[]).push([[1],{10:function(e,t,n){t.exports=1},20:function(e,t,n){t.exports=n(10)},30:function(e,t,n){t.exports=n(20)}}]);`);
  for (const [f, want, label] of [[WP1, ["87871"], "single-factory push chunk is 1 module, not the worker table (v0.3.11)"], [WP2, ["10", "20", "30"], "minified one-line chunk passes the char-overlap invariant (v0.3.11)"]]) {
    const o = path.join(TMP, path.basename(f) + ".json");
    try {
      execFileSync(process.execPath, [path.join(SKILL, "scripts/module-map.mjs"), "--in", f, "--out", o], { stdio: "pipe" });
      eq(`module-map — ${label}`, JSON.parse(readFileSync(o, "utf8")).modules.map((m) => String(m.id)).sort(), want);
    } catch (e) { bad(`module-map — ${label}`, String(e.stderr || e.stdout || e.message).split("\n")[0]); }
  }

  // v0.3.12 / darkroom §F-1: with the React Compiler, Turbopack inlines the whole
  // implementation inside e.s([name, 0, function(){…}], id). The reader used to
  // skip the call body, losing every edge inside it.
  const TS = path.join(TMP, "turbo-inline-export.js");
  writeFileSync(TS, `(globalThis.TURBOPACK = globalThis.TURBOPACK || []).push([void 0,
  111, e => {
    "use strict";
    var r = e.i(222);
    e.s(["useX", 0, function(o, a) {
      console.error("not an export name");
      return e.A(777).then(() => e.i(888));
    }], 111);
  },
  222, e => { e.s([["Bar", () => 2]], 222); },
  777, e => { e.v(t => t(888)); },
  888, e => {}
]);\n`);
  const TSO = path.join(TMP, "turbo-inline-export.json");
  try {
    execFileSync(process.execPath, [path.join(SKILL, "scripts/module-map.mjs"), "--in", TS, "--out", TSO], { stdio: "pipe" });
    const mm = JSON.parse(readFileSync(TSO, "utf8"));
    const m111 = mm.modules.find((m) => String(m.id) === "111");
    truthy("module-map — edges inside an inlined e.s(…) export body are collected (v0.3.12)",
      !!m111 && ["222", "777", "888"].every((x) => m111.requires.map(String).includes(x)), JSON.stringify(m111 && m111.requires));
    eq("module-map — only element-start strings are export names (v0.3.12)", m111 && m111.exportNames, ["useX"]);
    const m222 = mm.modules.find((m) => String(m.id) === "222");
    eq("module-map — paired-form export names still read (v0.3.12)", m222 && m222.exportNames, ["Bar"]);
  } catch (e) { bad("module-map — inlined export body", String(e.stderr || e.stdout || e.message).split("\n")[0]); }

  // F4: token stream equality sees a nested-template content change that
  // parses fine. Same code with different whitespace is EQUAL; a changed
  // template literal is not.
  const T0 = path.join(TMP, "tok-orig.js"), T1 = path.join(TMP, "tok-ws.js"), T2 = path.join(TMP, "tok-tpl.js");
  writeFileSync(T0, "const f=(e,t)=>`${iW(e)}:${t};`;export{f};\n");
  writeFileSync(T1, "const f = (e, t) => `${iW(e)}:${t};`;\nexport { f };\n");
  writeFileSync(T2, "const f = (e, t) => `$ {\n  iW(e)\n}: $ {\n  t\n};`;\nexport { f };\n");
  const vt = (a, b) => { try { execFileSync(process.execPath, [path.join(SKILL, "scripts/verify-tokens.mjs"), a, b], { stdio: "pipe" }); return true; } catch { return false; } };
  truthy("verify-tokens — whitespace-only reformat is token-identical (v0.3.10)", vt(T0, T1));
  truthy("verify-tokens — beautifier-style template mangling goes red (v0.3.10)", !vt(T0, T2));

  // F3: emit-webpack-chunk re-emits a pretty webpack chunk part-by-part and
  // its reassembly gate must be byte-exact; consumes module-map's field names.
  const PRETTY = path.join(TMP, "wp-pretty.js");
  writeFileSync(PRETTY, `(self.webpackChunk_N_E = self.webpackChunk_N_E || []).push([[2888], {\n` +
    `    10: function(e, t, n) {\n        "use strict";\n        t.exports = 1\n    },\n` +
    `    20: function(e, t, n) {\n        "use strict";\n        var z = n(10)\n    }\n}]);\n`);
  const PMAP = path.join(TMP, "wp-pretty-map.json"), GEN = path.join(TMP, "wp-gen.js"), PARTS = path.join(TMP, "wp-parts");
  try {
    execFileSync(process.execPath, [path.join(SKILL, "scripts/module-map.mjs"), "--in", PRETTY, "--out", PMAP], { stdio: "pipe" });
    execFileSync(process.execPath, [path.join(SKILL, "scripts/emit-webpack-chunk.mjs"), "--in", PRETTY, "--map", PMAP, "--out", GEN, "--parts", PARTS], { stdio: "pipe" });
    truthy("emit-webpack-chunk — parts reassemble byte-exact to the pretty chunk (v0.3.10)", readFileSync(GEN, "utf8") === readFileSync(PRETTY, "utf8"));
    execFileSync(process.execPath, [path.join(SKILL, "scripts/emit-webpack-chunk.mjs"), "--in", PRETTY, "--map", PMAP, "--out", GEN, "--parts", PARTS, "--check"], { stdio: "pipe" });
    ok("emit-webpack-chunk — --check passes on untouched parts");
  } catch (e) { bad("emit-webpack-chunk", String(e.stderr || e.stdout || e.message).split("\n")[0]); }

  // F2: verify-nextdata reads a pages-router mirror DIRECTORY (offline) and
  // compares __NEXT_DATA__ with _next/data; a changed prop goes red.
  const ND = path.join(TMP, "nd-a"), NDB = path.join(TMP, "nd-b");
  const nd = (dir, title) => {
    mkdirSync(path.join(dir, "_next/data/BUILD1"), { recursive: true });
    const props = { pageProps: { title, items: [{ _key: "k1", v: 1 }] }, __N_SSG: true };
    writeFileSync(path.join(dir, "index.html"), `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props, page: "/", query: {}, buildId: "BUILD1" })}</script></html>`);
    writeFileSync(path.join(dir, "_next/data/BUILD1/index.json"), JSON.stringify(props));
  };
  nd(ND, "hello"); nd(NDB, "hello");
  const vn = (a, b) => { try { execFileSync(process.execPath, [path.join(SKILL, "scripts/verify-nextdata.mjs"), "--a", a, ...(b ? ["--b", b] : []), "--routes", "/"], { stdio: "pipe" }); return true; } catch { return false; } };
  truthy("verify-nextdata — single side: __NEXT_DATA__ agrees with _next/data (v0.3.10)", vn(ND));
  truthy("verify-nextdata — two identical sides pass", vn(ND, NDB));
  nd(NDB, "changed");
  truthy("verify-nextdata — a changed pageProp goes red", !vn(ND, NDB));
}

// ------------------------------ 5a3. make-standalone refuses to run blind (v0.3.11)
{
  // 14islands F15: `--shell` defaulted to "site", so a usage probe EXECUTED the
  // defaults and copied a 1.27 GB mirror into src/public/. No --shell → usage,
  // exit 2, nothing written.
  const D = path.join(TMP, "standalone-blind");
  mkdirSync(D, { recursive: true });
  let code = 0;
  try { execFileSync(process.execPath, [path.join(SKILL, "tools/make-standalone.mjs")], { cwd: D, stdio: "pipe" }); }
  catch (e) { code = e.status; }
  truthy("make-standalone — no --shell exits 2 without writing (v0.3.11)", code === 2 && readdirSync(D).length === 0, `exit ${code}, wrote ${readdirSync(D).join(",")}`);
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

// ------------------- 5d. cold-audit-decls: flat-bundle roll-call (v0.3.14, samsyninja)
// A scope-hoisted bundle has no module containers, so the M(n) roll-call unit is the
// depth-0 declaration. The samsyninja M11.1 review did this by hand for one region and
// nobody could rerun it. Fixture pins: (a) depth-0 class/function/const-chain/
// destructuring bindings are collected, nested ones are not; (b) a citation range in a
// port comment covers a declaration (incl. --slack 1 off-by-one); (c) an uncited one is
// UNKNOWN and exits 1; (d) overrides bucket it and exit 0; (e) an override naming a
// declaration the scan cannot find is FATAL (exit 2); (f) a `match` range override
// touches only the lines it matches.
{
  const FX = path.join(TMP, "cold-decls");
  mkdirSync(path.join(FX, "port"), { recursive: true });
  const pretty = [
    "class Foo {",                       // L1
    "    constructor() { const inner = 1; }",
    "}",
    "function bar(x) {",                 // L4
    "    function nested() {}",
    "    return x;",
    "}",
    "const a = 1,",                      // L8 a
    "    b = {",                         // L9 b
    "        cls: 1",
    "    },",
    "    { c, d: e } = bar(a);",         // L12 c, e
    "var q = 2;",                        // L13 q
    "const hoisted = {",                 // L14 hoisted (match-able)
    "    class: \"x\"",
    "};",
    "",
  ].join("\n");
  writeFileSync(path.join(FX, "pretty.js"), pretty);
  writeFileSync(path.join(FX, "port", "foo.js"), "// Port of Foo + bar (pretty L1-L7)\nexport class Foo {}\n// b lives here (pretty L9), so does q — L12 covers c/e via slack\nexport const b = {};\n");
  const run = (extra) => {
    try { return { code: 0, out: execFileSync(process.execPath, [path.join(SKILL, "scripts/cold-audit-decls.mjs"), "--pretty", path.join(FX, "pretty.js"), "--ranges", "1-20", "--port", path.join(FX, "port"), ...extra], { cwd: SKILL, stdio: "pipe" }).toString() }; }
    catch (e) { return { code: e.status, out: String(e.stdout || "") + String(e.stderr || "") }; }
  };
  const r1 = run([]);
  truthy("cold-audit-decls — depth-0 roll-call finds Foo/bar/a/b/c/e/q/hoisted, not inner/nested", /examined 8\/8/.test(r1.out) && !/inner|nested/.test(r1.out), r1.out.split("\n").slice(0, 4).join(" | "));
  truthy("cold-audit-decls — cited ranges + slack cover Foo/bar/a/b/q/c/e; uncited `hoisted` is UNKNOWN → exit 1", r1.code === 1 && /UNKNOWN \(1\)/.test(r1.out) && /hoisted/.test(r1.out) && /cited 7/.test(r1.out), `exit ${r1.code}: ${r1.out.split("\n").find((l) => /cited/.test(l))}`);
  writeFileSync(path.join(FX, "ov.json"), JSON.stringify({ ranges: [{ from: 1, to: 20, bucket: "collapsed", match: "= \\{\\s*\\n\\s*class:", reason: "compiler-hoisted literal" }] }));
  const r2 = run(["--overrides", path.join(FX, "ov.json")]);
  truthy("cold-audit-decls — a `match` range override buckets only the matching line → PASS exit 0", r2.code === 0 && /collapsed 1/.test(r2.out) && /cited 7/.test(r2.out), `exit ${r2.code}`);
  writeFileSync(path.join(FX, "bad.json"), JSON.stringify({ decls: [{ name: "ghost", line: 99, bucket: "omitted", reason: "typo" }] }));
  const r3 = run(["--overrides", path.join(FX, "bad.json")]);
  truthy("cold-audit-decls — an override naming an unfound declaration is FATAL (exit 2), not silently inert", r3.code === 2 && /cannot find/.test(r3.out), `exit ${r3.code}`);
  const r4 = run(["--slack", "0"]);
  // strict: a (L8) and hoisted (L14) lose their neighbours' citations; q (L13) survives only as a
  // short-name marker ("so does q" on a line that carries L12) — named, not cited, listed for a human
  truthy("cold-audit-decls — --slack 0 reads ranges strictly: a/hoisted UNKNOWN, q demoted to named-only", r4.code === 1 && /UNKNOWN \(2\)/.test(r4.out) && /named-only 1/.test(r4.out) && /cited 5/.test(r4.out), r4.out.split("\n").find((l) => /cited/.test(l)));
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

// ------------------------------- v0.3.15 (raycastkbd): the container is not the whole file
// A Turbopack chunk carries bytes OUTSIDE the container (Sentry _debugIds
// prologue, //# debugId epilogue). slice-modules must carry both verbatim so
// the re-emitted chunk is token-identical to the original — verify-tokens was
// 0/54 red on a port whose every module was exact.
{
  const PRO = `;!function(){try{var e="undefined"!=typeof globalThis?globalThis:{},n=(new e.Error).stack;n&&((e._debugIds||(e._debugIds={}))[n]="79f61c53-98ea-5a97-2aab-08075fc42529")}catch(e){}}();\n`;
  const CON = `(globalThis.TURBOPACK || (globalThis.TURBOPACK = [])).push([\n    "object" == typeof document ? document.currentScript : void 0,\n` +
    `    618507, e => {\n        "use strict";\n        var t = e.i(271645);\n        e.s(["ActionIcon", 0, function() { return t.x }])\n    }\n]);\n`;
  const EPI = `//# debugId=79f61c53-98ea-5a97-2aab-08075fc42529\n`;
  const TP = path.join(TMP, "tp-pretty.js"), TPM = path.join(TMP, "tp-map.json"), TPC = path.join(TMP, "tp-closure.json"), TPG = path.join(TMP, "tp-gen.js");
  writeFileSync(TP, PRO + CON + EPI);
  const run = (args) => execFileSync(process.execPath, args, { stdio: "pipe" });
  try {
    run([path.join(SKILL, "scripts/module-map.mjs"), "--in", TP, "--out", TPM]);
    const map = JSON.parse(readFileSync(TPM, "utf8"));
    writeFileSync(TPC, JSON.stringify({ seed: "ALL", modules: map.modules.map((m) => m.id) }));
    run([path.join(SKILL, "scripts/slice-modules.mjs"), "--in", TP, "--map", TPM, "--closure", TPC, "--out", TPG]);
    const gen = readFileSync(TPG, "utf8");
    truthy("slice-modules — Turbopack prologue carried verbatim (v0.3.15)", gen.includes(PRO.trim()));
    truthy("slice-modules — Turbopack epilogue carried verbatim (v0.3.15)", gen.trimEnd().endsWith(EPI.trim()));
    truthy("slice-modules — header names the full regenerate command (v0.3.15)", /Regenerate:\s+node scripts\/slice-modules\.mjs --in .* --map .* --closure .* --out /.test(gen));
    let tok = true; try { run([path.join(SKILL, "scripts/verify-tokens.mjs"), TP, TPG]); } catch { tok = false; }
    truthy("slice-modules — re-emitted chunk is token-identical to the original incl. prologue (v0.3.15)", tok);
    run([path.join(SKILL, "scripts/slice-modules.mjs"), "--in", TP, "--map", TPM, "--closure", TPC, "--out", TPG, "--check"]);
    ok("slice-modules — --check passes on the fresh slice (v0.3.15)");
  } catch (e) { bad("slice-modules prologue/epilogue", String(e.stderr || e.stdout || e.message).split("\n").slice(-3).join(" | ")); }
}

// ------------------------------- v0.3.15 (raycastkbd): cold-audit examines Turbopack's classic one-parameter factory
// A loader-stub family's entry chunk registers the stub's target as
// `function(C) { C.n(C.i(850471)) }` — not an arrow, not three parameters. It fell
// through both signature shapes and the audit reported "examined only 2 of 3".
{
  const TP2 = path.join(TMP, "tp2-pretty.js"), TP2M = path.join(TMP, "tp2-map.json"), TP2C = path.join(TMP, "tp2-closure.json");
  writeFileSync(TP2, `(globalThis.TURBOPACK || (globalThis.TURBOPACK = [])).push([\n    "object" == typeof document ? document.currentScript : void 0,\n` +
    `    850471, C => {\n        "use strict";\n        C.s(["default", 0, function() { return 1 }])\n    },\n` +
    `    345458, function(C) {\n        C.n(C.i(850471))\n    }\n]);\n`);
  try {
    execFileSync(process.execPath, [path.join(SKILL, "scripts/module-map.mjs"), "--in", TP2, "--out", TP2M], { stdio: "pipe" });
    const map = JSON.parse(readFileSync(TP2M, "utf8"));
    writeFileSync(TP2C, JSON.stringify({ seed: "ALL", modules: map.modules.map((m) => m.id) }));
    const out = execFileSync(process.execPath, [path.join(SKILL, "scripts/cold-audit-modules.mjs"), "--map", TP2M, "--closure", TP2C], { stdio: "pipe" }).toString();
    truthy("cold-audit — Turbopack classic one-parameter factory is examined (v0.3.15)", /\(2\/2 module\(s\) examined\)/.test(out), out.split("\n").filter((l) => /examined/.test(l)).join(" | "));
  } catch (e) { bad("cold-audit one-parameter factory", String(e.stdout || e.stderr || e.message).split("\n").filter((l) => /FAIL|examined/.test(l)).join(" | ")); }
}

// ------------------------------- v0.3.15 (raycastkbd): serve — fallback CHAIN and a DSN stays a DSN
// Spawns serve.mjs on loopback (explicit --port, no browser). Three roots:
// site/ (top) → negotiated → mirror; the file only the last root holds must be
// served. And a stub telemetry host's DSN (userinfo URL) must be rewritten to
// a parseable same-origin DSN, not to a bare path — "Invalid Sentry Dsn" was a
// CLEAN-gate red on both sides of a byte-exact port.
{
  const { spawn } = await import("node:child_process");
  const R1 = path.join(TMP, "sv-site"), R2 = path.join(TMP, "sv-neg"), R3 = path.join(TMP, "sv-mirror");
  for (const r of [R1, R2, R3]) mkdirSync(path.join(r, "_next/static/immutable/chunks"), { recursive: true });
  writeFileSync(path.join(R3, "mirror-manifest.json"), JSON.stringify({ origin: "https://x.com", files: {} }));
  writeFileSync(path.join(R2, "only-in-neg.webp"), "RIFF");
  writeFileSync(path.join(R3, "only-in-mirror.txt"), "deep");
  writeFileSync(path.join(R3, "_next/static/immutable/chunks/app.js"),
    `init({dsn:"https://abc123@o379433.ingest.us.sentry.io/6624334"});x="https:\\/\\/abc123@o379433.ingest.us.sentry.io\\/6624334";`);
  const PORT = 29997;
  const sv = spawn(process.execPath, [path.join(SKILL, "scripts/serve.mjs"), "--root", R1, "--fallback-root", `${R2},${R3}`, "--port", String(PORT),
    "--stub-ext-hosts", "o379433.ingest.us.sentry.io"], { stdio: "pipe" });
  const get = async (p) => { const r = await fetch(`http://127.0.0.1:${PORT}${p}`); return { status: r.status, text: await r.text() }; };
  let up = false;
  for (let i = 0; i < 40 && !up; i++) { try { await fetch(`http://127.0.0.1:${PORT}/__wrs/identity`); up = true; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  try {
    if (!up) throw new Error(`serve.mjs did not come up on ${PORT}`);
    eq("serve — --fallback-root chain: second fallback answers (v0.3.15)", (await get("/only-in-mirror.txt")).status, 200);
    eq("serve — --fallback-root chain: first fallback answers (v0.3.15)", (await get("/only-in-neg.webp")).status, 200);
    const js = (await get("/_next/static/immutable/chunks/app.js")).text;
    truthy("serve — stub host DSN stays parseable, same-origin (v0.3.15)",
      js.includes(`dsn:"http://abc123@127.0.0.1:${PORT}/ext/o379433.ingest.us.sentry.io/6624334"`), js.slice(0, 160));
    truthy("serve — escaped-slash DSN spelling handled too (v0.3.15)",
      js.includes(`http:\\/\\/abc123@127.0.0.1:${PORT}\\/ext\\/o379433.ingest.us.sentry.io\\/6624334`));
    truthy("serve — no userinfo URL to the stub host survives (v0.3.15)", !/@o379433\.ingest\.us\.sentry\.io/.test(js));
    eq("serve — stub host path answers 200 (envelope endpoint) (v0.3.15)", (await get("/ext/o379433.ingest.us.sentry.io/api/6624334/envelope/")).status, 200);
  } catch (e) { bad("serve chain/DSN", String(e.message).split("\n")[0]); }
  finally { sv.kill("SIGTERM"); await new Promise((r) => sv.once("exit", r)); }
}

// ------------------------------- v0.3.16: gates that said FAIL and exited 0, flags parsed after the crash
// Every case here is offline and browser-free: each script is driven to the
// exact line that used to be wrong and asserted on its exit code and message.
{
  const run = (script, argv, opts = {}) => {
    try { return { code: 0, out: String(execFileSync(process.execPath, [path.join(SKILL, script), ...argv], { stdio: "pipe", ...opts })) }; }
    catch (e) { return { code: e.status, out: String(e.stdout || "") + String(e.stderr || "") }; }
  };
  // probe: argv is WALKED, so a flag's value is never taken as the URL. An
  // unknown flag dies before any browser (exit 2); a known one that used to be
  // missing from KNOWN_FLAGS (--expect-side) proceeds to the identity check and
  // fails THERE — nothing listens on :1 — which is the later, correct failure.
  const p1 = run("scripts/probe.mjs", ["--wait", "9000", "--bogus", "http://127.0.0.1:1/"], { cwd: TMP });
  truthy("probe — unknown flag dies before launch, exit 2 (v0.3.16)", p1.code === 2 && /unknown flag/.test(p1.out), `exit ${p1.code}: ${p1.out.slice(0, 120)}`);
  const p2 = run("scripts/probe.mjs", ["--expect-side", "mirror", "http://127.0.0.1:1/"], { cwd: TMP });
  truthy("probe — --expect-side is known and the URL survives leading flags (v0.3.16)",
    p2.code === 3 && /not a serve\.mjs instance/.test(p2.out) && !/unknown flag|Invalid URL/.test(p2.out), `exit ${p2.code}: ${p2.out.slice(0, 160)}`);
  // pixelcompare: a band file and a cross-side file must not share metric.json,
  // and the refusal comes before the server wait (no server here, and no 10 s).
  const PX = path.join(TMP, "px");
  mkdirSync(PX, { recursive: true });
  writeFileSync(path.join(PX, "metric.json"), JSON.stringify({ kind: "self-band", home: { meanAbsDiff: 1 } }));
  const p3 = run("scripts/pixelcompare.mjs", ["--a", "http://127.0.0.1:1/", "--b", "http://127.0.0.1:2/", "--out", PX], { cwd: TMP });
  truthy("pixelcompare — cross-side run refuses a self-band metric.json, exit 2 (v0.3.16)",
    p3.code === 2 && /must not share one metric\.json/.test(p3.out), `exit ${p3.code}: ${p3.out.slice(0, 160)}`);
  eq("pixelcompare — the refused file is untouched (v0.3.16)", JSON.parse(readFileSync(path.join(PX, "metric.json"), "utf8")).kind, "self-band");
  // mirror-site: NaN rounds used to be zero rounds and a green "Done".
  const p4 = run("scripts/mirror-site.mjs", ["--origin", "http://127.0.0.1:1", "--rounds", "abc", "--out", path.join(TMP, "ms-nan")]);
  truthy("mirror-site — non-numeric --rounds is a usage error, nothing written (v0.3.16)",
    p4.code === 2 && /--rounds must be an integer/.test(p4.out) && !existsSync(path.join(TMP, "ms-nan")), `exit ${p4.code}: ${p4.out.slice(0, 120)}`);
  // chrome sweep: orphan = the browser's LAUNCHER is gone, decided at the root
  // of the process tree — never "its parent is another Chrome".
  const { markOrphans } = await import(path.join(SKILL, "scripts/lib/chrome.mjs"));
  const tree = (ppid) => [{ pid: 4000001, ppid }, { pid: 4000002, ppid: 4000001 }, { pid: 4000003, ppid: 4000002 }];
  truthy("chrome — renderers of a LIVE sibling browser are not orphans (v0.3.16)", markOrphans(tree(process.pid)).every((f) => !f.orphan));
  truthy("chrome — a browser reparented to pid 1 is an orphan, renderers included (v0.3.16)", markOrphans(tree(1)).every((f) => f.orphan));
  // make-standalone: "FAIL — N asset(s) missing" used to exit 0.
  const { createHash } = await import("node:crypto");
  const sha = (b) => createHash("sha256").update(b).digest("hex");
  const MS = path.join(TMP, "ms"), MSM = path.join(MS, "mirror");
  mkdirSync(MSM, { recursive: true });
  const img = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  const shell = (extra) => `<html><img src="/a.png">${extra}</html>`;
  const ledger = (page) => {
    const files = {
      "https://mini.test/": { path: "index.html", bytes: Buffer.byteLength(page), sha256: sha(Buffer.from(page)), type: "text/html" },
      "https://mini.test/a.png": { path: "a.png", bytes: img.length, sha256: sha(img), type: "image/png" },
    };
    writeFileSync(path.join(MSM, "index.html"), page);
    writeFileSync(path.join(MSM, "a.png"), img);
    writeFileSync(path.join(MSM, "mirror-manifest.json"), JSON.stringify({ origin: "https://mini.test", files }, null, 2));
    writeFileSync(path.join(MSM, "inventory.tsv"), "SHA256\tBYTES\tPATH\tURL\n" + Object.entries(files).map(([u, r]) => [r.sha256, r.bytes, r.path, u].join("\t")).join("\n") + "\n");
  };
  const msArgs = (out) => ["--shell", path.join(MSM, "index.html"), "--mirror", MSM, "--out", path.join(MS, out), "--no-build"];
  ledger(shell(`<img src="/missing.png">`));
  const m1 = run("tools/make-standalone.mjs", msArgs("out-fail"), { cwd: SKILL });
  truthy("make-standalone — a missing ASSET exits 1 (v0.3.16)", m1.code === 1 && /FAIL — 1 asset\(s\) missing/.test(m1.out), `exit ${m1.code}: ${m1.out.slice(-200)}`);
  ledger(shell(``));
  const m2 = run("tools/make-standalone.mjs", msArgs("out-ok"), { cwd: SKILL });
  truthy("make-standalone — every asset present exits 0 (v0.3.16)", m2.code === 0 && /every referenced ASSET is present/.test(m2.out), `exit ${m2.code}: ${m2.out.slice(-200)}`);
}

// ------------------------------- v0.3.16: mirror-site against a loopback origin (no browser)
// A tiny in-process origin, two crawls. First crawl: an ABSOLUTE --out is used
// as given; a `.html` a JS chunk names goes through the page-scope guard (out of
// scope: dropped; in scope: crawled as a PAGE, its own assets fetched); and a
// `.webmanifest` reached from that page is queued as an asset and lands as a
// FILE. Second crawl, with /a.png answering 500: the carried-over GOOD row for a
// file still on disk is kept, not downgraded to an error row.
{
  const http = await import("node:http");
  const { execFile } = await import("node:child_process");
  let failA = false;
  const routes = {
    "/": ["text/html", `<html><a href="/about">about</a><script src="/app.js"></script><img src="/a.png"></html>`],
    "/app.js": ["text/javascript", `fetch("/data.json");x="/legal/site.html";y="/in/page.html";`],
    "/data.json": ["application/json", `{"img":"/b.png"}`],
    "/a.png": ["image/png", "PNGA"], "/b.png": ["image/png", "PNGB"],
    "/legal/site.html": ["text/html", `<html><img src="/legal/big.png"></html>`], "/legal/big.png": ["image/png", "BIG"],
    "/in/page.html": ["text/html", `<html><link rel="manifest" href="/in/site.webmanifest"><img src="/in/x.png"></html>`],
    "/in/x.png": ["image/png", "INX"], "/in/site.webmanifest": ["application/manifest+json", `{"name":"x"}`],
  };
  const srv = http.createServer((req, res) => {
    const r = routes[req.url];
    if (req.url === "/a.png" && failA) { res.writeHead(500); return res.end("boom"); }
    if (!r) { res.writeHead(404); return res.end("nf"); }
    res.writeHead(200, { "content-type": r[0] }); res.end(r[1]);
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${srv.address().port}`;
  const OUTM = path.join(TMP, "e2e-mirror");
  const crawl = () => new Promise((resolve) => execFile(process.execPath,
    [path.join(SKILL, "scripts/mirror-site.mjs"), "--origin", origin, "--out", OUTM, "--scope", "/in/", "--pages", "/", "--workers", "2"],
    { cwd: TMP }, (err, stdout, stderr) => resolve({ code: err ? err.code : 0, out: String(stdout) + String(stderr) })));
  const manifest = () => JSON.parse(readFileSync(path.join(OUTM, "mirror-manifest.json"), "utf8")).files;
  try {
    const c1 = await crawl();
    truthy("mirror-site — absolute --out is used as given, ledgers land there (v0.3.16)", c1.code === 0 && existsSync(path.join(OUTM, "inventory.tsv")), `exit ${c1.code}: ${c1.out.slice(-300)}`);
    truthy("mirror-site — .html named in a chunk, out of scope: dropped (v0.3.16)", !existsSync(path.join(OUTM, "legal")) && !manifest()[`${origin}/legal/site.html`]);
    truthy("mirror-site — .html named in a chunk, in scope: crawled as a page with its assets (v0.3.16)",
      /\[page\] \/in\/page\.html/.test(c1.out) && existsSync(path.join(OUTM, "in/page.html")) && existsSync(path.join(OUTM, "in/x.png")), c1.out.slice(-300));
    truthy("mirror-site — .webmanifest is queued as an asset and written as a file (v0.3.16)", statSync(path.join(OUTM, "in/site.webmanifest")).isFile());
    failA = true;
    const c2 = await crawl();
    const row = manifest()[`${origin}/a.png`];
    truthy("mirror-site — a fetch error keeps the carried-over row of a file still on disk (v0.3.16)",
      c2.code === 0 && row && row.path === "a.png" && row.sha256 && /keeping the carried-over row/.test(c2.out), `${JSON.stringify(row)} ${c2.out.slice(-200)}`);
  } catch (e) { bad("mirror-site loopback crawl", String(e.message).split("\n")[0]); }
  finally { srv.close(); }
}

// ------------------------------- v0.3.16: reference docs — unique section ids, resolvable citations, complete References list
// A rule only written in the docs decays: three duplicate-id families and a
// dangling §3.4 lived in verification-gates.md until a cold review counted them.
{
  const REF = path.join(SKILL, "references");
  const docs = readdirSync(REF).filter((f) => f.endsWith(".md"));
  const headings = {};
  const dups = [];
  for (const d of docs) {
    const ids = new Map();
    readFileSync(path.join(REF, d), "utf8").split("\n").forEach((l, i) => {
      const m = l.match(/^#{1,5}\s+§?\s*(\d+(?:\.\d+)*)\b/);
      if (!m) return;
      if (ids.has(m[1])) dups.push(`${d} §${m[1]} @${ids.get(m[1])},${i + 1}`); else ids.set(m[1], i + 1);
    });
    headings[d.replace(/\.md$/, "")] = ids;
  }
  truthy("docs — no reference doc repeats a section id (v0.3.16)", dups.length === 0, dups.slice(0, 5).join("; "));
  const names = Object.keys(headings).sort((a, b) => b.length - a.length);
  const cite = new RegExp(`(${names.join("|")})(?:\\.md)?[^§\\n]{0,40}?§\\s?(\\d+(?:\\.\\d+)*)`, "g");
  const walk = (dir, out = []) => { for (const f of readdirSync(dir)) { const p = path.join(dir, f); if (statSync(p).isDirectory()) walk(p, out); else if (/\.(md|mjs|js)$/.test(f)) out.push(p); } return out; };
  const unresolved = [];
  for (const f of [path.join(SKILL, "SKILL.md"), ...walk(REF), ...walk(path.join(SKILL, "scripts")), ...walk(path.join(SKILL, "tools"))]) {
    readFileSync(f, "utf8").split("\n").forEach((l, i) => {
      for (const m of l.matchAll(cite)) if (!headings[m[1]].has(m[2])) unresolved.push(`${path.relative(SKILL, f)}:${i + 1} ${m[1]} §${m[2]}`);
    });
  }
  truthy("docs — every `<doc> §x.y` citation resolves to a heading (v0.3.16)", unresolved.length === 0, unresolved.slice(0, 5).join("; "));
  const refList = readFileSync(path.join(SKILL, "SKILL.md"), "utf8").split("## References")[1] || "";
  const unlisted = docs.filter((d) => !refList.includes(`references/${d}`));
  truthy("docs — SKILL.md References list names every references/*.md (v0.3.16)", unlisted.length === 0, unlisted.join(", "));
}

// ------------------------------- v0.3.17: one argv contract for every script (lib/cli.mjs)
// A rule only written in the docs decays: "unknown flags must be FATAL" was
// written in v0.1.x and implemented by 9 of 57 scripts. Now every script must
// (a) answer --help with its header + a `flags:` inventory, exit 0, (b) reject an
// unknown flag with exit 2, (c) list in that inventory every flag its own usage
// block documents — the probe --expect-side bug was a documented flag that
// nothing knew.
{
  const fm = readFileSync(path.join(SKILL, "SKILL.md"), "utf8").match(/^metadata:\n\s+version:\s*"([^"]+)"/m);
  const { SKILL_VERSION } = await import(path.join(SKILL, "scripts/lib/version.mjs"));
  eq("version — lib/version.mjs matches SKILL.md frontmatter (v0.3.17)", SKILL_VERSION, fm && fm[1]);
  const scripts = [
    ...readdirSync(path.join(SKILL, "scripts")).filter((f) => /\.mjs$/.test(f) && !/example/.test(f)).map((f) => "scripts/" + f),
    ...readdirSync(path.join(SKILL, "tools")).filter((f) => /\.mjs$/.test(f)).map((f) => "tools/" + f),
    "scripts/lib/chrome.mjs", "scripts/lib/ports.mjs",
  ];
  const spawn = (rel, args) => { try { return { code: 0, out: execFileSync(process.execPath, [path.join(SKILL, rel), ...args], { cwd: TMP, stdio: "pipe", timeout: 20000 }).toString(), err: "" }; } catch (e) { return { code: e.status, out: String(e.stdout || ""), err: String(e.stderr || "") }; } };
  const noHelp = [], noReject = [], undocumented = [], skipped = [];
  for (const rel of scripts) {
    const h = spawn(rel, ["--help"]);
    if (/Cannot find package/.test(h.err)) { skipped.push(rel); continue; } // tools/ importing devDependencies not installed in this repo
    if (h.code !== 0 || !/^flags: /m.test(h.out)) { noHelp.push(`${rel} (exit ${h.code})`); continue; }
    const known = new Set((h.out.match(/^flags: (.*)$/m)?.[1] || "").match(/--[\w-]+/g) || []);
    // documented = every --flag on the usage lines of the header (a `node <name>` line and its indented continuations)
    const base = path.basename(rel);
    const header = h.out.split(/^flags: /m)[0].split("\n");
    const doc = new Set();
    for (let i = 0; i < header.length; i++) {
      if (!header[i].includes(`node ${base}`) && !header[i].includes(`node scripts/${base}`) && !header[i].includes(`node tools/${base}`)) continue;
      let j = i;
      do { for (const m of header[j].matchAll(/--([\w-]+)/g)) doc.add("--" + m[1]); j++; } while (j < header.length && /^\s+[\[<(-]/.test(header[j]));
    }
    for (const d of doc) if (!known.has(d) && d !== "--help" && d !== "--version") undocumented.push(`${rel} ${d}`);
    const u = spawn(rel, ["--zz-unknown-flag-for-selftest"]);
    if (u.code !== 2 || !/unknown flag/.test(u.err + u.out)) noReject.push(`${rel} (exit ${u.code})`);
  }
  truthy(`cli — every script answers --help with a flag inventory (${scripts.length - skipped.length} checked${skipped.length ? `, ${skipped.length} skipped: ${skipped.map((s) => path.basename(s)).join(",")}` : ""})`, noHelp.length === 0, noHelp.join("; "));
  truthy("cli — every script rejects an unknown flag with exit 2", noReject.length === 0, noReject.join("; "));
  truthy("cli — every flag on a script's usage line is in its known set", undocumented.length === 0, undocumented.slice(0, 8).join("; "));
}

// ------------------------------- v0.3.18: lib/hash — the one sha256 spelling
// 23 hand-rolled `createHash("sha256")…` sites collapsed into one module. The
// digest, the streamed digest and the short id must agree byte for byte with
// what those sites used to print (emit-webpack-chunk's sha12 column, the
// 64-hex pin in every slice header) — a ledger row and the gate that reads it
// cannot disagree about what "the sha256 of this file" means.
{
  const { sha256, sha256Short, sha256File } = await import(path.join(SKILL, "scripts/lib/hash.mjs"));
  eq("hash — sha256 of hello is the known digest (v0.3.18)", sha256("hello"), "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
  const hp = path.join(TMP, "hash-me.bin");
  const hbytes = Buffer.from("the quick brown fox\n".repeat(4096));
  writeFileSync(hp, hbytes);
  eq("hash — sha256File streams to the same digest sha256 gives the bytes (v0.3.18)", await sha256File(hp), sha256(hbytes));
  eq("hash — sha256Short(x, 12) is the first 12 hex chars (v0.3.18)", sha256Short("hello", 12), sha256("hello").slice(0, 12));
}

// ------------------------------- v0.3.18: lib/ledger — the three ledgers, written and read by one hand
// mirror-manifest.json / inventory.tsv / redirects.tsv. serve.mjs destructures
// CODE\tFROM\tTO in that order, wayback-mirror writes an empty redirects ledger
// as the bare header, and a corrupt manifest must THROW — mirror-site used to
// start a fresh ledger over it and overwrite it at the end.
{
  const L = await import(path.join(SKILL, "scripts/lib/ledger.mjs"));
  const dir = path.join(TMP, "ledger");
  const files = {
    "https://x.com/b.js": { path: "b.js", bytes: 22, sha256: "b".repeat(64) },
    "https://x.com/a.css": { path: "a.css", bytes: 11, sha256: "a".repeat(64) },
    "https://x.com/gone.png": { error: "HTTP 404" }, // no bytes on disk: a manifest row, never an inventory row
  };
  const redirects = [{ status: 301, from: "/old", to: "/new" }, { status: 301, from: "/old", to: "/new" }];
  await L.writeLedgers(dir, { origin: "https://x.com", files, redirects });
  const mf = await L.readManifest(dir);
  eq("ledger — manifest round-trips origin and files (v0.3.18)", [mf.origin, mf.files], ["https://x.com", files]);
  eq("ledger — inventory: only rows with path+sha256, sorted by path, bytes as Number (v0.3.18)", await L.readInventory(dir),
    [{ sha256: "a".repeat(64), bytes: 11, path: "a.css", url: "https://x.com/a.css" }, { sha256: "b".repeat(64), bytes: 22, path: "b.js", url: "https://x.com/b.js" }]);
  truthy("ledger — inventoryText opens with the SHA256/BYTES/PATH/URL header (v0.3.18)", L.inventoryText(files).startsWith("SHA256\tBYTES\tPATH\tURL\n"));
  eq("ledger — redirectsText dedupes identical rows and ends with a newline (v0.3.18)", L.redirectsText(redirects), "CODE\tFROM\tTO\n301\t/old\t/new\n");
  eq("ledger — redirectsText([]) is exactly the header, as wayback-mirror writes it (v0.3.18)", L.redirectsText([]), "CODE\tFROM\tTO\n");
  eq("ledger — redirects round-trip (v0.3.18)", await L.readRedirects(dir), [{ status: 301, from: "/old", to: "/new" }]);
  const added = await L.appendInventory(dir, [
    { sha256: "a".repeat(64), bytes: 11, path: "a.css", url: "https://x.com/a.css" },
    { sha256: "c".repeat(64), bytes: 33, path: "c.png", url: "https://x.com/c.png" },
  ]);
  eq("ledger — appendInventory adds only unknown paths and returns them (v0.3.18)", added.map((r) => r.path), ["c.png"]);
  eq("ledger — the appended row reads back with the rest (v0.3.18)", (await L.readInventory(dir)).map((r) => `${r.path}:${r.bytes}`), ["a.css:11", "b.js:22", "c.png:33"]);
  eq("ledger — readManifest on a missing dir is null, a fresh mirror (v0.3.18)", await L.readManifest(path.join(TMP, "no-such-mirror")), null);
  const corrupt = path.join(TMP, "ledger-corrupt");
  mkdirSync(corrupt, { recursive: true });
  writeFileSync(path.join(corrupt, L.MANIFEST_FILE), '{ "origin": "https://x.com", "files": ');
  truthy("ledger — readManifest on a corrupt manifest THROWS, never reads as empty (v0.3.18)", await L.readManifest(corrupt).then(() => false, () => true));
  eq("ledger — isBookkeeping: ledgers, tool dirs and dotfiles yes; mirror content no (v0.3.18)",
    ["inventory.tsv", "_pretty/x.js", ".DS_Store", "_next/x.js"].map((p) => L.isBookkeeping(p)), [true, true, true, false]);
}

// ------------------------------- v0.3.18: lib/negotiate — the std→bare ladder against loopback origins
// Four fetchers carried their own retry ladder. The rungs and the stop rules are
// source behaviour — a 403 has two opposite cures, a 404 is a 404, a 3xx is
// recorded not chased — so each is exercised against a tiny origin that answers
// one way, counting which rungs it saw.
{
  const { fetchProfiles, fetchLadder, BROWSER_UA, BARE_UA } = await import(path.join(SKILL, "scripts/lib/negotiate.mjs"));
  const http = await import("node:http");
  const rungs = fetchProfiles("https://cdn/x.jpg", { origin: "https://x.com" });
  eq("negotiate — the ladder is std then bare (v0.3.18)", rungs.map((r) => r.name), ["std", "bare"]);
  const [std, bare] = rungs;
  truthy("negotiate — std: BROWSER_UA, the browser's image Accept, a same-origin Referer (v0.3.18)",
    std.headers["user-agent"] === BROWSER_UA && std.headers.accept.startsWith("image/") && std.headers.referer === "https://x.com/", JSON.stringify(std.headers));
  eq("negotiate — bare: BARE_UA and */* only (v0.3.18)", bare.headers, { "user-agent": BARE_UA, accept: "*/*" });
  const origin = async (handler) => {
    const srv = http.createServer(handler);
    await new Promise((r) => srv.listen(0, "127.0.0.1", r));
    return { srv, url: `http://127.0.0.1:${srv.address().port}/x.jpg`, stop: () => new Promise((r) => { srv.closeAllConnections(); srv.close(r); }) };
  };
  // one origin per behaviour; the body is drained so the server can close
  const climb = async (handler, seen) => {
    const o = await origin((req, res) => { seen.push(req.headers["user-agent"]); handler(req, res); });
    try { const r = await fetchLadder(o.url, { origin: "http://127.0.0.1" }); if (r.res) await r.res.arrayBuffer(); return r; }
    finally { await o.stop(); }
  };
  const seen403 = [];
  const allergic = await climb((req, res) => { res.writeHead(/Mozilla/.test(req.headers["user-agent"]) ? 403 : 200); res.end("x"); }, seen403);
  truthy("negotiate — a 403 on std climbs to bare and wins (v0.3.18)", allergic.profile === "bare" && allergic.res && allergic.res.ok && allergic.error === "", JSON.stringify([allergic.profile, allergic.error]));
  eq("negotiate — the header-allergic origin saw both rungs, in order (v0.3.18)", seen403, [BROWSER_UA, BARE_UA]);
  const seen404 = [];
  const missing = await climb((req, res) => { res.writeHead(404); res.end("nf"); }, seen404);
  eq("negotiate — a 404 is a 404: std's answer, no bare retry (v0.3.18)", [missing.res.status, missing.profile, seen404.length], [404, "std", 1]);
  const seen302 = [];
  const moved = await climb((req, res) => { res.writeHead(302, { location: "/elsewhere.jpg" }); res.end(); }, seen302);
  eq("negotiate — a 302 comes back as-is with its Location, not chased, not retried (v0.3.18)", [moved.res.status, moved.res.headers.get("location"), moved.profile, seen302.length], [302, "/elsewhere.jpg", "std", 1]);
  const dead = await origin(() => {});
  await dead.stop();
  const unreachable = await fetchLadder(dead.url, { origin: "http://127.0.0.1" });
  truthy("negotiate — an unreachable origin yields res null and names the failure (v0.3.18)", unreachable.res === null && unreachable.error.length > 0, JSON.stringify(unreachable));
}

// ------------------------------- v0.3.18: lib/chrome — one flag set, one candidate list; lib/cdp — a dead port fails loudly
{
  const { headlessArgs, CHROME_CANDIDATES } = await import(path.join(SKILL, "scripts/lib/chrome.mjs"));
  const args = headlessArgs({ port: 21012, width: 100, height: 50, sentinelUrl: "about:blank" });
  truthy("chrome — headlessArgs carries the debug port and window size, sentinel URL last (v0.3.18)",
    args.includes("--remote-debugging-port=21012") && args.includes("--window-size=100,50") && args[args.length - 1] === "about:blank", args.join(" "));
  truthy("chrome — CHROME_CANDIDATES is a non-empty list of paths (v0.3.18)",
    Array.isArray(CHROME_CANDIDATES) && CHROME_CANDIDATES.length > 0 && CHROME_CANDIDATES.every((c) => typeof c === "string"));
  const { connectCdp, cdpUrlFor } = await import(path.join(SKILL, "scripts/lib/cdp.mjs"));
  const open = await connectCdp("ws://127.0.0.1:1/").then(() => "", (e) => e.message);
  truthy("cdp — connectCdp against a closed port rejects instead of hanging (v0.3.18)", /CDP websocket failed to open/.test(open), open);
  const reach = await cdpUrlFor(1, { attempts: 2, intervalMs: 10 }).then(() => "", (e) => e.message);
  truthy("cdp — cdpUrlFor gives up and says so (v0.3.18)", /could not reach CDP/.test(reach), reach);
}

// ------------------------------- v0.3.19: case-studies mirror their parent doc (战史外置的不变量)
// Stories moved out of references/*.md into references/case-studies/<name>.md.
// Three things must stay true as both sides evolve: every case file has a parent
// doc; every numbered heading in a case file exists in the parent (same id);
// every pointer in a parent ("case-studies/<name>.md §x.y") lands on a section
// the case file actually has — a pointer to nothing is a rule with its evidence
// silently gone.
{
  const REF = path.join(SKILL, "references");
  const CS = path.join(REF, "case-studies");
  const headingIds = (text) => new Set(text.split("\n").map((l) => l.match(/^#{1,5}\s+§?\s*(\d+(?:\.\d+)*)\b/)?.[1]).filter(Boolean));
  const orphans = [], badHeadings = [], badPointers = [];
  const caseFiles = existsSync(CS) ? readdirSync(CS).filter((f) => f.endsWith(".md")) : [];
  for (const f of caseFiles) {
    const parent = f === "skill.md" ? path.join(SKILL, "SKILL.md") : path.join(REF, f);
    if (!existsSync(parent)) { orphans.push(f); continue; }
    if (f === "skill.md") continue; // SKILL.md sections are unnumbered; pointers use section names
    const parentIds = headingIds(readFileSync(parent, "utf8"));
    const caseIds = headingIds(readFileSync(path.join(CS, f), "utf8"));
    for (const id of caseIds) if (!parentIds.has(id)) badHeadings.push(`${f} §${id}`);
    const doc = readFileSync(parent, "utf8");
    for (const m of doc.matchAll(new RegExp(`case-studies/${f.replace(".", "\\.")}\`?\\s*§\\s?(\\d+(?:\\.\\d+)*)`, "g"))) if (!caseIds.has(m[1])) badPointers.push(`${f} §${m[1]}`);
  }
  truthy(`docs — every case-studies file has a parent doc (${caseFiles.length} case files)`, orphans.length === 0, orphans.join(", "));
  truthy("docs — every case-studies heading exists in its parent doc", badHeadings.length === 0, badHeadings.slice(0, 8).join("; "));
  truthy("docs — every 实证 pointer lands on a section the case file has", badPointers.length === 0, badPointers.slice(0, 8).join("; "));
}

// ---------------------------------------------------------------- summary
rmSync(TMP, { recursive: true, force: true });
console.log(`\n${fail ? "FAIL" : "PASS"} — ${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
