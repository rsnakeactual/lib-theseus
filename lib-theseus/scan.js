#!/usr/bin/env node
// lib-theseus/scan.js — the parity-gate scanner (polyglot driver).
//
// One driver, many language plugins. The driver is language-agnostic;
// language-specific knowledge lives in lib-theseus/scanners/<lang>.js.
// Adding support for a new language = adding one plugin file.
//
// This file must contain zero third-party dependencies. Pure
// node:fs / node:path / strings. Plugins must follow the same rule.
//
// Usage:
//   node lib-theseus/scan.js                  # scan repo root
//   node lib-theseus/scan.js src              # scan a subtree
//   node lib-theseus/scan.js --quiet          # only print summary line
//   node lib-theseus/scan.js --json           # machine-readable output
//   node lib-theseus/scan.js --language=py    # restrict to one plugin

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SCANNERS_DIR = path.join(__dirname, 'scanners');

// ---------------------------------------------------------------------------
// Plugin contract (every file under scanners/ exports an object shaped as):
//
//   {
//     language: 'python',
//     // Optional. Defaults to extension-based check from sourceExtensions.
//     matchSource(filePath: string): boolean
//     // Optional. Defaults to basename-based check from manifestFiles.
//     matchManifest(filePath: string): boolean
//     sourceExtensions?: string[]   // e.g. ['.py']
//     manifestFiles?: string[]      // e.g. ['requirements.txt', 'pyproject.toml']
//     // Optional. Called once before scanning, lets the plugin populate
//     // ctx.projectPackages and ctx.discovered by reading the tree.
//     discoverContext(projectRoot: string, ctx: object): void
//     scanSource(src: string, filePath: string, ctx: object): Ref[]
//     scanManifest(src: string, filePath: string, ctx: object): Ref[]
//     classify(spec: string, ctx: object, ref?: Ref): {
//       allowed: boolean, packageName?: string, reason?: string
//     }
//   }
//
// Where Ref = { spec, line, kind, package?, version? }.
// ---------------------------------------------------------------------------

function loadPlugins() {
  const plugins = [];
  let entries;
  try { entries = fs.readdirSync(SCANNERS_DIR); }
  catch { return plugins; }
  for (const f of entries.sort()) {
    if (!f.endsWith('.js')) continue;
    let mod;
    try { mod = require(path.join(SCANNERS_DIR, f)); }
    catch (e) {
      process.stderr.write(`scan.js: cannot load scanner ${f}: ${e.message}\n`);
      process.exit(2);
    }
    if (!mod || typeof mod.language !== 'string') {
      process.stderr.write(`scan.js: ${f} did not export 'language'\n`);
      process.exit(2);
    }
    if (typeof mod.matchSource !== 'function') {
      const exts = new Set((mod.sourceExtensions || []).map(s => s.toLowerCase()));
      mod.matchSource = (p) => exts.has(path.extname(p).toLowerCase());
    }
    if (typeof mod.matchManifest !== 'function') {
      const names = new Set(mod.manifestFiles || []);
      mod.matchManifest = (p) => {
        const b = path.basename(p);
        if (names.has(b)) return true;
        // pattern support for things like *.gemspec
        for (const n of names) {
          if (n.startsWith('*.') && b.endsWith(n.slice(1))) return true;
        }
        return false;
      };
    }
    plugins.push(mod);
  }
  return plugins;
}

// ---------------------------------------------------------------------------
// Project-local config. Schema (all keys optional):
//
//   {
//     "platformExceptions": {
//       "javascript": ["electron", "node-pty"],
//       "python": [],
//       "rust": []
//     },
//     "projectPackages": {
//       "python": ["myproj"],
//       "go":     ["github.com/me/myproj"]
//     },
//     "skipDirs": ["assets", "MobileApp"]
//   }
//
// Backward compat: if `platformExceptions` is an array, it's treated as
// the JavaScript list (the old single-language schema).

