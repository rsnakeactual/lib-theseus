// lib-theseus/scanners/rust.js — Rust (rustc / cargo).
//
// Source: .rs
// Manifest: Cargo.toml
// Stdlib crates: std, core, alloc, proc_macro, test
// Project-local: crate, self, super; the [package].name from Cargo.toml
//                (auto-discovered).

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SOURCE_EXTS = ['.rs'];
const MANIFEST_FILES = ['Cargo.toml'];

const RUST_STDLIB = new Set([
  'std', 'core', 'alloc', 'proc_macro', 'test',
]);
const RUST_LOCAL_KEYWORDS = new Set(['crate', 'self', 'super', 'Self']);

// ---------------------------------------------------------------------------
// Comment + string stripping.

function stripRustCommentsAndStrings(src) {
  const out = [];
  const n = src.length;
  let i = 0;
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (c === '/' && c2 === '/') {
      while (i < n && src[i] !== '\n') { out.push(' '); i++; }
      continue;
    }
    if (c === '/' && c2 === '*') {
      // /* */ may nest in Rust; track depth.
      let depth = 1;
      out.push('  '); i += 2;
      while (i < n && depth > 0) {
        if (src[i] === '/' && src[i + 1] === '*') { depth++; out.push('  '); i += 2; continue; }
        if (src[i] === '*' && src[i + 1] === '/') { depth--; out.push('  '); i += 2; continue; }
        out.push(src[i] === '\n' ? '\n' : ' ');
        i++;
      }
      continue;
    }
    // Raw string: r#"…"# (any number of #).
    if (c === 'r' && (c2 === '"' || c2 === '#')) {
      let hashes = 0;
      let j = i + 1;
      while (j < n && src[j] === '#') { hashes++; j++; }
      if (j < n && src[j] === '"') {
        const close = '"' + '#'.repeat(hashes);
        out.push(' '); i = j + 1;
        while (i < n && src.substr(i, close.length) !== close) {
          out.push(src[i] === '\n' ? '\n' : ' ');
          i++;
        }
        if (i < n) { out.push(' '.repeat(close.length)); i += close.length; }
        continue;
      }
    }
    if (c === '"') {
      out.push(' '); i++;
      while (i < n && src[i] !== '"') {
        if (src[i] === '\\' && i + 1 < n) { out.push('  '); i += 2; continue; }
        out.push(src[i] === '\n' ? '\n' : ' ');
        i++;
      }
      if (i < n) { out.push(' '); i++; }
      continue;
    }
    out.push(c);
    i++;
  }
  return out.join('');
}

const RE_RS_USE         = /\buse\s+([A-Za-z_][A-Za-z0-9_]*)/g;
const RE_RS_EXTERN      = /\bextern\s+crate\s+([A-Za-z_][A-Za-z0-9_]*)/g;

function lineOfOffset(src, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < src.length; i++) {
    if (src.charCodeAt(i) === 10) line++;
  }
  return line;
}

function scanSource(src /* , filePath, ctx */) {
  const cleaned = stripRustCommentsAndStrings(src);
  const out = [];
  let m;
  RE_RS_USE.lastIndex = 0;
  while ((m = RE_RS_USE.exec(cleaned)) !== null) {
    out.push({ spec: m[1], line: lineOfOffset(cleaned, m.index) });
  }
  RE_RS_EXTERN.lastIndex = 0;
  while ((m = RE_RS_EXTERN.exec(cleaned)) !== null) {
    out.push({ spec: m[1], line: lineOfOffset(cleaned, m.index) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Cargo.toml parsing.

function tomlSections(src) {
  // Walk the file once, return { sectionName: [{lineno, key, raw}] }.
  // Section is current when we see [name] header. Sub-table syntax
  // [parent.child] is preserved literally.
  const out = {};
  const lines = src.split('\n');
  let cur = '';
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].replace(/#.*$/, '').trim();
    if (!trimmed) continue;
    const sec = trimmed.match(/^\[\[?([^\]]+)\]?\]$/);
    if (sec) { cur = sec[1].trim(); continue; }
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    (out[cur] = out[cur] || []).push({ lineno: i + 1, key, val });
  }
  return out;
}

function scanManifest(src /* , filePath, ctx */) {
  const sections = tomlSections(src);
  const out = [];
  const depTables = [
    'dependencies', 'dev-dependencies', 'build-dependencies',
    'workspace.dependencies',
  ];
  for (const name of Object.keys(sections)) {
    // Direct: [dependencies] / [dev-dependencies] / etc.
    if (depTables.includes(name)) {
      for (const e of sections[name]) {
        out.push({ spec: e.key, package: e.key, line: e.lineno, kind: `manifest-${name}` });
      }
      continue;
    }
    // Sub-table: [dependencies.serde] (the crate name is the trailing segment)
    for (const t of depTables) {
      if (name.startsWith(t + '.')) {
        const crate = name.slice(t.length + 1);
        out.push({ spec: crate, package: crate, line: 0, kind: `manifest-${t}` });
        break;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Discover the crate's own name (so e.g. `use myproj::foo` is local).

function discoverContext(manifestPaths, ctx /* , projectRoot */) {
  for (const mp of manifestPaths) {
    let raw;
    try { raw = fs.readFileSync(mp, 'utf8'); } catch { continue; }
    const sections = tomlSections(raw);
    const pkg = sections['package'] || [];
    for (const e of pkg) {
      if (e.key !== 'name') continue;
      const m = e.val.match(/^"([^"]+)"/);
      if (!m) continue;
      ctx.projectPackages.add(m[1]);
      ctx.projectPackages.add(m[1].replace(/-/g, '_'));
      ctx.discovered.projectName = m[1];
    }
  }
}

// ---------------------------------------------------------------------------

function classify(spec, ctx /* , ref */) {
  if (!spec) return { allowed: true };
  if (RUST_LOCAL_KEYWORDS.has(spec)) return { allowed: true };
  if (RUST_STDLIB.has(spec)) return { allowed: true };
  if (ctx.projectPackages.has(spec)) return { allowed: true };
  if (ctx.platformExceptions.has(spec)) return { allowed: true };
  return { allowed: false, packageName: spec };
}

module.exports = {
  language: 'rust',
  sourceExtensions: SOURCE_EXTS,
  manifestFiles: MANIFEST_FILES,
  discoverContext,
  scanSource, scanManifest, classify,
};
