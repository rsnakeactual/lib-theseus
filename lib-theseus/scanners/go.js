// lib-theseus/scanners/go.js — Go (golang).
//
// Source: .go
// Manifest: go.mod (and go.sum, treated as derived; we only parse go.mod)
//
// Stdlib heuristic: any import path with no '.' in its first segment is
// the Go standard library (e.g. `fmt`, `net/http`, `encoding/json`).
// Project-local: anything starting with the `module …` line from go.mod.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SOURCE_EXTS = ['.go'];
const MANIFEST_FILES = ['go.mod'];

// ---------------------------------------------------------------------------
// Comment + string stripping.

function stripGoCommentsAndStrings(src) {
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
      out.push('  '); i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        out.push(src[i] === '\n' ? '\n' : ' ');
        i++;
      }
      if (i < n) { out.push('  '); i += 2; }
      continue;
    }
    // Raw string `…`
    if (c === '`') {
      out.push('`'); i++;
      while (i < n && src[i] !== '`') {
        out.push(src[i] === '\n' ? '\n' : ' ');
        i++;
      }
      if (i < n) { out.push('`'); i++; }
      continue;
    }
    // Interpreted string "…"
    if (c === '"') {
      out.push('"'); i++;
      while (i < n && src[i] !== '"' && src[i] !== '\n') {
        if (src[i] === '\\' && i + 1 < n) { out.push(src[i], src[i + 1]); i += 2; continue; }
        out.push(src[i]);
        i++;
      }
      if (i < n && src[i] === '"') { out.push('"'); i++; }
      continue;
    }
    out.push(c);
    i++;
  }
  return out.join('');
}

function lineOfOffset(src, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < src.length; i++) {
    if (src.charCodeAt(i) === 10) line++;
  }
  return line;
}

// `import "x"`, `import _ "x"`, `import alias "x"`, and block form.
const RE_GO_SINGLE = /\bimport\s+(?:[A-Za-z_][\w]*\s+|_\s+|\.\s+)?"([^"]+)"/g;
const RE_GO_BLOCK  = /\bimport\s*\(\s*([\s\S]*?)\)/g;
const RE_GO_BLOCK_LINE = /(?:[A-Za-z_][\w]*\s+|_\s+|\.\s+)?"([^"]+)"/g;

function scanSource(src /* , filePath, ctx */) {
  const cleaned = stripGoCommentsAndStrings(src);
  const out = [];
  let m;
  RE_GO_SINGLE.lastIndex = 0;
  while ((m = RE_GO_SINGLE.exec(cleaned)) !== null) {
    out.push({ spec: m[1], line: lineOfOffset(cleaned, m.index) });
  }
  RE_GO_BLOCK.lastIndex = 0;
  while ((m = RE_GO_BLOCK.exec(cleaned)) !== null) {
    const blockStart = m.index;
    const inner = m[1];
    let mm;
    RE_GO_BLOCK_LINE.lastIndex = 0;
    while ((mm = RE_GO_BLOCK_LINE.exec(inner)) !== null) {
      const offset = blockStart + m[0].indexOf(inner) + mm.index;
      out.push({ spec: mm[1], line: lineOfOffset(cleaned, offset) });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// go.mod parsing.

function scanManifest(src /* , filePath, ctx */) {
  const out = [];
  const lines = src.split('\n');
  let inRequire = false;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].replace(/\/\/.*$/, '').trim();
    if (!t) continue;
    if (t.startsWith('require (')) { inRequire = true; continue; }
    if (inRequire && t === ')') { inRequire = false; continue; }
    let line = t;
    if (t.startsWith('require ') && !t.endsWith('(')) {
      line = t.slice('require '.length).trim();
    } else if (!inRequire) continue;
    const m = line.match(/^([^\s]+)\s+([^\s]+)/);
    if (!m) continue;
    out.push({ spec: m[1], package: m[1], line: i + 1, kind: 'manifest-require', version: m[2] });
  }
  return out;
}

// ---------------------------------------------------------------------------

function discoverContext(manifestPaths, ctx /* , projectRoot */) {
  for (const mp of manifestPaths) {
    let raw;
    try { raw = fs.readFileSync(mp, 'utf8'); } catch { continue; }
    const m = raw.match(/^module\s+(\S+)/m);
    if (!m) continue;
    ctx.projectPackages.add(m[1]);
    if (!ctx.discovered.modulePath) ctx.discovered.modulePath = m[1];
  }
}

// ---------------------------------------------------------------------------
// classify
//
// Stdlib heuristic: Go stdlib import paths never contain a '.' in the
// first segment. Anything like "github.com/x/y" or "gopkg.in/x" has a
// '.' and is third-party (or project-local if it matches the module
// path).

function classify(spec, ctx /* , ref */) {
  if (!spec) return { allowed: true };
  // stdlib
  const firstSeg = spec.split('/')[0];
  if (!firstSeg.includes('.')) {
    // No domain → stdlib (with a small set of known exceptions like
    // "C" for cgo).
    if (firstSeg === 'C') return { allowed: true };
    return { allowed: true };
  }
  // project-local (matches module path or any prefix the user added)
  for (const pkg of ctx.projectPackages) {
    if (spec === pkg || spec.startsWith(pkg + '/')) return { allowed: true };
  }
  // platform exception
  if (ctx.platformExceptions.has(spec)) return { allowed: true };
  // Reduce to the "module path" we'll report — for github.com/a/b/c, the
  // package is github.com/a/b.
  const parts = spec.split('/');
  const moduleSpec = parts.slice(0, 3).join('/');
  if (ctx.platformExceptions.has(moduleSpec)) return { allowed: true };
  return { allowed: false, packageName: moduleSpec };
}

module.exports = {
  language: 'go',
  sourceExtensions: SOURCE_EXTS,
  manifestFiles: MANIFEST_FILES,
  discoverContext,
  scanSource, scanManifest, classify,
};