function loadConfig() {
  const cfgPath = path.join(__dirname, 'exceptions.json');
  const result = {
    platformExceptions: {},
    projectPackages: {},
    skipDirs: new Set(),
    path: cfgPath, present: false,
  };
  let raw;
  try { raw = fs.readFileSync(cfgPath, 'utf8'); }
  catch { return result; }
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (e) {
    process.stderr.write(`scan.js: cannot parse ${cfgPath}: ${e.message}\n`);
    process.exit(2);
  }
  result.present = true;
  let pe = parsed.platformExceptions || {};
  if (Array.isArray(pe)) pe = { javascript: pe };
  for (const [lang, list] of Object.entries(pe)) {
    result.platformExceptions[lang] = new Set(Array.isArray(list) ? list : []);
  }
  for (const [lang, list] of Object.entries(parsed.projectPackages || {})) {
    result.projectPackages[lang] = new Set(Array.isArray(list) ? list : []);
  }
  for (const d of (parsed.skipDirs || [])) result.skipDirs.add(d);
  return result;
}

// ---------------------------------------------------------------------------
// CLI

const args = process.argv.slice(2);
let target = null;
let asJson = false;
let quiet = false;
let onlyLang = null;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--json') asJson = true;
  else if (a === '--quiet' || a === '-q') quiet = true;
  else if (a === '--language' && i + 1 < args.length) onlyLang = args[++i];
  else if (a.startsWith('--language=')) onlyLang = a.slice('--language='.length);
  else if (a.startsWith('-')) {
    process.stderr.write(`scan.js: unknown flag: ${a}\n`);
    process.exit(2);
  } else if (target === null) {
    target = a;
  }
}
if (target === null) target = path.resolve(__dirname, '..');
target = path.resolve(target);

const PLUGINS = loadPlugins();
const CFG = loadConfig();

const DEFAULT_SKIP_DIRS = new Set([
  'node_modules', '.git', 'out', 'build', 'dist', '.cache', '_research',
  '__pycache__', 'target', 'vendor', '.gradle', '.idea', '.vscode',
  'venv', '.venv', 'env-py', 'site-packages',
  ...CFG.skipDirs,
]);

// ---------------------------------------------------------------------------
// File walk + plugin matching

function walk(root, onFile) {
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); }
  catch { return; }
  for (const ent of entries) {
    const full = path.join(root, ent.name);
    if (ent.isDirectory()) {
      if (DEFAULT_SKIP_DIRS.has(ent.name)) continue;
      walk(full, onFile);
    } else if (ent.isFile()) {
      onFile(full);
    }
  }
}

function pluginForFile(filePath) {
  // Manifest match wins over source match (a JSON manifest also has .json, etc.)
  for (const p of PLUGINS) {
    if (onlyLang && p.language !== onlyLang) continue;
    if (p.matchManifest(filePath)) return { plugin: p, kind: 'manifest' };
  }
  for (const p of PLUGINS) {
    if (onlyLang && p.language !== onlyLang) continue;
    if (p.matchSource(filePath)) return { plugin: p, kind: 'source' };
  }
  return null;
}

// Ctx is per-language and passed to each plugin call.
const contexts = Object.create(null);
function ctxFor(lang) {
  if (!contexts[lang]) {
    contexts[lang] = {
      projectRoot: target,
      platformExceptions: CFG.platformExceptions[lang] || new Set(),
      projectPackages: new Set(CFG.projectPackages[lang] || new Set()),
      discovered: {},
    };
  }
  return contexts[lang];
}

// ---------------------------------------------------------------------------
// Pass 0: walk the tree once, classify each file (manifest vs source vs
// neither), and group manifest paths by language so each plugin can run
// its discoverContext over every manifest in the tree (not just at root).

const matched = [];          // [{ filePath, plugin, kind }]
const manifestsByLang = {};  // { language: [filePath, ...] }
walk(target, (filePath) => {
  const m = pluginForFile(filePath);
  if (!m) return;
  matched.push({ filePath, ...m });
  if (m.kind === 'manifest') {
    (manifestsByLang[m.plugin.language] = manifestsByLang[m.plugin.language] || []).push(filePath);
  }
});

