#!/usr/bin/env node
/**
 * flight-decode.mjs — the M1 coordinate system for C1 (RSC) sites.  [v0.3 R&D]
 *
 * A server component never ships source; what it ships is its OUTPUT: the
 * React flight stream inlined as `self.__next_f.push([1,"..."])` rows. That
 * stream is therefore the only spec a reconstruction can be checked against —
 * the C1 analogue of `_pretty/` line numbers. This tool decodes it into:
 *
 *   1. modules:  rowId -> { turbopackId, chunks, exportName }   (client refs —
 *      the I-rows literally name the client components: free tier-1 evidence)
 *   2. hints:    HL preloads (css/fonts)
 *   3. rows:     every row, parsed (T-rows as text, JSON rows as data)
 *   4. tree:     row 0's router state with $-refs RESOLVED into a nested
 *      structure — ["$","tag",key,props] React elements, module refs shown
 *      as {"$component": "<exportName>#<turbopackId>"}
 *   5. outline:  human-readable JSX-ish rendering of the resolved tree
 *
 * Wire grammar handled (react-server-dom-webpack, Next 15/Turbopack era):
 *   row      := <hexId?> ":" payload "\n"      (id may be EMPTY — :HL rows)
 *   payload  := "I" json | "HL" json | "T<hex>," rawBytes | "E" json | json
 *   T rows carry their own byte length and NO terminator (verify-lenprefix).
 *   $-refs in json: "$<id>" ref | "$L<id>" lazy | "$@<id>" promise |
 *   "$S<name>" symbol | "$undefined" | "$D<date>" | "$n<bigint>" | "$$" escape
 *
 * Usage: node scripts/flight-decode.mjs --mirror mirror --out docs/flight
 */
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { cli } from "./lib/cli.mjs";

cli({ known: ["mirror", "out"], file: import.meta.url });

const args = process.argv.slice(2);
const flag = (n, d) => {
  const i = args.indexOf("--" + n);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d;
};
const MIRROR = flag("mirror", "mirror");
const OUT = flag("out", "docs/flight");

const PUSH = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g;

function streamOf(html) {
  PUSH.lastIndex = 0;
  let s = "",
    m = null,
    n = 0;
  while ((m = PUSH.exec(html))) {
    n++;
    s += JSON.parse(m[1]);
  }
  return n ? s : null;
}

/** Split the stream into rows, honoring T-row length prefixes (bytes!). */
function rowsOf(stream) {
  const buf = Buffer.from(stream, "utf8");
  const rows = [];
  let i = 0;
  while (i < buf.length) {
    const colon = buf.indexOf(0x3a, i);
    if (colon < 0) break;
    const id = buf.subarray(i, colon).toString("utf8"); // may be ""
    if (!/^[0-9a-f]*$/i.test(id)) {
      // not a row head — resync to next newline (defensive; should not happen)
      const nl = buf.indexOf(0x0a, i);
      if (nl < 0) break;
      i = nl + 1;
      continue;
    }
    let j = colon + 1;
    // T-row: T<hex>,<exactly that many bytes, no terminator>
    const tm = /^T([0-9a-f]+),/i.exec(buf.subarray(j, j + 20).toString("latin1"));
    if (tm) {
      const len = parseInt(tm[1], 16);
      const start = j + tm[0].length;
      rows.push({ id, kind: "T", text: buf.subarray(start, start + len).toString("utf8") });
      i = start + len;
      if (buf[i] === 0x0a) i++;
      continue;
    }
    const nl = buf.indexOf(0x0a, j);
    const body = buf.subarray(j, nl < 0 ? buf.length : nl).toString("utf8");
    i = nl < 0 ? buf.length : nl + 1;
    if (body.startsWith("I")) rows.push({ id, kind: "I", json: JSON.parse(body.slice(1)) });
    else if (body.startsWith("HL")) rows.push({ id, kind: "HL", json: JSON.parse(body.slice(2)) });
    else if (body.startsWith("E")) rows.push({ id, kind: "E", json: JSON.parse(body.slice(1)) });
    else {
      // Everything else is a JSON model row — EXCEPT React 19 stream-control
      // sentinels (measured on basement.studio): `<id>:X` starts an async
      // iterable, `<id>:C` closes a stream, `R`/`r`/`x` start byte/text streams.
      // Their body is a bare tag char, not JSON, and JSON.parse would throw and
      // abort the whole document. Store them raw; they carry stream plumbing,
      // not element trees, so a $-ref to one resolves to a sentinel marker.
      try {
        rows.push({ id, kind: "json", json: JSON.parse(body) });
      } catch {
        rows.push({ id, kind: "raw", raw: body });
      }
    }
  }
  return rows;
}

