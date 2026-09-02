#!/usr/bin/env node
// accept-names.mjs — name-modules 只提名，不决定；这是显式的"接受"步（darkroom 实战入库，v0.3.13）。
// 默认规则：**只接受 tier-1（打包器声明的导出名）**，其余保留 id——readable-source.md §3.0.1.4：
// 无证据不命名，错名比哈希更糟。同名冲突时后者带 id 后缀。接受理由写回 `why`，可审计。
//   node tools/accept-names.mjs --in docs/sourcify/names-<chunk>.json [--out <same>] [--max-tier 1]
import { readFile, writeFile } from "node:fs/promises";
import { cli } from "../scripts/lib/cli.mjs";
cli({ known: ["in", "out", "max-tier"], file: import.meta.url });
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf("--" + n); return i >= 0 ? args[i + 1] : d; };
const IN = flag("in"), OUT = flag("out", IN), MAX_TIER = Number(flag("max-tier", "1"));
if (!IN) { console.error("usage: accept-names.mjs --in names.json [--out names.json] [--max-tier 1]"); process.exit(2); }
const d = JSON.parse(await readFile(IN, "utf8"));
const taken = new Set(); let n = 0;
for (const m of d.modules) {
  if (m.name) { taken.add(m.name); n++; continue; }
  const c = (m.candidates || []).filter((x) => x.tier <= MAX_TIER).sort((a, b) => a.tier - b.tier)[0];
  if (!c) continue;
  let name = c.name; if (taken.has(name)) name = `${name}-${m.id}`; taken.add(name);
  m.name = name; m.tier = c.tier; m.why = `${c.why} (accepted: tier-${c.tier} <= --max-tier ${MAX_TIER}, tools/accept-names.mjs)`; n++;
}
await writeFile(OUT, JSON.stringify(d, null, 2) + "\n");
console.log(`accepted ${n}/${d.modules.length} name(s) at tier <= ${MAX_TIER}; the rest keep their ids`);
