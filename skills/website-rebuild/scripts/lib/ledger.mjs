/**
 * lib/ledger.mjs — the mirror's three ledgers, read and written in ONE place.
 *
 *   mirror-manifest.json   { origin, mirroredAt, files: { [url]: { path, bytes, sha256, type?, profile?, vary?, error? } } }
 *   inventory.tsv          SHA256 \t BYTES \t PATH \t URL   (one row per file on disk, sorted by path)
 *   redirects.tsv          CODE \t FROM \t TO               (source behaviour, replayed by serve.mjs; column
 *                                                            order is what serve's reader destructures — a
 *                                                            FROM-first ledger silently replays nothing)
 *
 * Four scripts wrote these files (mirror-site, netcapture, reconcile-gaps,
 * wayback-mirror) and six read them, each with its own TSV formatter and parser.
 * They agreed by luck. A ledger is the mirror's contract with every gate; the
 * spelling of a row is not a per-script decision (verification-gates.md §2.1.1).
 *
 * Ledger files are BOOKKEEPING, not mirror content: the coverage check and the
 * closure gate must skip them, make-standalone must not ship them. LEDGER_FILES
 * is that list, once — verify-mirror and make-standalone used to carry their own
 * and they had drifted.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

export const MANIFEST_FILE = "mirror-manifest.json";
export const INVENTORY_FILE = "inventory.tsv";
export const REDIRECTS_FILE = "redirects.tsv";

/** Files that live in the mirror root but are not the mirror. Root-level only. */
export const LEDGER_FILES = new Set([
  MANIFEST_FILE,
  INVENTORY_FILE,
  REDIRECTS_FILE,
  // The closure gate WRITES closure-gap.txt into the mirror so --seeds can reach
  // it — which made the coverage check report the gate's own artefact as an
  // orphan one run later. A gate must not fail on what it itself wrote.
  "closure-gap.txt",
  "netcapture.tsv",
  "external.txt",
  "urlpath-policy.json",
  // Archival rescues (wayback-mirror.mjs) add two ledger companions: the
  // permanent-holes register and the per-file capture provenance.
  "wayback-holes.txt",
  "wayback-provenance.json",
]);
/** Top-level toolchain output dirs inside a mirror (never mirror content). */
export const TOOL_DIRS = ["_pretty/", "_scripts/"];
// Dotfiles at ANY depth (.DS_Store lands in every directory macOS opens) — the
// predicate verify-mirror's coverage check always applied.
export const isBookkeeping = (rel) => LEDGER_FILES.has(rel) || TOOL_DIRS.some((d) => rel.startsWith(d)) || rel.split("/").some((seg) => seg.startsWith("."));

// ---- manifest -------------------------------------------------------------------
/**
 * Read the manifest. Missing file → null (a fresh mirror). A file that exists but
 * cannot be parsed, or has no `files` map, THROWS — a corrupt ledger must never
 * be mistaken for an empty one (mirror-site used to start a fresh ledger over it
 * and overwrite it at the end).
 */
export async function readManifest(root) {
  let text;
  try { text = await readFile(path.join(root, MANIFEST_FILE), "utf8"); } catch (e) { if (e.code === "ENOENT") return null; throw e; }
  const mf = JSON.parse(text);
  if (!mf || typeof mf !== "object" || typeof mf.files !== "object" || mf.files === null) throw new Error(`${MANIFEST_FILE}: no \`files\` map in the document`);
  return mf;
}
export async function writeManifest(root, { origin, files, mirroredAt = new Date().toISOString(), ...rest }) {
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, MANIFEST_FILE), JSON.stringify({ origin, mirroredAt, ...rest, files }, null, 2));
}

// ---- inventory ------------------------------------------------------------------
export const INVENTORY_HEADER = ["SHA256", "BYTES", "PATH", "URL"].join("\t");
/** Rows for every manifest entry that has bytes on disk, sorted by path. */
export function inventoryRows(files) {
  return Object.entries(files)
    .filter(([, f]) => f && f.path && f.sha256)
    .sort((a, b) => a[1].path.localeCompare(b[1].path))
    .map(([url, f]) => ({ sha256: f.sha256, bytes: f.bytes, path: f.path, url }));
}
export const inventoryLine = (r) => [r.sha256, r.bytes, r.path, r.url].join("\t");
export function inventoryText(files) {
  return INVENTORY_HEADER + "\n" + inventoryRows(files).map(inventoryLine).join("\n") + "\n";
}
export async function writeInventory(root, files) {
  await writeFile(path.join(root, INVENTORY_FILE), inventoryText(files));
}
export function parseInventory(text) {
  return text.split("\n").slice(1).filter(Boolean).map((l) => {
    const [sha256, bytes, p, url] = l.split("\t");
    return { sha256, bytes: Number(bytes), path: p, url };
  }).filter((r) => r.path);
}
/** [] when the file is absent. */
export async function readInventory(root) {
  const text = await readFile(path.join(root, INVENTORY_FILE), "utf8").catch(() => "");
  return text ? parseInventory(text) : [];
}
/**
 * Append rows whose PATH is not yet recorded; creates the header if the file is
 * absent. Returns the rows actually added. (netcapture --fetch / reconcile-gaps
 * batches; a later mirror-site run rewrites the whole file from the manifest,
 * so callers must ALSO write the manifest — see appendLedger in netcapture.)
 */
export async function appendInventory(root, rows) {
  const inv = path.join(root, INVENTORY_FILE);
  let text = await readFile(inv, "utf8").catch(() => "");
  if (!text) text = INVENTORY_HEADER + "\n";
  const known = new Set(parseInventory(text).map((r) => r.path));
  const add = rows.filter((r) => !known.has(r.path));
  if (!add.length) return add;
  if (!text.endsWith("\n")) text += "\n";
  await writeFile(inv, text + add.map(inventoryLine).join("\n") + "\n");
  return add;
}

// ---- redirects ------------------------------------------------------------------
export const REDIRECTS_HEADER = ["CODE", "FROM", "TO"].join("\t");
/** Dedupe (a re-visited redirect is the same source behaviour, not a new row) and format. */
export function redirectsText(rows) {
  const uniq = [...new Map(rows.map((r) => [`${r.status}\t${r.from}\t${r.to}`, r])).values()];
  return REDIRECTS_HEADER + "\n" + uniq.map((r) => [r.status, r.from, r.to].join("\t")).join("\n") + (uniq.length ? "\n" : "");
}
export function parseRedirects(text) {
  const out = [];
  for (const line of text.split("\n").slice(1)) {
    const [status, from, to] = line.split("\t");
    if (status && from) out.push({ status: Number(status), from, to: to || "" });
  }
  return out;
}
/** [] when the file is absent. */
export async function readRedirects(root, file = REDIRECTS_FILE) {
  const text = await readFile(path.join(root, file), "utf8").catch(() => "");
  return text ? parseRedirects(text) : [];
}
export async function writeRedirects(root, rows) {
  await writeFile(path.join(root, REDIRECTS_FILE), redirectsText(rows));
}

/** The three files from one merged state — the periodic flush, the SIGINT flush and the final write share it. */
export async function writeLedgers(root, { origin, files, redirects = [], ...rest }) {
  await writeManifest(root, { origin, files, ...rest });
  await writeRedirects(root, redirects);
  await writeInventory(root, files);
}
