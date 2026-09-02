// urlpath.mjs — THE url -> local-path mapping. One implementation, shared by
// mirror-site.mjs (writes the bytes), netcapture.mjs (diffs against them),
// serve.mjs (reads them) and verify-mirror.mjs (audits them).
//
// WHY THIS EXISTS — the collapse that turns every downstream gate green
// ---------------------------------------------------------------------------
// Each of those scripts used to carry its own copy of `localPathFor()`, and all
// of them keyed on `u.pathname` alone. On any site whose image CDN is a QUERY-
// PARAMETERISED TRANSFORM (Shopify, Cloudinary, imgix, Next/image, Wix, …) the
// query string is not decoration — it selects which bytes come back. Measured
// on objectandarchive.com (2026-08-13), one pathname, three responses:
//
//     /cdn/shop/files/x.jpg?v=1775999782&width=320     43,196 B
//     /cdn/shop/files/x.jpg?v=1775999782&width=600    163,064 B
//     /cdn/shop/files/x.jpg?v=1775999782&width=1200   328,321 B
//
// A pathname-only mapping lands all three on one file. The damage is SILENT,
// which is the whole point of this module:
//   - the mirror stops being a byte-level restatement of the origin's URL space
//     (mirroring.md §0), and inventory.tsv's sha256 describes whichever variant
//     happened to be written last — a race between crawler workers;
//   - the server answers every ?width= with that one file, so a srcset picks a
//     32px icon for a 1200px slot AND STILL RENDERS: the zero-404 gate, the
//     console gate and the zero-outbound gate all go green on a wrong mirror;
//   - the capture pass keys its ledger by url+search but resolves disk by
//     pathname, so every variant after the first reports HAVE. GAP = 0, falsely.
//
// Nothing downstream can catch this, because everything downstream asks "does
// it render?" and the answer is yes. That is why scripts/verify-mirror.mjs
// exists and why its first assertion is injectivity of THIS function.
//
// THE MAPPING
// ---------------------------------------------------------------------------
//   /cdn/shop/x.jpg?v=1&width=600   ->  cdn/shop/x@@v=1&width=600.jpg
//   /cdn/shop/x.jpg                 ->  cdn/shop/x.jpg
//   /collections/foo?page=2         ->  collections/foo@@page=2/index.html
//   https://cdn.other.com/a.js?b=1  ->  assets/cdn.other.com/a@@b=1.js
//
// The suffix goes BEFORE the extension so `path.extname()` keeps working —
// every consumer uses it for MIME selection and for the "is this a page?" test.
// Params are sorted, so two orderings of one request map to one file (transform
// CDNs are order-insensitive; verify with two byte-identical responses before
// relying on it). Filesystem-hostile or over-long suffixes degrade to
// `@@h<sha1-12>`: degrading on ANY hostile character rather than replacing it
// keeps the mapping injective — `?a=b/c` and `?a=b?c` would otherwise sanitise
// to the same name and re-create the collapse this module exists to prevent.
//
// POLICY — which params are part of the identity of the bytes
// ---------------------------------------------------------------------------
// Some params select bytes (`width`, `format`, `crop`); some are pure cache
// busters (`v`, `_`, `cb`) that produce identical bytes and, left in the key,
// merely store the same file twice. The default is DELIBERATELY CONSERVATIVE:
// **every param is part of the key**. Over-storing costs disk; collapsing costs
// correctness, silently. Narrow it per project only with evidence (two URLs
// differing only in that param, byte-identical responses):
//
//     node mirror-site.mjs --origin … --query-ignore v,cb        # drop busters
//     node mirror-site.mjs --origin … --query-only width,height  # keep only these
//
// The effective policy is written to <mirror>/urlpath-policy.json by the
// crawler and read back by serve/netcapture/verify-mirror, so the policy lives
// next to the bytes it produced and the four scripts CANNOT drift apart. A
// mirror written under one policy and served under another is itself a defect —
// verify-mirror.mjs reports it as MAPPING DRIFT.

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const POLICY_FILE = "urlpath-policy.json";

