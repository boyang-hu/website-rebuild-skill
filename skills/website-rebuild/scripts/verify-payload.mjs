#!/usr/bin/env node
/**
 * verify-payload.mjs — the SSG PAYLOAD gate.
 *
 * Static-site generators inline the page's data as a serialised blob:
 * `window.__NUXT__=(function(a,b,c,…){…}(…))` for Nuxt 2, `__NUXT_DATA__` for
 * Nuxt 3, `self.__next_f` for Next, `__sveltekit_*` for SvelteKit. On this
 * target it is 63,491 bytes — 54% of the document — and it expands 8.9x to
 * 566 KB of content. Everything the page renders comes out of it.
 *
 * WHY IT NEEDS ITS OWN GATE, distinct from the shell byte gate:
 *
 *   The shell gate proves "the rebuild differs from the mirror only where the
 *   transform table says". It compares TEXT. A payload is not text in any
 *   meaningful sense — it is a program whose output is data, deduplicated
 *   through function arguments, with slashes escaped as / so the blob can
 *   never contain "</script>". Two payloads can differ in bytes and mean the
 *   same thing (argument order), or agree closely in bytes and mean different
 *   things (one substitution deep inside a shared argument, reused 40 times).
 *
 *   And the serve layer REWRITES INSIDE IT: url localisation has to reach the
 *   escaped spellings, or the page fetches its images from the live CDN. That
 *   is a rewrite of a serialised program by regex — which is exactly the kind
 *   of edit that can stay invisible to a byte diff and still change what the
 *   page renders.
 *
 * So: expand both sides, compare the STRUCTURE, and report where they diverge.
 *
 *   node scripts/verify-payload.mjs --a http://127.0.0.1:24001 --b http://127.0.0.1:24002 \
 *        --routes /,/works,/about,/contact
 *   node scripts/verify-payload.mjs --a <base> --routes … --dump docs/payload
 *   node scripts/verify-payload.mjs --a <base> --b <base> --routes … --allow-absent
 *
 * ⛔ It evaluates the payload with `new Function`. That is safe HERE and only
 * here: the input comes from a mirror of a site we are already running in a
 * browser, and the alternative — reimplementing the serialiser's argument
 * substitution — would be a second implementation of somebody else's format,
 * which drifts (verification-gates.md §2.1.1).
 */
import { cli } from "./lib/cli.mjs";

cli({ known: ["a", "b", "routes", "dump"], bools: ["allow-absent"], file: import.meta.url });

const args = process.argv.slice(2);
const flag = (n, d) => {
  const i = args.indexOf("--" + n);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d;
};
const A = (flag("a", "") || "").replace(/\/+$/, "");
const B = (flag("b", "") || "").replace(/\/+$/, "");
const ROUTES = flag("routes", "/").split(",").filter(Boolean);
const DUMP = flag("dump", null);
// --allow-absent: a hand-built SSG can carry NO data island at all — content
// lives in the markup, which the shell byte gate already covers. Opt-in, per
// project, AFTER verifying the absence (grep for window.__* / self.__* /
// json islands): agreement-on-absence passes, but one side having a payload
// the other lacks still fails. Without the flag, absence stays loud — a
// payload shape this gate doesn't recognize yet must not pass as "none".
const ALLOW_ABSENT = args.includes("--allow-absent");

if (!A) {
  console.error("usage: verify-payload.mjs --a <base> [--b <base>] --routes /,/x [--dump dir]");
  process.exit(2);
}

let failures = 0;
const fail = (m) => (failures++, console.log(`  FAIL ${m}`));
const ok = (m) => console.log(`  ok   ${m}`);

// The known inline payload shapes. Each returns the raw serialised source.
const SHAPES = [
  { name: "nuxt2", re: /window\.__NUXT__\s*=\s*([\s\S]*?);?\s*<\/script>/ },
  { name: "nuxt3", re: /<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/ },
];

// The push shape every Next.js App Router page streams its payload through.
const FLIGHT_PUSH = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g;

