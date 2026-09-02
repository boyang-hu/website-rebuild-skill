#!/usr/bin/env node
// check-cases.mjs — the zero-loss guard for moving war stories out of a reference doc.
//
//   node selftest/check-cases.mjs <name>            # e.g. mirroring, or SKILL
//
// Baseline = the doc as committed at HEAD (git show). Every sentence of the
// baseline (≥ 10 chars, headings excluded) must appear VERBATIM in either the
// rewritten doc or its case-studies companion. Prints the missing sentences and
// exits 1 if any. Also prints sizes so the split can be judged.
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SK = path.join(ROOT, "skills/website-rebuild");
const name = process.argv[2];
if (!name) { console.error("usage: check-cases.mjs <doc-name-without-.md | SKILL>"); process.exit(2); }
const isSkill = name === "SKILL";
const docRel = isSkill ? "skills/website-rebuild/SKILL.md" : `skills/website-rebuild/references/${name}.md`;
const caseRel = `skills/website-rebuild/references/case-studies/${isSkill ? "skill" : name}.md`;

const baseline = execFileSync("git", ["show", `HEAD:${docRel}`], { cwd: ROOT, encoding: "utf8" });
const slim = readFileSync(path.join(ROOT, docRel), "utf8");
const cases = existsSync(path.join(ROOT, caseRel)) ? readFileSync(path.join(ROOT, caseRel), "utf8") : "";

const norm = (s) => s.replace(/\s+/g, " ").trim();
const sentences = (text) => {
  const out = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const body = line.replace(/^[>\-*+]\s+/, "").replace(/^\d+\.\s+/, "");
    for (const s of body.split(/(?<=[。；！？])|\|/)) {
      const t = norm(s).replace(/^[。；！？\s]+|[\s]+$/g, "");
      if (t.length >= 10) out.push(t);
    }
  }
  return out;
};
const hay = norm(slim) + "\n" + norm(cases);
const missing = [];
const seen = new Set();
for (const s of sentences(baseline)) {
  if (seen.has(s)) continue;
  seen.add(s);
  if (!hay.includes(s)) missing.push(s);
}
const kb = (s) => (Buffer.byteLength(s) / 1024).toFixed(1);
console.log(`${name}: baseline ${kb(baseline)} KB → doc ${kb(slim)} KB + cases ${kb(cases)} KB   sentences ${seen.size}, missing ${missing.length}`);
for (const m of missing.slice(0, 40)) console.log(`  MISSING: ${m.slice(0, 140)}`);
if (missing.length > 40) console.log(`  … ${missing.length - 40} more`);
process.exit(missing.length ? 1 : 0);