/**
 * The identity of a fetched resource. RFC 3986: the FRAGMENT is never sent to
 * the server, so `x.css?v=1` and `x.css?v=1#Shape-Arch` are ONE resource with
 * one set of bytes — not two URLs that collapsed onto one file.
 *
 * This helper exists because two different things were both true and only one
 * of them was right:
 *   - localRelPath() already ignores the fragment (it reads pathname + search),
 *     so the BYTES on disk were always correct;
 *   - but a crawler that enqueues the raw href records TWO ledger rows for that
 *     one resource, and verify-mirror's injectivity gate then reports a
 *     collapse that never happened ("whichever fetch finished last won" — when
 *     in fact both fetches asked the origin for the identical thing).
 * Measured on objectandarchive M2: exactly one such pair, from a `#Shape-Arch`
 * reference on a stylesheet URL. Canonicalise on the way INTO the queue and on
 * the way into the gate, or the two disagree about how many URLs exist.
 */
export function canonicalUrl(abs) {
  try {
    const u = new URL(abs);
    u.hash = "";
    return u.href;
  } catch {
    return String(abs);
  }
}

const MAX_SUFFIX = 96;
// Anything that is illegal, magic or lossy in a path segment on macOS, Linux or
// Windows. Hitting one of these sends the whole suffix to its hash form.
const HOSTILE = /[/\\?%*:|"'<>&=\x00-\x1f\x7f]/;

/**
 * Conservative default: no param is ignored, no allow-list. Two URLs that
 * differ in any way are two files.
 */
export const DEFAULT_POLICY = Object.freeze({ ignore: [], only: null });

/**
 * Cache-buster spellings seen in the wild. NOT ignored by default — this list
 * is a menu for `--query-ignore`, not a behaviour. Passing one of these without
 * checking is how a real transform param (`t` for "trim" on some CDNs, `v` for
 * "variant" on others) gets dropped and the collapse comes back.
 */
export const COMMON_CACHE_BUSTERS = Object.freeze([
  "v", "ver", "version", "rev", "_", "t", "ts", "cb", "cachebust", "nocache",
]);

/** Accept a loose object (or nothing) and return a canonical policy. */
export function normalizePolicy(p) {
  const list = (x) =>
    (Array.isArray(x) ? x : String(x ?? "").split(","))
      .map((s) => String(s).trim())
      .filter(Boolean)
      .sort();
  if (!p) return DEFAULT_POLICY;
  const only = p.only === null || p.only === undefined || p.only === "" ? null : list(p.only);
  return Object.freeze({ ignore: list(p.ignore), only: only && only.length ? only : null });
}

/** One-line, log-friendly description — printed by every script that loads one. */
export function describePolicy(policy) {
  const p = normalizePolicy(policy);
  if (p.only) return `query policy: ONLY [${p.only.join(", ")}] in path key`;
  if (p.ignore.length) return `query policy: all params except [${p.ignore.join(", ")}]`;
  return "query policy: every query param is part of the path key (default)";
}

/** Read `--query-ignore` / `--query-only` off an argv array. */
export function policyFromArgs(args) {
  const val = (name) => {
    const i = args.indexOf("--" + name);
    return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : null;
  };
  const ignore = val("query-ignore");
  const only = val("query-only");
  if (ignore === null && only === null) return null; // "not specified", ≠ default
  return normalizePolicy({ ignore: ignore ?? [], only });
}

/**
 * Load the policy a mirror was written with. Absent file = the default, which
 * is also what a mirror produced before this module existed used implicitly.
 */
export async function loadPolicy(root) {
  try {
    return normalizePolicy(JSON.parse(await readFile(join(root, POLICY_FILE), "utf8")));
  } catch {
    return DEFAULT_POLICY;
  }
}

/** Record the policy next to the bytes it produced. */
export async function savePolicy(root, policy) {
  const p = normalizePolicy(policy);
  await writeFile(
    join(root, POLICY_FILE),
    JSON.stringify(
      {
        _comment:
          "url -> local path query policy for this mirror (scripts/lib/urlpath.mjs). " +
          "Serving or auditing the mirror under a different policy is a defect: " +
          "verify-mirror.mjs reports it as MAPPING DRIFT.",
        ignore: p.ignore,
        only: p.only,
      },
      null,
      2,
    ) + "\n",
  );
  return p;
}

/** The params that are part of the path key, sorted, per policy. */
function keyedParams(search, policy) {
  const p = normalizePolicy(policy);
  const out = [];
  for (const [k, v] of new URLSearchParams(search)) {
    if (p.only) {
      if (!p.only.includes(k)) continue;
    } else if (p.ignore.includes(k)) continue;
    out.push([k, v]);
  }
  return out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
}

/** Normalised, filesystem-safe encoding of a URL search string ("" if none). */
export function querySuffix(search, policy = DEFAULT_POLICY) {
  if (!search || search === "?") return "";
  const params = keyedParams(search, policy);
  if (!params.length) return "";
  const raw = params.map(([k, v]) => (v === "" ? k : `${k}=${v}`)).join("&");
  // HOSTILE is tested against each key and value SEPARATELY, never against the
  // joined string: `&` and `=` are the join characters, so they are legal in the
  // result but ambiguous inside a value (`?a=b&c` vs `?a=b%26c`) — both cases
  // therefore go to the hash form, which is injective by construction.
  const hostile = params.some(([k, v]) => HOSTILE.test(k) || HOSTILE.test(v));
  if (hostile || raw.length > MAX_SUFFIX) {
    return "@@h" + createHash("sha1").update(raw).digest("hex").slice(0, 12);
  }
  return "@@" + raw;
}

/**
 * Does this path END in a file extension? The page-vs-asset test, in ONE place
 * so the writer (localRelPath) and the lookup (serveCandidates) cannot answer
 * it differently for the same name.
 * ⚠ {1,12}, not {1,8}: `.webmanifest` is ELEVEN characters and the shorter cap
 * classified it as a page, so the crawler wrote the file as a DIRECTORY with an
 * index.html inside while serve.mjs (which sees a real extension via
 * path.extname) looked for a file and 404'd. The cap still exists — it keeps a
 * path segment like `/v1.2.3` from reading as an extension — it was just set
 * before `.webmanifest`, `.geojson` and friends were common. lib/extract-refs.mjs
 * exports the same cap as EXT; the two must not drift.
 */
const hasExt = (p) => p.includes(".") && /\.[a-z0-9]{1,12}$/i.test(p);

/** Insert a query suffix into "dir/name.ext" -> "dir/name@@q.ext". */
export function withQuerySuffix(p, suffix) {
  if (!suffix) return p;
  const slash = p.lastIndexOf("/");
  const dot = p.lastIndexOf(".");
  if (dot > slash) return p.slice(0, dot) + suffix + p.slice(dot);
  return p + suffix;
}

/**
 * Mirror-relative path for an absolute URL. Origin pages land at
 * `<path>/index.html`, origin assets at `<path>`, every other host under
 * `assets/<host>/<path>` — plus the query suffix above.
 */
export function localRelPath(absUrl, originHost, policy = DEFAULT_POLICY) {
  const u = new URL(absUrl);
  const suffix = querySuffix(u.search, policy);
  // ⚠ COLLAPSE CONSECUTIVE SLASHES HERE, not somewhere downstream. Sites build
  // asset URLs by concatenating a base that ends in "/" with a path that starts
  // with one, so `…/textures//tunnels/x.png` is common and origins serve it
  // happily. The crawler used to write such a file through path.join(), which
  // silently normalises it, while this function kept the "//" — so the ledger
  // said one path, the mapping computed another, and serve.mjs (which resolves
  // through this function) would 404 on a file that is right there on disk.
  // Measured on a WebGL target: 2 texture files, caught by the mapping-drift
  // gate. Normalising in the ONE shared mapping is what keeps crawler, capture,
  // server and gate on the same answer (§2.1.1) — normalising downstream is how
  // they drifted in the first place.
  let clean = decodeURIComponent(u.pathname).replace(/\/{2,}/g, "/");
  // ⛔ A URL PATH CAN CONTINUE PAST A FILE. Storyblok's image service appends
  // transforms UNDER the original's path: `…/team-hero.jpg` is the original and
  // `…/team-hero.jpg/m/110x110/filters:format(avif):quality(70)` is a variant.
  // A naive mapping needs `team-hero.jpg` to be a file and a directory at once,
  // and the crawl fails both ways — ENOTDIR creating the variant after the
  // original, EISDIR writing the original after a variant. Measured: every
  // storyblok asset with transforms, ~1,700 entries.
  //
  // ⭐ Flatten the tail into the filename: everything after an
  // extension-bearing NON-FINAL segment joins it with the reserved "@@"
  // delimiter (the same convention query strings use). Injective — "@@" is
  // reserved — and shared by crawler, server, capture and gates via this one
  // function, which is what keeps them agreeing (§2.1.1).
  // ⚠ Gated on a KNOWN asset extension, not "any dotted segment": a version
  // directory like `/decoders/1.5.5/…` must NOT flatten — a dot-anywhere rule
  // would have silently remapped every existing mirror that has one.
  clean = clean.replace(
    /^(.*?\.(?:jpe?g|png|gif|webp|avif|svg|ico|mp4|webm|mov|mp3|wav|pdf|css|js|mjs|json|woff2?|ttf|otf|glb|gltf|ktx2|wasm|zip))(\/.+)$/i,
    (m0, file, tail) => file + "@@" + tail.slice(1).replace(/\//g, "@@"),
  );
  if (u.hostname !== originHost) {
    if (clean.endsWith("/")) clean += "index";
    return "assets/" + u.hostname + withQuerySuffix(clean, suffix);
  }
  if (clean === "/" || clean === "") return withQuerySuffix("index.html", suffix);
  let p = clean.replace(/^\/+/, "");
  if (p.endsWith("/")) p = p.slice(0, -1);
  // Extension-less origin URLs are pages; extensioned ones are assets (hasExt).
  if (!hasExt(p)) return p + suffix + "/index.html";
  return withQuerySuffix(p, suffix);
}

/**
 * Disk candidates serve.mjs should try for an incoming (pathname, search),
 * most specific first. The bare-pathname fallback is deliberate: it keeps
 * mirrors taken before this module existed working, and it answers requests
 * whose only query is a cache buster the policy ignores.
 */
export function serveCandidates(pathname, search, policy = DEFAULT_POLICY) {
  const suffix = querySuffix(search, policy);
  const out = [];
  // ⛔ THE SAME FLATTEN THE WRITER USED. localRelPath() flattens a path that
  // continues past a file (Storyblok's `x.jpg/m/110x110/filters:…` transforms)
  // into `x.jpg@@m@@110x110@@filters:…` — so the request, which arrives in the
  // SLASH spelling, must be resolved through the identical rule or the server
  // 404s on a file the crawler wrote. One library, one answer (§2.1.1).
  const flat = pathname.replace(
    /^(.*?\.(?:jpe?g|png|gif|webp|avif|svg|ico|mp4|webm|mov|mp3|wav|pdf|css|js|mjs|json|woff2?|ttf|otf|glb|gltf|ktx2|wasm|zip))(\/.+)$/i,
    (m0, file, tail) => file + "@@" + tail.slice(1).replace(/\//g, "@@"),
  );
  if (flat !== pathname) {
    // ⛔ …AND THE SAME PAGE/ASSET TEST ON THE FLATTENED NAME. The writer runs
    // hasExt() on the flattened form: `x.jpg@@m@@110x110@@filters:quality(70)`
    // ends in `)`, so it is written as `<flat>/index.html`, and a flat name that
    // does end in an extension takes the query suffix BEFORE that extension
    // (`x.jpg@@m@@y@@w=1.png`). This function emitted the bare flat name only,
    // and serve.mjs — seeing a dot somewhere in it — tried the bare file: 404 on
    // every Storyblok transform the crawler had on disk. Emit every spelling
    // localRelPath() can produce for this name, crawler's first. The bare flat
    // name stays last: it is the cross-host form (assets/<host>/… never gets an
    // index.html) and the cache-buster-only fallback.
    if (!hasExt(flat)) out.push(flat + suffix + "/index.html");
    if (suffix) out.push(withQuerySuffix(flat, suffix));
    out.push(flat);
  }
  if (suffix) {
    // ⛔ For a DIRECTORY-style path the crawler and the server used to disagree
    // about the ORDER of two operations — attach the query suffix, and append
    // `/index.html`. The crawler suffixes the last SEGMENT and then adds the
    // index (`…/defaultlinks@@locale=en_US&src=globalnav/index.html`); this
    // function suffixed the path INCLUDING its trailing slash
    // (`…/defaultlinks/@@locale=…`). Same library, same URL, two filenames, and
    // the mirror served a 404 for a file it had on disk.
    //
    // Emit the crawler's shape first, since that is the one that exists.
    if (pathname.endsWith("/")) out.push(pathname.slice(0, -1) + suffix + "/");
    out.push(withQuerySuffix(pathname, suffix));
  }
  out.push(pathname);
  return out;
}
