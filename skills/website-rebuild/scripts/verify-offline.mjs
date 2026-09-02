#!/usr/bin/env node
/**
 * verify-offline.mjs — the STATIC half of the zero-outbound gate
 * (verification-gates.md §1.6). scripts/probe.mjs covers the resource level:
 * it watches requests and fails on any that leave the served origin. That is
 * one of four required assertions, and the other three are invisible to it:
 *
 *   class 1  connection warm-up  — <link rel=preconnect|dns-prefetch|preload>
 *                                  do DNS + TLS with no resource request
 *   class 2  inline self-contained telemetry — sendBeacon/fetch to an absolute
 *                                  external URL from code that does not depend
 *                                  on any stubbed script
 *   class 3  fallback-path outbound — only fires when something else fails
 *
 * This script asserts all three against the SERVED bytes (not the mirror on
 * disk: the response layer is where localisation happens, so the disk copy
 * would report holes that are not there and miss ones that are). Its output is
 * the artefact §1.6 asks for at close-out: an enumerated list of every external
 * absolute URL still present, each with a verdict — not the sentence "probe was
 * green".
 *
 * Outbound <a href> anchors are NOT outbound calls: they are source content
 * (constitution rule 3) and only navigate on click.
 *
 * Usage:
 *   node scripts/verify-offline.mjs --base http://127.0.0.1:29001 --routes /,/x,/y
 */
import { cli } from "./lib/cli.mjs";

cli({ known: ["base", "routes"], file: import.meta.url });

const args = process.argv.slice(2);
const flag = (n, d) => {
  const i = args.indexOf("--" + n);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d;
};
const BASE = (flag("base", "http://127.0.0.1:29001") || "").replace(/\/+$/, "");
const ROUTES = flag("routes", "/").split(",").filter(Boolean);
const SELF = new URL(BASE).host;

// Namespace identifiers: they appear in xmlns / JSON-LD @context and are never
// fetched. Everything else has to be justified below.
const NAMESPACE_HOSTS = new Set(["www.w3.org", "schema.org", "json-schema.org", "purl.org", "ogp.me", "gmpg.org"]);

let problems = 0;
const census = new Map(); // host -> { count, kinds:Set, sample }

// ⛔ A gate must fail legibly. Pointed at a base with nothing listening, this
// one used to die on an unhandled `TypeError: fetch failed` and a stack trace —
// which reads as "the gate is broken", not "you did not start the server". The
// difference matters most in a registered command someone runs months later.
try {
  await fetch(BASE, { redirect: "manual", signal: AbortSignal.timeout(5000) });
} catch (e) {
  console.error(`FATAL — nothing answered at ${BASE} (${e.cause?.code || e.name || e.message}).`);
  console.error(`        This gate reads the SERVED rebuild, so a server has to be up:`);
  console.error(`          node scripts/serve.mjs --root <rebuild-root> --port ${new URL(BASE).port || 80}`);
  console.error(`        ⚠ If the rebuild has no routes yet, this gate is not applicable at this stage —`);
  console.error(`          say so in the plan rather than leaving a registered command that always dies.`);
  process.exit(5);
}

for (const route of ROUTES) {
  const res = await fetch(BASE + route, { redirect: "manual" });
  const html = await res.text();
  console.log(`\n=== ${route}  (HTTP ${res.status}, ${html.length} B) ===`);

  // ---- class 1: connection warm-up ----------------------------------------
  const warm = [];
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    if (!/rel=["']?(preconnect|dns-prefetch|preload|prerender|modulepreload)/i.test(tag)) continue;
    const href = tag.match(/href=["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    let host = null;
    try {
      host = new URL(href, "https://" + SELF).host;
    } catch {}
    if (!host || host === SELF || !/^(https?:)?\/\//.test(href)) continue;
    warm.push(tag.replace(/\s+/g, " "));
  }
  if (warm.length) {
    problems += warm.length;
    console.log(`  FAIL class 1 — connection warm-up to external hosts (${warm.length}):`);
    for (const w of warm) console.log(`    ${w}`);
  } else {
    console.log("  ok   class 1 — no external preconnect / dns-prefetch / preload");
  }

  // ---- class 2 + 3: absolute external URLs in the served bytes -------------
  // Anchors are stripped first so source content cannot be confused with calls.
  const withoutAnchors = html.replace(/<a\b[^>]*>/gi, (t) => t.replace(/https?:\/\/[^"'\s]+/g, "ANCHOR"));
  const callish = [];
  for (const m of withoutAnchors.matchAll(/https?:(?:\\\/\\\/|\/\/)([a-z0-9.-]+\.[a-z]{2,})([^"'`\s\\<>)]*)/gi)) {
    const host = m[1].toLowerCase();
    if (host === SELF || NAMESPACE_HOSTS.has(host)) continue;
    const rec = census.get(host) || { count: 0, kinds: new Set(), sample: m[0].slice(0, 90) };
    rec.count++;
    rec.kinds.add(route);
    census.set(host, rec);
    callish.push(m[0].slice(0, 110));
  }
  // Beacon/fetch call sites that still name an external host.
  const beacons = [
    ...withoutAnchors.matchAll(/(sendBeacon|fetch|new Image|XMLHttpRequest[^;]{0,40}open)\s*\(\s*[`'"]https?:\/\/[^`'"]+/gi),
  ].map((m) => m[0].slice(0, 120));
  if (beacons.length) {
    problems += beacons.length;
    console.log(`  FAIL class 2/3 — call sites naming an external absolute URL (${beacons.length}):`);
    for (const b of beacons) console.log(`    ${b}`);
  } else {
    console.log("  ok   class 2/3 — no sendBeacon/fetch/Image call site names an external absolute URL");
  }
  console.log(`  info external absolute URLs remaining in bytes: ${callish.length}`);
}

console.log(`\n=== external absolute-URL census (all routes) ===`);
if (!census.size) console.log("  (none)");
for (const [host, rec] of [...census].sort((a, b) => b[1].count - a[1].count)) {
  console.log(`  ${String(rec.count).padStart(4)}x ${host}\n        e.g. ${rec.sample}`);
}
console.log(
  `\n${problems ? "FAIL" : "PASS"} — ${problems} static outbound problem(s). ` +
    `Every host in the census above must have a line in mirror/external.txt.`,
);
process.exit(problems ? 1 : 0);
