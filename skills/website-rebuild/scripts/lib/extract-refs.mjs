// extract-refs.mjs — THE asset-reference extractor: every URL shape a mirror
// has to be able to see in a text file. Shared by mirror-site.mjs (pass 1, the
// BFS crawl) and verify-mirror.mjs (pass 4, the static closure gate).
//
// It lives in lib/ for the same reason lib/urlpath.mjs does: when the crawler
// and the closure gate carry separate copies of these regexes, the gate cannot
// see the references the crawler cannot see, so the closure check reports
// "reference set − disk set = ∅" while both sides share one blind spot. A gate
// that inherits the bug it is auditing is worse than no gate.
//
// ⚠ THE LINE ABOVE IS A CLAIM, AND IT IS CHECKABLE — CHECK IT【objectarchive N12】
//     grep -l "lib/extract-refs.mjs" scripts/*.mjs
// must list exactly the callers named here. On the project that wrote this
// module, that same header sentence was true of the gate and FALSE of the
// crawler, which kept a private copy of the shapes for four milestones. A file
// header states intent; only an import statement states code, and a header that
// claims sharing while one caller has its own copy is worse than no claim —
// it makes the next fix land on one side and read as landed on both.
//
// Shapes covered, and why each one is here:
//   1. absolute            https://host/path
//   2. protocol-relative   //host/path        (quoted or parenthesised)
//   3. root-relative       src=/path.ext      on the origin itself
//   4. srcset candidates   see below — the one that hides hundreds of files
//   5. relative url(...)   inside CSS, resolved against the stylesheet's URL
//
// …and every one of them is run TWICE: once over the file's bytes, once over a
// DECODED VIEW of them (see "THE ESCAPED-URL BLIND SPOT" below).
//
// (4) is the field lesson. `srcset` / `imagesrcset` are COMMA-SEPARATED
// CANDIDATE LISTS, and only the FIRST candidate is preceded by the quote that
// shapes (1)–(3) key on; every later one starts after ", ". Measured on
// objectandarchive.com: 68 srcsets × ~5 candidates, so ~270 responsive variants
// were invisible to pass 1 — while the ledger looked complete, because the
// first candidate of every set was present. Paired with a pathname-only url ->
// path mapping (lib/urlpath.mjs) this is undetectable downstream: the page
// renders from whichever variant did land.
//
// THE ESCAPED-URL BLIND SPOT — why the second pass exists【objectarchive D-T10】
// ---------------------------------------------------------------------------
// Shape (1)'s character class excludes backslash, on purpose: a URL match must
// stop at an escape boundary. The consequence nobody drew: a URL SPELLED with
// escapes never starts matching at all. `https:\/\/host\/path` — what a
// template engine's JSON filter emits inside an inline payload (Liquid
// `| json`, PHP `json_encode`, `JSON.stringify` piped through an HTML escaper)
// — dies at the first `\/`, and the whole class of references is invisible.
// Same for `\/\/host\/path`, for the double-escaped `https:\\/\\/…` that comes
// out of JSON-inside-JSON, for the `\u002f` spelling of the same escape, and
// for `&#x2F;` in an attribute value.
//
// The causal chain, and it is the reason this file exists at all:
//
//     a hole in the DISCOVERY regex
//       -> a reference set that is missing a whole CLASS of references
//         -> pass 4 computes "reference set − disk set" over that short set
//           -> the closure gate reports "= ∅" AND IS GREEN.
//
// The gate did not fail to run. It ran, correctly, on an input that was already
// wrong — the same family as "the mirror needs its own gate" (mirroring.md
// §5.1): every downstream gate can be green because THE THING THEY MEASURE is
// the broken artefact. A gate's input can be the bug.
//
// Measured on objectandarchive.com (M(n)): reference set 1,360 -> 1,420. The 60
// invisible references included two woff2 that were referenced on three routes
// and never mirrored. Nothing downstream could catch it either — the host form
// does not render on any produced document, and an unrendered element makes no
// request (verification-gates.md §1.6 class 2), so the runtime gates were blind
// FOR A LEGITIMATE REASON. It was found by the closing per-asset copyright
// audit counting fonts, not by any gate.
//
// The fix is not "add two more regexes". Escapes COMPOSE with every other
// shape: an escaped srcset list inside a JSON-embedded HTML blob needs shape
// (4) to see through `\"` as well as `\/`. So the whole shape set is re-run
// over a decoded view of the text, and the two result sets are unioned.
// Over-inclusion is the safe direction here: a phantom reference makes this
// gate RED and gets one line in external.txt, while a missed class makes it
// GREEN and takes a copyright audit to find.
//
// Measured, differentially, over that project's 197 mirrored text files:
// 1,587 -> 1,767 references, ZERO lost. 121 of those are invisible even to the
// two-extra-regexes version of this fix, and they are why the decoding is a
// NORMALISING PASS and not a second alphabet of shapes: one string can carry
// TWO escape flavours at once. That site's JSON-LD spells an image as
//
//     "image":"https:\/\/host\/....jpg?v=1784637278\u0026width=1920"
//
// A shape written for \/ matches the head of that and then STOPS at the
// \u0026, because its class excludes backslash. So the reference does not go
// missing — it comes out TRUNCATED, as ...jpg?v=1784637278, and under a
// query-aware mapping (lib/urlpath.mjs) that is a DIFFERENT asset, which IS on
// disk. A half-understood escape turns a missing reference into a satisfied
// one: the gate stays green, holding a real file up as evidence for a claim
// about a different one. Escape flavour and escape depth are unbounded; the
// shape list is not.

