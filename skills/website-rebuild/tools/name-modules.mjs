#!/usr/bin/env node
/**
 * name-modules.mjs — propose a filename for every module in the slice, from
 * evidence found inside the module, and record which evidence produced it.
 *
 * A webpack container hands you the module boundaries for free, so the hard
 * part of M(n+1) moves: on a flat bundle the question is "where does this cut",
 * here it is "what is this thing called". The ids are content hashes and carry
 * nothing.
 *
 * ⛔ This tool PROPOSES. It does not decide. Every proposal carries the tier and
 * the literal evidence string it came from, so a name can be checked against the
 * thing that justified it — and readable-source.md's rule holds: no evidence
 * means the module keeps its id, it does NOT get a plausible-sounding name.
 * A wrong name is worse than a hash, because a hash makes you go and look.
 *
 * Evidence tiers, strongest first:
 *   1  a global the module publishes, or a      window.ExpressionParser = r
 *      name it REGISTERS ITSELF UNDER          .share("AnimSystem", …)
 *   2  a class or function declaration whose     class KeyframeTween {...}
 *      binding is what the module exports, or
 *      the FIELD NAME a consumer stores it in   this._chapterPlayer = new M(…)
 *   3  a namespaced constant that names a        DATA_ATTRIBUTE = "data-anim-tween"
 *      concept in its VALUE, not its key, or
 *      a PascalCase prefix built into a name    "TimeGroup-" + counter
 *   4  a type name QUOTED INSIDE an error        "TimeGroup not instantiated correctly"
 *      message — errors name what threw them
 *   5  exported member names, joined            {parse, evaluate, programs}
 *
 *   node tools/name-modules.mjs [--map docs/module-map.json] [--closure docs/slice-closure.json]
 *        [--out docs/module-names.json] [--overrides docs/module-names.overrides.json]
 */
import fs from "node:fs";
import path from "node:path";
import { parse } from "@babel/parser";
import _traverse from "@babel/traverse";
import { cli } from "../scripts/lib/cli.mjs";
cli({ known: ["map", "closure", "out", "overrides"], file: import.meta.url });
const traverse = _traverse.default ?? _traverse;

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf("--" + n); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d; };
const MAP = JSON.parse(fs.readFileSync(flag("map", "docs/module-map.json"), "utf8"));
const CLO = JSON.parse(fs.readFileSync(flag("closure", "docs/slice-closure.json"), "utf8"));
const OUT = flag("out", "docs/module-names.json");
// ⭐ Tier 0: a name someone arrived at BY READING THE MODULE. The tool proposes;
// this is where a decision survives the next run. Nothing the tool infers may
// overwrite it, and every entry carries the reading that produced it — a bare
// override is just a different way to invent a name.
const OVERRIDES_PATH = flag("overrides", "docs/module-names.overrides.json");
const OVERRIDES = fs.existsSync(OVERRIDES_PATH) ? JSON.parse(fs.readFileSync(OVERRIDES_PATH, "utf8")) : {};
for (const [id, o] of Object.entries(OVERRIDES)) {
  if (!o || typeof o.name !== "string" || typeof o.why !== "string" || o.why.length < 12) {
    console.error(`FATAL — override for ${id} needs both a name and a why that says what was read.`);
    process.exit(5);
  }
}
const SRC = fs.readFileSync(MAP.source, "utf8");
const byId = new Map(MAP.modules.map((m) => [m.id, m]));