for (const p of PLUGINS) {
  if (onlyLang && p.language !== onlyLang) continue;
  if (typeof p.discoverContext !== 'function') continue;
  try { p.discoverContext(manifestsByLang[p.language] || [], ctxFor(p.language), target); }
  catch (e) {
    process.stderr.write(`scan.js: ${p.language} discoverContext failed: ${e.message}\n`);
  }
}

// ---------------------------------------------------------------------------
// Pass 1: scan + classify

const violations = [];

for (const { filePath, plugin, kind } of matched) {
  let src;
  try { src = fs.readFileSync(filePath, 'utf8'); }
  catch { continue; }
  const ctx = ctxFor(plugin.language);
  let refs;
  try {
    refs = kind === 'manifest'
      ? (plugin.scanManifest ? plugin.scanManifest(src, filePath, ctx) : [])
      : (plugin.scanSource   ? plugin.scanSource  (src, filePath, ctx) : []);
  } catch (e) {
    process.stderr.write(`scan.js: ${plugin.language} scan failed in ${filePath}: ${e.message}\n`);
    continue;
  }
  for (const ref of refs || []) {
    const spec = ref.spec != null ? ref.spec : ref.package;
    if (spec == null) continue;
    let result;
    try { result = plugin.classify(spec, ctx, ref); }
    catch (e) {
      process.stderr.write(`scan.js: ${plugin.language} classify failed for ${spec}: ${e.message}\n`);
      continue;
    }
    if (!result || result.allowed) continue;
    violations.push({
      language: plugin.language,
      file: path.relative(target, filePath) || path.basename(filePath),
      line: ref.line || 0,
      spec: spec,
      package: result.packageName || ref.package || spec,
      kind: ref.kind || (kind === 'manifest' ? 'manifest-dep' : 'import'),
      reason: result.reason || '',
    });
  }
}

// ---------------------------------------------------------------------------
// Pass 2: theseus.json validation
//
// Walks lib-theseus/<package>/ folders looking for per-library
// records. See PROTOCOL.md §11 for the schema and §14.5 for the
// validation contract.

const ECOSYSTEMS = new Set(['npm', 'pypi', 'cargo', 'gomod', 'rubygems', 'maven', 'nuget', 'composer', 'pub', 'swift', 'other']);
const ABUSE_CATEGORIES = new Set(['DoS', 'Injection', 'ParserDesync', 'InfoDisclosure', 'ResourceExhaustion', 'LogicFlaw', 'AuthBypass', 'MemorySafety', 'Other']);
const IMPL_BASES = new Set(['spec', 'behavior', 'both']);

function isObject(v) { return v && typeof v === 'object' && !Array.isArray(v); }
function isString(v) { return typeof v === 'string' && v.length > 0; }
function isInt(v)    { return typeof v === 'number' && Number.isInteger(v); }
function isBool(v)   { return typeof v === 'boolean'; }
function isArray(v)  { return Array.isArray(v); }

