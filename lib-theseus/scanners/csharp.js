// lib-theseus/scanners/csharp.js — C# / F# / VB.NET (.NET ecosystem).
//
// Source: .cs .fs .vb
// Manifests: *.csproj, *.fsproj, *.vbproj, packages.config,
//            Directory.Packages.props, Directory.Build.props
//
// Stdlib detection: namespaces under `System.*` (the .NET BCL) are
// stdlib. `Microsoft.*` is NOT stdlib in v1 — most Microsoft.X
// namespaces correspond to NuGet packages (Microsoft.Extensions.*,
// Microsoft.AspNetCore.*, etc.). Project-local namespace defaults to
// the `<RootNamespace>` from the project file (or the project file
// basename if absent); add anything else via projectPackages.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SOURCE_EXTS = ['.cs', '.fs', '.vb'];
const MANIFEST_FILES = ['*.csproj', '*.fsproj', '*.vbproj', 'packages.config', 'Directory.Packages.props', 'Directory.Build.props'];

// Top-level namespaces that ship with the runtime.
const CSHARP_STDLIB_PREFIXES = ['System'];

// ---------------------------------------------------------------------------
// Comment + string stripping. Handles:
//   //, /* */, "...", '...', $"...", @"..." (verbatim), $@"...", @$"...",
//   $$"""...""" / """...""" (raw, C# 11+).

