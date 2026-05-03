// lib-theseus/scanners/c.js — C / C++.
//
// Source: .c .h .cc .cpp .cxx .hpp .hxx .cppm .ipp .tpp
// Manifests: conanfile.txt, conanfile.py, vcpkg.json, CMakeLists.txt
//
// C / C++ is genuinely hard for static dependency detection because
// `#include <foo.h>` vs `#include "foo.h"` is a build-system convention,
// not a system-vs-project signal. v1 takes a pragmatic stance:
//
// - Manifest declarations (conan, vcpkg, find_package) are the
//   authoritative list of third-party deps. Always reported.
// - Quoted `#include "..."` is treated as project-local (the standard
//   convention); never reported.
// - Angle-bracket `#include <...>` is allowed if the header (or its
//   first path segment) is in the C/C++/POSIX stdlib list. Otherwise
//   it's reported (catches `<boost/...>`, `<Qt/...>`, `<nlohmann/...>`,
//   `<gtest/...>`, etc.). Single-name angle includes that aren't
//   stdlib are also reported — those are usually third-party
//   single-header libs.
//
// Users override classification with platformExceptions (for system-
// installed deps the project legitimately relies on) and
// projectPackages (for in-tree umbrella headers like `<myproj/...>`).

'use strict';

const path = require('node:path');

const SOURCE_EXTS = ['.c', '.h', '.cc', '.cpp', '.cxx', '.c++', '.hpp', '.hxx', '.h++', '.cppm', '.ipp', '.tpp', '.inl'];
const MANIFEST_FILES = ['conanfile.txt', 'conanfile.py', 'vcpkg.json', 'vcpkg-configuration.json', 'CMakeLists.txt'];

// C standard library headers (C99 + C11 + C17 + C23).
const C_STDLIB = new Set([
  'assert.h', 'complex.h', 'ctype.h', 'errno.h', 'fenv.h', 'float.h',
  'inttypes.h', 'iso646.h', 'limits.h', 'locale.h', 'math.h', 'setjmp.h',
  'signal.h', 'stdalign.h', 'stdarg.h', 'stdatomic.h', 'stdbit.h', 'stdbool.h',
  'stdckdint.h', 'stddef.h', 'stdint.h', 'stdio.h', 'stdlib.h', 'stdnoreturn.h',
  'string.h', 'tgmath.h', 'threads.h', 'time.h', 'uchar.h', 'wchar.h', 'wctype.h',
]);

// POSIX headers commonly included from C and C++.
const POSIX_STDLIB = new Set([
  'aio.h', 'arpa/inet.h', 'cpio.h', 'dirent.h', 'dlfcn.h', 'fcntl.h', 'fmtmsg.h',
  'fnmatch.h', 'ftw.h', 'glob.h', 'grp.h', 'iconv.h', 'langinfo.h', 'libgen.h',
  'monetary.h', 'mqueue.h', 'ndbm.h', 'net/if.h', 'netdb.h', 'netinet/in.h',
  'netinet/tcp.h', 'nl_types.h', 'poll.h', 'pthread.h', 'pwd.h', 'regex.h',
  'sched.h', 'search.h', 'semaphore.h', 'spawn.h', 'strings.h', 'stropts.h',
  'sys/file.h', 'sys/ipc.h', 'sys/mman.h', 'sys/msg.h', 'sys/poll.h',
  'sys/resource.h', 'sys/select.h', 'sys/sem.h', 'sys/shm.h', 'sys/socket.h',
  'sys/stat.h', 'sys/statvfs.h', 'sys/time.h', 'sys/times.h', 'sys/types.h',
  'sys/uio.h', 'sys/un.h', 'sys/utsname.h', 'sys/wait.h', 'syslog.h', 'tar.h',
  'termios.h', 'trace.h', 'ulimit.h', 'unistd.h', 'utime.h', 'utmpx.h',
  'wordexp.h',
]);