function validateTheseusJson(parsed, packageDir, projectRoot) {
  const errors = [];
  const r = (msg) => errors.push(msg);

  if (!isInt(parsed.schemaVersion) || parsed.schemaVersion !== 1) {
    r('schemaVersion must equal 1');
  }
  if (!isObject(parsed.original)) {
    r('original must be an object');
  } else {
    const o = parsed.original;
    if (!isString(o.name))      r('original.name must be a non-empty string');
    if (!isString(o.ecosystem)) r('original.ecosystem must be a non-empty string');
    else if (!ECOSYSTEMS.has(o.ecosystem)) r(`original.ecosystem "${o.ecosystem}" is not in the closed set (see PROTOCOL.md §11.4)`);
    if (!isString(o.version))   r('original.version must be a non-empty string');
    if (!isString(o.license))   r('original.license must be a non-empty string');
    if (!isString(o.studiedAt)) r('original.studiedAt must be an ISO-8601 date or datetime string');
  }
  if (!isObject(parsed.replacement)) {
    r('replacement must be an object');
  } else {
    const rep = parsed.replacement;
    if (!isString(rep.path)) {
      r('replacement.path must be a non-empty string');
    } else {
      const target = path.resolve(projectRoot, rep.path);
      try { fs.accessSync(target); }
      catch { r(`replacement.path points at "${rep.path}" but no such file exists`); }
    }
    if (!isString(rep.completedAt)) r('replacement.completedAt must be an ISO-8601 date or datetime string');
  }
  if (!isObject(parsed.license)) {
    r('license must be an object');
  } else {
    const l = parsed.license;
    if (!isBool(l.sourceCopied)) r('license.sourceCopied must be a boolean');
    else if (l.sourceCopied !== false) r('license.sourceCopied is true — that record is documenting a license violation; the rewrite is not protocol-conformant');
    if (!isString(l.confirmation)) r('license.confirmation must be a non-empty string explaining how the impl was derived');
    if (l.implementationBasis !== undefined && !IMPL_BASES.has(l.implementationBasis)) {
      r(`license.implementationBasis "${l.implementationBasis}" is not in the closed set (spec/behavior/both)`);
    }
  }
  if (!isArray(parsed.knownVulnerabilities)) {
    r('knownVulnerabilities must be an array (use [] if there are no known CVEs in the studied version\'s history)');
  }
  if (!isArray(parsed.abuseCases)) {
    r('abuseCases must be an array (use [] if no abuse cases apply, but think hard before saying so)');
  }
  if (!isArray(parsed.performanceMandates)) {
    r('performanceMandates must be an array (use [] only if the library has no user-visible performance-critical path; rare)');
    return errors;
  }
  const abuseIds = new Set();
  if (isArray(parsed.abuseCases)) {
    for (let i = 0; i < parsed.abuseCases.length; i++) {
      const a = parsed.abuseCases[i];
      const where = `abuseCases[${i}]`;
      if (!isObject(a)) { r(`${where} must be an object`); continue; }
      if (!isString(a.id))         r(`${where}.id must be a non-empty string (e.g. "AC-001")`);
      else abuseIds.add(a.id);
      if (!isString(a.title))      r(`${where}.title must be a non-empty string`);
      if (!isString(a.category))   r(`${where}.category must be a non-empty string`);
      else if (!ABUSE_CATEGORIES.has(a.category)) r(`${where}.category "${a.category}" is not in the closed set (see PROTOCOL.md §11.4)`);
      if (!isString(a.scenario))   r(`${where}.scenario must be a non-empty string`);
      if (!isString(a.ourDefense)) r(`${where}.ourDefense must be a non-empty string`);
      if (!isString(a.test))       r(`${where}.test must be a path string`);
      else {
        const testPath = path.resolve(packageDir, a.test);
        try { fs.accessSync(testPath); }
        catch { r(`${where}.test points at "${a.test}" but no such file exists relative to the package folder`); }
      }
    }
  }
  for (let i = 0; i < parsed.performanceMandates.length; i++) {
    const p = parsed.performanceMandates[i];
    const where = `performanceMandates[${i}]`;
    if (!isObject(p)) { r(`${where} must be an object`); continue; }
    if (!isString(p.id))       r(`${where}.id must be a non-empty string (e.g. "PM-001")`);
    if (!isString(p.title))    r(`${where}.title must be a non-empty string`);
    if (!isString(p.scenario)) r(`${where}.scenario must be a non-empty string describing what work is being measured and why timing matters`);
    if (!isString(p.baseline)) r(`${where}.baseline must be a non-empty string with the measured timing/memory/throughput of the original`);
    if (!isString(p.mandate))  r(`${where}.mandate must be a non-empty string with the bound this impl must meet (prefer "≤Nx original" over absolutes)`);
    if (!isString(p.test))     r(`${where}.test must be a path string pointing at the benchmark`);
    else {
      const testPath = path.resolve(packageDir, p.test);
      try { fs.accessSync(testPath); }
      catch { r(`${where}.test points at "${p.test}" but no such file exists relative to the package folder`); }
    }
  }
  if (isArray(parsed.knownVulnerabilities)) {
    for (let i = 0; i < parsed.knownVulnerabilities.length; i++) {
      const v = parsed.knownVulnerabilities[i];
      const where = `knownVulnerabilities[${i}]`;
      if (!isObject(v)) { r(`${where} must be an object`); continue; }
      if (!isString(v.id))            r(`${where}.id must be a non-empty string (e.g. "CVE-2022-21680")`);
      if (!isString(v.affectsVersions)) r(`${where}.affectsVersions must be a non-empty string`);
      if (!isString(v.title))         r(`${where}.title must be a non-empty string`);
      if (!isString(v.ourMitigation)) r(`${where}.ourMitigation must be a non-empty string`);
      if (v.abuseCaseRef !== undefined) {
        if (!isString(v.abuseCaseRef)) r(`${where}.abuseCaseRef must be a string referencing an abuseCases[].id`);
        else if (!abuseIds.has(v.abuseCaseRef)) r(`${where}.abuseCaseRef "${v.abuseCaseRef}" does not match any abuseCases[].id`);
      }
    }
  }
  return errors;
}

