// lib-theseus/scanners/python.js — Python (CPython 3.x ecosystem).
//
// Source: .py
// Manifests: requirements.txt, pyproject.toml, setup.py, Pipfile,
//            *.egg-info, constraints.txt
//
// Project-local detection: relative imports (`from . import …` /
// `from .pkg import …`), explicit prefixes in
// exceptions.json#projectPackages.python, plus auto-detected
// top-level packages (any directory at the project root containing
// __init__.py is treated as a project-local namespace).

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SOURCE_EXTS = ['.py'];
const MANIFEST_FILES = [
  'requirements.txt', 'requirements-dev.txt', 'requirements.in',
  'constraints.txt', 'pyproject.toml', 'setup.py', 'setup.cfg',
  'Pipfile',
];

// Python 3 standard library — top-level modules. Conservative; modules
// added in recent CPython versions are included.
const PY_STDLIB = new Set([
  '__future__', '_thread', 'abc', 'aifc', 'argparse', 'array', 'ast',
  'asynchat', 'asyncio', 'asyncore', 'atexit', 'audioop', 'base64',
  'bdb', 'binascii', 'binhex', 'bisect', 'builtins', 'bz2',
  'calendar', 'cgi', 'cgitb', 'chunk', 'cmath', 'cmd', 'code', 'codecs',
  'codeop', 'collections', 'colorsys', 'compileall', 'concurrent',
  'configparser', 'contextlib', 'contextvars', 'copy', 'copyreg',
  'cProfile', 'crypt', 'csv', 'ctypes', 'curses', 'dataclasses',
  'datetime', 'dbm', 'decimal', 'difflib', 'dis', 'distutils',
  'doctest', 'email', 'encodings', 'ensurepip', 'enum', 'errno',
  'faulthandler', 'fcntl', 'filecmp', 'fileinput', 'fnmatch',
  'fractions', 'ftplib', 'functools', 'gc', 'genericpath', 'getopt',
  'getpass', 'gettext', 'glob', 'graphlib', 'grp', 'gzip', 'hashlib',
  'heapq', 'hmac', 'html', 'http', 'idlelib', 'imaplib', 'imghdr',
  'imp', 'importlib', 'inspect', 'io', 'ipaddress', 'itertools',
  'json', 'keyword', 'lib2to3', 'linecache', 'locale', 'logging',
  'lzma', 'mailbox', 'mailcap', 'marshal', 'math', 'mimetypes',
  'mmap', 'modulefinder', 'msilib', 'msvcrt', 'multiprocessing',
  'netrc', 'nis', 'nntplib', 'ntpath', 'numbers', 'opcode', 'operator',
  'optparse', 'os', 'ossaudiodev', 'pathlib', 'pdb', 'pickle',
  'pickletools', 'pipes', 'pkgutil', 'platform', 'plistlib', 'poplib',
  'posix', 'posixpath', 'pprint', 'profile', 'pstats', 'pty', 'pwd',
  'py_compile', 'pyclbr', 'pydoc', 'pydoc_data', 'pyexpat', 'queue',
  'quopri', 'random', 're', 'readline', 'reprlib', 'resource',
  'rlcompleter', 'runpy', 'sched', 'secrets', 'select', 'selectors',
  'shelve', 'shlex', 'shutil', 'signal', 'site', 'smtpd', 'smtplib',
  'sndhdr', 'socket', 'socketserver', 'spwd', 'sqlite3', 'ssl',
  'stat', 'statistics', 'string', 'stringprep', 'struct', 'subprocess',
  'sunau', 'symtable', 'sys', 'sysconfig', 'syslog', 'tabnanny',
  'tarfile', 'telnetlib', 'tempfile', 'termios', 'test', 'textwrap',
  'threading', 'time', 'timeit', 'tkinter', 'token', 'tokenize',
  'tomllib', 'trace', 'traceback', 'tracemalloc', 'tty', 'turtle',
  'turtledemo', 'types', 'typing', 'unicodedata', 'unittest', 'urllib',
  'uu', 'uuid', 'venv', 'warnings', 'wave', 'weakref', 'webbrowser',
  'winreg', 'winsound', 'wsgiref', 'xdrlib', 'xml', 'xmlrpc', 'zipapp',
  'zipfile', 'zipimport', 'zlib', 'zoneinfo',
]);

