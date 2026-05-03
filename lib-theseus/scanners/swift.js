// lib-theseus/scanners/swift.js — Swift (SPM / CocoaPods / Carthage).
//
// Source: .swift
// Manifests: Package.swift (SPM), Podfile (CocoaPods), Cartfile (Carthage)
//
// Stdlib detection: Swift modules ship together — `Swift`, `Foundation`,
// `UIKit`, `SwiftUI`, `Combine`, the Core* family, etc. The list below
// is comprehensive for Apple platforms. On Linux/Windows Swift,
// `Glibc` / `WinSDK` cover libc.
//
// Project-local detection: read `name:` from `Package.swift`'s
// `Package(...)` literal. `Package.swift` is real Swift code (not a
// declarative manifest), so the parser is regex-based and handles the
// common forms; unusual constructs may need manual `projectPackages`
// entries.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SOURCE_EXTS = ['.swift'];
const MANIFEST_FILES = ['Package.swift', 'Podfile', 'Cartfile', 'Cartfile.private'];

// Apple frameworks + Swift stdlib + bundled testing. This is the
// "modules that ship with the SDK" list.
const SWIFT_STDLIB = new Set([
  // Swift core
  'Swift', 'Foundation', '_Concurrency', '_StringProcessing', 'RegexBuilder',
  'Distributed', 'Synchronization', 'Observation',
  // Linux/Windows libc
  'Darwin', 'Glibc', 'WinSDK', 'Bionic', 'Musl',
  'Dispatch', 'os', 'OSLog',
  // UI / app frameworks
  'UIKit', 'SwiftUI', 'AppKit', 'WatchKit', 'CarPlay', 'WidgetKit',
  'ActivityKit', 'AppIntents',
  // Core* family
  'CoreData', 'CoreGraphics', 'CoreLocation', 'CoreMotion', 'CoreImage',
  'CoreAnimation', 'CoreText', 'CoreFoundation', 'CoreVideo', 'CoreAudio',
  'CoreMIDI', 'CoreBluetooth', 'CoreSpotlight', 'CoreServices', 'CoreNFC',
  'CoreHaptics', 'CoreTelephony', 'CoreML', 'CoreMediaIO',
  // Media
  'AVFoundation', 'AVKit', 'AVRouting', 'WebKit', 'StoreKit',
  'EventKit', 'EventKitUI', 'MessageUI', 'Messages',
  'PassKit', 'PhotoKit', 'Photos', 'PhotosUI',
  // Health / fitness / home
  'HealthKit', 'HealthKitUI', 'HomeKit',
  // Games / 3D
  'GameKit', 'GameplayKit', 'GameController',
  'SceneKit', 'SpriteKit',
  'Metal', 'MetalKit', 'MetalPerformanceShaders', 'MetalPerformanceShadersGraph',
  // AR / vision / ML
  'ARKit', 'RealityKit', 'Vision', 'VisionKit', 'CreateML',
  'Speech', 'NaturalLanguage', 'SoundAnalysis',
  // Maps / location / motion
  'MapKit', 'Maps',
  // Networking / security
  'Network', 'NetworkExtension', 'CryptoKit', 'CommonCrypto',
  'Security', 'LocalAuthentication', 'AuthenticationServices',
  'BackgroundTasks', 'UserNotifications', 'UserNotificationsUI',
  // Reactive / data
  'Combine', 'TabularData', 'Charts',
  // Identifiers / system
  'AdSupport', 'AppTrackingTransparency', 'Accessibility',
  'Accelerate', 'simd',
  'SystemConfiguration', 'StoreKitTest',
  'Compression', 'IOKit',
  // Calls, telephony, push
  'CallKit', 'PushKit', 'ReplayKit',
  // Communication
  'MultipeerConnectivity', 'ExternalAccessory', 'NearbyInteraction',
  // Contacts / intents
  'Intents', 'IntentsUI', 'Contacts', 'ContactsUI',
  // QuickLook / Safari
  'QuickLook', 'QuickLookThumbnailing', 'SafariServices',
  // Notifications / extensions
  'NotificationCenter', 'GroupActivities', 'SharedWithYou',
  // Audio toolboxes
  'AudioToolbox', 'AudioUnit', 'OpenAL', 'OpenGLES',
  // Quartz family
  'Quartz', 'QuartzCore',
  // Less common but ship-with-SDK
  'DeveloperToolsSupport', 'GroupActivities', 'BusinessChat',
  // Test frameworks
  'XCTest', 'Testing',
]);

// ---------------------------------------------------------------------------
// Comment + string stripping.
//   //, /* */ (nested), "...", """...""" (multi-line), #"..."# (raw with N #).

