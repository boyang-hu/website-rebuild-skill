/**
 * lib/cli.mjs — the ONE argv contract for every script in scripts/ and tools/.
 *
 *   import { cli } from "./lib/cli.mjs";            // tools/: "../scripts/lib/cli.mjs"
 *   const { positionals } = cli({ known: ["out", "rounds"], bools: ["check"], file: import.meta.url });
 *
 * Call it FIRST — after the imports, before any side effect (no fetch, no spawn,
 * no file read before it runs). It gives every script three things it used to
 * get from nobody:
 *
 *   --help / -h   prints the script's own header comment (the block at the top
 *                 of the file, which is where the usage has always lived), then
 *                 the flag inventory and the skill version. Exit 0.
 *   --version     prints the skill version this script was copied from. A
 *                 project's scripts/ is a COPY; the number is how you tell
 *                 whether it fell behind the skill. Exit 0.
 *   unknown flag  ⛔ FATAL, exit 2, listing the known set. A flag that is
 *                 silently ignored is a downgrade nobody knows about: passing
 *                 `--settle` to a tool whose word for it is `--wait` once cost
 *                 three hours of chasing a phantom (verification-gates.md
 *                 §2.1.3). Before this module, 9 of 57 scripts enforced it.
 *
 * It does NOT replace a script's own `flag()` reader — those keep their exact
 * semantics. It only validates the shape of argv and hands back the leftovers:
 *   { argv, positionals, flag(name, dflt), has(name) }
 *
 * Value flags consume the next token unless that token itself starts with
 * `--` (so `--check --other` treats `--check` as bare). `--k=v` is accepted for
 * validation; whether the script's reader honours it is the script's business.
 * A bare `--` ends flag parsing.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SKILL_VERSION } from "./version.mjs";

/**
 * Exit codes shared by the toolchain. The meaning is the contract; the number
 * is what CI sees. Keep new scripts on this table (scripts/README.md 退出码约定).
 */
export const EXIT = {
  OK: 0,          // gate green / job done
  FAIL: 1,        // gate red: the thing under test is wrong (or a ledger the tool cannot read)
  USAGE: 2,       // bad invocation: missing/invalid/unknown flag, missing input, bad config
  IDENTITY: 3,    // port taken, wrong side, attached to somebody else's browser (lib/ports.mjs)
  TRANSPORT: 4,   // CDP transport died (payload ceiling, close 1006, timeout)
  FATAL: 5,       // precondition not met: container unrecognised, nothing to examine, blank frame
  STATE: 6,       // page never reached the requested state (--ready / --hold)
  INTERRUPTED: 130, // SIGINT after a ledger flush
};

function headerOf(file) {
  if (!file) return "";
  let src;
  try { src = readFileSync(file.startsWith("file:") ? fileURLToPath(file) : file, "utf8"); } catch { return ""; }
  const lines = src.split("\n");
  let i = 0;
  if (lines[0]?.startsWith("#!")) i = 1;
  while (i < lines.length && lines[i].trim() === "") i++;
  const out = [];
  if (lines[i]?.trimStart().startsWith("/*")) {
    for (; i < lines.length; i++) {
      const l = lines[i];
      const end = l.includes("*/");
      let t = l.replace(/^\s*\/\*+\s?/, "").replace(/\*\/\s*$/, "").replace(/^\s*\*\s?/, "");
      if (t.trim() !== "" || out.length) out.push(t);
      if (end) break;
    }
  } else {
    for (; i < lines.length && lines[i].startsWith("//"); i++) out.push(lines[i].replace(/^\/\/\s?/, ""));
  }
  while (out.length && out[out.length - 1].trim() === "") out.pop();
  return out.join("\n");
}

export function cli({ known = [], bools = [], file = null, argv = process.argv.slice(2), positional = "" } = {}) {
  const names = new Set([...known, ...bools]);
  const isBool = new Set(bools);
  if (argv.includes("--help") || argv.includes("-h")) {
    const header = headerOf(file);
    const inv = [...names].sort().map((n) => (isBool.has(n) ? `--${n}` : `--${n} <v>`)).join(" ");
    process.stdout.write(
      (header ? header + "\n\n" : "") +
      `flags: ${inv || "(none)"}${positional ? `\npositional: ${positional}` : ""}\n` +
      `--help / --version are always accepted; any other unknown flag is FATAL (exit 2).\n` +
      `skill version ${SKILL_VERSION}\n`,
    );
    process.exit(EXIT.OK);
  }
  if (argv.includes("--version")) { console.log(SKILL_VERSION); process.exit(EXIT.OK); }
  const bad = [], positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") { positionals.push(...argv.slice(i + 1)); break; }
    if (!a.startsWith("--")) { positionals.push(a); continue; }
    const name = a.slice(2).split("=")[0];
    if (!names.has(name)) { bad.push(a); continue; }
    if (!isBool.has(name) && !a.includes("=") && i + 1 < argv.length && !argv[i + 1].startsWith("--")) i++;
  }
  if (bad.length) {
    console.error(`FATAL: unknown flag(s): ${bad.join(" ")}`);
    console.error(`       known: ${[...names].sort().map((n) => "--" + n).join(" ") || "(none)"}   (--help for usage)`);
    process.exit(EXIT.USAGE);
  }
  const flag = (n, d) => {
    const eq = argv.find((x) => x.startsWith(`--${n}=`));
    if (eq !== undefined) return eq.slice(n.length + 3);
    const i = argv.indexOf(`--${n}`);
    return i >= 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
  };
  const has = (n) => argv.includes(`--${n}`) || argv.some((x) => x.startsWith(`--${n}=`));
  return { argv, positionals, flag, has };
}