function extract(html) {
  for (const s of SHAPES) {
    const m = html.match(s.re);
    if (m) return { shape: s.name, src: m[1].trim() };
  }
  // ⭐ React flight — what every Next.js App Router page ships, and the most
  // common serialised-payload shape in the wild. This gate exists to compare a
  // payload's MEANING across sides, and it did not recognise the payload most
  // targets have: the two Nuxt shapes were the whole of its vocabulary.
  FLIGHT_PUSH.lastIndex = 0;
  let m, stream = "", pushes = 0;
  while ((m = FLIGHT_PUSH.exec(html))) {
    pushes++;
    try { stream += JSON.parse(m[1]); } catch { return null; }
  }
  if (pushes) return { shape: `flight(${pushes} pushes)`, src: stream };
  return null;
}

/**
 * Expand a flight stream into `{"<id>:<tag>": value}`.
 *
 * ⭐ Flight is not a JS expression, so it cannot be evaluated the way Nuxt's
 * payload is — but each ROW's content is JSON, so expanding row-wise puts it in
 * exactly the shape paths() already understands. A difference is then reported
 * as a row and a path, not as "these two 230 KB strings differ".
 *
 * ⛔ Length-prefixed rows are walked BY THEIR DECLARED LENGTH. Splitting on
 * newlines instead reads a T row's own newlines as row boundaries — the text is
 * length-delimited precisely because it may contain them.
 */
