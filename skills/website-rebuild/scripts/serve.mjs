#!/usr/bin/env node
// serve.mjs — zero-dependency static server for the pristine mirror (and the
// rebuild), so source and rebuild can be diffed side-by-side without network.
//
//   node serve.mjs --side mirror  --root mirror   # the source site
//   node serve.mjs --side rebuild --root dist            # the rebuild
//   node serve.mjs --side mirror --root mirror [--ext-hosts cdn.x.com,fonts.gstatic.com]
//                  [--stub-ext-hosts telemetry.example.com] [--origin-host example.com] [--port N]
//   PORT=3200 SERVE_ROOT=mirror node serve.mjs    # explicit port still wins
//
// PORTS AND IDENTITY (scripts/lib/ports.mjs — read its header once):
//   --side is what picks the port, and it is REQUIRED unless you pass an
//   explicit --port/PORT. The mirror and the rebuild therefore always land on
//   two different, self-describing ports (…1 = mirror, …2 = rebuild), and a
//   port that is already taken is a loud exit, never a silent slide to the next
//   free one. Every response also carries an x-wrs-identity token and this
//   server answers /__wrs/identity, which is how pixelcompare.mjs proves its
//   two sides are two processes instead of one server reached by two URLs.
//
// Discipline: the mirror on disk is SACRED — never rewritten. Every local-run
// adaptation happens in the response layer:
//   * full MIME map + Range requests, so <video>/<audio> can seek
//   * QUERY-AWARE file resolution (lib/urlpath.mjs): ?width=320 and ?width=1200
//     are two files, not one, on any transform CDN     [objectandarchive]
//   * redirect replay from <root>/_scripts/redirects.tsv or <root>/redirects.tsv
//     (tab-separated "CODE FROM TO" lines, header row skipped): origin routing
//     behavior is replayed from the ledger, not re-invented   [careers-kimi]
//     — minus entries that localize to a self-redirect, which would loop
//   * /ext/<host>/ mapping: text responses get absolute external-host URLs
//     rewritten to /ext/<host>/<path>, which resolves back into the mirror's
//     assets/<host>/<path>; SRI integrity attrs are dropped because rewritten
//     bytes can no longer match their hash        [samsyninja, landonorris]
//     ext hosts are auto-detected from <root>/assets/<host>/ dirs; add more
//     with --ext-hosts, and name the deliberately-unmirrored telemetry ones
//     with --stub-ext-hosts so they answer with a JS stub instead of a 404.
//     All four spellings are rewritten — plain, protocol-relative, JSON-escaped
//     and BARE HOST CONSTANT (no trailing slash)      [objectandarchive]
//   * --origin-host: the origin's own absolute/protocol-relative self-references
//     become root-relative, so an offline mirror stops phoning the live site
//     for bytes it already has                        [objectandarchive]
//   * ?__probe instrumentation: HTML responses get probe-shim.js injected so
//     both sides can be driven deterministically   [storytellingnoomo]
//   * 404.html template replay when the mirror captured one   [landonorris]
//
// Site-specific layers (e.g. careers-kimi's RSC flight payloads served from
// _rsc/ on an `RSC: 1` header) are intentionally left out — re-add per project.
//
// Adapted from storytellingnoomo-rebuild/scripts/serve.mjs and
// landonorris-rebuild/scripts/serve.mjs. Lineage:
//   samsyninja-rebuild (response-layer rewriting; mirror stays pristine)
//   -> careers-kimi-rebuild (redirect replay from ledger, RSC layer)
//   -> storytellingnoomo-rebuild ("Adapted from careers-kimi-rebuild/scripts/
//      serve.mjs"; Range support, probe-shim injection)
//   -> landonorris-rebuild (/ext/<host>/ mapping, 404 semantics, SRI strip)
//   -> racingshop-rebuild (HLS/DASH ladder MIME types)
//   -> shopifydesign-rebuild (.mov MIME, --stub-ext-hosts for hosts that are
//      rewritten into /ext/ but deliberately not mirrored).

import http from "node:http";
import { rewriteFlight, hasFlight } from "./lib/flight.mjs";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  IDENTITY_HEADER,
  IDENTITY_PATH,
  SIDES,
  SIDE_HEADER,
  describeOccupant,
  fatal,
  labelPort,
  resolvePort,
} from "./lib/ports.mjs";
// File resolution is QUERY-AWARE, using the same mapping — and the same stored
// policy — the crawler wrote with. Resolving by pathname alone answers every
// ?width=N with one arbitrary variant: the page renders, so the zero-404 gate
// goes green while the server hands out the wrong bytes. See lib/urlpath.mjs.
import { serveCandidates, loadPolicy, policyFromArgs, describePolicy } from "./lib/urlpath.mjs";