// ⛔ Do NOT re-slice text out of the pretty file to parse it. The first version
// did, and got 0/46 because every slice ends on the container's separating
// comma — `function(){...},` does not parse. Cutting text by line number and
// re-parsing it invents a boundary problem the packer already solved: parse the
// container ONCE and take the function nodes it actually contains.
const FILE = parse(SRC, { sourceType: "unambiguous", errorRecovery: true });
const NODES = new Map();
traverse(FILE, {
  ObjectProperty(p) {
    const k = p.node.key;
    // ⛔ Three key forms, and all three occur: a minifier quotes a key only when
    // it must. `"02b5c2be…":` is quoted because it starts with a digit,
    // `a738138e…:` is a bare identifier, and `14:` is a NUMBER — and 14 happens
    // to be the entry module. Accepting only the long-hex form silently drops
    // it, and the failure surfaces far away as "candidates is not iterable".
    // This is the third time a numeric module id has cost time on this target.
    const id = k.type === "StringLiteral" ? String(k.value)
      : k.type === "NumericLiteral" ? String(k.value)
      : k.type === "Identifier" ? k.name
      : null;
    if (!id || !/^[0-9a-f]{16,}$|^\d{1,6}$/.test(id)) return;
    const v = p.node.value;
    if (v.type === "FunctionExpression" || v.type === "ArrowFunctionExpression") NODES.set(id, p.get("value"));
  },
  // ⭐ The OTHER container. Turbopack pushes a flat array —
  // `TURBOPACK.push([currentScript, id, factory, id, factory, …])` — so the
  // factory nodes live as ARRAY ELEMENTS after their numeric ids, and an
  // ObjectProperty walk finds none of them. Without this, a Turbopack chunk
  // whose modules declare no export names (CSS registration, side-effect
  // modules) gave this tool NOTHING and it exited FATAL on a container that
  // module-map had read perfectly well.
  CallExpression(p) {
    const c = p.node.callee;
    if (c.type !== "MemberExpression" || c.property?.name !== "push") return;
    const arr = p.node.arguments[0];
    if (!arr || arr.type !== "ArrayExpression") return;
    const els = arr.elements;
    for (let i = 1; i < els.length - 1; i++) {
      const idEl = els[i], fnEl = els[i + 1];
      const id = idEl?.type === "NumericLiteral" ? String(idEl.value)
        : idEl?.type === "StringLiteral" ? String(idEl.value) : null;
      if (!id || !fnEl) continue;
      if (fnEl.type === "FunctionExpression" || fnEl.type === "ArrowFunctionExpression") {
        NODES.set(id, p.get(`arguments.0.elements.${i + 1}`));
        i++;
      }
    }
  },
});
// ⭐ A packer that DECLARES export names has already answered the question this
// tool exists to answer. Turbopack writes `ctx.s([["HeroSection", () => x]], id)`
// and module-map records it, so those names are evidence of the strongest kind:
// not inferred from a global, a registry or a consumer's field name, but stated
// by the build. webpack declares nothing of the sort, which is why the tiers
// below had to be invented for it.
const DECLARED = new Map(
  MAP.modules.filter((m) => (m.exportNames || []).length).map((m) => [String(m.id), m.exportNames]),
);

if (NODES.size === 0 && DECLARED.size === 0) {
  console.error("FATAL — no module container was parsed AND the map declares no export names.");
  console.error("        Either the map and the file disagree, or this packer's container is one");
  console.error("        this tool does not read yet.");
  process.exit(5);
}
if (NODES.size === 0) {
  console.log(`  (container not parsed; naming from the ${DECLARED.size} module(s) whose exports the packer declares)`);
}

// Words that name nothing. A file called `index.js` or `utils.js` tells the
// reader exactly as much as the hash did, at the cost of looking informative.
const EMPTY = new Set(["index", "utils", "util", "helpers", "helper", "common", "misc", "base", "core", "main", "lib", "data", "value", "item", "temp"]);

const kebab = (s) =>
  String(s)
    .replace(/^data-/, "")
    .replace(/[_\s]+/g, "-")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")   // RAFEmitter -> RAF-Emitter
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^A-Za-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();

const RE_TYPE = /\b[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]+)+\b/g;

// Names a module gives ITSELF by handing a string literal to a registry. The
// shape varies by framework but the evidence is the same strength as a global:
// the string is what the rest of the program looks it up by.
const REGISTRARS = /^(share|register|registerComponent|define|component|provide|factory|service|bind)$/;