function stripSwiftCommentsAndStrings(src) {
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
    // Raw string: #"…"# (any number of #)
    if (c === '#') {
      let hashes = 0;
      let j = i;
      while (j < n && src[j] === '#') { hashes++; j++; }
      if (hashes > 0 && j < n && src[j] === '"') {
        // Multi-line raw? #"""…"""#
        if (src[j + 1] === '"' && src[j + 2] === '"') {
          const close = '"""' + '#'.repeat(hashes);
          out.push(' '.repeat(hashes + 3)); i = j + 3;
          while (i < n && src.substr(i, close.length) !== close) {
            out.push(src[i] === '\n' ? '\n' : ' ');
            i++;
          }
          if (i < n) { out.push(' '.repeat(close.length)); i += close.length; }
          continue;
        }
        const close = '"' + '#'.repeat(hashes);
        out.push(' '.repeat(hashes + 1)); i = j + 1;
        while (i < n && src.substr(i, close.length) !== close) {
          out.push(src[i] === '\n' ? '\n' : ' ');
          i++;
        }
        if (i < n) { out.push(' '.repeat(close.length)); i += close.length; }
        continue;
      }
      // Otherwise, # might be an attribute or directive — leave as is.
    }
    // Triple-quoted string: """…"""
    if (c === '"' && c2 === '"' && src[i + 2] === '"') {
      out.push('   '); i += 3;
      while (i < n && !(src[i] === '"' && src[i + 1] === '"' && src[i + 2] === '"')) {
        out.push(src[i] === '\n' ? '\n' : ' ');
        i++;
      }
      if (i < n) { out.push('   '); i += 3; }
      continue;
    }
    if (c === '"') {
      out.push(' '); i++;
      while (i < n && src[i] !== '"' && src[i] !== '\n') {
        if (src[i] === '\\' && i + 1 < n) { out.push('  '); i += 2; continue; }
        out.push(' '); i++;
      }
      if (i < n && src[i] === '"') { out.push(' '); i++; }
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

// `import Foundation`
// `@testable import MyApp`
// `import struct Foundation.URL`
// `import class UIKit.UIView`
const RE_SWIFT_IMPORT = /^[ \t]*(?:@\w+\s+)?import\s+(?:struct\s+|class\s+|enum\s+|protocol\s+|typealias\s+|func\s+|var\s+|let\s+)?([A-Za-z_]\w*)/gm;

function scanSource(src /* , filePath, ctx */) {
  const cleaned = stripSwiftCommentsAndStrings(src);
  const out = [];
  let m;
  RE_SWIFT_IMPORT.lastIndex = 0;
  while ((m = RE_SWIFT_IMPORT.exec(cleaned)) !== null) {
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

function urlToPackageName(url) {
  if (!url) return null;
  let last = url.split('/').filter(Boolean).pop();
  if (!last) return null;
  return last.replace(/\.git$/, '');
}

function scanPackageSwift(src) {
  const out = [];
  // .package(url: "https://github.com/foo/bar.git", from: "1.0.0")
  // .package(url: "https://github.com/foo/bar.git", .upToNextMajor(from: "1.0.0"))
  // .package(name: "Bar", url: "https://...", ...)
  // .package(path: "../local-pkg")        ← project-local; skip
  // .package(name: "X", path: "...")      ← project-local; skip
  const reUrl = /\.package\s*\(\s*(?:name:\s*"([^"]+)"\s*,\s*)?url:\s*"([^"]+)"/g;
  let m;
  while ((m = reUrl.exec(src)) !== null) {
    const name = m[1] || urlToPackageName(m[2]);
    if (name) out.push({ spec: name, package: name, line: lineOf(src, m.index), kind: 'manifest-Package.swift', url: m[2] });
  }
  return out;
}

function scanPodfile(src) {
  const out = [];
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].replace(/#.*$/, '').trim();
    const m = t.match(/^pod\s+['"]([^'"]+)['"]/);
    if (m) {
      // Pod names use '/' for subspecs; record the root pod name.
      const name = m[1].split('/')[0];
      out.push({ spec: name, package: name, line: i + 1, kind: 'manifest-Podfile' });
    }
  }
  return out;
}

function scanCartfile(src) {
  const out = [];
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].replace(/#.*$/, '').trim();
    // github "Alamofire/Alamofire" ~> 5.0
    // git "https://example.com/x.git"
    // binary "https://example.com/x.json"
    const m = t.match(/^(?:github|git|binary)\s+["']([^"']+)["']/);
    if (m) {
      const ref = m[1];
      let name;
      if (/^https?:\/\//.test(ref) || ref.endsWith('.git')) {
        name = urlToPackageName(ref);
      } else {
        // "owner/repo" form
        name = ref.split('/').pop().replace(/\.git$/, '');
      }
      if (name) out.push({ spec: name, package: name, line: i + 1, kind: 'manifest-Cartfile' });
    }
  }
  return out;
}

function scanManifest(src, filePath /* , ctx */) {
  const base = path.basename(filePath);
  if (base === 'Package.swift') return scanPackageSwift(src);
  if (base === 'Podfile') return scanPodfile(src);
  if (base === 'Cartfile' || base === 'Cartfile.private') return scanCartfile(src);
  return [];
}

// ---------------------------------------------------------------------------
// Project name discovery (from Package.swift).

function discoverContext(manifestPaths, ctx /* , projectRoot */) {
  for (const mp of manifestPaths) {
    if (path.basename(mp) !== 'Package.swift') continue;
    let raw;
    try { raw = fs.readFileSync(mp, 'utf8'); } catch { continue; }
    // let package = Package(name: "MyProject", ...)
    const m = raw.match(/Package\s*\(\s*name:\s*"([^"]+)"/);
    if (m) {
      ctx.projectPackages.add(m[1]);
      ctx.discovered.packageName = m[1];
    }
    // Targets within the package are also project-local module names.
    // .target(name: "Foo", ...) or .testTarget(name: "FooTests", ...)
    const tre = /\.(?:target|testTarget|executableTarget|systemLibrary)\s*\(\s*name:\s*"([^"]+)"/g;
    let tm;
    while ((tm = tre.exec(raw)) !== null) {
      ctx.projectPackages.add(tm[1]);
    }
  }
}

// ---------------------------------------------------------------------------

function classify(spec, ctx /* , ref */) {
  if (!spec) return { allowed: true };
  if (SWIFT_STDLIB.has(spec)) return { allowed: true };
  if (ctx.projectPackages.has(spec)) return { allowed: true };
  if (ctx.platformExceptions.has(spec)) return { allowed: true };
  return { allowed: false, packageName: spec };
}

module.exports = {
  language: 'swift',
  sourceExtensions: SOURCE_EXTS,
  manifestFiles: MANIFEST_FILES,
  discoverContext, scanSource, scanManifest, classify,
};
