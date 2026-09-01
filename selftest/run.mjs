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