function stripCsCommentsAndStrings(src) {
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
    // Raw string: """...""" (any run of >=3 quotes)
    if (c === '"' && c2 === '"' && src[i + 2] === '"') {
      let q = 0;
      while (i + q < n && src[i + q] === '"') q++;
      const close = '"'.repeat(q);
      out.push(' '.repeat(q)); i += q;
      while (i < n && src.substr(i, q) !== close) {
        out.push(src[i] === '\n' ? '\n' : ' ');
        i++;
      }
      if (i < n) { out.push(' '.repeat(q)); i += q; }
      continue;
    }
    // Verbatim string: @"..." (doubled quotes escape)
    if (c === '@' && c2 === '"') {
      out.push('  '); i += 2;
      while (i < n) {
        if (src[i] === '"' && src[i + 1] === '"') { out.push('  '); i += 2; continue; }
        if (src[i] === '"') { out.push(' '); i++; break; }
        out.push(src[i] === '\n' ? '\n' : ' ');
        i++;
      }
      continue;
    }
    // Interpolated verbatim: $@"..." or @$"..."
    if (c === '$' && c2 === '@' && src[i + 2] === '"') {
      out.push('   '); i += 3;
      while (i < n && src[i] !== '"') { out.push(src[i] === '\n' ? '\n' : ' '); i++; }
      if (i < n) { out.push(' '); i++; }
      continue;
    }
    if (c === '"' || c === '\'') {
      const q = c;
      out.push(' '); i++;
      while (i < n && src[i] !== q && src[i] !== '\n') {
        if (src[i] === '\\' && i + 1 < n) { out.push('  '); i += 2; continue; }
        out.push(' '); i++;
      }
      if (i < n && src[i] === q) { out.push(' '); i++; }
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

// `using Foo.Bar;` / `using static Foo.Bar.Baz;` / `using F = Foo.Bar;`
// VB.NET uses `Imports Foo.Bar` (we accept both forms).
const RE_CS_USING       = /^[ \t]*using\s+(?:static\s+)?(?:[A-Za-z_]\w*\s*=\s*)?([A-Za-z_][\w.]*)\s*;/gm;
const RE_VB_IMPORTS     = /^[ \t]*Imports\s+([A-Za-z_][\w.]*)\b/gm;
// F# uses `open Foo.Bar`
const RE_FS_OPEN        = /^[ \t]*open\s+([A-Za-z_][\w.]*)\b/gm;

function scanSource(src, filePath /* , ctx */) {
  const ext = path.extname(filePath).toLowerCase();
  const cleaned = stripCsCommentsAndStrings(src);
  const out = [];
  const push = (regex) => {
    regex.lastIndex = 0;
    let m;
    while ((m = regex.exec(cleaned)) !== null) {
      out.push({ spec: m[1], line: lineOfOffset(cleaned, m.index) });
    }
  };
  if (ext === '.cs')  push(RE_CS_USING);
  if (ext === '.vb')  push(RE_VB_IMPORTS);
  if (ext === '.fs')  push(RE_FS_OPEN);
  return out;
}

// ---------------------------------------------------------------------------
// Manifest parsing.

function lineOf(src, idx) {
  let line = 1;
  for (let i = 0; i < idx; i++) if (src.charCodeAt(i) === 10) line++;
  return line;
}

// .csproj / .fsproj / .vbproj / Directory.Packages.props / Directory.Build.props
function scanProjectFile(src) {
  const out = [];
  // <PackageReference Include="Foo" Version="1.0" />
  // <PackageReference Update="Foo" Version="1.0" />  (centralized package mgmt)
  const re = /<PackageReference\s+(?:Include|Update)\s*=\s*["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    out.push({ spec: m[1], package: m[1], line: lineOf(src, m.index), kind: 'manifest-PackageReference' });
  }
  // Legacy <Reference Include="Newtonsoft.Json, Version=…" /> for assembly refs;
  // capture the assembly name only.
  const re2 = /<Reference\s+Include\s*=\s*["']([^",;]+)/g;
  while ((m = re2.exec(src)) !== null) {
    const name = m[1].trim();
    if (name && !name.startsWith('System')) {
      out.push({ spec: name, package: name, line: lineOf(src, m.index), kind: 'manifest-Reference' });
    }
  }
  return out;
}

function scanPackagesConfig(src) {
  const out = [];
  // <package id="Foo" version="1.0" />
  const re = /<package\s+id\s*=\s*["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    out.push({ spec: m[1], package: m[1], line: lineOf(src, m.index), kind: 'manifest-packages.config' });
  }
  return out;
}

function scanManifest(src, filePath /* , ctx */) {
  const base = path.basename(filePath);
  if (base === 'packages.config') return scanPackagesConfig(src);
  return scanProjectFile(src); // covers .csproj, .fsproj, .vbproj, Directory.*.props
}

// ---------------------------------------------------------------------------
// Project-local namespace discovery.

function discoverContext(manifestPaths, ctx /* , projectRoot */) {
  for (const mp of manifestPaths) {
    const base = path.basename(mp);
    if (!/\.(cs|fs|vb)proj$/i.test(base)) continue;
    let raw;
    try { raw = fs.readFileSync(mp, 'utf8'); } catch { continue; }
    const m = raw.match(/<RootNamespace>\s*([A-Za-z_][\w.]*)\s*<\/RootNamespace>/);
    if (m) {
      ctx.projectPackages.add(m[1]);
      ctx.discovered.rootNamespace = m[1];
    } else {
      // Fall back to project file basename
      const name = base.replace(/\.(cs|fs|vb)proj$/i, '');
      if (/^[A-Za-z_]\w*$/.test(name)) ctx.projectPackages.add(name);
    }
    // Also pick up <AssemblyName> as a potential local namespace
    const a = raw.match(/<AssemblyName>\s*([A-Za-z_][\w.]*)\s*<\/AssemblyName>/);
    if (a) ctx.projectPackages.add(a[1]);
  }
}

// ---------------------------------------------------------------------------

function isStdlib(spec) {
  for (const p of CSHARP_STDLIB_PREFIXES) {
    if (spec === p || spec.startsWith(p + '.')) return true;
  }
  return false;
}

function classify(spec, ctx /* , ref */) {
  if (!spec) return { allowed: true };
  if (isStdlib(spec)) return { allowed: true };
  for (const p of ctx.projectPackages) {
    if (spec === p || spec.startsWith(p + '.')) return { allowed: true };
  }
  if (ctx.platformExceptions.has(spec)) return { allowed: true };
  // For source-side imports, derive the package-name reporting key by
  // stripping any trailing PascalCase class segments. "Newtonsoft.Json.Linq"
  // → "Newtonsoft.Json"; "AutoMapper" stays "AutoMapper".
  const segs = spec.split('.');
  while (segs.length > 1 && /^[A-Z]/.test(segs[segs.length - 1]) && segs.length > 2) segs.pop();
  const pkg = segs.join('.');
  if (ctx.platformExceptions.has(pkg)) return { allowed: true };
  return { allowed: false, packageName: pkg || spec };
}

module.exports = {
  language: 'csharp',
  sourceExtensions: SOURCE_EXTS,
  manifestFiles: MANIFEST_FILES,
  discoverContext, scanSource, scanManifest, classify,
};