// --- cross-module naming ---------------------------------------------------
// ⭐ The strongest evidence in a minified bundle is often not inside the module
// at all: it is what its CONSUMERS call it. Local variables are mangled to one
// letter, but PROPERTY NAMES SURVIVE MINIFICATION — so `this._chapterPlayer =
// new M(...)` names module M even though M itself contains no readable name.
//
// This is what let a 97-line anonymous `class {}` get a real filename. Scan the
// WHOLE container, not just the slice: a consumer outside the vertical slice
// still names the module inside it.
//
// ⚠ It is evidence about the ROLE the consumer uses it in, which is usually but
// not always the module's own identity — a field called `this._defaultEasing`
// names a use, not a type. Recorded with the consumer id so it can be checked.
const CONSUMER_NAMES = new Map(); // module id -> [{field, from}]
for (const [cid, fnPath] of NODES) {
  const local = new Map(); // local binding name -> required module id
  fnPath.traverse({
    VariableDeclarator(p) {
      const { id: lhs, init } = p.node;
      if (lhs.type !== "Identifier" || !init || init.type !== "CallExpression") return;
      const a0 = init.arguments[0];
      if (init.callee.type === "Identifier" && a0 && a0.type === "StringLiteral" && NODES.has(a0.value)) local.set(lhs.name, a0.value);
    },
  });
  if (local.size === 0) continue;
  fnPath.traverse({
    AssignmentExpression(p) {
      const { left, right } = p.node;
      if (left.type !== "MemberExpression" || left.computed || left.property.type !== "Identifier") return;
      // ⛔ `this.field = new M(...)` and `this.field = M(...)` only. NOT
      // `this.field = M.method(...)` — that names the method's RESULT, and it
      // put `breakpoint` on an 85-line constants table because one line reads
      // `pageMetrics.breakpoint = M.someMethod()`. The field holds a number the
      // module computed, not the module.
      if (right.type !== "NewExpression" && right.type !== "CallExpression") return;
      const callee = right.callee;
      if (callee.type !== "Identifier" || !local.has(callee.name)) return;
      // ⛔ …and the field must belong to someone ELSE. `M.pageMetrics.breakpoint`
      // is the module writing into its own export; a module does not name
      // itself by naming its fields.
      let lbase = left.object;
      while (lbase.type === "MemberExpression") lbase = lbase.object;
      if (lbase.type === "Identifier" && local.has(lbase.name)) return;
      const target = local.get(callee.name);
      const field = left.property.name.replace(/^_+/, "");
      if (field.length < 4 || /^[a-z]$/.test(field)) return;
      // ⛔ Module-system plumbing is not a name. `X.exports = require(id)` and
      // `X.default = …` are how CommonJS/ESM interop is spelled, and four
      // different modules laid claim to "exports" on that basis alone.
      if (/^(exports|default|module|prototype|constructor|options|config|props|state|data|value|instance|current)$/.test(field)) return;
      CONSUMER_NAMES.set(target, (CONSUMER_NAMES.get(target) || []).concat({ field, from: cid }));
    },
  });
}

const results = [];