// WHICH FILES GET SCANNED AT ALL — a gate's INPUT, not its assertion
// 【objectarchive N13 / D-T12】
// ---------------------------------------------------------------------------
// The shapes above answer "what does a reference look like?". This half answers
// the other question, and it is the one that went wrong: A REFERENCE THE
// EXTRACTOR COULD SEE IS STILL INVISIBLE IF NOBODY HANDS IT THE FILE.
//
// It used to be an EXTENSION WHITELIST copied into two scripts — the crawler's
// `TEXT_EXT` and the closure gate's `TEXT` — and both copies stopped at
// `html|css|js|mjs|json|svg`. Every other mirrored text format was a document
// neither side ever opened, and because BOTH sides shared the blind spot, the
// closure gate could not see it: "reference set − disk set = ∅" is computed
// over files the gate itself chose to read. Measured on objectandarchive.com
// (M0b): 16 `/collections/*.atom` feeds sat on disk, each an XML document full
// of product links and CDN image URLs in escaped `<content>` HTML, and neither
// the crawl nor the gate had ever read one. Reference set 3,109 -> 3,521.
//
// Same family as the prefix-matched excuse (verify-mirror.mjs's closure gate)
// and the escaped-URL blind spot above: NOT A WRONG ASSERTION, AN ASSERTION
// OVER A SHORT INPUT. When auditing any gate, ask how its input is delimited
// BEFORE asking whether its predicate is right.
//
// So the predicate lives here, next to the shapes, shared by both callers — and
// it is not an extension whitelist. Extensions are the origin's own naming
// choice and carry no promise (one origin serves woff2 bytes at a `.woff` URL);
// plenty of real routes have no extension at all. Three inputs, in order of how
// much they promise:
//   1. the DECLARED content-type (the origin's own statement — the oracle);
//   2. the extension (a hint, and the only thing available for an orphan file);
//   3. the bytes themselves (sniffed, for everything the first two cannot rule).
// Over-inclusion is the safe direction: scanning a binary as text costs one
// wasted regex pass, while skipping a text file costs a class of references
// that nothing downstream can recover.

/** Extensions whose bytes are text worth rescanning for references. */
export const TEXT_REF_EXT =
  /\.(html?|xhtml|css|js|mjs|cjs|jsx|ts|tsx|json|jsonld|map|webmanifest|svg|xml|atom|rss|rdf|xsl|xslt|txt|md|csv|tsv|vtt|srt|gltf|mtl)($|\?)/i;

