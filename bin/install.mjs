#!/usr/bin/env node
/**
 * website-rebuild-skill — installer.
 *
 * Copies the skill directory shipped inside this package into an agent's
 * skills directory, then verifies every copied byte against the source by
 * sha256. It installs FILES: it never runs the skill, never spawns a browser,
 * and never fetches anything. The skill itself stays zero-dependency — this
 * package has no dependencies either.
 *
 *   npx website-rebuild-skill                  ->  ~/.claude/skills/website-rebuild
 *   npx website-rebuild-skill --project        ->  ./.claude/skills/website-rebuild
 *   npx website-rebuild-skill --dir <skills>   ->  <skills>/website-rebuild
 *
 * Flags
 *   --dir <path>   the skills DIRECTORY to install into; `website-rebuild` is
 *                  appended to it. Use this for any runtime whose convention
 *                  is not ~/.claude/skills.
 *   --project      shorthand for --dir ./.claude/skills
 *   --force        replace an existing install. The old directory is REMOVED
 *                  first (a merge would leave files the new version deleted),
 *                  so the version being replaced is printed before it goes.
 *   --dry-run      print what would be written, write nothing
 *   --version      print the skill version carried by this package
 *   --help         this text
 *
 * Exit codes follow the skill's own table (scripts/lib/cli.mjs):
 *   0 ok  ·  1 refused / verification failed  ·  2 bad invocation
 */
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const EXIT = { OK: 0, FAIL: 1, USAGE: 2 };
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, "..", "skills", "website-rebuild");
const LEAF = "website-rebuild";

const VALUE_FLAGS = new Set(["dir"]);
const BOOL_FLAGS = new Set(["project", "force", "dry-run", "help", "version"]);

function die(msg, code) {
  console.error(`⛔ ${msg}`);
  process.exit(code);
}

/** argv shaped like scripts/lib/cli.mjs: an unknown flag is fatal, never ignored. */
function parse(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok === "--") break;
    if (tok === "-h") { out.help = true; continue; }
    if (!tok.startsWith("--")) die(`unexpected argument \`${tok}\` — this installer takes flags only.`, EXIT.USAGE);
    const eq = tok.indexOf("=");
    const name = (eq === -1 ? tok.slice(2) : tok.slice(2, eq));
    if (BOOL_FLAGS.has(name)) { out[name] = true; continue; }
    if (VALUE_FLAGS.has(name)) {
      let val = eq === -1 ? argv[++i] : tok.slice(eq + 1);
      if (val === undefined || val.startsWith("--")) die(`--${name} needs a value.`, EXIT.USAGE);
      out[name] = val;
      continue;
    }
    die(`unknown flag \`--${name}\`.\n   known: ${[...BOOL_FLAGS, ...VALUE_FLAGS].map((f) => "--" + f).sort().join(" ")}`, EXIT.USAGE);
  }
  return out;
}

function header() {
  const src = readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n");
  const out = [];
  const start = src.findIndex((l) => l.startsWith("/**")) + 1;
  for (let i = start; i < src.length && !src[i].includes("*/"); i++) out.push(src[i].replace(/^ \*\/?$/, "").replace(/^ \* ?/, ""));
  return out.join("\n");
}

function skillVersion(dir) {
  try {
    const fm = readFileSync(path.join(dir, "SKILL.md"), "utf8").match(/^\s*version:\s*"?([^"\n]+)"?\s*$/m);
    return fm ? fm[1].trim() : "unknown";
  } catch { return "unknown"; }
}

/** Every file under `dir`, as paths relative to it, sorted — the copy manifest. */
function walk(dir, base = dir, acc = []) {
  for (const ent of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, base, acc);
    else if (ent.isFile()) acc.push(path.relative(base, full));
  }
  return acc;
}

const sha256 = (f) => createHash("sha256").update(readFileSync(f)).digest("hex");

function main() {
  const opt = parse(process.argv.slice(2));
  const version = skillVersion(SRC);

  if (opt.help) { console.log(header()); process.exit(EXIT.OK); }
  if (opt.version) { console.log(version); process.exit(EXIT.OK); }

  if (!existsSync(SRC)) die(`the package is missing its payload (${SRC}). Reinstall it.`, EXIT.FAIL);
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 22) console.error(`⚠️  the skill needs Node ≥ 22 to run (this is ${process.versions.node}). Installing anyway — the files are fine; the runtime that uses them will need 22+.`);

  if (opt.dir && opt.project) die("--dir and --project both set; pick one.", EXIT.USAGE);
  const skillsDir = opt.dir
    ? path.resolve(opt.dir)
    : opt.project
      ? path.resolve(process.cwd(), ".claude", "skills")
      : path.join(homedir(), ".claude", "skills");
  const dest = path.join(skillsDir, LEAF);

  const files = walk(SRC);
  const bytes = files.reduce((n, f) => n + statSync(path.join(SRC, f)).size, 0);
  const mb = (bytes / 1024 / 1024).toFixed(1);

  console.log(`website-rebuild v${version} — ${files.length} files, ${mb} MB`);
  console.log(`  from  ${SRC}`);
  console.log(`  into  ${dest}`);

  if (existsSync(dest)) {
    const had = skillVersion(dest);
    if (!opt.force) {
      console.error(`\n⛔ already installed there (v${had}). Nothing was written.`);
      console.error(`   re-run with --force to replace it, or --dir <path> to install elsewhere.`);
      process.exit(EXIT.FAIL);
    }
    if (!opt["dry-run"]) {
      console.log(`\n  replacing v${had} (removing the old directory first)`);
      rmSync(dest, { recursive: true, force: true });
    } else {
      console.log(`\n  would replace v${had}`);
    }
  }

  if (opt["dry-run"]) { console.log("\n--dry-run: nothing written."); process.exit(EXIT.OK); }

  mkdirSync(skillsDir, { recursive: true });
  cpSync(SRC, dest, { recursive: true });

  // Verify the copy the way the skill verifies a mirror: per-file sha256, both directions.
  const copied = walk(dest);
  const bad = [];
  if (copied.length !== files.length) bad.push(`file count ${copied.length} != ${files.length}`);
  for (const f of files) {
    const d = path.join(dest, f);
    if (!existsSync(d)) { bad.push(`missing: ${f}`); continue; }
    if (sha256(path.join(SRC, f)) !== sha256(d)) bad.push(`sha256 differs: ${f}`);
  }
  if (bad.length) {
    console.error(`\n⛔ copy did not verify (${bad.length} problem${bad.length > 1 ? "s" : ""}):`);
    for (const b of bad.slice(0, 10)) console.error(`   ${b}`);
    if (bad.length > 10) console.error(`   … and ${bad.length - 10} more`);
    process.exit(EXIT.FAIL);
  }

  console.log(`\n✅ installed and verified — ${files.length}/${files.length} files match by sha256.`);
  console.log(`\nNext: tell your agent to rebuild a site, e.g.`);
  console.log(`   "复刻 https://example.com" / "1:1 rebuild https://example.com"`);
}

main()