for (const id of CLO.modules) {
  const m = byId.get(id);
  if (!m) { results.push({ id, name: null, tier: null, why: "not in webpack map", candidates: [], evidence: {} }); continue; }

  const fnPath = NODES.get(id);
  if (!fnPath) {
    // No parsed body, but the packer may still have named it.
    const decl = DECLARED.get(String(id));
    if (decl && decl.length) {
      const usable2 = decl.filter((n) => n && n !== "default" && n.length > 2);
      const pick = usable2[0] ?? null;
      results.push({
        id, lines: m.lines, name: null, tier: null, why: null,
        candidates: pick ? [{ name: kebab(pick), tier: 1, why: `the packer declares it exports \`${pick}\`` }] : [],
        evidence: { declaredExports: decl },
      });
      continue;
    }
    results.push({ id, name: null, tier: null, why: "in the map but not in the parsed container", candidates: [], evidence: {} });
    continue;
  }

  const ev = { globals: [], classes: [], fns: [], consts: [], strings: [], typeNames: [], prefixes: [], registered: [], members: [] };
  let exportedName = null;

  fnPath.traverse({
    // module.exports = <Identifier>  →  remember which binding is the export
    AssignmentExpression(p) {
      const { left, right } = p.node;
      if (
        left.type === "MemberExpression" && !left.computed &&
        left.property.type === "Identifier" && left.property.name === "exports" &&
        right.type === "Identifier"
      ) exportedName = right.name;

      // window.X = ... / self.X = ... — tier 1
      if (
        left.type === "MemberExpression" && !left.computed &&
        left.object.type === "Identifier" && /^(window|self|globalThis)$/.test(left.object.name) &&
        left.property.type === "Identifier"
      ) ev.globals.push(left.property.name);

      // X.CONST_NAME = "literal" — tier 3, the VALUE is what names the concept
      if (
        left.type === "MemberExpression" && !left.computed &&
        left.property.type === "Identifier" && /^[A-Z][A-Z0-9_]+$/.test(left.property.name) &&
        right.type === "StringLiteral" && right.value.length > 3
      ) ev.consts.push({ key: left.property.name, value: right.value });
    },
    CallExpression(p) {
      const c = p.node.callee;
      if (c.type !== "MemberExpression" || c.computed || c.property.type !== "Identifier") return;
      if (!REGISTRARS.test(c.property.name)) return;
      const a0 = p.node.arguments[0];
      if (a0 && a0.type === "StringLiteral" && /^[A-Za-z][\w-]{2,}$/.test(a0.value)) {
        ev.registered.push({ how: `${c.property.name}(${JSON.stringify(a0.value)})`, name: a0.value });
      }
    },
    ClassDeclaration(p) { if (p.node.id) ev.classes.push(p.node.id.name); },
    ClassExpression(p) { if (p.node.id) ev.classes.push(p.node.id.name); },
    FunctionDeclaration(p) { if (p.node.id) ev.fns.push(p.node.id.name); },
    StringLiteral(p) {
      const v = p.node.value;
      if (/^data-[a-z-]{4,}$/.test(v)) { ev.strings.push(v); return; }
      // ⛔ A sentence is not a name. The first version took the first four words
      // of the longest string and produced `you-cannot-create-multiple`,
      // `tweens-do-not-have`, `attempted-to-parse-a` — filenames that read as
      // informative and say nothing. ⭐ The real name was inside the same
      // string every time: an error message NAMES THE TYPE THAT THREW IT.
      // "You cannot create multiple AnimSystems", "TimeGroup not instantiated
      // correctly", "KeyframeController.updateAnimation(...)". So tier 4 accepts
      // a PascalCase token found in the message, and nothing else — a message
      // with no type name in it is not evidence of what the module is called.
      // ⛔ …and NOT by counting which type name occurs most. An error message
      // routinely names TWO types: the one that threw, and the API you should
      // have called instead — "TimeGroup not instantiated correctly. Please use
      // `AnimSystem.createTimeGroup(el)`". Frequency picked AnimSystem and named
      // the TimeGroup module after its own error's advice. ⭐ The subject is the
      // one at the FRONT; the advice lives inside backticks or after "use".
      // Third time counting has produced a confident wrong answer here
      // (reverse-engineering.md §0.4) — position and role are the axis, not
      // frequency.
      if (v.length >= 14 && /\s/.test(v)) {
        const advice = new Set();
        for (const seg of v.match(/`[^`]*`/g) || []) for (const w of seg.match(RE_TYPE) || []) advice.add(w);
        for (const seg of v.match(/\b(?:use|call|see)\s+[^.,;]*/gi) || []) for (const w of seg.match(RE_TYPE) || []) advice.add(w);
        for (const w of v.match(RE_TYPE) || []) if (!advice.has(w)) ev.typeNames.push(w);
      }
      // A PascalCase token used as a prefix for generated names/classNames is
      // the type naming itself: `"TimeGroup-" + counter`.
      if (/^[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]+)+[-_]$/.test(v)) ev.prefixes.push(v.replace(/[-_]$/, ""));
    },
  });

  // Members hung off the exported binding — a weak but real description.
  if (exportedName) {
    fnPath.traverse({
      AssignmentExpression(p) {
        const { left } = p.node;
        if (left.type === "MemberExpression" && !left.computed &&
            left.object.type === "Identifier" && left.object.name === exportedName &&
            left.property.type === "Identifier") ev.members.push(left.property.name);
      },
    });
  }

  // --- collect ALL candidates, strongest first; resolve collisions later ----
  // ⛔ Do not pick here. The first version picked one name per module and then
  // dropped BOTH sides of any collision — which threw away a tier-1 name
  // (`share("AnimSystem")`, the module registering itself) because an unrelated
  // module's tier-4 guess happened to land on the same word. A dedup rule that
  // ignores evidence strength destroys your best evidence. Resolution needs to
  // see every module's whole ladder at once.
  const usable = (n) => n && n.length > 2 && !EMPTY.has(kebab(n)) && !/^[a-z]$/.test(n) && !/^_+$/.test(n);
  const cand = [];
  const add = (n, tier, why) => { const k = kebab(n); if (k && k.length >= 3 && !EMPTY.has(k) && !cand.some((c) => c.name === k)) cand.push({ name: k, tier, why }); };

  for (const d of (DECLARED.get(String(id)) || [])) {
    if (d && d !== "default") add(d, 1, `the packer declares it exports \`${d}\``);
  }
  for (const g of ev.globals) add(g, 1, `window.${g} = …`);
  for (const r of ev.registered) add(r.name, 1, `registers itself as ${r.how}`);
  for (const c of ev.classes.filter(usable)) add(c, 2, `class ${c}`);
  // Consumer field names, most-agreed-upon first. ⭐ Here frequency IS the right
  // axis — unlike inside an error message, several consumers independently
  // choosing the same field name is corroboration, not repetition.
  //
  // ⛔ But ONE consumer's field name is a USE, not a type. Sampling five of
  // these caught exactly that: a 33-line class with `epsilon`, `target`,
  // `current`, `snapAtCreation` is a damped scalar, and the single consumer
  // that stored it in `.rotation` was using it for rotation that day. So a lone
  // field name drops to tier 3 and says out loud what it is evidence OF.
  const cf = new Map();
  for (const { field, from } of CONSUMER_NAMES.get(id) || []) cf.set(field, (cf.get(field) || []).concat(from));
  for (const [field, froms] of [...cf].sort((a, b) => new Set(b[1]).size - new Set(a[1]).size)) {
    const n = new Set(froms).size;
    if (n >= 2) add(field, 2, `${n} consumers independently store it as \`.${field}\``);
    else add(field, 3, `ONE consumer stores it as \`.${field}\` — a use, maybe not the type (${froms[0].slice(0, 10)}…)`);
  }
  for (const f of ev.fns.filter(usable)) add(f, 2, `function ${f}()`);
  for (const x of ev.prefixes) add(x, 3, `builds names with "${x}-"`);
  for (const c of ev.consts) add(c.value, 3, `${c.key} = ${JSON.stringify(c.value)}`);
  for (const t of ev.typeNames) {
    const singular = /[a-z]s$/.test(t) && !/ss$/.test(t) ? t.slice(0, -1) : t;
    add(singular, 4, `error message names ${t}`);
  }
  for (const s0 of ev.strings) add(s0, 4, `attribute ${JSON.stringify(s0)}`);
  const ms = ev.members.filter(usable);
  if (ms.length >= 2) add(ms.slice(0, 3).join("-"), 5, `exports ${ms.slice(0, 3).join(", ")}`);
  cand.sort((a, b) => a.tier - b.tier);

  results.push({
    id, lines: m.lines, name: null, tier: null, why: null, candidates: cand.slice(0, 6),
    evidence: { globals: ev.globals, registered: ev.registered.map((r) => r.how), classes: [...new Set(ev.classes)].slice(0, 6), consts: ev.consts.slice(0, 4), consumerFields: (CONSUMER_NAMES.get(id) || []).map((c) => c.field) },
  });
}

// --- resolution ------------------------------------------------------------
// ⛔ Two modules cannot share a filename, but "drop both" is the wrong repair
// when their claims are not equally strong. Walk tier by tier: at each tier,
// a name claimed by exactly one module is awarded; a name claimed by several
// AT THE SAME TIER is genuinely ambiguous and no one gets it. A module that
// loses a name to a stronger claim falls through to its own next candidate.
//
// ⚠ Still honest at the end: a module that runs out of candidates keeps its
// id. An unnamed module makes the reader go and look, which is correct — an
// arbitrarily-suffixed `foo-2.js` makes them think they already know.
const taken = new Map();
const contested = [];
// ⛔ An override for an id that is not in the slice is silently inert, and a
// silently inert override reads in the diff as a decision that took effect.
// This exact mistake — an id typed from memory, one character-run wrong — has
// now cost time twice on this target. Be loud, and say which id was meant.
{
  const present = new Set(results.map((r) => r.id));
  const unknown = Object.keys(OVERRIDES).filter((id) => !present.has(id));
  if (unknown.length) {
    console.error(`FATAL — ${unknown.length} override(s) name a module that is not in this slice:`);
    for (const u of unknown) {
      const near = [...present].filter((p) => p.slice(0, 8) === u.slice(0, 8));
      console.error(`  ${u}${near.length ? `   did you mean ${near.join(", ")}?` : ""}`);
    }
    process.exit(5);
  }
}

// Tier 0 first, and unconditionally — a read beats every inference.
for (const r of results) {
  const o = OVERRIDES[r.id];
  if (!o) continue;
  r.name = o.name; r.tier = 0; r.why = o.why; taken.set(o.name, r.id);
}
for (const tier of [1, 2, 3, 4, 5]) {
  const claims = new Map();
  for (const r of results) {
    if (r.name) continue;
    for (const c of r.candidates) {
      if (c.tier !== tier || taken.has(c.name)) continue;
      claims.set(c.name, (claims.get(c.name) || []).concat({ r, c }));
      break; // only this module's best remaining candidate at this tier
    }
  }
  for (const [n, list] of claims) {
    if (list.length === 1) {
      const { r, c } = list[0];
      r.name = n; r.tier = c.tier; r.why = c.why; taken.set(n, r.id);
    } else {
      contested.push({ name: n, tier, ids: list.map((x) => x.r.id) });
      // ⚠ Burn it for everyone so a later tier cannot quietly re-award it.
      taken.set(n, null);
      for (const { r, c } of list) r.candidates = r.candidates.filter((x) => x.name !== c.name);
    }
  }
}
for (const r of results) {
  if (!r.name) r.why = r.candidates.length
    ? `every candidate lost to a stronger claim (${r.candidates.map((c) => c.name).join(", ")}) — keeps its id`
    : "no evidence — keeps its id (readable-source.md: never invent a name)";
}

// ⛔ The output directory may not exist yet. A tool whose FIRST run cannot
// succeed is a tool nobody can start using — and the crash names the output
// path, which reads like a missing input.
fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ source: MAP.source, seed: CLO.seed, modules: results }, null, 2) + "\n");