// C++ standard library headers (C++17 + C++20 + C++23).
const CPP_STDLIB = new Set([
  'algorithm', 'any', 'array', 'atomic', 'barrier', 'bit', 'bitset',
  'cassert', 'ccomplex', 'cctype', 'cerrno', 'cfenv', 'cfloat', 'charconv',
  'chrono', 'cinttypes', 'ciso646', 'climits', 'clocale', 'cmath',
  'codecvt', 'compare', 'complex', 'concepts', 'condition_variable',
  'coroutine', 'csetjmp', 'csignal', 'cstdalign', 'cstdarg', 'cstdbool',
  'cstddef', 'cstdint', 'cstdio', 'cstdlib', 'cstring', 'ctgmath', 'ctime',
  'cuchar', 'cwchar', 'cwctype', 'debugging', 'deque', 'exception',
  'execution', 'expected', 'filesystem', 'flat_map', 'flat_set', 'format',
  'forward_list', 'fstream', 'functional', 'future', 'generator',
  'hazard_pointer', 'initializer_list', 'iomanip', 'ios', 'iosfwd',
  'iostream', 'istream', 'iterator', 'latch', 'limits', 'list', 'locale',
  'map', 'mdspan', 'memory', 'memory_resource', 'mutex', 'new', 'numbers',
  'numeric', 'optional', 'ostream', 'print', 'queue', 'random', 'ranges',
  'ratio', 'rcu', 'regex', 'scoped_allocator', 'semaphore', 'set',
  'shared_mutex', 'source_location', 'span', 'spanstream', 'sstream',
  'stack', 'stacktrace', 'stdatomic.h', 'stdexcept', 'stdfloat',
  'stop_token', 'streambuf', 'string', 'string_view', 'strstream',
  'syncstream', 'system_error', 'text_encoding', 'thread', 'tuple',
  'typeindex', 'typeinfo', 'type_traits', 'unordered_map', 'unordered_set',
  'utility', 'valarray', 'variant', 'vector', 'version',
]);

const STDLIB = new Set([...C_STDLIB, ...POSIX_STDLIB, ...CPP_STDLIB]);

// ---------------------------------------------------------------------------
// Comment + string stripping.