// ---------------------------------------------------------------------------
// Stripping comments + triple/single-quoted strings.

function stripPyCommentsAndStrings(src) {
  const out = [];
  const n = src.length;
  let i = 0;
  while (i < n) {
    const c = src[i];
    // Triple-quoted strings (docstrings, multi-line).
    if ((c === '"' || c === '\'') && src.substr(i, 3) === c + c + c) {
      const tri = c + c + c;
      out.push('   '); i += 3;
      while (i < n && src.substr(i, 3) !== tri) {
        out.push(src[i] === '\n' ? '\n' : ' ');
        i++;
      }
      if (i < n) { out.push('   '); i += 3; }
      continue;
    }
    // Single-line strings (regular and prefixed: r"..", b"..", f".." etc.)
    if (c === '"' || c === '\'') {
      const quote = c;
      out.push(' '); i++;
      while (i < n && src[i] !== quote && src[i] !== '\n') {
        if (src[i] === '\\' && i + 1 < n) { out.push('  '); i += 2; continue; }
        out.push(' ');
        i++;
      }
      if (i < n && src[i] === quote) { out.push(' '); i++; }
      continue;
    }
    // # line comment
    if (c === '#') {
      while (i < n && src[i] !== '\n') { out.push(' '); i++; }
      continue;
    }
    out.push(c);
    i++;
  }
  return out.join('');
}

// ---------------------------------------------------------------------------
// Source scanning. Captures `import X` and `from X import …`; relative
// imports (leading dots) are preserved with their dots so classify() can
// recognize them as project-local.