const theseusFindings = []; // [{ kind: 'missing'|'invalid', package, errors? }]
const theseusRoot = path.join(target, 'lib-theseus');
let theseusEntries;
try { theseusEntries = fs.readdirSync(theseusRoot, { withFileTypes: true }); }
catch { theseusEntries = []; }

for (const ent of theseusEntries) {
  if (!ent.isDirectory()) continue;
  if (ent.name === 'scanners') continue;
  if (ent.name.startsWith('.') || ent.name.startsWith('_')) continue;

  const pkgDir = path.join(theseusRoot, ent.name);
  const jsonPath = path.join(pkgDir, 'theseus.json');
  const prdPath  = path.join(pkgDir, 'PRD.md');

  let hasPrd = false;
  try { fs.accessSync(prdPath); hasPrd = true; } catch {}

  let raw;
  try { raw = fs.readFileSync(jsonPath, 'utf8'); }
  catch {
    if (hasPrd) {
      theseusFindings.push({
        kind: 'missing', package: ent.name,
        errors: ['theseus.json is missing; the PRD.md alone is not sufficient (PROTOCOL.md §11)'],
      });
    }
    continue;
  }

  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (e) {
    theseusFindings.push({
      kind: 'invalid', package: ent.name,
      errors: [`cannot parse theseus.json: ${e.message}`],
    });
    continue;
  }

  const errs = validateTheseusJson(parsed, pkgDir, target);
  if (errs.length > 0) {
    theseusFindings.push({ kind: 'invalid', package: ent.name, errors: errs });
  }
}

// ---------------------------------------------------------------------------
// Classify each (language, package) pair as in-use, orphaned, or unlisted.
//
//   in-use    — appears in a manifest AND in source (regular case; needs rewrite)
//   imported-not-listed — appears in source but no manifest (transitive
//                         dependency leak, peer dep used via globals, etc.)
//   orphaned  — appears in a manifest but never imported in any source
//               file (free win: just delete the manifest line)
//
// Orphans are the cheapest category to resolve — they don't need to be
// rewritten at all. Surfacing them in their own section turns "find what's
// safe to delete" from a manual exercise into a mechanical one.

function isManifestKind(kind) {
  return typeof kind === 'string' && kind.startsWith('manifest-');
}

function classifyUsage() {
  // key = "lang::package"
  const groups = new Map();
  for (const v of violations) {
    const key = `${v.language}::${v.package}`;
    if (!groups.has(key)) {
      groups.set(key, { language: v.language, package: v.package, sites: [], hasManifest: false, hasImport: false });
    }
    const g = groups.get(key);
    g.sites.push(v);
    if (isManifestKind(v.kind)) g.hasManifest = true;
    else g.hasImport = true;
  }
  const orphans = [];
  const inUse = [];
  for (const g of groups.values()) {
    if (g.hasManifest && !g.hasImport) orphans.push(g);
    else inUse.push(g);
  }
  return { orphans, inUse, total: groups.size };
}

// ---------------------------------------------------------------------------
// Output