function stripCCommentsAndStrings(src) {
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
    // C++11 raw string: R"delim(…)delim"
    if (c === 'R' && c2 === '"') {
      let j = i + 2;
      let delim = '';
      while (j < n && src[j] !== '(' && delim.length < 16) { delim += src[j]; j++; }
      if (j < n && src[j] === '(') {
        const close = ')' + delim + '"';
        out.push(' '.repeat(j + 1 - i)); i = j + 1;
        while (i < n && src.substr(i, close.length) !== close) {
          out.push(src[i] === '\n' ? '\n' : ' ');
          i++;
        }
        if (i < n) { out.push(' '.repeat(close.length)); i += close.length; }
        continue;
      }
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

const RE_C_INCLUDE_SYS = /^[ \t]*#\s*include\s*<([^>\n]+)>/gm;
const RE_C_INCLUDE_USR = /^[ \t]*#\s*include\s*"([^"\n]+)"/gm;

function scanSource(src /* , filePath, ctx */) {
  const cleaned = stripCCommentsAndStrings(src);
  const out = [];
  let m;
  RE_C_INCLUDE_SYS.lastIndex = 0;
  while ((m = RE_C_INCLUDE_SYS.exec(cleaned)) !== null) {
    out.push({ spec: m[1], line: lineOfOffset(cleaned, m.index), kind: 'include-system' });
  }
  RE_C_INCLUDE_USR.lastIndex = 0;
  while ((m = RE_C_INCLUDE_USR.exec(cleaned)) !== null) {
    out.push({ spec: m[1], line: lineOfOffset(cleaned, m.index), kind: 'include-user' });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Manifest parsing.

function lineOf(src, idx) {
  let line = 1;
  for (let i = 0; i < idx; i++) if (src.charCodeAt(i) === 10) line++;
  return line;
}

function scanConanTxt(src) {
  const out = [];
  const lines = src.split('\n');
  let inDeps = false;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].split('#')[0].trim();
    if (/^\[\w+\]$/.test(t)) {
      inDeps = ['[requires]', '[tool_requires]', '[build_requires]', '[test_requires]'].includes(t);
      continue;
    }
    if (!inDeps || !t) continue;
    const m = t.match(/^([A-Za-z0-9_\-+.]+)\//);
    if (m) out.push({ spec: m[1], package: m[1], line: i + 1, kind: 'manifest-conanfile.txt' });
  }
  return out;
}

function scanConanPy(src) {
  const out = [];
  // requires = ["foo/1.0", "bar/2.0@user/channel"]
  const arrayRe = /\b(?:requires|build_requires|tool_requires|test_requires)\s*=\s*\[([\s\S]*?)\]/g;
  let m;
  while ((m = arrayRe.exec(src)) !== null) {
    const baseLine = lineOf(src, m.index);
    const items = m[1].matchAll(/["']([A-Za-z0-9_\-+.]+)\//g);
    for (const it of items) {
      out.push({ spec: it[1], package: it[1], line: baseLine, kind: 'manifest-conanfile.py' });
    }
  }
  // self.requires("foo/1.0")
  const callRe = /\bself\.(?:requires|build_requires|tool_requires|test_requires)\s*\(\s*["']([A-Za-z0-9_\-+.]+)\//g;
  while ((m = callRe.exec(src)) !== null) {
    out.push({ spec: m[1], package: m[1], line: lineOf(src, m.index), kind: 'manifest-conanfile.py' });
  }
  return out;
}

function scanVcpkgJson(src) {
  let parsed;
  try { parsed = JSON.parse(src); } catch { return []; }
  const out = [];
  const depList = (arr, kind) => {
    if (!Array.isArray(arr)) return;
    for (const d of arr) {
      const name = (typeof d === 'string') ? d : (d && d.name);
      if (name) out.push({ spec: name, package: name, line: 0, kind });
    }
  };
  depList(parsed.dependencies, 'manifest-vcpkg.json');
  depList(parsed['default-features'], 'manifest-vcpkg.json');
  if (parsed.overrides) depList(parsed.overrides, 'manifest-vcpkg.json');
  return out;
}

function scanCMake(src) {
  const out = [];
  // find_package(NAME ...)
  const re = /\bfind_package\s*\(\s*([A-Za-z][A-Za-z0-9_]*)/gi;
  let m;
  while ((m = re.exec(src)) !== null) {
    const name = m[1];
    // Skip CMake's own modules and language detection
    if (['CXX', 'C', 'Threads', 'Filesystem'].includes(name)) continue;
    out.push({ spec: name, package: name, line: lineOf(src, m.index), kind: 'manifest-CMakeLists.txt' });
  }
  // pkg_check_modules(VAR pkgname)
  const re2 = /\bpkg_check_modules\s*\(\s*[A-Za-z_][\w]*\s+([A-Za-z][\w\-+.]*)/gi;
  while ((m = re2.exec(src)) !== null) {
    out.push({ spec: m[1], package: m[1], line: lineOf(src, m.index), kind: 'manifest-CMakeLists.txt' });
  }
  return out;
}

function scanManifest(src, filePath /* , ctx */) {
  const base = path.basename(filePath);
  if (base === 'conanfile.txt') return scanConanTxt(src);
  if (base === 'conanfile.py')  return scanConanPy(src);
  if (base === 'vcpkg.json' || base === 'vcpkg-configuration.json') return scanVcpkgJson(src);
  if (base === 'CMakeLists.txt') return scanCMake(src);
  return [];
}

// ---------------------------------------------------------------------------

function classify(spec, ctx, ref) {
  if (!spec) return { allowed: true };

  // Source-side `#include "..."` is treated as project-local always.
  // Users who structure quoted includes that escape the project (e.g. into
  // a vendored deps tree) can mark those via projectPackages or skipDirs.
  if (ref && ref.kind === 'include-user') return { allowed: true };

  if (ref && ref.kind === 'include-system') {
    if (STDLIB.has(spec)) return { allowed: true };
    const firstSeg = spec.split('/')[0];
    if (STDLIB.has(firstSeg)) return { allowed: true };
    if (ctx.projectPackages.has(firstSeg) || ctx.platformExceptions.has(firstSeg)) {
      return { allowed: true };
    }
    if (ctx.projectPackages.has(spec) || ctx.platformExceptions.has(spec)) {
      return { allowed: true };
    }
    return { allowed: false, packageName: firstSeg };
  }

  // Manifest entry
  if (ctx.projectPackages.has(spec) || ctx.platformExceptions.has(spec)) {
    return { allowed: true };
  }
  return { allowed: false, packageName: spec };
}

module.exports = {
  language: 'c',
  sourceExtensions: SOURCE_EXTS,
  manifestFiles: MANIFEST_FILES,
  scanSource, scanManifest, classify,
};
