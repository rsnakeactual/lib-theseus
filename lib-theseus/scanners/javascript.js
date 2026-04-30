// lib-theseus/scanners/javascript.js — JavaScript / TypeScript / HTML
//
// Surfaces every external module reference in JS/TS/HTML files, plus
// every package.json dependency, plus CDN script/link tags, plus
// node_modules-relative loads in HTML (which are public deps in
// disguise).

'use strict';

const path = require('node:path');

const SOURCE_EXTS = ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.html', '.htm'];
const MANIFEST_FILES = ['package.json'];

const NODE_BUILTINS = new Set([
  'assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console',
  'constants', 'crypto', 'dgram', 'diagnostics_channel', 'dns', 'domain',
  'events', 'fs', 'fs/promises', 'http', 'http2', 'https', 'inspector',
  'module', 'net', 'os', 'path', 'path/posix', 'path/win32', 'perf_hooks',
  'process', 'punycode', 'querystring', 'readline', 'readline/promises',
  'repl', 'stream', 'stream/consumers', 'stream/promises', 'stream/web',
  'string_decoder', 'sys', 'timers', 'timers/promises', 'tls',
  'trace_events', 'tty', 'url', 'util', 'util/types', 'v8', 'vm',
  'wasi', 'worker_threads', 'zlib', 'test',
]);

// ---------------------------------------------------------------------------
// Comment-stripping for JS. Keeps string literal content intact so the
// require()/import argument extractor can read specifiers.

// Set of characters that, when they precede `/` (skipping whitespace),
// indicate the `/` starts a regex literal rather than division.
const REGEX_LEAD = new Set([
  '=', '(', ',', '{', '[', ';', ':', '?', '!', '&', '|', '+', '-',
  '*', '%', '~', '^', '<', '>', '\n',
]);
const REGEX_LEAD_KEYWORDS = ['return', 'typeof', 'instanceof', 'in', 'of', 'delete', 'void', 'throw', 'new'];

function isRegexContext(out) {
  // Look back through `out` for the last non-whitespace character/token.
  let i = out.length - 1;
  while (i >= 0 && /\s/.test(out[i])) i--;
  if (i < 0) return true;
  const ch = out[i];
  if (REGEX_LEAD.has(ch)) return true;
  // Maybe a keyword?
  let end = i + 1;
  while (i >= 0 && /[A-Za-z_$]/.test(out[i])) i--;
  const word = out.slice(i + 1, end).join('');
  return REGEX_LEAD_KEYWORDS.includes(word);
}

function stripJsComments(src) {
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
    // Regex literal: /…/flags. Eat until the closing `/` (handling escapes
    // and character classes), then the flag chars. Heuristic for context.
    if (c === '/' && isRegexContext(out)) {
      out.push(' '); i++;
      let inClass = false;
      while (i < n) {
        const k = src[i];
        if (k === '\\' && i + 1 < n) { out.push('  '); i += 2; continue; }
        if (k === '[') inClass = true;
        else if (k === ']') inClass = false;
        else if (k === '/' && !inClass) { out.push(' '); i++; break; }
        else if (k === '\n') { out.push('\n'); i++; break; }
        out.push(' ');
        i++;
      }
      // consume regex flags (gimsuy)
      while (i < n && /[gimsuy]/.test(src[i])) { out.push(' '); i++; }
      continue;
    }
    if (c === '\'' || c === '"' || c === '`') {
      const quote = c;
      out.push(quote); i++;
      while (i < n) {
        const k = src[i];
        if (k === '\\' && i + 1 < n) { out.push(k, src[i + 1]); i += 2; continue; }
        out.push(k);
        i++;
        if (k === quote) break;
      }
      continue;
    }
    out.push(c);
    i++;
  }
  return out.join('');
}

