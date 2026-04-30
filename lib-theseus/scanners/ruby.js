// lib-theseus/scanners/ruby.js — Ruby (MRI / bundler ecosystem).
//
// Source: .rb (and .rake / .gemspec also have Ruby syntax)
// Manifests: Gemfile, *.gemspec
//
// Stdlib detection: hardcoded allowlist of Ruby standard library
// requires (the `require` token corresponds to a file the runtime
// resolves, not necessarily a gem). This list covers the modules
// almost any Ruby project would touch from stdlib.

'use strict';

const SOURCE_EXTS = ['.rb', '.rake', '.ru'];
const MANIFEST_FILES = ['Gemfile', '*.gemspec'];

const RUBY_STDLIB = new Set([
  // Core / always-available (require not needed but commonly written):
  'English', 'rbconfig',
  // Standard library "default gems" / "bundled gems":
  'abbrev', 'base64', 'benchmark', 'bigdecimal', 'cgi', 'coverage',
  'csv', 'date', 'dbm', 'debug', 'delegate', 'did_you_mean', 'digest',
  'drb', 'erb', 'etc', 'expect', 'fcntl', 'fiber', 'fiddle', 'fileutils',
  'find', 'forwardable', 'gdbm', 'getoptlong', 'io/console', 'io/nonblock',
  'io/wait', 'ipaddr', 'irb', 'json', 'logger', 'matrix', 'minitest',
  'monitor', 'mutex_m', 'net/ftp', 'net/http', 'net/https', 'net/imap',
  'net/pop', 'net/smtp', 'net/telnet', 'nkf', 'objspace', 'observer',
  'open-uri', 'open3', 'openssl', 'optparse', 'ostruct', 'pathname',
  'pp', 'prettyprint', 'prime', 'profile', 'profiler', 'pstore', 'psych',
  'racc', 'rdoc', 'readline', 'reline', 'resolv', 'resolv-replace',
  'rinda', 'ripper', 'rss', 'rubygems', 'scanf', 'sdbm', 'securerandom',
  'set', 'shellwords', 'singleton', 'socket', 'stringio', 'strscan',
  'syslog', 'tempfile', 'thwait', 'time', 'timeout', 'tmpdir', 'tracer',
  'tsort', 'un', 'uri', 'weakref', 'webrick', 'win32ole', 'yaml', 'zlib',
]);

// ---------------------------------------------------------------------------

function stripRubyCommentsAndStrings(src) {
  const out = [];
  const n = src.length;
  let i = 0;
  // Handle =begin/=end block comments at line starts.
  while (i < n) {
    if ((i === 0 || src[i - 1] === '\n') && src.startsWith('=begin', i)) {
      while (i < n) {
        if ((src[i] === '\n' || i === 0) && src.startsWith('=end', i + (src[i] === '\n' ? 1 : 0))) {
          // skip to end of line
          while (i < n && src[i] !== '\n') { out.push(' '); i++; }
          break;
        }
        out.push(src[i] === '\n' ? '\n' : ' ');
        i++;
      }
      continue;
    }
    const c = src[i];
    if (c === '#') {
      while (i < n && src[i] !== '\n') { out.push(' '); i++; }
      continue;
    }
    if (c === '"' || c === '\'') {
      const q = c;
      out.push(q); i++;
      while (i < n && src[i] !== q) {
        if (src[i] === '\\' && i + 1 < n) { out.push(' ', src[i + 1]); i += 2; continue; }
        out.push(src[i] === '\n' ? '\n' : ' ');
        i++;
      }
      if (i < n) { out.push(q); i++; }
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

const RE_RB_REQUIRE = /\brequire\s*\(?\s*['"]([^'"]+)['"]/g;
const RE_RB_REQUIRE_RELATIVE = /\brequire_relative\b/g;

function scanSource(src /* , filePath, ctx */) {
  const cleaned = stripRubyCommentsAndStrings(src);
  // Note: stripping replaces string content with spaces; we need the
  // ORIGINAL specifiers, so re-extract from raw src using the cleaned
  // mask only to ensure we're outside comments.
  const out = [];
  let m;
  RE_RB_REQUIRE.lastIndex = 0;
  while ((m = RE_RB_REQUIRE.exec(src)) !== null) {
    // Validate the match position isn't inside a comment by checking
    // the cleaned version has the same `require` token at that offset.
    if (cleaned.slice(m.index, m.index + 'require'.length) !== 'require') continue;
    out.push({ spec: m[1], line: lineOfOffset(src, m.index) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Gemfile and *.gemspec parsing.

function scanGemfile(src) {
  const out = [];
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].replace(/#.*$/, '').trim();
    const m = t.match(/^gem\s+['"]([^'"]+)['"]/);
    if (m) out.push({ spec: m[1], package: m[1], line: i + 1, kind: 'manifest-Gemfile' });
  }
  return out;
}

function scanGemspec(src) {
  const out = [];
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].replace(/#.*$/, '');
    const m = t.match(/\.add(?:_runtime|_development)?_dependency\s*\(?\s*['"]([^'"]+)['"]/);
    if (m) out.push({ spec: m[1], package: m[1], line: i + 1, kind: 'manifest-gemspec' });
  }
  return out;
}

function scanManifest(src, filePath /* , ctx */) {
  const base = (filePath.split('/').pop() || '').toLowerCase();
  if (base === 'gemfile') return scanGemfile(src);
  if (base.endsWith('.gemspec')) return scanGemspec(src);
  return [];
}

// ---------------------------------------------------------------------------

function classify(spec, ctx /* , ref */) {
  if (!spec) return { allowed: true };
  if (RUBY_STDLIB.has(spec)) return { allowed: true };
  // Allow first-segment match for nested paths (e.g. require 'json/pure')
  const first = spec.split('/')[0];
  if (RUBY_STDLIB.has(first)) return { allowed: true };
  if (ctx.projectPackages.has(spec) || ctx.projectPackages.has(first)) return { allowed: true };
  if (ctx.platformExceptions.has(spec) || ctx.platformExceptions.has(first)) return { allowed: true };
  return { allowed: false, packageName: spec };
}

module.exports = {
  language: 'ruby',
  sourceExtensions: SOURCE_EXTS,
  manifestFiles: MANIFEST_FILES,
  scanSource, scanManifest, classify,
};
