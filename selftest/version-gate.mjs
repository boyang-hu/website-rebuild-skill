/**
 * selftest/version-gate.mjs — one version, four places.
 *
 * The skill's version is written down in three files that nothing syncs, and a
 * release adds a fourth: the git tag. They have drifted before (the README
 * badge sat at 0.3.13 while the tag said 0.3.19), so a release refuses to go
 * out until all four agree — the gate reports the drift, it never repairs it.
 *
 *   node selftest/version-gate.mjs            # check the three files
 *   node selftest/version-gate.mjs v0.3.19    # …and pin them to a tag
 *
 * Exit: 0 all agree · 1 drift found · 2 bad invocation
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKILL = path.join(ROOT, "skills", "website-rebuild");
const read = (...p) => readFileSync(path.join(ROOT, ...p), "utf8");

const argv = process.argv.slice(2);
if (argv.length > 1 || argv.some((a) => a.startsWith("-"))) {
  console.error("⛔ usage: node selftest/version-gate.mjs [vX.Y.Z]");
  process.exit(2);
}

const sources = [
  ["package.json", JSON.parse(read("package.json")).version],
  ["skills/website-rebuild/SKILL.md", read("skills", "website-rebuild", "SKILL.md").match(/^\s*version:\s*"?([^"\n]+)"?\s*$/m)?.[1]?.trim()],
  ["skills/website-rebuild/scripts/lib/version.mjs", read("skills", "website-rebuild", "scripts", "lib", "version.mjs").match(/SKILL_VERSION\s*=\s*"([^"]+)"/)?.[1]],
];
if (argv[0]) sources.unshift(["git tag", argv[0].replace(/^v/, "")]);

const expected = sources[0][1];
let bad = 0;
for (const [where, got] of sources) {
  const ok = got === expected && got !== undefined;
  if (!ok) bad++;
  console.log(`${ok ? "✅" : "❌"} ${String(got ?? "(not found)").padEnd(10)} ${where}`);
}

if (bad) {
  console.error(`\n⛔ version drift: ${bad} of ${sources.length} disagree with \`${expected}\` (${sources[0][0]}).`);
  process.exit(1);
}
console.log(`\n✅ version ${expected} agrees across ${sources.length} sources.`);