const RE_REQUIRE         = /\brequire\s*\(\s*(['"`])([^'"`]+)\1\s*\)/g;
const RE_IMPORT_FROM     = /\bimport\s+(?:[^'"`;]*?\bfrom\s+)?(['"])([^'"`]+)\1/g;
const RE_IMPORT_BARE     = /\bimport\s+(['"])([^'"`]+)\1/g;
const RE_DYNAMIC_IMPORT  = /\bimport\s*\(\s*(['"`])([^'"`]+)\1\s*\)/g;
const RE_EXPORT_FROM     = /\bexport\s+(?:\*|\{[^}]*\}|[A-Za-z_$][\w$]*)\s+from\s+(['"])([^'"`]+)\1/g;

const RE_HTML_SCRIPT_SRC    = /<script\b[^>]*\bsrc\s*=\s*(['"])([^'"]+)\1/gi;
const RE_HTML_LINK_HREF     = /<link\b[^>]*\bhref\s*=\s*(['"])([^'"]+)\1[^>]*>/gi;
const RE_HTML_SCRIPT_BLOCK  = /<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;

function lineOfOffset(src, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < src.length; i++) {
    if (src.charCodeAt(i) === 10) line++;
  }
  return line;
}

// Defensive validity check: a real module specifier never contains
// whitespace, parens, semicolons, etc. If our strip pass missed
// something, this filter prevents fake matches from leaking through.
const SPEC_VALID = /^(?:\.\.?\/|\/|node:|@[\w.\-]+\/[\w.\-]+|[\w.\-][\w.\-/]*)$/;

function scanJsSource(src, offsetBase = 0) {
  const out = [];
  const cleaned = stripJsComments(src);
  const push = (regex, group) => {
    regex.lastIndex = 0;
    let m;
    while ((m = regex.exec(cleaned)) !== null) {
      const spec = m[group];
      if (!SPEC_VALID.test(spec)) continue;
      out.push({ spec, line: lineOfOffset(cleaned, m.index) + offsetBase });
    }
  };
  push(RE_REQUIRE, 2);
  push(RE_IMPORT_FROM, 2);
  push(RE_IMPORT_BARE, 2);
  push(RE_DYNAMIC_IMPORT, 2);
  push(RE_EXPORT_FROM, 2);
  return out;
}

// Pull a package name out of "../node_modules/<pkg>/lib/x.js"
function nodeModulesPackage(p) {
  const idx = p.indexOf('node_modules/');
  if (idx === -1) return null;
  const rest = p.slice(idx + 'node_modules/'.length);
  if (rest.startsWith('@')) {
    const parts = rest.split('/');
    if (parts.length < 2) return rest;
    return parts[0] + '/' + parts[1];
  }
  return rest.split('/')[0];
}

function scanHtmlSource(src) {
  const out = [];
  let m;
  RE_HTML_SCRIPT_SRC.lastIndex = 0;
  while ((m = RE_HTML_SCRIPT_SRC.exec(src)) !== null) {
    const url = m[2];
    const line = lineOfOffset(src, m.index);
    if (/^https?:\/\//i.test(url) || url.startsWith('//')) {
      out.push({ spec: url, line, kind: 'cdn-script' });
    } else {
      const pkg = nodeModulesPackage(url);
      if (pkg) out.push({ spec: url, line, kind: 'node-modules-script', package: pkg });
    }
  }
  RE_HTML_LINK_HREF.lastIndex = 0;
  while ((m = RE_HTML_LINK_HREF.exec(src)) !== null) {
    const tag = m[0];
    if (!/rel\s*=\s*['"]stylesheet['"]/i.test(tag)) continue;
    const url = m[2];
    const line = lineOfOffset(src, m.index);
    if (/^https?:\/\//i.test(url) || url.startsWith('//')) {
      out.push({ spec: url, line, kind: 'cdn-link' });
    } else {
      const pkg = nodeModulesPackage(url);
      if (pkg) out.push({ spec: url, line, kind: 'node-modules-link', package: pkg });
    }
  }
  RE_HTML_SCRIPT_BLOCK.lastIndex = 0;
  while ((m = RE_HTML_SCRIPT_BLOCK.exec(src)) !== null) {
    const blockStart = m.index + m[0].indexOf(m[1]);
    const blockSrc = m[1];
    const blockLineBase = lineOfOffset(src, blockStart) - 1;
    for (const r of scanJsSource(blockSrc, blockLineBase)) out.push(r);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Plugin contract

function packageNameFor(spec) {
  if (!spec) return null;
  if (spec.startsWith('.') || spec.startsWith('/')) return null;
  let s = spec.startsWith('node:') ? spec.slice(5) : spec;
  if (s.startsWith('@')) {
    const parts = s.split('/');
    if (parts.length < 2) return s;
    return parts[0] + '/' + parts[1];
  }
  if (NODE_BUILTINS.has(s)) return s;
  return s.split('/')[0];
}

function scanSource(src, filePath /* , ctx */) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html' || ext === '.htm') return scanHtmlSource(src);
  return scanJsSource(src);
}

function scanManifest(src /* , filePath, ctx */) {
  let parsed;
  try { parsed = JSON.parse(src); } catch { return []; }
  const out = [];
  const fields = [
    'dependencies', 'devDependencies', 'peerDependencies',
    'optionalDependencies', 'bundleDependencies', 'bundledDependencies',
  ];
  for (const field of fields) {
    const obj = parsed[field];
    if (!obj || typeof obj !== 'object') continue;
    for (const [name, version] of Object.entries(obj)) {
      out.push({ spec: name, package: name, line: 0, kind: `manifest-${field}`, version });
    }
  }
  return out;
}

function classify(spec, ctx, ref) {
  if (ref) {
    if (ref.kind === 'cdn-script' || ref.kind === 'cdn-link') {
      return { allowed: false, packageName: spec, reason: 'CDN load' };
    }
    if (ref.kind === 'node-modules-script' || ref.kind === 'node-modules-link') {
      if (ctx.platformExceptions.has(ref.package)) return { allowed: true };
      return { allowed: false, packageName: ref.package, reason: 'node_modules-relative load' };
    }
  }
  if (!spec) return { allowed: true };
  if (spec.startsWith('.') || spec.startsWith('/')) return { allowed: true };
  if (spec.startsWith('node:')) return { allowed: true };
  const pkg = packageNameFor(spec);
  if (pkg && NODE_BUILTINS.has(pkg)) return { allowed: true };
  if (pkg && ctx.platformExceptions.has(pkg)) return { allowed: true };
  return { allowed: false, packageName: pkg };
}

module.exports = {
  language: 'javascript',
  sourceExtensions: SOURCE_EXTS,
  manifestFiles: MANIFEST_FILES,
  scanSource, scanManifest, classify,
};