const byTier = new Map();
for (const r of results) byTier.set(r.tier, (byTier.get(r.tier) || 0) + 1);
console.log(`=== name-modules ===`);
console.log(`  ${results.length} module(s) in slice → ${OUT}\n`);
for (const t of [0, 1, 2, 3, 4, 5, null]) {
  const n = byTier.get(t) || 0;
  if (n) console.log(`  tier ${t ?? "-"}  ${String(n).padStart(3)}  ${t === 0 ? "read by a human, recorded in " + OVERRIDES_PATH : t ? "" : "no evidence — keeps its id"}`);
}
for (const c of contested) console.log(`\n  ⚠ "${c.name}" claimed at tier ${c.tier} by ${c.ids.length} modules — ambiguous, awarded to none:\n      ${c.ids.join("\n      ")}`);
const named = results.filter((r) => r.name).length;
console.log(`\n  named ${named}/${results.length} (${Math.round((named / results.length) * 100)}%)`);
console.log(`  ⚠ every tier-3/4/5 name is a GUESS BACKED BY A STRING. Read the module before trusting it.`);
const review = results.filter((r) => r.name && r.tier >= 3);
if (review.length) {
  console.log(`\n  review these ${review.length} before they become filenames:`);
  for (const r of review) console.log(`    ${r.name.padEnd(22)} ${r.why}`);
}