/** Extensions whose bytes are definitely not text — never worth opening. */
export const BINARY_REF_EXT =
  /\.(png|jpe?g|gif|webp|avif|heic|bmp|ico|tiff?|psd|woff2?|ttf|otf|eot|mp4|m4v|mov|webm|mkv|avi|mp3|m4a|m4s|wav|ogg|oga|opus|flac|aac|zip|gz|br|zst|7z|rar|tar|pdf|wasm|glb|bin|dds|ktx2?|basis|hdr|exr|riv|db|sqlite)($|\?)/i;

/**
 * Declared types that mean "text worth rescanning". Tested BEFORE the binary
 * table on purpose: `image/svg+xml` matches both, and it is text.
 */
export const TEXT_REF_CONTENT_TYPE = /^text\/|javascript|ecmascript|json|xml|svg|css|manifest|atom|rss/i;

/** Declared types that mean "binary". */
export const BINARY_REF_CONTENT_TYPE =
  /^(image|font|audio|video|model)\/|application\/(wasm|zip|gzip|pdf|vnd\.ms-fontobject|x-font)/i;

/**
 * Types that carry NO information and must not be read as a declaration.
 * `application/octet-stream` is what a server says when it does not know, and
 * it is the default for every extension the origin's MIME table never heard of
 * — treating it as "binary" would rebuild the blind spot this predicate exists
 * to close (measured: a `.dat` runtime config served as octet-stream, holding
 * the only reference to one asset).
 */
export const UNINFORMATIVE_CONTENT_TYPE =
  /^(application\/octet-stream|binary\/octet-stream|application\/x-unknown|content\/unknown|\*\/\*)/i;

// NUL-free binary containers — the ones the control-character ratio below would
// not settle on its own. [byte signature, offset].
const BINARY_MAGIC = [
  [[0xff, 0xd8, 0xff], 0], // jpeg
  [[0x1f, 0x8b], 0], // gzip
  [[0x42, 0x4d], 0], // bmp
  [[0x25, 0x50, 0x44, 0x46], 0], // %PDF
  [[0x50, 0x4b, 0x03, 0x04], 0], // zip / PK
  [[0x52, 0x61, 0x72, 0x21], 0], // Rar!
  [[0x77, 0x4f, 0x46, 0x46], 0], // wOFF
  [[0x77, 0x4f, 0x46, 0x32], 0], // wOF2
  [[0x4f, 0x54, 0x54, 0x4f], 0], // OTTO
  [[0x47, 0x49, 0x46, 0x38], 0], // GIF8
  [[0x52, 0x49, 0x46, 0x46], 0], // RIFF (webp/wav/avi)
  [[0x4f, 0x67, 0x67, 0x53], 0], // OggS
  [[0x49, 0x44, 0x33], 0], // ID3
  [[0x1a, 0x45, 0xdf, 0xa3], 0], // matroska / webm
  [[0x66, 0x74, 0x79, 0x70], 4], // ISO-BMFF: mp4 / mov / avif / heic
];