function expandFlight(stream) {
  const buf = Buffer.from(stream, "utf8");
  const out = {};
  let i = 0, n = 0;
  const put = (key, val) => { out[key in out ? `${key}#${n}` : key] = val; };
  while (i < buf.length) {
    const nl = buf.indexOf(0x0a, i);
    const comma = buf.indexOf(0x2c, i);
    const lineEnd = nl < 0 ? buf.length : nl;
    if (comma >= 0 && comma < lineEnd) {
      const m2 = /^([0-9a-f]*):T([0-9a-f]+)$/i.exec(buf.subarray(i, comma).toString("utf8"));
      if (m2) {
        const stop = Math.min(comma + 1 + parseInt(m2[2], 16), buf.length);
        put(`${m2[1]}:T`, buf.subarray(comma + 1, stop).toString("utf8"));
        n++; i = stop;
        continue;
      }
    }
    const line = buf.subarray(i, lineEnd).toString("utf8");
    i = lineEnd + 1;
    if (!line) continue;
    const m3 = /^([0-9a-f]*):([A-Z]?)([\s\S]*)$/.exec(line);
    if (!m3) { put(`raw:${n}`, line); n++; continue; }
    let val = m3[3];
    if (/^[[{"]/.test(m3[3])) { try { val = JSON.parse(m3[3]); } catch {} }
    put(`${m3[1]}:${m3[2]}`, val);
    n++;
  }
  return out;
}

function expand(found) {
  if (found.shape === "nuxt3-payload-file") return JSON.parse(found.src);
  if (found.shape.startsWith("flight")) return expandFlight(found.src);
  if (found.shape === "nuxt3") return JSON.parse(found.src);
  // nuxt2: an IIFE that returns the object. Evaluated, not re-implemented.
  return new Function(`return (${found.src})`)();
}

/** Stable structural key set: every path in the object, sorted. Comparing paths
 *  rather than a JSON dump means a difference is reported as a LOCATION, not as
 *  "these two 566 KB strings differ". */
function paths(v, prefix = "$", out = new Map()) {
  if (v === null || typeof v !== "object") {
    out.set(prefix, typeof v === "string" ? v : JSON.stringify(v));
    return out;
  }
  if (Array.isArray(v)) v.forEach((x, i) => paths(x, `${prefix}[${i}]`, out));
  else for (const k of Object.keys(v).sort()) paths(v[k], `${prefix}.${k}`, out);
  return out;
}

const get = async (base, route) => {
  const res = await fetch(base + route);
  if (!res.ok) throw new Error(`${base}${route} -> HTTP ${res.status}`);
  return res.text();
};

console.log(`=== verify-payload  ${A}${B ? "  vs  " + B : ""} ===\n`);

for (const route of ROUTES) {
  const htmlA = await get(A, route);
  // ⭐ Nuxt 3 can EXTERNALIZE the payload: the document references
  // `/_payload.json?<buildId>` (a devalue-encoded JSON array) instead of
  // inlining __NUXT_DATA__. When that reference exists it IS the payload, and
  // it comes FIRST: the page may also carry an inline `window.__NUXT__ = {}`
  // runtime-config assignment, which the nuxt2 shape happily grabs and then
  // fails to evaluate — a wrong-shape match reported as a corrupt payload.
  let payloadPath = null;
  {
    const m = htmlA.match(/"((?:[\w./-]*)?_payload\.json[^"]*)"/);
    if (m) payloadPath = m[1].startsWith("/") ? m[1] : "/" + m[1].replace(/^\.\//, "");
  }
  let foundA = payloadPath
    ? { shape: "nuxt3-payload-file", src: await get(A, payloadPath) }
    : extract(htmlA);
  if (!foundA) {
    if (ALLOW_ABSENT) {
      // Absence must AGREE across sides: a port that dropped the island the
      // mirror carries — or grew one — is exactly what this gate exists to see.
      if (B) {
        const htmlB0 = await get(B, route);
        const foundB0 = extract(htmlB0);
        if (foundB0) { fail(`${route} — side A has no payload but side B carries a ${foundB0.shape} island`); continue; }
      }
      console.log(`--- ${route}  [no payload island — declared absent, sides agree] ---`);
      continue;
    }
    fail(`${route} — no known SSG payload shape found`);
    continue;
  }

  let dataA;
  try {
    dataA = expand(foundA);
  } catch (e) {
    fail(`${route} — payload does not evaluate (${foundA.shape}): ${e.message}\n         A rewrite that corrupts the payload lands exactly here, and a byte diff would have called it a small change.`);
    continue;
  }
  const pA = paths(dataA);
  const ratio = (JSON.stringify(dataA).length / foundA.src.length).toFixed(1);
  console.log(`--- ${route}  [${foundA.shape}]  ${foundA.src.length} B -> ${JSON.stringify(dataA).length} B (x${ratio}), ${pA.size} leaf paths ---`);

  if (DUMP) {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const f = path.join(DUMP, (route === "/" ? "index" : route.replace(/^\//, "").replace(/\//g, "_")) + ".json");
    await fs.mkdir(path.dirname(f), { recursive: true });
    await fs.writeFile(f, JSON.stringify(dataA, null, 2));
    console.log(`       dumped -> ${f}`);
  }

  // Every URL the payload carries must be local after the serve layer's
  // rewriting. A payload URL still naming an external host is a latent outbound
  // that no load-time probe can see until the page happens to request it —
  // measured on this target: 11 escaped URLs to the media host, of which the
  // runtime probe caught exactly one.
  const external = [];
  for (const [p, v] of pA) {
    if (typeof v === "string" && /^https?:\/\/(?!127\.0\.0\.1|localhost)/.test(v)) external.push(`${p} = ${v.slice(0, 90)}`);
  }
  if (external.length) {
    console.log(`  info ${external.length} absolute URL(s) inside the payload — each must have an external.txt line:`);
    for (const e of external.slice(0, 6)) console.log(`         ${e}`);
  } else ok("no absolute external URL survives inside the payload");

  if (!B) continue;

  const htmlB = await get(B, route);
  // Same precedence as side A: the externalized payload outranks inline shapes.
  let foundB = payloadPath
    ? { shape: "nuxt3-payload-file", src: await get(B, payloadPath) }
    : extract(htmlB);
  if (!foundB) { fail(`${route} — payload missing on side B`); continue; }
  let dataB;
  try {
    dataB = expand(foundB);
  } catch (e) {
    fail(`${route} — side B payload does not evaluate: ${e.message}`);
    continue;
  }
  const pB = paths(dataB);

  const onlyA = [...pA.keys()].filter((k) => !pB.has(k));
  const onlyB = [...pB.keys()].filter((k) => !pA.has(k));
  const allDiff = [...pA.keys()].filter((k) => pB.has(k) && pA.get(k) !== pB.get(k));

  // ⭐ CLASSIFY the mismatches instead of accepting or rejecting them wholesale.
  // A port legitimately changes URLs and asset paths — localisation, and one
  // transform per chunk. It does NOT legitimately change what the payload SAYS.
  // Blanking every URL-shaped span on both sides separates the two, and does it
  // WITHOUT the transform table: a gate that replayed the table would be
  // agreeing with the builder rather than checking it (§2.1.2).
  // ⛔ ONE placeholder for both spellings. The first version used \0URL\0 for an
  // absolute URL and \0PATH\0 for a root-relative one — so LOCALISATION ITSELF,
  // the transform this gate is meant to tolerate, came out as a content
  // difference. Two placeholders is two classes; there is only one thing here.
  // Two steps, in this order:
  //   1. strip scheme+host, so an absolute URL and its localised form become the
  //      SAME path — including the extensionless ones (`/eight-journal/x`),
  //      which a path-with-extension pattern never matches and which made 52 of
  //      115 routes look like content changes;
  //   2. blank any path that carries an extension, so a chunk substitution
  //      (`x.js` -> `x.port.js`) reads as the same reference.
  //
  // ⚠ This gate cannot tell a URL that is an ADDRESS from a URL that is
  // CONTENT — an anchor whose visible text is the address it links to
  // normalises to the same thing either way. That distinction belongs to the
  // render comparison, which is where it was actually found
  // (payload-gates.md §2). Here it would pass, and saying so is part of
  // knowing what this PASS is worth.
  const blankPaths = (v) =>
    String(v)
      .replace(/https?:\/\/[^\s"'/]+/g, "")
      // `/ext/<host>/…` is the serving convention for a mirrored or stubbed
      // external host. It is the same reference wearing the local spelling, and
      // a classifier that does not know it reports every one as content.
      .replace(/\/ext\/[^\s"'/]+/g, "")
      .replace(/\/[\w./~@%+-]*\.[a-z0-9]{2,5}(?:\?[^\s"']*)?/gi, "\u0000REF\u0000");
  const pathOnly = [], contentDiff = [];
  for (const k of allDiff) (blankPaths(pA.get(k)) === blankPaths(pB.get(k)) ? pathOnly : contentDiff).push(k);
  if (pathOnly.length) {
    console.log(`  ok   ${pathOnly.length} value(s) differ ONLY inside a URL or asset path — e.g. ${pathOnly[0]}`);
    console.log(`         A: ${String(pA.get(pathOnly[0])).slice(0, 78)}`);
    console.log(`         B: ${String(pB.get(pathOnly[0])).slice(0, 78)}`);
  }
  const diff = contentDiff;
  if (onlyA.length || onlyB.length || diff.length) {
    fail(`${route} — payload structures differ: ${onlyA.length} only-in-A, ${onlyB.length} only-in-B, ${diff.length} value mismatch(es) OUTSIDE any URL`);
    for (const k of [...onlyA.slice(0, 3), ...onlyB.slice(0, 3)]) console.log(`         path only on one side: ${k}`);
    for (const k of diff.slice(0, 5)) console.log(`         ${k}\n           A: ${String(pA.get(k)).slice(0, 80)}\n           B: ${String(pB.get(k)).slice(0, 80)}`);
  } else ok(`${route} — payload agrees across sides (${pA.size} leaf paths; every difference is a URL or asset path)`);
}

console.log(failures ? `\nFAIL — ${failures} payload problem(s).` : `\nPASS — 0 payload problem(s).`);
process.exit(failures ? 1 : 0);
