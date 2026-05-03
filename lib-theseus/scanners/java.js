// lib-theseus/scanners/java.js — Java / Kotlin (JVM ecosystem).
//
// Source: .java .kt .kts
// Manifests: pom.xml (Maven), build.gradle, build.gradle.kts (Gradle),
//            settings.gradle, settings.gradle.kts
//
// Stdlib detection: top-level prefixes `java.`, `javax.`, `jakarta.`,
// `sun.`, `com.sun.`, `jdk.`, `org.w3c.dom`, `org.xml.sax`, `org.ietf.jgss`
// are JDK; `kotlin.` and `kotlinx.` are the Kotlin standard library.
//
// Project-local detection: read the project's `groupId` from pom.xml or
// `group` from build.gradle. Anything matching that prefix is local.
// `android.` / `androidx.` are NOT in v1's stdlib — they're platform on
// Android projects. Add them via platformExceptions on Android-targeting
// projects.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SOURCE_EXTS = ['.java', '.kt', '.kts'];
const MANIFEST_FILES = ['pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts'];

const STDLIB_PREFIXES = [
  'java.', 'javax.', 'jakarta.', 'sun.', 'com.sun.', 'jdk.',
  'org.w3c.dom', 'org.xml.sax', 'org.ietf.jgss',
  'kotlin.', 'kotlinx.',
];