const startsWith = (b, sig, off) => {
  if (b.length < off + sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (b[off + i] !== sig[i]) return false;
  return true;
};

/**
 * Last resort: do these bytes look like text? Used only when neither the
 * declared type nor the extension can rule — extensionless routes, orphan
 * files, `application/octet-stream`.
 *
 * Deliberately crude and one-directional: a NUL byte or a known binary
 * signature settles it, otherwise a low ratio of C0 control characters means
 * text. UTF-16 (NUL-padded) is therefore read as binary — mirrored responses
 * are UTF-8 in practice, and the cost of that call is one unscanned file, which
 * the closure gate will still report as a MISSING reference if it matters.
 */
export function sniffTextBytes(head) {
  if (!head || !head.length) return false;
  const b = Buffer.isBuffer(head) ? head : Buffer.from(head);
  for (const [sig, off] of BINARY_MAGIC) if (startsWith(b, sig, off)) return false;
  const n = Math.min(b.length, 4096);
  let controls = 0;
  for (let i = 0; i < n; i++) {
    const c = b[i];
    if (c === 0) return false;
    if ((c < 0x09 || (c > 0x0d && c < 0x20) || c === 0x7f) && c !== 0x1b) controls++;
  }
  return controls / n < 0.02;
}

/**
 * `true` / `false` / `null` — the third meaning "only the bytes can say".
 * Split out so a caller that would have to read from disk can decide whether
 * the read is worth it.
 */
export function textRefVerdict({ url = "", contentType = "" } = {}) {
  const t = String(contentType || "");
  if (t && !UNINFORMATIVE_CONTENT_TYPE.test(t)) {
    if (TEXT_REF_CONTENT_TYPE.test(t)) return true;
    if (BINARY_REF_CONTENT_TYPE.test(t)) return false;
  }
  const u = String(url || "");
  if (TEXT_REF_EXT.test(u)) return true;
  if (BINARY_REF_EXT.test(u)) return false;
  return null;
}

/**
 * THE predicate: should this file be rescanned for references?
 *
 *   url          the URL it was fetched from, or its local path (extension hint)
 *   contentType  what the origin DECLARED (from the response or the ledger)
 *   head         first bytes, if the caller already has them (or can cheaply
 *                read them); without it an inconclusive file reads as "no"
 */
export function isTextRefSource({ url = "", contentType = "", head = null } = {}) {
  const v = textRefVerdict({ url, contentType });
  if (v !== null) return v;
  return head ? sniffTextBytes(head) : false;
}

/**
 * HTML entities that appear inside URL attributes — including the ones that
 * hide the URL's own syntax (`&#x2F;` for "/", `&#58;` for ":"). Decimal and
 * hex spellings, with or without leading zeros; applied repeatedly-encoded
 * text decodes one layer per pass because `&amp;#x2F;` -> `&#x2F;` -> "/".
 */
export function decodeEntities(s) {
  return s
    .replace(/&(?:amp|#0*38|#[xX]0*26);/g, "&")
    .replace(/&(?:quot|#0*34|#[xX]0*22);/g, '"')
    .replace(/&(?:apos|#0*39|#[xX]0*27);/g, "'")
    .replace(/&(?:sol|#0*47|#[xX]0*2[fF]);/g, "/")
    .replace(/&(?:colon|#0*58|#[xX]0*3[aA]);/g, ":")
    .replace(/&(?:equals|#0*61|#[xX]0*3[dD]);/g, "=")
    .replace(/&(?:quest|#0*63|#[xX]0*3[fF]);/g, "?");
}

/**
 * Undo backslash escaping of the characters that carry URL syntax, so an
 * escaped reference reads like a plain one.
 *
 * Deliberately narrow: only `/ " '` and the `\u00XX` spellings of the same
 * handful of characters. A general JSON unescape would also rewrite `\n`,
 * `\t`, `\\` and the rest, which changes text that has nothing to do with
 * URLs and invents references that were never written. RUNS of backslashes
 * collapse (`\/`, `\\/`, `\\\\/` all mean "/") — that is the JSON-inside-JSON
 * case, where each nesting level doubles them.
 */
export function decodeUrlEscapes(s) {
  return s
    .replace(/\\+([/"'])/g, "$1")
    .replace(/\\+u00(2[267fF]|3[adfADF])/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/** Cheap guard: is there anything in this text that a decoded pass could reveal? */
const MAYBE_ENCODED = /\\+[/"']|\\+u00[23]|&(?:#[0-9a-fA-F]|amp|quot|apos|sol|colon|equals|quest)/;

/**
 * Build an extractor bound to one site.
 *
 *   origin      "https://example.com" (no trailing slash) — base for root-relative refs
 *   originHost  hostname of the origin
 *   assetHosts  iterable of hostnames worth following (origin host included by
 *               the caller); anything else is ignored, exactly as the crawler's
 *               ASSET_HOSTS whitelist does
 *
 * Returns `(text, baseUrl) => Set<absolute url>`.
 */
/**
 * Concatenate a document's streamed flight payload into the one string the
 * client actually parses, so a scanner never sees a push boundary. Returns null
 * when the document has no such payload.
 *
 * ⚠ The pushes are REPLACED, not appended: appending would leave the truncated
 * spellings in the text and the phantoms would survive alongside the real URLs.
 */
export function joinFlightPushes(text) {
  const PUSH = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g;
  let m, stream = "", first = -1, last = -1;
  while ((m = PUSH.exec(text))) {
    if (first < 0) first = m.index;
    last = m.index + m[0].length;
    try { stream += JSON.parse(m[1]); } catch { return null; }
  }
  if (first < 0) return null;
  return text.slice(0, first) + stream + text.slice(last);
}

export function createRefExtractor({ origin, originHost, assetHosts, onOffHost }) {
  const hosts = assetHosts instanceof Set ? assetHosts : new Set(assetHosts || []);
  // Every reference to a host NOT on the list is reported through onOffHost so
  // the caller can census it. It used to be dropped in silence, and silence is
  // indistinguishable from "there was nothing there": measured on a portfolio
  // site whose artwork lives on a custom media domain, 143 references to that
  // one host vanished without a word and the mirror looked finished at 57
  // files. netcapture.mjs has had an off-host census and an under-observation
  // warning for exactly this reason; the crawler needs the same eyes.
  const offHost = typeof onOffHost === "function" ? onOffHost : () => {};
  const ORIGIN = String(origin || "").replace(/\/+$/, "");

  const addIfAsset = (rawUrl, urls) => {
    // ⛔ A TEMPLATE PREFIX IS NOT AN ADDRESS. A URL assembled at runtime —
    //     `https://cdn.jsdelivr.net/npm/${pkg}@${ver}/dist/x.wasm`
    // scans statically as everything up to the first `${`, and that fragment is
    // an INVENTED reference in exactly the way a push-boundary truncation is:
    // it 404s, and the ledger keeps a hole for a URL that never existed.
    // ⭐ The real one is only visible to a capture pass, which is where this
    // asset was in fact found.
    if (/\$\{|\$$/.test(rawUrl)) return;
    try {
      const u = new URL(rawUrl);
      if (!hosts.has(u.hostname)) return void offHost(u.hostname, u.href);
      // Same-origin URLs without an extension are pages, not assets.
      if (u.hostname === originHost && !/\.[a-z0-9]{2,5}($|\?)/i.test(u.pathname)) return;
      u.hash = "";
      urls.add(u.href);
    } catch {}
  };

  // The five shapes, over one view of the text. Called twice per file: raw,
  // then decoded (see header — escaped spellings compose with every shape, so
  // the shapes are re-run rather than duplicated).
  const scan = (text, baseUrl, urls) => {
    // ⚠ Root-relative means relative to the DOCUMENT'S host, not the site's.
    // A playlist mirrored from video.twimg.com that says "/ext_tw_video/…"
    // means video.twimg.com/ext_tw_video/… — the browser resolves it against
    // the document it came from. Joining ORIGIN unconditionally re-homed 42
    // real HLS refs onto the origin and the closure gate demanded files from
    // a host that never served them (measured on rauchg, cross-host fMP4 HLS).
    let DOC_ORIGIN = ORIGIN;
    if (baseUrl) {
      try { DOC_ORIGIN = new URL(baseUrl).origin; } catch {}
    }
    // 1. absolute URLs
    for (const m of text.matchAll(/https?:\/\/[a-z0-9.-]+\/[^\s"'`\\<>{}|^\][]+/gi)) {
      // ⚠ Parens are handled by BALANCE, not by presence. A URL really can end
      // in ")": Storyblok's `…filters:format(avif):quality(70)`. Blind trailing
      // strips manufactured 1,593 phantom `…quality(70` URLs (v0.1.68's paren
      // lesson, third location). And the match can OVERRUN a closing paren the
      // URL never opened: inline `style="…url(https://…x.webp);--aspect:…"`
      // yielded 98 phantom `x.webp);--aspect` URLs (fourth location) — the
      // junk sits mid-string, so no trailing trim can reach it. One rule covers
      // both: truncate at the first paren that closes more than the URL ever
      // opened, left to right. The other trailing marks (, . ; : !) stay
      // unconditional: sentence punctuation around a URL in prose, never path.
      // ⚠ decodeEntities can INTRODUCE the very boundary chars the raw match
      // excluded: `&quot;image&quot;:&quot;https://…x.webp&quot;,…` matches
      // straight through, and only the decode turns &quot; back into `"`.
      // Measured here: 98 phantom `x.webp","description":"…` URLs (fifth
      // trailing-junk shape). The decoded string must re-obey the same
      // character-class boundary the raw regex enforced.
      let ref = decodeEntities(m[0]).split(/["'`\\<>{}|^\][\s]/)[0];
      let depth = 0;
      for (let i = 0; i < ref.length; i++) {
        const c = ref[i];
        if (c === "(") depth++;
        else if (c === ")" && --depth < 0) { ref = ref.slice(0, i); break; }
      }
      while (",.;:!".includes(ref[ref.length - 1])) ref = ref.slice(0, -1);
      addIfAsset(ref, urls);
    }
    // 2. protocol-relative (//host/path)
    for (const m of text.matchAll(/["'(]\/\/([a-z0-9.-]+\/[^\s"')<>]+)/gi)) {
      addIfAsset("https://" + decodeEntities(m[1]), urls);
    }
    // 3. root-relative refs on the origin itself (sites that serve their own
    // bundles/media reference them as /path/file.ext).
    // The (?!\/) guard is load-bearing: protocol-relative refs (//host/path)
    // also start with "/", and without it they get joined onto ORIGIN as
    // https://host//host/path — 77 phantom 404s on the first Shopify target
    // (racingshop-rebuild). Shape 2 already handled those.
    for (const m of text.matchAll(
      /(?:src|href|poster|content|data-src|data-poster|data-bg)=["'](\/(?!\/)[^"']+?\.[a-z0-9]{2,5}(?:\?[^"']*)?)["']/gi,
    )) {
      addIfAsset(DOC_ORIGIN + decodeEntities(m[1]), urls);
    }
    // 3b. root-relative paths as PLAIN STRING LITERALS, not in an attribute.
    // Shape 3 requires src=/href=/poster=…, which is right for markup and blind
    // to code: `new Workbox("/sw.js")`, `fetch("/data/index.json")`,
    // `img.src = "/img/sprite.svg"` match nothing there.
    //
    // ⭐ The costly instance is the SERVICE WORKER, because the two mirror
    // passes share the blind spot: the crawler cannot see the registration
    // (a bare string in a chunk), and the CDP capture does not observe the
    // fetch either — the browser retrieves /sw.js outside the page's context,
    // so it never appears as a page request. Measured on a Nuxt SSG target:
    // origin serves /sw.js 200, the mirror had no such file, both passes
    // reported themselves complete, and the only thing that noticed was a CLEAN
    // probe reporting "404 when fetching the script" two steps downstream.
    //
    // Deliberately still requires a file EXTENSION: without it every route
    // string ("/about", "/works/x") becomes a phantom asset. Route strings are
    // the page queue's business, not the asset extractor's.
    for (const m of text.matchAll(/["'](\/(?!\/)[A-Za-z0-9_\-./@]+\.[a-z0-9]{2,5})(\?[^"']*)?["']/gi)) {
      addIfAsset(DOC_ORIGIN + decodeEntities(m[1] + (m[2] || "")), urls);
    }
    // 4. srcset / imagesrcset candidate lists — one entry per candidate, not
    // one per attribute (see header).
    for (const m of text.matchAll(/\b(?:image)?srcset=["']([^"']+)["']/gi)) {
      for (const cand of decodeEntities(m[1]).split(",")) {
        const ref = cand.trim().split(/\s+/)[0];
        if (!ref) continue;
        if (ref.startsWith("//")) addIfAsset("https:" + ref, urls);
        else if (/^https?:\/\//i.test(ref)) addIfAsset(ref, urls);
        else if (ref.startsWith("/")) addIfAsset(DOC_ORIGIN + ref, urls);
      }
    }
    // 4b. A REFERENCE NESTED IN ANOTHER URL'S QUERY. An image-optimisation
    // endpoint names its subject in a parameter:
    //
    //     /_next/image?url=%2F_next%2Fstatic%2Fmedia%2Fpic_3.0w8q….png&w=2048&q=75
    //
    // ⛔ An extractor that treats a URL as atomic sees ONE reference here — the
    // endpoint — and never asks for the image. Measured on eightdesign: 8
    // source images referenced only this way, absent from the mirror, and the
    // closure gate green throughout because nothing ever named them. They
    // surfaced only when the built site's references were replayed against the
    // server.
    //
    // ⭐ The parameter names are the ones endpoints actually use; a value that
    // does not look like a reference is skipped by addIfAsset anyway.
    for (const m of text.matchAll(/[?&](?:url|src|image|file|path|href|u)=([^&"'\s<>\\]+)/gi)) {
      // ⚠ ")" is ALLOWED in the value and trimmed only when UNBALANCED. The
      // first version excluded it outright and truncated six references whose
      // filename really contains "(1).jpg" — manufacturing exactly the kind of
      // phantom this file exists to stop, in the shape added to stop another
      // one. A "(" ... ")" that balances belongs to the name; a lone trailing
      // ")" is the CSS url(...) closing delimiter.
      let raw = m[1];
      while (raw.endsWith(")") && (raw.match(/\(/g) || []).length < (raw.match(/\)/g) || []).length) raw = raw.slice(0, -1);
      let inner = raw;
      try { inner = decodeURIComponent(inner); } catch {}
      if (/^https?:\/\//i.test(inner)) addIfAsset(inner, urls);
      else if (inner.startsWith("/") && /\.[a-z0-9]{2,5}$/i.test(inner.split("?")[0])) addIfAsset(DOC_ORIGIN + inner, urls);
    }

    // 4c. RELATIVE MODULE SPECIFIERS in JS. Vite writes its chunk manifest as
    // an array of "./Xxx.js" strings (__vite__mapDeps) and its dynamic imports
    // as import("./Xxx.js") — all relative to the IMPORTING FILE's directory.
    // A root-relative shape never matches them, so a third of the lazy chunks
    // were absent from a "closed" mirror; at runtime the failed import fired
    // Nuxt's app:chunkError hook, which calls reloadNuxtApp — a RELOAD LOOP in
    // which every timer forever belongs to a document that no longer exists.
    // Measured on hubtown: probe uptime 6s after a 100s settle.
    if (baseUrl && /\.js($|\?)/i.test(baseUrl)) {
      const dir = baseUrl.replace(/[^/]+(\?.*)?$/, "");
      for (const m of text.matchAll(/"(\.\/[\w~.-]+\.(?:js|css|json|woff2?|png|jpe?g|webp|svg|wasm|glb|ktx2))"/g)) {
        try { addIfAsset(new URL(m[1], dir).href, urls); } catch {}
      }
    }

    // 5. relative url(...) inside CSS
    if (baseUrl && /\.css($|\?)/i.test(baseUrl)) {
      for (const m of text.matchAll(/url\(\s*['"]?(?!data:|https?:|\/\/)([^'")]+)['"]?\s*\)/gi)) {
        try {
          addIfAsset(new URL(m[1], baseUrl).href, urls);
        } catch {}
      }
    }
    // 6. DOCUMENT-RELATIVE attribute refs: src="./content/x/thumb.png",
    // href="content/3.project/.../1.jpg", data-retina="…". Old-school sites
    // (hand-written PHP-era HTML) spell most of their asset space this way,
    // and shapes 1–5 are all blind to it: absolute, protocol-relative,
    // ROOT-relative, srcset, CSS url() — none begins without a scheme or a
    // slash. Measured on a 2018 rescue: every project-gallery thumb and
    // lightbox image (`./content/…/thumb.png`, `…/1.jpg`) was invisible to
    // the closure gate, which then reported ∅ over a mirror missing the whole
    // gallery. The attr= anchor keeps JS operator soup out; addIfAsset's
    // extension gate keeps page links out; resolution is against the DOCUMENT
    // URL, exactly as the browser resolves it.
    // Two guards, both measured on the first retro-audit of this shape:
    // ① the value must CONTAIN a slash — HTML data-attributes carry
    //   dot-separated non-URLs (\`data-ease="power2.inOut"\`, version strings
    //   like \`5.3.11\`) that wear an extension convincingly; a document-
    //   relative asset reference in practice always crosses a directory.
    // ② documents only — a relative string inside a JS chunk resolves against
    //   the CHUNK URL, which is a guess, not how any loader resolves it
    //   (import maps and __vite__mapDeps are shape territory elsewhere);
    //   CSS already has shape 5 with correct base semantics.
    if (baseUrl && !/\.(m?js|css)($|\?)/i.test(baseUrl)) {
      for (const m of text.matchAll(/(?:src|href|poster|data-[a-z0-9-]+)\s*=\s*["']((?:\.\/)?[a-zA-Z0-9_][^"'<>\s]*?\.[a-z0-9]{2,5}(?:\?[^"']*)?)["']/gi)) {
        const v = m[1];
        if (/^(?:https?:|\/|#|data:|mailto:|tel:|javascript:)/i.test(v)) continue;
        if (!v.includes("/")) continue;
        try {
          addIfAsset(new URL(v, baseUrl).href, urls);
        } catch {}
      }
    }
  };

  return function extractAssetUrls(text, baseUrl) {
    const urls = new Set();
    // ⛔ A STREAMED PAYLOAD IS CUT AT ARBITRARY POINTS, INCLUDING MID-URL.
    // Next.js delivers its flight payload as a run of
    // `self.__next_f.push([1,"…"])` calls, and the split lands wherever the
    // encoder's buffer ended — routinely inside a URL. Scanning the raw HTML
    // therefore reads FRAGMENTS, and a fragment is not a miss: it is an
    // INVENTED reference. Measured here:
    //
    //   .../media/1f9dadf367424346-s.p.04        (tail cut off)
    //   https://host/static/media/9010da…        ("/_next" was in the push before)
    //   https://host/9dc1a6fb114b646f-s.p…       (the whole path prefix was)
    //
    // The crawler then fetches those, gets 404, and writes 17 failed rows that
    // look exactly like real missing assets — permanent gaps in the ledger for
    // URLs that never existed. ⭐ Reassemble first: the client concatenates
    // before parsing, so push boundaries carry no meaning and removing them
    // loses nothing.
    // ⛔ REPLACES the raw scan, never joins it. Scanning both would re-add every
    // truncated spelling alongside the whole one, which is the phantom this
    // exists to remove — and the reassembled text keeps everything outside the
    // pushes verbatim, so nothing is lost by scanning it alone.
    const joined = joinFlightPushes(text);
    const view = joined === null ? text : joined;
    scan(view, baseUrl, urls);
    // Second pass over the decoded view. Guarded, so files with no escaping at
    // all pay one regex test; unioned, so the raw pass can never LOSE a
    // reference to the decoding (that would be the same bug pointing the other
    // way).
    if (MAYBE_ENCODED.test(view)) {
      const decoded = decodeUrlEscapes(decodeEntities(view));
      if (decoded !== view) scan(decoded, baseUrl, urls);
    }
    return urls;
  };
}