const RE_PY_IMPORT = /^[ \t]*import[ \t]+([^\n#]+)/gm;
const RE_PY_FROM   = /^[ \t]*from[ \t]+(\.+[\w.]*|[\w][\w.]*)[ \t]+import\b/gm;

function lineOfOffset(src, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < src.length; i++) {
    if (src.charCodeAt(i) === 10) line++;
  }
  return line;
}

function scanSource(src /* , filePath, ctx */) {
  const out = [];
  const cleaned = stripPyCommentsAndStrings(src);

  RE_PY_IMPORT.lastIndex = 0;
  let m;
  while ((m = RE_PY_IMPORT.exec(cleaned)) !== null) {
    const list = m[1].split(',');
    const baseLine = lineOfOffset(cleaned, m.index);
    for (const item of list) {
      const name = item.trim().split(/\s+as\s+/i)[0].trim();
      if (!name) continue;
      out.push({ spec: name, line: baseLine });
    }
  }

  RE_PY_FROM.lastIndex = 0;
  while ((m = RE_PY_FROM.exec(cleaned)) !== null) {
    out.push({ spec: m[1], line: lineOfOffset(cleaned, m.index) });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Manifest scanning.

function lineOf(src, idx) {
  let line = 1;
  for (let i = 0; i < idx; i++) if (src.charCodeAt(i) === 10) line++;
  return line;
}

function depNameFromRequirement(req) {
  // PEP 508-ish: "name[extra1,extra2]>=1.0; python_version>='3.8'"
  let s = req.trim();
  if (!s || s.startsWith('#') || s.startsWith('-')) return null;
  if (s.startsWith('git+') || s.startsWith('http')) return null;
  s = s.split(';')[0];                              // drop env marker
  s = s.split(/[<>=!~]/)[0];                        // drop version specs
  s = s.split('[')[0];                              // drop extras
  s = s.split(/\s+@/)[0];                           // drop direct refs
  return s.trim() || null;
}

function scanRequirementsTxt(src) {
  const out = [];
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const name = depNameFromRequirement(lines[i]);
    if (name) out.push({ spec: name, package: name, line: i + 1, kind: 'manifest-requirements' });
  }
  return out;
}

function scanPyproject(src) {
  // PEP 621 [project] dependencies = ["x", "y[extra]>=1"]
  // and [project.optional-dependencies] groupName = ["x", ...]
  // and Poetry [tool.poetry.dependencies] / [tool.poetry.group.*.dependencies]
  const out = [];
  const lines = src.split('\n');
  let section = '';
  let arrayKey = null;
  let arrayLineStart = 0;
  let arrayBuf = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.replace(/#.*$/, '').trim();
    if (arrayKey !== null) {
      arrayBuf += ' ' + line;
      if (line.includes(']')) {
        const inside = arrayBuf.slice(arrayBuf.indexOf('[') + 1, arrayBuf.lastIndexOf(']'));
        const items = inside.split(',');
        for (const it of items) {
          const m = it.match(/^[\s"']+([A-Za-z0-9_.\-]+)/);
          if (m) {
            const name = m[1];
            if (depNameFromRequirement(name)) {
              out.push({ spec: name, package: name, line: arrayLineStart, kind: `manifest-${arrayKey}` });
            }
          }
        }
        arrayKey = null;
        arrayBuf = '';
      }
      continue;
    }
    const sec = trimmed.match(/^\[([^\]]+)\]$/);
    if (sec) { section = sec[1]; continue; }

    // PEP 621 array-style: dependencies = [ ... ]
    if (section === 'project' && /^dependencies\s*=\s*\[/.test(trimmed)) {
      arrayKey = 'project.dependencies';
      arrayLineStart = i + 1;
      arrayBuf = trimmed;
      if (trimmed.includes(']')) {
        const inside = arrayBuf.slice(arrayBuf.indexOf('[') + 1, arrayBuf.lastIndexOf(']'));
        for (const it of inside.split(',')) {
          const m = it.match(/^[\s"']+([A-Za-z0-9_.\-]+)/);
          if (m) out.push({ spec: m[1], package: m[1], line: arrayLineStart, kind: 'manifest-project.dependencies' });
        }
        arrayKey = null;
        arrayBuf = '';
      }
      continue;
    }
    if (section === 'project.optional-dependencies' && /^[\w-]+\s*=\s*\[/.test(trimmed)) {
      arrayKey = 'project.optional-dependencies';
      arrayLineStart = i + 1;
      arrayBuf = trimmed;
      if (trimmed.includes(']')) {
        const inside = arrayBuf.slice(arrayBuf.indexOf('[') + 1, arrayBuf.lastIndexOf(']'));
        for (const it of inside.split(',')) {
          const m = it.match(/^[\s"']+([A-Za-z0-9_.\-]+)/);
          if (m) out.push({ spec: m[1], package: m[1], line: arrayLineStart, kind: 'manifest-project.optional-dependencies' });
        }
        arrayKey = null;
        arrayBuf = '';
      }
      continue;
    }

    // Poetry table-style: name = "version" or name = { version = "…" }
    if (/^tool\.poetry(\..+)?\.dependencies$/.test(section)
        || /^tool\.poetry\.group\..+\.dependencies$/.test(section)) {
      const m = trimmed.match(/^([A-Za-z0-9_.\-]+)\s*=/);
      if (m) {
        const name = m[1];
        if (name !== 'python') {
          out.push({ spec: name, package: name, line: i + 1, kind: `manifest-${section}` });
        }
      }
    }
  }
  return out;
}

function scanSetupPy(src) {
  // Best-effort regex extraction of install_requires / extras_require.
  const out = [];
  const re = /install_requires\s*=\s*\[([\s\S]*?)\]/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const baseLine = lineOf(src, m.index);
    for (const item of m[1].split(',')) {
      const x = item.match(/['"]([A-Za-z0-9_.\-]+)/);
      if (x) out.push({ spec: x[1], package: x[1], line: baseLine, kind: 'manifest-setup.install_requires' });
    }
  }
  const re2 = /extras_require\s*=\s*\{([\s\S]*?)\}/g;
  while ((m = re2.exec(src)) !== null) {
    const baseLine = lineOf(src, m.index);
    const arrays = m[1].match(/\[([\s\S]*?)\]/g) || [];
    for (const arr of arrays) {
      for (const item of arr.split(',')) {
        const x = item.match(/['"]([A-Za-z0-9_.\-]+)/);
        if (x) out.push({ spec: x[1], package: x[1], line: baseLine, kind: 'manifest-setup.extras_require' });
      }
    }
  }
  return out;
}

function scanPipfile(src) {
  const out = [];
  const lines = src.split('\n');
  let section = '';
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].replace(/#.*$/, '').trim();
    const sec = trimmed.match(/^\[([^\]]+)\]$/);
    if (sec) { section = sec[1]; continue; }
    if (section !== 'packages' && section !== 'dev-packages') continue;
    const m = trimmed.match(/^([A-Za-z0-9_.\-]+)\s*=/);
    if (m) out.push({ spec: m[1], package: m[1], line: i + 1, kind: `manifest-Pipfile.${section}` });
  }
  return out;
}

function scanManifest(src, filePath /* , ctx */) {
  const base = path.basename(filePath);
  if (base === 'pyproject.toml') return scanPyproject(src);
  if (base === 'setup.py') return scanSetupPy(src);
  if (base === 'Pipfile') return scanPipfile(src);
  if (base === 'setup.cfg') return [];   // rarely used for deps; skip in v1
  return scanRequirementsTxt(src);
}

// ---------------------------------------------------------------------------
// Project-context discovery.

function discoverContext(manifestPaths, ctx, projectRoot) {
  // 1) Any directory in the tree containing __init__.py is a project-local
  //    Python package — its top-level name is the import root we accept.
  function walkForInit(dir, depth) {
    if (depth > 4) return;       // don't descend forever
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name.startsWith('.')) continue;
      if (['node_modules', 'target', 'venv', '.venv', '__pycache__', 'dist', 'build', 'site-packages'].includes(e.name)) continue;
      const sub = path.join(dir, e.name);
      try {
        fs.accessSync(path.join(sub, '__init__.py'));
        ctx.projectPackages.add(e.name);
      } catch {
        walkForInit(sub, depth + 1);
      }
    }
  }
  walkForInit(projectRoot, 0);

  // 2) [project].name from each pyproject.toml.
  for (const mp of manifestPaths) {
    if (path.basename(mp) !== 'pyproject.toml') continue;
    let raw;
    try { raw = fs.readFileSync(mp, 'utf8'); } catch { continue; }
    const lines = raw.split('\n');
    let inProject = false;
    for (const line of lines) {
      const t = line.replace(/#.*$/, '').trim();
      const sec = t.match(/^\[([^\]]+)\]$/);
      if (sec) { inProject = sec[1] === 'project'; continue; }
      if (!inProject) continue;
      const m = t.match(/^name\s*=\s*"([^"]+)"/);
      if (m) {
        ctx.projectPackages.add(m[1]);
        ctx.projectPackages.add(m[1].replace(/-/g, '_'));
        ctx.discovered.projectName = m[1];
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Classification.

function topLevel(spec) {
  // For a spec like "foo.bar.baz" or "foo", return "foo".
  // Relative imports keep their dots so we recognize them here.
  if (spec.startsWith('.')) return null;
  return spec.split('.')[0];
}

function classify(spec, ctx /* , ref */) {
  if (!spec) return { allowed: true };
  if (spec.startsWith('.')) return { allowed: true, reason: 'relative import' };
  const top = topLevel(spec);
  if (!top) return { allowed: true };
  if (PY_STDLIB.has(top)) return { allowed: true };
  if (ctx.projectPackages.has(top)) return { allowed: true };
  if (ctx.platformExceptions.has(top)) return { allowed: true };
  // Distribution names sometimes differ from import names (e.g. PIL ⇄
  // Pillow). Allow either form against platformExceptions.
  if (ctx.platformExceptions.has(spec)) return { allowed: true };
  return { allowed: false, packageName: top };
}

module.exports = {
  language: 'python',
  sourceExtensions: SOURCE_EXTS,
  manifestFiles: MANIFEST_FILES,
  discoverContext,
  scanSource, scanManifest, classify,
};