function isStdlib(spec) {
  if (spec === 'java' || spec === 'javax' || spec === 'jakarta' || spec === 'kotlin') return true;
  for (const p of STDLIB_PREFIXES) {
    if (spec.startsWith(p)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Comment + string stripping (covers Java + Kotlin).
// Java: //, /* */, "..."  Java 15 text blocks: """..."""
// Kotlin: //, /* */ (nested), "...", """..."""
// Kotlin string interpolation `${...}` is not parsed deeply — we just skip
// the literal until the closing quote.

function stripJavaCommentsAndStrings(src) {
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
      // Kotlin /* */ may nest; Java doesn't, but treating as nesting is safe.
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
    // Triple-quoted: """..."""
    if (c === '"' && c2 === '"' && src[i + 2] === '"') {
      out.push('   '); i += 3;
      while (i < n && !(src[i] === '"' && src[i + 1] === '"' && src[i + 2] === '"')) {
        out.push(src[i] === '\n' ? '\n' : ' ');
        i++;
      }
      if (i < n) { out.push('   '); i += 3; }
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

// `import com.example.Foo;` / `import static com.example.Foo.bar;`
const RE_JAVA_IMPORT = /^[ \t]*import\s+(?:static\s+)?([A-Za-z_][\w.]*?)(?:\.\*)?\s*;/gm;
// Kotlin: `import com.example.Foo` (no semicolon required), optional `as Bar`
const RE_KOTLIN_IMPORT = /^[ \t]*import\s+([A-Za-z_][\w.]*?)(?:\.\*)?(?:\s+as\s+\w+)?\s*$/gm;

function scanSource(src, filePath /* , ctx */) {
  const ext = path.extname(filePath).toLowerCase();
  const cleaned = stripJavaCommentsAndStrings(src);
  const out = [];
  const re = (ext === '.java') ? RE_JAVA_IMPORT : RE_KOTLIN_IMPORT;
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(cleaned)) !== null) {
    out.push({ spec: m[1], line: lineOfOffset(cleaned, m.index) });
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

function scanPomXml(src) {
  const out = [];
  // Strip XML comments to avoid matching commented-out deps.
  const stripped = src.replace(/<!--[\s\S]*?-->/g, (m) => ' '.repeat(m.length));
  const depRe = /<dependency>([\s\S]*?)<\/dependency>/g;
  let m;
  while ((m = depRe.exec(stripped)) !== null) {
    const block = m[1];
    const g = block.match(/<groupId>\s*([^<\s][^<]*?)\s*<\/groupId>/);
    const a = block.match(/<artifactId>\s*([^<\s][^<]*?)\s*<\/artifactId>/);
    if (g && a) {
      const name = `${g[1].trim()}:${a[1].trim()}`;
      out.push({ spec: name, package: name, line: lineOf(stripped, m.index), kind: 'manifest-pom.xml' });
    }
  }
  // Plugin dependencies under <build><plugins><plugin>
  const plRe = /<plugin>([\s\S]*?)<\/plugin>/g;
  while ((m = plRe.exec(stripped)) !== null) {
    const block = m[1];
    const g = block.match(/<groupId>\s*([^<\s][^<]*?)\s*<\/groupId>/);
    const a = block.match(/<artifactId>\s*([^<\s][^<]*?)\s*<\/artifactId>/);
    if (g && a) {
      const name = `${g[1].trim()}:${a[1].trim()}`;
      out.push({ spec: name, package: name, line: lineOf(stripped, m.index), kind: 'manifest-pom.xml-plugin' });
    } else if (a) {
      // Maven plugins under org.apache.maven.plugins are implicit if no groupId
      const name = `org.apache.maven.plugins:${a[1].trim()}`;
      out.push({ spec: name, package: name, line: lineOf(stripped, m.index), kind: 'manifest-pom.xml-plugin' });
    }
  }
  return out;
}

const GRADLE_CONFIGS = [
  'implementation', 'api', 'compile', 'compileOnly', 'compileOnlyApi',
  'runtimeOnly', 'runtimeClasspath',
  'testImplementation', 'testCompile', 'testCompileOnly', 'testRuntimeOnly',
  'androidTestImplementation', 'androidTestCompileOnly',
  'debugImplementation', 'releaseImplementation',
  'kapt', 'ksp', 'annotationProcessor', 'testAnnotationProcessor',
  'classpath',
];

function scanGradle(src) {
  const out = [];
  // Strip line comments to avoid matching commented-out deps.
  const stripped = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const cfg of GRADLE_CONFIGS) {
    // Forms:
    //   implementation 'group:artifact:version'
    //   implementation("group:artifact:version")
    //   implementation group: 'g', name: 'a', version: 'v'
    //   implementation(group = "g", name = "a", version = "v")
    const re1 = new RegExp(`\\b${cfg}\\b\\s*\\(?\\s*["']([^"':]+):([^"':]+):([^"']+)["']`, 'g');
    let m;
    while ((m = re1.exec(stripped)) !== null) {
      const name = `${m[1]}:${m[2]}`;
      out.push({ spec: name, package: name, line: lineOf(stripped, m.index), kind: `manifest-gradle-${cfg}` });
    }
    const re2 = new RegExp(`\\b${cfg}\\b\\s*\\(?\\s*group\\s*[:=]\\s*["']([^"']+)["']\\s*,\\s*name\\s*[:=]\\s*["']([^"']+)["']`, 'g');
    while ((m = re2.exec(stripped)) !== null) {
      const name = `${m[1]}:${m[2]}`;
      out.push({ spec: name, package: name, line: lineOf(stripped, m.index), kind: `manifest-gradle-${cfg}` });
    }
  }
  return out;
}

function scanManifest(src, filePath /* , ctx */) {
  const base = path.basename(filePath);
  if (base === 'pom.xml') return scanPomXml(src);
  if (base.startsWith('build.gradle') || base.startsWith('settings.gradle')) return scanGradle(src);
  return [];
}

// ---------------------------------------------------------------------------
// Project-local groupId/group discovery.

function discoverContext(manifestPaths, ctx /* , projectRoot */) {
  for (const mp of manifestPaths) {
    let raw;
    try { raw = fs.readFileSync(mp, 'utf8'); } catch { continue; }
    const base = path.basename(mp);
    if (base === 'pom.xml') {
      // Project's own groupId. Avoid matching <parent><groupId>... by taking
      // the first <groupId> that appears outside any <parent>, <dependency>,
      // or <plugin> block. Simpler approach: find <groupId> immediately under
      // <project>.
      const stripped = raw.replace(/<parent>[\s\S]*?<\/parent>/g, '')
                          .replace(/<dependencies>[\s\S]*?<\/dependencies>/g, '')
                          .replace(/<plugins>[\s\S]*?<\/plugins>/g, '')
                          .replace(/<dependencyManagement>[\s\S]*?<\/dependencyManagement>/g, '');
      const m = stripped.match(/<groupId>\s*([^<\s][^<]*?)\s*<\/groupId>/);
      if (m) {
        ctx.projectPackages.add(m[1].trim());
        ctx.discovered.groupId = m[1].trim();
      }
    } else if (base.startsWith('build.gradle') || base.startsWith('settings.gradle')) {
      // Groovy: group = 'com.example' or group 'com.example'
      // Kotlin DSL: group = "com.example"
      let m = raw.match(/^[ \t]*group\s*=?\s*['"]([^'"]+)['"]/m);
      if (m) ctx.projectPackages.add(m[1].trim());
      // settings.gradle: rootProject.name = "myapp"
      m = raw.match(/rootProject\.name\s*=\s*['"]([^'"]+)['"]/);
      if (m) ctx.discovered.rootProjectName = m[1].trim();
    }
  }
}

// ---------------------------------------------------------------------------

function classify(spec, ctx /* , ref */) {
  if (!spec) return { allowed: true };
  if (isStdlib(spec)) return { allowed: true };
  for (const p of ctx.projectPackages) {
    if (spec === p) return { allowed: true };
    if (spec.startsWith(p + '.')) return { allowed: true };  // package-style
    if (spec.startsWith(p + ':')) return { allowed: true };  // Maven coords
  }
  if (ctx.platformExceptions.has(spec)) return { allowed: true };

  // For source-side imports: "com.example.foo.Bar" → strip trailing
  // PascalCase classes to get the package "com.example.foo".
  if (!spec.includes(':')) {
    const segs = spec.split('.');
    while (segs.length > 1 && /^[A-Z]/.test(segs[segs.length - 1])) segs.pop();
    const pkg = segs.join('.');
    if (ctx.platformExceptions.has(pkg)) return { allowed: true };
    for (const p of ctx.projectPackages) {
      if (pkg === p || pkg.startsWith(p + '.')) return { allowed: true };
    }
    return { allowed: false, packageName: pkg || spec };
  }

  return { allowed: false, packageName: spec };
}

module.exports = {
  language: 'java',
  sourceExtensions: SOURCE_EXTS,
  manifestFiles: MANIFEST_FILES,
  discoverContext, scanSource, scanManifest, classify,
};