const args = process.argv.slice(2);
// Every --flag this script understands. An UNKNOWN flag is a loud failure, not
// a shrug: a flag that is silently ignored looks exactly like one that worked.
// Field case — `--fallback-root` was passed to a build of this script that did
// not have it yet; it started single-rooted without a word and every asset
// 404'd (121 problems on the first probe). A degradation nobody was told about
// is worse than a crash.
const KNOWN_FLAGS = new Set([
  "host", "port", "root", "fallback-root", "side", "origin-host", "ext-hosts",
  "stub-ext-hosts", "query-ignore", "query-only", "rewrite",
]);
{
  const unknown = args.filter((a) => a.startsWith("--") && !KNOWN_FLAGS.has(a.slice(2)));
  if (unknown.length) {
    console.error(`FATAL: unknown flag(s): ${unknown.join(" ")}`);
    console.error(`       known: ${[...KNOWN_FLAGS].map((f) => "--" + f).join(" ")}`);
    console.error(`       A silently ignored flag is a silent downgrade — refusing to start.`);
    process.exit(2);
  }
}
const flag = (name, dflt) => {
  const i = args.indexOf("--" + name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : dflt;
};

const HOST = flag("host", process.env.HOST || "127.0.0.1");
const ROOT = path.resolve(flag("root", process.env.SERVE_ROOT || "mirror"));
// --fallback-root <dir>: resolve against ROOT first, then this. asset-management.md's
// headline strategy is "the mirror is the ONLY asset store, never copy": on a
// strategy-A rebuild site/ holds just the transformed shells plus the generated
// port output, and every image/font/css/vendor byte is read from the read-only
// mirror. Without this the rebuild side needs a second copy of the mirror — a
// second place for the bytes to drift. Order matters: anything the build layer
// rewrote must win over the untransformed original.
// ⭐ A CHAIN, not one directory: `--fallback-root mirror-negotiated,mirror`.
// The independent ledger tree for negotiated variants (sanity-platform.md
// §1.2 — the browser-Accept re-grab that leaves the read-only mirror untouched)
// has to sit ABOVE the mirror on BOTH sides, and the rebuild side has already
// spent its first root on site/. Left to right; the first root that holds the
// file answers. [raycastkbd: 42 next/image rungs in mirror-negotiated/, the
// rest of the site in mirror/, site/ on top — three roots, one server]
const FALLBACK_ROOTS = flag("fallback-root", "")
  .split(",").map((s) => s.trim()).filter(Boolean).map((p) => path.resolve(p));
const FALLBACK_ROOT = FALLBACK_ROOTS[0] || null;
const ROOTS = [ROOT, ...FALLBACK_ROOTS];

// Which side of the comparison this instance is. It selects the port, it is
// stamped on every response, and it is the thing that makes a two-sided run
// legible at a glance ("…1 is the mirror, …2 is the rebuild").
const SIDE = flag("side", process.env.SERVE_SIDE || null);
if (SIDE !== null && !(SIDE in SIDES)) {
  fatal(`FATAL: --side must be one of ${Object.keys(SIDES).join(", ")}, got ${JSON.stringify(SIDE)}`, 2);
}
if (SIDE === null && !flagGiven("port") && !process.env.PORT) {
  fatal([
    "FATAL: serve.mjs needs to know which side it is serving.",
    "         node serve.mjs --side mirror  --root mirror",
    "         node serve.mjs --side rebuild --root dist",
    "       The side picks a distinct, self-describing port for each side of the",
    "       comparison; without it two instances can end up on one port and a",
    "       later A/B run compares one side with itself (lib/ports.mjs header).",
    "       Pass --port/PORT explicitly if you really want to choose the number.",
  ], 2);
}
const { port: PORT, label: PORT_LABEL } = resolvePort({
  lane: "serve",
  side: SIDE ?? "unset",
  cli: flagGiven("port") ? flag("port", null) : null,
  env: process.env.PORT || null,
});

// Per-process identity. Two serve.mjs instances never share it, so an A/B
// script can prove its two URLs are two servers and not one server twice.
const IDENTITY = {
  tool: "serve.mjs",
  side: SIDE ?? "unset",
  root: ROOT,
  port: PORT,
  pid: process.pid,
  token: randomBytes(8).toString("hex"),
  started: new Date().toISOString(),
};

function flagGiven(name) {
  return args.includes("--" + name);
}

// ---------------------------------------------------------------------------
// CONFIG — per-project constants.
// ---------------------------------------------------------------------------

// Same-origin path prefixes to answer with an empty JS stub instead of 404,
// e.g. analytics reverse-proxy blobs that were deliberately not mirrored
// (landonorris stubbed Webflow's GA proxies /nvhc, /avljl this way).
const STUB_PREFIXES = [];

// External hosts that get rewritten into /ext/<host>/ like any other ext host,
// but are then answered with an empty JS stub instead of a file, because they
// were deliberately NOT mirrored (pure telemetry: no behavior to reproduce, and
// letting them out would break the zero-outbound gate). List them here per
// project, or pass --stub-ext-hosts; register each one as a deviation.
// The rewrite is what makes this work even for runtime-built URLs: a loader
// that concatenates a "https://telemetry.example/tag/" literal with an id has
// the literal rewritten in the JS response, so the built URL is redirected too,
// and downstream hosts are never reached because their loaders never execute.
const STUB_EXT_HOSTS = [
  ...flag("stub-ext-hosts", "").split(",").map((s) => s.trim()).filter(Boolean),
];

// File extensions whose responses are eligible for external-host rewriting.
const TEXT_REWRITE = new Set([".html", ".css", ".js", ".mjs", ".json", ".svg"]);

// ⭐ THE MIRROR ALREADY KNOWS WHAT THE ORIGIN DECLARED. An extensionless URL
// (a Nuxt server route like /api/_auth/session) stores as <path>/index.html,
// and extension-guessing then serves the origin's application/json bytes as
// text/html — whereupon ofetch, which parses BY CONTENT-TYPE, hands the app a
// STRING where it awaited an object, and an enter sequence dies with zero
// failed requests to point at. The manifest records the declared type per
// entry; the server's job is to say the same thing the origin said.
const RECORDED_TYPE = new Map();
for (const root of ROOTS) {
  try {
    const mf = JSON.parse(await fsp.readFile(path.join(root, "mirror-manifest.json"), "utf8"));
    for (const rec of Object.values(mf.files || {})) {
      if (!rec || !rec.path || !rec.type) continue;
      RECORDED_TYPE.set(path.join(root, rec.path), rec.type);
      RECORDED_TYPE.set(path.join(root, rec.path, "index.html"), rec.type);
    }
  } catch {}
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".rsc": "text/x-component; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".webm": "video/webm",
  ".mp4": "video/mp4",
  // .mov shows up in real mirrors; without this it goes out as
  // application/octet-stream and <video> refuses to play it.
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  // HLS ladder (see scripts/gapfill-video.mjs). Serving a mirrored .m3u8 with
  // the wrong type makes the player refuse the manifest, so the recovered
  // renditions never play. NOTE: in a mirror, ".ts" is an MPEG-TS segment,
  // never TypeScript — never serve it as text/*.
  ".m3u8": "application/vnd.apple.mpegurl",
  ".ts": "video/mp2t",
  ".m4s": "video/iso.segment",
  ".mpd": "application/dash+xml",
  ".otf": "font/otf",
  ".ttf": "font/ttf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".hdr": "application/octet-stream",
  ".bin": "application/octet-stream",
  ".ktx2": "image/ktx2",
  ".riv": "application/octet-stream",
};

// ---------------------------------------------------------------------------

// External hosts whose absolute URLs get rewritten to /ext/<host>/. Auto-
// detected from <root>/assets/<host>/ (mirror-site.mjs layout) + --ext-hosts.
const EXT_HOSTS = [...new Set([
  // Discovered across BOTH roots: on the rebuild side the mirrored external
  // hosts live under the FALLBACK root, and missing them here leaves absolute
  // URLs to those hosts in the served bytes — the page then reaches out for real.
  ...(await Promise.all(
    ROOTS.map((r) => fsp.readdir(path.join(r, "assets"), { withFileTypes: true }).catch(() => [])),
  )).flat()
    .filter((d) => d.isDirectory() && d.name.includes("."))
    .map((d) => d.name),
  // Stubbed hosts must be rewritten too, or the page calls them for real.
  ...STUB_EXT_HOSTS,
  ...flag("ext-hosts", "").split(",").filter(Boolean),
])];

// --origin-host <host>[,<host>] — the ORIGIN's own hostname(s). Plenty of
// origins address their own assets absolutely or protocol-relatively
// (`//example.com/cdn/...`, common on platforms that serve the store CDN under
// the custom domain). Served from 127.0.0.1 those resolve to
// http://example.com/..., i.e. THE OFFLINE MIRROR SILENTLY PHONES THE LIVE SITE
// for bytes that are already on disk. Rewriting them to root-relative is a
// response-layer transform, so the mirror on disk stays byte-pristine — and it
// must be registered as a deviation in the project's plan.
const ORIGIN_HOSTS = flag("origin-host", "").split(",").map((s) => s.trim()).filter(Boolean);

// Query policy the mirror was written under (mirror-site.mjs writes it into the
// root). --query-ignore/--query-only override it, but doing so means serving a
// mirror under a mapping different from the one that produced it: fix the
// mirror instead. verify-mirror.mjs reports the mismatch as MAPPING DRIFT.
const QUERY_POLICY = policyFromArgs(args) ?? (await loadPolicy(ROOT));

// Redirect replay ledger (optional): "CODE\tFROM\tTO" per line, header skipped.
// FROM may be a bare path or the absolute URL the crawler asked for; requests
// arrive here as paths, so absolute FROMs are also keyed by their local
// equivalent (ext hosts under /ext/<host>/), otherwise the ledger loads and
// replays nothing at all.
const REDIRECTS = new Map();
let selfRedirects = 0;
const localizeUrl = (abs) => {
  const u = new URL(abs);
  return EXT_HOSTS.includes(u.hostname) ? `/ext/${u.hostname}${u.pathname}` : u.pathname;
};
const trimSlash = (p) => p.replace(/(.)\/$/, "$1");
for (const ledger of ["_scripts/redirects.tsv", "redirects.tsv"]) {
  try {
    const tsv = await fsp.readFile(path.join(ROOT, ledger), "utf8");
    for (const line of tsv.trim().split("\n").slice(1)) {
      const [code, from, to] = line.split("\t");
      if (!from || !to) continue;
      // Drop entries that LOCALIZE TO A SELF-REDIRECT. Origins routinely carry
      // http->https redirects on the same path, and a crawler that meets one
      // http:// reference records the pair faithfully. Both sides then localize
      // to the same local path — the scheme is gone and the lookup key is the
      // pathname — so replaying the entry is an infinite loop:
      // ERR_TOO_MANY_REDIRECTS on a file that is really on disk. Measured on
      // objectandarchive: one genuinely mirrored image, dead, looking exactly
      // like a mirror gap. The ledger is not wrong; replaying it locally is.
      let localFrom = from, localTo = to;
      try { if (/^https?:\/\//i.test(from)) localFrom = localizeUrl(from); } catch {}
      try { if (/^https?:\/\//i.test(to)) localTo = localizeUrl(to); } catch {}
      if (trimSlash(localFrom) === trimSlash(localTo)) {
        selfRedirects++;
        continue;
      }
      const rec = { code: Number(code), to };
      REDIRECTS.set(trimSlash(from), rec);
      if (/^https?:\/\//i.test(from)) {
        try { REDIRECTS.set(trimSlash(localizeUrl(from)), rec); } catch {}
      }
    }
    break;
  } catch {}
}

// Probe shim (optional): injected into HTML when the request carries ?__probe.
let PROBE_SHIM = null;
try {
  PROBE_SHIM = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "probe-shim.js"),
    "utf8",
  );
} catch {}

// A host reference has FOUR spellings in a real page, and each one that is left
// unhandled is an outbound request the render-level gates cannot show you:
//
//   plain          https://host/path        http://host/path
//   protocol-rel   //host/path
//   JSON-escaped   https:\/\/host\/path  and  \/\/host\/path
//   BARE CONSTANT  "https://host"           then code does host + "/v1/metrics"
//
// The escaped protocol-relative form is what Liquid's `| json` filter emits for
// a theme asset URL inside an inline script; the bare constant is how telemetry
// SDKs and platform boilerplate store their base URL (`window.shopUrl =
// 'https://example.com'`). Measured on objectandarchive with only the
// trailing-slash forms handled: the last 6 outbound requests of an otherwise
// "zero-outbound" run were 4 telemetry beacons and 2 fetches to the LIVE ORIGIN
// for a 229 KB theme asset that was on disk the whole time. Because the URL is
// built at runtime, it appears nowhere in the mirror, and the natural (wrong)
// conclusion is that it is unfixable.
// Shape 6 helper: `https:\u002F\u002Fhost\u002Fpath` (and the http/
// protocol-relative variants). The replacement keeps the SAME escaping so the
// surrounding JSON/JS string stays byte-valid — a plain "/" here would still
// parse, but it would silently change the bytes of a payload that downstream
// byte gates compare.
function unicodeSlash(text, host, to) {
  // U is the six LITERAL characters \u002F as they appear in the payload.
  // U_RE is how you match them in a RegExp: a bare "\u002F" in a pattern is a
  // unicode escape the engine resolves to "/" BEFORE matching, so the first
  // version of this silently matched real slashes and rewrote nothing. The
  // failure was invisible except by counting the survivors.
  const U = "\\u002F";
  const U_RE = "\\\\u002F";
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const toEsc = to.replace(/\//g, U);
  return text
    .replace(new RegExp(`https?:${U_RE}${U_RE}${esc(host)}${U_RE}`, "gi"), `${toEsc}${U}`)
    // No-path form inside the payload: same rule as the unescaped one — it
    // means the home page, so it becomes "/" written the payload's way.
    .replace(new RegExp(`https?:${U_RE}${U_RE}${esc(host)}(?!${U_RE})`, "gi"), toEsc || U)
    .replace(new RegExp(`${U_RE}${U_RE}${esc(host)}${U_RE}`, "gi"), `${toEsc}${U}`);
}

// --rewrite 'FROM::TO' (repeatable): a REGISTERED literal replacement applied to
// text responses. It exists for one recurring shape that no url localisation can
// reach — THE SOURCE PROGRAM BRANCHING ON ITS OWN HOSTNAME:
//
//     let CDN_PATH = "";
//     window.location.hostname == "example.com" && (CDN_PATH = "https://cdn.example");
//
// Served from 127.0.0.1 that assignment never runs, so a whole subsystem takes a
// different path and every asset request goes somewhere that does not exist.
// Measured on a WebGL target: 36 request failures per page, all of them assets,
// while the localisation layer had done its job perfectly.
//
// ⛔ THIS EDITS THE SOURCE PROGRAM, so it obeys the deviation rules: every rule
// is a §6 entry, and its FIRST HIT IS LOGGED so a rule that never fires cannot
// pass for one that worked (silence here used to be indistinguishable from
// success). asset-management.md §3 is the precedent — the same response-layer
// rewrite of a CDN base, registered.
//
// The faithful alternative is to make the browser believe the hostname
// (`--host-resolver-rules=MAP host 127.0.0.1:PORT`), which needs no source edit
// at all. It is blocked here for a mundane reason worth writing down: these
// scripts verify the server's identity with Node's fetch, and Node does not
// share Chrome's resolver rules, so the two halves would disagree about what
// they are talking to.
const REWRITES = args
  .map((a, i) => (a === "--rewrite" ? args[i + 1] : null))
  .filter(Boolean)
  .map((spec) => {
    const at = spec.indexOf("::");
    if (at < 0) {
      console.error(`FATAL: --rewrite needs FROM::TO, got ${JSON.stringify(spec)}`);
      process.exit(2);
    }
    return { from: spec.slice(0, at), to: spec.slice(at + 2), hits: 0 };
  });

function rewrite(text, ext) {
  // Rewritten bytes can no longer match SRI hashes; drop integrity attrs (HTML only).
  if (ext === ".html") text = text.replace(/ integrity="[^"]*"/g, "");
  // ⛔ Length-prefixed payloads first, and out of band: rewriteFlight() hands
  // each row's content to rewriteText() on its own and re-declares the length.
  // If the blanket pass below reached those rows it would shorten them without
  // touching the prefix, which is the corruption this exists to prevent.
  if (ext === ".html" && hasFlight(text)) {
    const done = rewriteFlight(text, (t) => rewriteText(t, ext));
    if (done !== null) return done;
  }
  return rewriteText(text, ext);
}

function rewriteText(text, ext) {
  // ⛔ A DSN IS A PARSED ADDRESS, NOT A FETCH TARGET. Normalising the userinfo
  // away (below) and then localising the host turns Sentry's
  //     https://<key>@o3794….ingest.us.sentry.io/6624334
  // into `/ext/o3794….ingest.us.sentry.io/6624334`, which `new Dsn()` rejects:
  // "Invalid Sentry Dsn" on the console of BOTH sides — a CLEAN-gate red that
  // reads like a port bug and that no static gate can see (raycastkbd). For
  // STUB hosts keep the DSN a DSN: scheme + userinfo + THIS server +
  // /ext/<host>/<path>. Sentry parses it, posts its envelopes to
  // /ext/<host>/api/<project>/envelope/, the stub answers 200 — same-origin,
  // zero egress, and the SDK initialises exactly as it does on the origin.
  for (const h of STUB_EXT_HOSTS) {
    const eh = h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    text = text
      .replace(new RegExp(`https?://([\\w.+-]+(?::[^@/\\s"']*)?)@${eh}/`, "gi"), (m, ui) => `http://${ui}@${HOST}:${PORT}/ext/${h}/`)
      .replace(new RegExp(`https?:\\\\/\\\\/([\\w.+-]+(?::[^@\\s"']*)?)@${eh}\\\\/`, "gi"), (m, ui) => `http:\\/\\/${ui}@${HOST}:${PORT}\\/ext\\/${h}\\/`);
  }
  // ⛔ A URL CAN CARRY USERINFO, AND EVERY HOST SHAPE BELOW MISSES IT. Sentry's
  // DSN is the canonical case: `https://<key>@o3794….ingest.us.sentry.io/…`
  // sits in a chunk, the stub host is listed, and the request still went out —
  // because `https://host/` never occurs in the text; `https://key@host/` does.
  // Normalize the userinfo away for LISTED hosts only (plain and \/-escaped
  // spellings), then the ordinary shapes localise what remains.
  for (const h of [...ORIGIN_HOSTS, ...EXT_HOSTS]) {
    const eh = h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    text = text
      .replace(new RegExp(`https?://[\\w.+-]+(?::[^@/\\s"']*)?@${eh}`, "gi"), (m) => m.slice(0, m.indexOf(":")) + "://" + h)
      .replace(new RegExp(`https?:\\\\/\\\\/[\\w.+-]+(?::[^@\\s"']*)?@${eh}`, "gi"), (m) => m.slice(0, m.indexOf(":")) + ":\\/\\/" + h);
  }
  for (const h of ORIGIN_HOSTS) {
    text = text.replaceAll(`https://${h}/`, "/").replaceAll(`http://${h}/`, "/");
    // The NO-PATH form: `https://host` with nothing after it means the home
    // page, so it localises to "/" — not to "" (an empty href points at the
    // CURRENT page, a silently broken link) and not left alone (it would point
    // at the live origin). Found by the payload gate, which saw this side and
    // the build layer disagree on the same input.
    text = text.replace(new RegExp(`https?://${h.replace(/\./g, "\\.")}(?![/\\w.-])`, "g"), "/");
    text = text.replaceAll(`https:\\/\\/${h}\\/`, "\\/").replaceAll(`http:\\/\\/${h}\\/`, "\\/");
    text = text.replaceAll(`\\/\\/${h}\\/`, "\\/");
    // Shape 6: UNICODE-ESCAPED slashes. Serialised payloads escape "/" as
    // \u002F so the blob can never contain a literal "</script>" — Nuxt's
    // devalue does it, and so do several other SSG payload serialisers.
    // Measured on a Nuxt SSG target: 11 URLs to the media host survived every
    // other shape in this function and sat inside window.__NUXT__; the runtime
    // zero-outbound probe caught exactly ONE of them (the only one that page
    // happened to request), so ten were latent outbound.
    text = unicodeSlash(text, h, "");
    if (ext === ".html" || ext === ".css") text = text.replaceAll(`//${h}/`, "/");
    text = text.replace(bareHostRe(h), "");
  }
  for (const h of EXT_HOSTS) {
    text = text.replaceAll(`https://${h}/`, `/ext/${h}/`).replaceAll(`http://${h}/`, `/ext/${h}/`);
    text = text
      .replaceAll(`https:\\/\\/${h}\\/`, `\\/ext\\/${h}\\/`)
      .replaceAll(`http:\\/\\/${h}\\/`, `\\/ext\\/${h}\\/`)
      .replaceAll(`\\/\\/${h}\\/`, `\\/ext\\/${h}\\/`);
    text = unicodeSlash(text, h, `/ext/${h}`);
    // Unescaped protocol-relative form only in markup/styles: inside JS it is
    // often concatenated with a "https:" prefix and rewriting would corrupt it.
    if (ext === ".html" || ext === ".css") text = text.replaceAll(`//${h}/`, `/ext/${h}/`);
    text = text.replace(bareHostRe(h), `/ext/${h}`);
  }
  for (const r of REWRITES) {
    if (!text.includes(r.from)) continue;
    const n = text.split(r.from).length - 1;
    if (r.hits === 0) {
      console.log(`  [rewrite] first hit: ${JSON.stringify(r.from).slice(0, 70)} -> ${JSON.stringify(r.to).slice(0, 40)}`);
    }
    r.hits += n;
    text = text.split(r.from).join(r.to);
  }
  return text;
}

// The trailing negative lookahead is load-bearing: without it the host
// "shop.app" also matches inside "shop.apple.example.com", and the rewrite
// mangles an unrelated third-party URL into a local path.
const bareHostCache = new Map();
function bareHostRe(h) {
  let re = bareHostCache.get(h);
  if (!re) {
    re = new RegExp(`https?://${h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w.-])`, "g");
    bareHostCache.set(h, re);
  }
  re.lastIndex = 0;
  return re;
}

async function statFile(p) {
  try {
    const st = await fsp.stat(p);
    if (st.isFile()) return { file: p, size: st.size };
  } catch {}
  return null;
}

async function resolveFile(pathname, search = "") {
  // Try the query-suffixed name first, then the bare pathname. serveCandidates()
  // returns [<name>@@<sorted-query><ext>, <name><ext>]; the bare fallback keeps
  // cache-buster-only queries and pre-query-aware mirrors working, while
  // ?width=320 and ?width=1200 now resolve to two different files.
  for (const cand of serveCandidates(pathname, search, QUERY_POLICY)) {
    const hit = await resolveOne(cand);
    if (hit) return hit;
  }
  // ⭐ AN IMAGE-OPTIMISATION ENDPOINT IS A SERVER-SIDE INTERFACE, NOT A FILE.
  // Next.js asks for `/_next/image?url=<src>&w=<width>&q=<quality>`, where the
  // width is whatever the component decided from the viewport. A static mirror
  // can hold the widths a capture pass happened to request and NOTHING MORE —
  // the set is unbounded, so "capture them all" is not a plan, it is a loop
  // that never converges. Measured here: 73 of 115 routes still 404ed on this
  // endpoint after two capture passes, and a third would have taken nine hours.
  //
  // ⛔ REGISTER THIS AS A DEVIATION. The bytes served are the ORIGINAL image,
  // not the origin's resized-and-recompressed one, so they are larger and
  // sharper than what the live site sends. That is a real difference and it is
  // declared; the alternative was a permanent 404 on most routes, which is a
  // bigger one. The original is genuinely in the mirror — this resolves the
  // interface, it does not invent an asset.
  // ⭐ THE OTHER HALF OF THE BARE FALLBACK. serveCandidates() handles
  // "request HAS a query, file has none" — a cache buster the mirror ignored.
  // The reverse also happens: the document references `/x.svg` while the mirror
  // stored `x@@dpl=….svg`, because the URL it was FETCHED by carried the
  // origin's deployment id. Measured on the built site: several such
  // references, all present on disk, all 404ing.
  //
  // ⛔ Only when the variant is UNAMBIGUOUS. Two variants of one path are two
  // resources (`?width=320` vs `?width=1200`), and answering either from a bare
  // request is exactly the collapse verify-mirror's injectivity gate exists to
  // catch. One variant, serve it; more than one, 404 and let the gate speak.
  // With OR without a query: a bare request finds its one stored variant, and a
  // query whose exact variant was never stored finds the equivalent one — both
  // only when unambiguous (see resolveSoleQueryVariant).
  {
    const only = await resolveSoleQueryVariant(pathname);
    if (only) return only;
  }

  const opt = imageEndpointSource(pathname, search);
  if (opt) {
    const hit = await resolveFile(opt.pathname, opt.search);
    if (hit) { IMAGE_ENDPOINT_HITS++; return hit; }
    // ⚠ The endpoint's `url=` parameter carries the path WITHOUT the query the
    // origin serves that file under. The mirror stored it query-suffixed
    // (`x@@dpl=…​.png`) because that is the URL it was fetched by, so an exact
    // match cannot succeed and the asset looks absent while sitting right
    // there. Measured: 28 source images across the built site.
    const any = await resolveAnyQueryVariant(opt.pathname);
    if (any) { IMAGE_ENDPOINT_HITS++; return any; }
  }
  return null;
}

/** Every stored variant of a path, whatever query suffix it was mirrored under. */
async function queryVariantsOf(pathname) {
  const clean = path.normalize(decodeURIComponent(pathname));
  if (clean.split(/[/\\]/).some((seg) => seg === "..")) return [];
  const ext = path.extname(clean);
  const base = clean.slice(0, clean.length - ext.length).replace(/^\//, "");
  const out = [];
  for (const root of ROOTS) {
    const dir = path.join(root, path.dirname(base));
    let names;
    try { names = await fsp.readdir(dir); } catch { continue; }
    const stem = path.basename(base) + "@@";
    for (const n of names) if (n.startsWith(stem) && n.endsWith(ext)) out.push(path.join(dir, n));
  }
  return out;
}

/**
 * Serve a request from its stored variant(s) when that is UNAMBIGUOUS:
 * exactly one variant, or several that are byte-identical.
 *
 * ⭐ The second arm is measured, not assumed. Next's `?_rsc=` token is
 * SESSION-STATE: the runtime computes a fresh one each visit, so the variant a
 * capture stored and the variant a replay requests never agree — 11 prefetch
 * 404s on a page whose mirror held every payload. Two tokens for one route
 * were byte-identical (63,738 B, same sha), which is what licenses answering
 * either request with the one payload. Differing variants still refuse:
 * ?width=320 vs ?width=1200 are two resources, and the injectivity gate owns
 * that distinction.
 */
async function resolveSoleQueryVariant(pathname) {
  const v = await queryVariantsOf(pathname);
  if (!v.length || v.length > 6) return null;
  // ⚠ A variant can be a plain file OR a directory holding index.html — the
  // url->path mapping decides per entry (an extensionless route stores as a
  // directory). Resolve each to its actual file before judging anything: the
  // first version stat'd the directory, got "not a file", and refused to serve
  // a sole variant that was sitting right there.
  const resolve1 = async (f) => (await statFile(f)) || statFile(path.join(f, "index.html"));
  const first = await resolve1(v[0]);
  if (v.length === 1) return first;
  if (!first) return null;
  const { createHash } = await import("node:crypto");
  const sha = async (f) => createHash("sha256").update(await fsp.readFile((await resolve1(f)).file)).digest("hex");
  const h0 = await sha(v[0]);
  for (const f of v.slice(1)) if (await sha(f) !== h0) return null;
  return first;
}

/**
 * Last resort for the image endpoint: any stored variant will do, because the
 * endpoint is resolving an INTERFACE and the caller already accepted that the
 * bytes are the original rather than the origin's resized ones.
 */
async function resolveAnyQueryVariant(pathname) {
  const v = await queryVariantsOf(pathname);
  return v.length ? statFile(v[0]) : null;
}

let IMAGE_ENDPOINT_HITS = 0;

/**
 * Map an image-optimisation request onto the source it names.
 * Returns null when this is not one, so the ordinary 404 stands.
 */
function imageEndpointSource(pathname, search) {
  if (!/\/_next\/image$|\/_next\/image\/$/.test(pathname)) return null;
  const q = new URLSearchParams(search.replace(/^\?/, ""));
  const src = q.get("url");
  if (!src) return null;
  // `url` may be same-origin (`/_next/static/media/x.png`) or an absolute URL on
  // a mirrored host, which localises the same way every other reference does.
  if (/^https?:\/\//i.test(src)) {
    try {
      const u = new URL(src);
      const local = EXT_HOSTS.includes(u.hostname) ? `/ext/${u.hostname}${u.pathname}` : u.pathname;
      return { pathname: local, search: u.search };
    } catch { return null; }
  }
  const at = src.indexOf("?");
  return at < 0 ? { pathname: src, search: "" } : { pathname: src.slice(0, at), search: src.slice(at) };
}

async function resolveOne(pathname) {
  // Reject traversal before touching the filesystem.
  //
  // ⛔ Traversal is a path SEGMENT equal to `..`, not the two-character
  // substring. A `includes("..")` guard also rejects perfectly legal filenames:
  // Next.js content hashes produce names like
  // `5053fba55258321d-s.p.10w.ec_utoj...woff2`, and this server answered 404 for
  // three real fonts that were sitting on disk. ⚠ The symptom arrives far from
  // the cause — as missing fonts, then as "GSAP target not found" for elements
  // that never got laid out.
  const clean = path.normalize(decodeURIComponent(pathname));
  if (clean.split(/[/\\]/).some((seg) => seg === "..")) return null;
  // ⛔ Never serve a git repository. The standard layouts point --root at
  // mirror/ or site/, where no .git lives — but a server pointed at a repo
  // root answers /.git/HEAD, and from there the whole object store walks out
  // (measured on a pre-skill rebuild whose server root WAS the repo).
  // Only `.git` is blocked, not dotfiles wholesale: mirrors legitimately
  // carry /.well-known/.
  if (clean.split(/[/\\]/).some((seg) => seg === ".git")) return null;

  for (const root of ROOTS) {
    if (clean.startsWith("/ext/")) {
      // mirror layout keeps external assets under assets/<host>/
      const hit =
        (await statFile(path.join(root, "assets", clean.slice("/ext/".length)))) ||
        (await statFile(path.join(root, clean)));
      if (hit) return hit;
      continue;
    }

    const direct = path.join(root, clean);
    // Extension-less paths are routes -> <route>/index.html.
    const candidates = path.extname(clean)
      ? [direct]
      : [path.join(direct, "index.html"), direct + ".html", direct];
    for (const c of candidates) {
      if (!c.startsWith(root)) continue;
      const hit = await statFile(c);
      if (hit) return hit;
    }
  }
  return null;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    // 0. instance identity. Stamped on EVERY response (so any client can tell
    // which side answered it) and served in full at /__wrs/identity. This is
    // what turns "two URLs" into "two provably different processes" for the
    // A/B scripts; the path is namespaced so it cannot shadow a mirrored one.
    res.setHeader(IDENTITY_HEADER, IDENTITY.token);
    res.setHeader(SIDE_HEADER, IDENTITY.side);
    if (url.pathname === IDENTITY_PATH) {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify(IDENTITY));
    }

    // 1. redirect replay — origin behavior from the ledger, before anything else
    const redirect = REDIRECTS.get(trimSlash(url.pathname));
    if (redirect) {
      // Rewrite the origin host to this server so local navigation stays local
      // (an ext host goes to its /ext/<host>/ home instead); the status code and
      // the path are the origin's. A relative Location is already local.
      let to = redirect.to;
      if (/^https?:\/\//i.test(to)) {
        const u = new URL(to);
        to = EXT_HOSTS.includes(u.hostname)
          ? `/ext/${u.hostname}${u.pathname}${u.search}`
          : `http://${req.headers.host || "localhost"}${u.pathname}${u.search}${u.hash}`;
      }
      res.writeHead(redirect.code, { location: to, "cache-control": "no-cache" });
      return res.end();
    }

    // 2. stub prefixes (unmirrored analytics proxies): keep the console quiet
    if (STUB_PREFIXES.some((p) => url.pathname.startsWith(p))) {
      res.writeHead(200, { "content-type": "text/javascript" });
      return res.end("/* stub */");
    }

    // 2b. telemetry hosts rewritten into /ext/ but never mirrored -> JS stub.
    if (STUB_EXT_HOSTS.some((h) => url.pathname.startsWith(`/ext/${h}/`))) {
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
      return res.end("/* unmirrored telemetry host: stubbed */");
    }

    // 3. file resolution (incl. /ext/<host>/ mapping)
    const hit = await resolveFile(url.pathname, url.search);
    if (!hit) {
      // Replay the origin's 404 template if the mirror captured one.
      const tpl = await statFile(path.join(ROOT, "404.html"));
      if (tpl && !url.pathname.startsWith("/ext/")) {
        const html = rewrite(await fsp.readFile(tpl.file, "utf8"), ".html");
        res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
        return res.end(html);
      }
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      return res.end("404 not found: " + url.pathname);
    }

    const ext = path.extname(hit.file).toLowerCase();
    const headers = {
      "content-type": RECORDED_TYPE.get(hit.file) || MIME[ext] || "application/octet-stream",
      "cache-control": "no-cache",
      "access-control-allow-origin": "*",
    };

    // 4. response-layer text transforms (ext-host rewrite + probe injection)
    // ⛔ "Is this text?" must use the same three-level signal as the MIME
    // answer above: recorded content-type first, extension second. A mirrored
    // Google-Fonts CSS lands as `css@@family=…` (no extension), passed the
    // rewrite gate untouched, and every absolute gstatic URL inside it walked
    // out live — measured on a dead-site rescue where that was the LAST
    // outbound request standing.
    const recType = String(RECORDED_TYPE.get(hit.file) || "");
    const textByType = /^text\/|javascript|json|xml|svg|css/i.test(recType);
    const rwExt = TEXT_REWRITE.has(ext) ? ext : (/css/i.test(recType) ? ".css" : /html/i.test(recType) ? ".html" : ".js");
    const wantsProbe = ext === ".html" && url.searchParams.has("__probe") && PROBE_SHIM;
    if (((TEXT_REWRITE.has(ext) || textByType) && (EXT_HOSTS.length || ORIGIN_HOSTS.length)) || wantsProbe) {
      let text = await fsp.readFile(hit.file, "utf8");
      if (EXT_HOSTS.length || ORIGIN_HOSTS.length) text = rewrite(text, rwExt);
      if (wantsProbe) text = text.replace(/<head([^>]*)>/i, `<head$1><script>${PROBE_SHIM}</script>`);
      const body = Buffer.from(text, "utf8");
      res.writeHead(200, { ...headers, "content-length": body.length });
      return res.end(body);
    }

    // 5. Range support, so <video>/<audio> can seek.
    const range = req.headers.range;
    if (range && /^bytes=\d*-\d*$/.test(range)) {
      const [s, e] = range.replace("bytes=", "").split("-");
      const start = s ? Number(s) : 0;
      const end = e ? Number(e) : hit.size - 1;
      if (start >= hit.size || end >= hit.size || start > end) {
        res.writeHead(416, { "content-range": `bytes */${hit.size}` });
        return res.end();
      }
      res.writeHead(206, {
        ...headers,
        "content-range": `bytes ${start}-${end}/${hit.size}`,
        "accept-ranges": "bytes",
        "content-length": end - start + 1,
      });
      return fs.createReadStream(hit.file, { start, end }).pipe(res);
    }

    res.writeHead(200, { ...headers, "content-length": hit.size, "accept-ranges": "bytes" });
    fs.createReadStream(hit.file).pipe(res);
  } catch (e) {
    res.writeHead(500, { "content-type": "text/plain" });
    res.end(String(e));
  }
});

// A taken port is a hard stop, not a nudge to the next free one: the whole
// point of the allocation is that the other scripts can find this server where
// they expect it, and a server that moved leaves them talking to whatever else
// answers there.
server.on("error", async (e) => {
  if (e.code !== "EADDRINUSE") throw e;
  fatal([
    `FATAL: serve.mjs cannot bind port ${PORT_LABEL} — it is already taken.`,
    `       occupant: ${await describeOccupant(PORT)}`,
    `       (if that is a stale serve.mjs of yours, stop it; if it is another`,
    `        workspace, give this one its own slot: WRS_PORT_SLOT=<0..8>)`,
  ]);
});

server.listen(PORT, HOST, () => {
  console.log(`serving ${ROOT}  [side ${IDENTITY.side.toUpperCase()}]`);
  console.log(`  http://${HOST}:${PORT}/`);
  console.log(`  port ${labelPort(PORT)}`);
  console.log(`  identity ${IDENTITY.token}  (GET ${IDENTITY_PATH})`);
  console.log(`  ${describePolicy(QUERY_POLICY)}`);
  if (ORIGIN_HOSTS.length) console.log(`  origin hosts -> root-relative: ${ORIGIN_HOSTS.join(", ")}`);
  if (EXT_HOSTS.length) console.log(`  ext hosts: ${EXT_HOSTS.join(", ")}`);
  if (REDIRECTS.size) console.log(`  replaying ${REDIRECTS.size} redirects from ledger`);
  if (selfRedirects) {
    console.log(`  skipped ${selfRedirects} ledger redirect(s) that localize to themselves (would loop)`);
  }
});