/** Resolve $-refs against the row table. Lazy refs resolve too (SSG streams
 *  are complete), but keep a breadcrumb of the row id for traceability. */
function resolve(v, table, seen = new Set()) {
  if (typeof v === "string") {
    if (!v.startsWith("$")) return v;
    if (v.startsWith("$$")) return v.slice(1);
    if (v === "$undefined") return { $undefined: true };
    if (v.startsWith("$S")) return { $symbol: v.slice(2) };
    if (v.startsWith("$D")) return { $date: v.slice(2) };
    if (v.startsWith("$n")) return { $bigint: v.slice(2) };
    const m = /^\$([L@])?([0-9a-f]+)((?::[^\s\"]+)*)$/i.exec(v);
    if (m) {
      const id = m[2];
      if (seen.has(id)) {
        // 带路径的自引用指向行内数据叶(flight 去重),在原始 json 上走路径
        // 再解析叶子(整行重解会无限递归);无路径的自引用才是真环。
        if (!m[3]) return { $cycle: id };
        const row0 = table.get(id);
        if (!row0 || row0.kind !== "json") return { $cycle: id };
        let leaf = row0.json;
        for (const seg of m[3].split(":").filter(Boolean)) {
          if (leaf == null) return { $badPath: v };
          const isElem = Array.isArray(leaf) && leaf[0] === "$" && leaf.length >= 4;
          if (isElem && seg === "props") { leaf = leaf[3]; continue; }
          if (isElem && seg === "key") { leaf = leaf[2]; continue; }
          if (isElem && seg === "type") { leaf = leaf[1]; continue; }
          leaf = Array.isArray(leaf) && /^\d+$/.test(seg) ? leaf[Number(seg)] : leaf[seg];
        }
        return resolve(leaf, table, seen);
      }
      const row = table.get(id);
      if (!row) return { $missingRow: id };
      if (row.kind === "T") return row.text;
      if (row.kind === "raw") return { $stream: row.raw }; // X/C/R stream sentinel
      if (row.kind === "I")
        return { $component: `${row.json[2] || "(default)"}#${row.json[0]}`, chunks: row.json[1] };
      const s2 = new Set(seen);
      s2.add(id);
      // $<id>:<seg>:<seg>… 深引用(flight 数据去重:同一份数据第二处只发路径,
      // 实测 basement:links=$34:props:children:2:…)。段按 数字=数组下标、
      // 其余=对象键 索引进已解析的目标。
      let val = resolve(row.json, table, s2);
      if (m[3]) {
        for (const seg of m[3].split(":").filter(Boolean)) {
          if (val == null) return { $badPath: v };
          // flight element 是数组 ["$",type,key,props],但路径引用按 React
          // element 对象寻址:props→[3]、key→[2]、type→[1]
          const isElem = Array.isArray(val) && val[0] === "$" && val.length >= 4;
          if (isElem && seg === "props") { val = val[3]; continue; }
          if (isElem && seg === "key") { val = val[2]; continue; }
          if (isElem && seg === "type") { val = val[1]; continue; }
          val = Array.isArray(val) && /^\d+$/.test(seg) ? val[Number(seg)] : val[seg];
        }
      }
      return val;
    }
    return v; // "$" followed by something we don't model — keep verbatim
  }
  if (Array.isArray(v)) return v.map((x) => resolve(x, table, seen));
  if (v && typeof v === "object") {
    const o = {};
    for (const [k, val] of Object.entries(v)) o[k] = resolve(val, table, seen);
    return o;
  }
  return v;
}

/** JSX-ish outline of a resolved element tree, for human reading. */
function outline(v, depth = 0, lines = [], maxText = 80) {
  const pad = "  ".repeat(depth);
  if (Array.isArray(v) && v[0] === "$" && v.length >= 4) {
    const [, type, key, props] = v;
    const t =
      typeof type === "string"
        ? type
        : type && type.$component
          ? type.$component
          : type && type.$symbol
            ? type.$symbol
            : JSON.stringify(type)?.slice(0, 40);
    const attrs = [];
    for (const [k, val] of Object.entries(props || {})) {
      if (k === "children") continue;
      const s = typeof val === "string" ? val : JSON.stringify(val);
      if (s !== undefined) attrs.push(`${k}=${s.length > 60 ? s.slice(0, 57) + "..." : s}`);
    }
    lines.push(`${pad}<${t}${key != null ? ` key=${key}` : ""}${attrs.length ? " " + attrs.join(" ") : ""}>`);
    if (props && props.children !== undefined) outline(props.children, depth + 1, lines, maxText);
    return lines;
  }
  if (Array.isArray(v)) {
    for (const c of v) outline(c, depth, lines, maxText);
    return lines;
  }
  if (typeof v === "string") {
    const s = v.replace(/\n/g, "\\n");
    lines.push(`${pad}"${s.length > maxText ? s.slice(0, maxText - 3) + "..." : s}"`);
    return lines;
  }
  if (v && typeof v === "object") {
    if (v.$component) {
      lines.push(`${pad}<${v.$component}/>`);
      return lines;
    }
    if (v.$undefined || v.$symbol || v.$date || v.$bigint) return lines;
    if (v.children !== undefined) {
      // plain object carrying an element subtree (e.g. a parallel-route slot)
      const rest = Object.keys(v).filter((k) => k !== "children");
      lines.push(`${pad}{${rest.join(",")}${rest.length ? "," : ""}children:}`);
      outline(v.children, depth + 1, lines, maxText);
      return lines;
    }
    lines.push(`${pad}${JSON.stringify(v).slice(0, 100)}`);
    return lines;
  }
  return lines;
}

// ---------------------------------------------------------------------------
const htmlFiles = [];
async function walk(d) {
  for (const e of await readdir(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory() && e.name !== "assets" && e.name !== "_next") await walk(p);
    else if (e.isFile() && e.name.endsWith(".html")) htmlFiles.push(p);
  }
}
await walk(MIRROR);
await mkdir(OUT, { recursive: true });

const summary = [];
for (const f of htmlFiles.sort()) {
  const html = await readFile(f, "utf8");
  const stream = streamOf(html);
  if (!stream) {
    summary.push({ doc: f, rows: 0, note: "no flight stream" });
    continue;
  }
  const rows = rowsOf(stream);
  const table = new Map(rows.filter((r) => r.id !== "").map((r) => [r.id, r]));
  const modules = {};
  const hints = [];
  for (const r of rows) {
    if (r.kind === "I")
      modules[r.id] = { turbopackId: r.json[0], chunks: r.json[1], exportName: r.json[2] || "(default)" };
    if (r.kind === "HL") hints.push(r.json);
  }
  const root = table.get("0");
  const tree = root ? resolve(root.json, table) : null;
  const route = f.replace(MIRROR, "").replace(/index\.html$/, "").replace(/\.html$/, "") || "/";
  const slug = (route === "/" ? "index" : route.replace(/^\/|\/$/g, "").replace(/\//g, "__"));
  await writeFile(
    path.join(OUT, slug + ".json"),
    JSON.stringify({ doc: f, route, modules, hints, tree, rowCount: rows.length,
      rowKinds: rows.reduce((a, r) => ((a[r.kind] = (a[r.kind] || 0) + 1), a), {}) }, null, 1)
  );
  // The element trees live inside the router payload's flight entries:
  // f[i] = [routerStateTree, seedData(elements), head(elements), isPartial]
  const treeLines = [];
  if (tree && Array.isArray(tree.f)) {
    for (const [idx, entry] of tree.f.entries()) {
      treeLines.push(`### f[${idx}] segment: ${JSON.stringify(entry[0]).slice(0, 120)}`);
      treeLines.push(`--- seed:`);
      outline(entry[1], 1, treeLines);
      treeLines.push(`--- head:`);
      outline(entry[2], 1, treeLines);
    }
  } else treeLines.push("(no router payload)");
  await writeFile(path.join(OUT, slug + ".outline.txt"), treeLines.join("\n") + "\n");
  summary.push({ doc: f, route, rows: rows.length, modules: Object.keys(modules).length,
    kinds: rows.reduce((a, r) => ((a[r.kind] = (a[r.kind] || 0) + 1), a), {}) });
}
console.log(`decoded ${summary.length} docs -> ${OUT}/`);
for (const s of summary)
  console.log(
    ` ${(s.route || "-").padEnd(45)} rows:${String(s.rows).padStart(3)} ` +
      (s.kinds ? Object.entries(s.kinds).map(([k, v]) => `${k}:${v}`).join(" ") : s.note)
  );