function writeReport() {
  const usage = classifyUsage();
  // Annotate each violation with its usage classification (helpful for JSON
  // consumers and downstream tooling).
  const orphanKeys = new Set(usage.orphans.map(g => `${g.language}::${g.package}`));
  for (const v of violations) {
    v.orphan = orphanKeys.has(`${v.language}::${v.package}`);
  }

  if (asJson) {
    process.stdout.write(JSON.stringify({
      target, languages: PLUGINS.map(p => p.language),
      violations,
      theseusRecords: theseusFindings,
      summary: {
        totalSites: violations.length,
        uniquePackages: usage.total,
        orphanedPackages: usage.orphans.length,
        inUsePackages: usage.inUse.length,
        invalidTheseusRecords: theseusFindings.length,
      },
      clean: violations.length === 0 && theseusFindings.length === 0,
    }, null, 2) + '\n');
    return;
  }

  const allClean = violations.length === 0 && theseusFindings.length === 0;
  if (allClean) {
    if (!quiet) process.stdout.write('\nlib-theseus scan: CLEAN — zero public dependencies detected, all theseus.json records valid.\n\n');
    return;
  }

  if (!quiet && usage.inUse.length > 0) {
    const byLang = new Map();
    for (const g of usage.inUse) {
      if (!byLang.has(g.language)) byLang.set(g.language, []);
      byLang.get(g.language).push(g);
    }
    for (const lang of [...byLang.keys()].sort()) {
      process.stdout.write(`\n=== ${lang.toUpperCase()} — IN USE (rewrite required) ===\n`);
      const groups = byLang.get(lang);
      // Sort groups by displayed name (package, except for CDN refs which
      // sort by their full URL).
      groups.sort((a, b) => a.package.localeCompare(b.package));
      for (const g of groups) {
        // CDN entries: keep the original [CDN] header convention.
        const cdnSite = g.sites.find(s => s.kind === 'cdn-script' || s.kind === 'cdn-link');
        const header = cdnSite ? `[CDN] ${cdnSite.spec}` : g.package;
        process.stdout.write(`\n  ${header}  (${g.sites.length} site${g.sites.length === 1 ? '' : 's'})\n`);
        for (const v of g.sites) {
          process.stdout.write(`    ${v.file}:${v.line}  ${v.spec}\n`);
        }
      }
    }
  }

  if (!quiet && usage.orphans.length > 0) {
    process.stdout.write('\n=== ORPHANED — listed in manifest but never imported (just delete the manifest entry) ===\n');
    const byLang = new Map();
    for (const g of usage.orphans) {
      if (!byLang.has(g.language)) byLang.set(g.language, []);
      byLang.get(g.language).push(g);
    }
    for (const lang of [...byLang.keys()].sort()) {
      process.stdout.write(`\n  [${lang}]\n`);
      const groups = byLang.get(lang).sort((a, b) => a.package.localeCompare(b.package));
      for (const g of groups) {
        const sites = g.sites.map(s => `${s.file}:${s.line}`).join(', ');
        process.stdout.write(`    ${g.package}  —  ${sites}\n`);
      }
    }
  }

  if (!quiet && theseusFindings.length > 0) {
    process.stdout.write('\n=== THESEUS RECORDS — INVALID ===\n');
    for (const f of theseusFindings) {
      process.stdout.write(`\n  ${f.package}\n`);
      for (const e of f.errors) {
        process.stdout.write(`    lib-theseus/${f.package}/theseus.json: ${e}\n`);
      }
    }
  }

  const langCount = new Set(violations.map(v => v.language)).size;
  const parts = [];
  if (usage.inUse.length > 0) {
    parts.push(`${usage.inUse.length} package(s) in use (rewrite required)`);
  }
  if (usage.orphans.length > 0) {
    parts.push(`${usage.orphans.length} orphaned (delete from manifest)`);
  }
  if (violations.length > 0) {
    parts.push(`${violations.length} site(s) across ${langCount} language(s)`);
  }
  if (theseusFindings.length > 0) {
    parts.push(`${theseusFindings.length} invalid theseus.json record(s)`);
  }
  process.stdout.write(
    `\nlib-theseus scan: WORK REMAINING — ${parts.join('; ')}.\n` +
    `Resolve per lib-theseus/PROTOCOL.md and re-run.\n\n`
  );
}

writeReport();
process.exit((violations.length === 0 && theseusFindings.length === 0) ? 0 : 1);
