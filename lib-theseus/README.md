# lib-theseus

> *If, over the years, every plank of the Ship of Theseus is replaced
> with one we built ourselves — is it still the same ship?*
> **Yes. And now it's actually ours.**

A portable, polyglot protocol and scanner for driving a codebase to
**zero public dependencies**. Drop the directory into any project,
configure one file, and the scanner mechanically tells you what's still
using a third-party library — across JavaScript, Python, Rust, Go, and
Ruby — and the protocol document tells you exactly how to replace each
one (parity-equivalent, hardened against the original's CVE history,
with full provenance recorded).

**`PROTOCOL.md` is the rules. `scan.js` is the enforcer. This file is
the on-ramp.**

---

## What & why

This directory holds four kinds of artifacts:

| File | Purpose |
|---|---|
| `PROTOCOL.md` | The rewrite contract. The seven phases (identify → study → write tests → implement → verify → PRD → cleanup), licensing safety (clean-room), the parity-and-abuse gate, the anti-cheat table for LLMs. **Read it before any rewrite work.** |
| `scan.js` + `scanners/` | A pure-Node, zero-dependency scanner with one driver and one plugin per language. Walks the tree, reports every public-package reference, validates `theseus.json` records, exits non-zero until the project is clean. |
| `exceptions.json` | The single project-specific config: per-language platform exceptions and skip dirs. The only file you customize per host project. |
| Per-library work folders (created during a rewrite) | `lib-theseus/<package>/` containing `PRD.md` (human-readable), `theseus.json` (machine-readable provenance + security record), `fixtures/`, `tests/`, `abuse-fixtures/`, `abuse-tests/`. |

The goals, ranked, in case rules don't cover an edge case:

1. Supply-chain attack surface = 0
2. CVE scanners go quiet (no `package@version` in any lockfile)
3. License hygiene (no transitive surprise)
4. Version drift = 0
5. Reviewability — every byte the app runs is yours
6. Smaller, faster, fewer features

Full reasoning lives in `PROTOCOL.md` §1.

---

## Requirements

- **Node.js 18+** (uses only `node:fs` / `node:path`, the `node:`
  prefix, and the `import.meta`-style `require` — nothing fancy).
- **Nothing else.** The scanner has no `package.json`, no
  `node_modules`, no install step. It eats its own dog food.

---

## Install (three paths)

### A. Via the Claude Code skill (recommended)

If you use Claude Code, this directory ships as a Claude skill at
`~/.claude/skills/lib-theseus/`. In any project, ask Claude:

```
/lib-theseus
```

Claude will detect whether `lib-theseus/` already exists in the
project, and if not, copy it from the skill payload, generate a
starter `exceptions.json`, run the first scan, and report findings.
Subsequent invocations:

```
/lib-theseus scan                # run the scanner, summarize results
/lib-theseus phase 1             # walk through Phase 1 of PROTOCOL §5
/lib-theseus phase 4 marked      # walk Phase 4 for the `marked` package
```

### B. Manual copy from the skill payload

```sh
cp -r ~/.claude/skills/lib-theseus/lib-theseus ./lib-theseus
cp lib-theseus/exceptions.example.json lib-theseus/exceptions.json
# edit exceptions.json — see "Configure" below
node lib-theseus/scan.js
```

### C. From a peer project (e.g., this repo)

If lib-theseus already lives in another project on your machine, copy
the directory across:

```sh
cp -r /path/to/source/project/lib-theseus ./lib-theseus
cp lib-theseus/exceptions.example.json lib-theseus/exceptions.json
# do NOT copy the source project's exceptions.json — start fresh
node lib-theseus/scan.js
```

The directory is intentionally drop-in: no init step, no postinstall,
no platform-specific paths.

---

## Configure

Edit `lib-theseus/exceptions.json`. Schema (all keys optional):

```json
{
  "platformExceptions": {
    "javascript": ["electron", "node-pty"],
    "python":     [],
    "rust":       [],
    "go":         [],
    "ruby":       []
  },
  "projectPackages": {
    "go":     ["github.com/me/myproject"],
    "python": ["myproject"]
  },
  "skipDirs": ["MobileApp", "vendored-assets"]
}
```

- **`platformExceptions[<lang>]`** — packages that genuinely cannot be
  rewritten (the runtime your app compiles against, native bindings
  with no pure-language equivalent, build-only tools that don't ship).
  Each entry must be justified in `PROTOCOL.md §3.1`. Keep the list
  measurable in single digits per language.
- **`projectPackages[<lang>]`** — names the scanner should treat as
  project-local even though they look like third-party imports. Most
  languages auto-detect this (Cargo.toml `[package].name`, `go.mod`
  module line, `pyproject.toml [project].name`, top-level dirs with
  `__init__.py`). Use this only when auto-detection misses something.
- **`skipDirs`** — extra directory basenames the walker won't descend
  into. Defaults already cover `node_modules`, `.git`, `out`, `build`,
  `dist`, `.cache`, `_research`, `__pycache__`, `target`, `vendor`,
  `.gradle`, `.idea`, `.vscode`, `venv`, `.venv`.

Backward compat: an array under `platformExceptions` is auto-promoted
to JavaScript-only, matching the original single-language schema.

---

## Run

```sh
node lib-theseus/scan.js                     # scan repo root, all languages
node lib-theseus/scan.js src                 # scan a subtree
node lib-theseus/scan.js --quiet             # only the summary line
node lib-theseus/scan.js --json              # machine-readable
node lib-theseus/scan.js --language=python   # restrict to one plugin
```

Exit code is `0` when the tree is clean and `1` when any third-party
reference remains. That makes the scanner suitable for CI gates,
pre-commit hooks, and ad-hoc verification. (Wiring it into either is
your call — we deliberately don't auto-install hooks.)

---

## Reading the output

```
=== JAVASCRIPT — UNREWRITTEN ===

  marked  (3 sites)
    main.js:1441                marked
    package.json:0              marked
    src/files.html:1783         ../node_modules/marked/lib/marked.umd.js

=== PYTHON — UNREWRITTEN ===

  requests  (2 sites)
    src/app.py:5                requests
    requirements.txt:1          requests

lib-theseus scan: REWRITE STILL NEEDED — N site(s),
K unique package(s), L language(s).
```

Sites are grouped by **language → package → file:line**. A package is
fully rewritten only when it disappears from *every* line: source
imports, manifests (`package.json` / `Cargo.toml` / `go.mod` / etc.),
HTML CDN tags, and `node_modules`-relative loads. Removing it from
just one is a half-rewrite (see `PROTOCOL.md §11`'s anti-cheat).

---

## The seven phases

When the scanner reports a package, the workflow to replace it is
fixed (`PROTOCOL.md §5`):

1. **Identify** — run the scanner; record findings in `INVENTORY.md`.
2. **Study** — find the public spec; license-check; CVE-history
   check (npm advisory DB / OSV / GHSA); optional research install
   in `lib-theseus/<package>/_research/` (gitignored).
3. **Test cases (parity, abuse, *and* performance)** — write parity
   tests against the *original* with golden fixtures; **also** write
   abuse tests that reproduce every known CVE in the studied
   version's history plus the OWASP-shaped attack surface; **also**
   write performance benchmarks anchored to baselines measured from
   the original — wall-clock latency, memory high-water, asymptotic
   complexity on user-controlled input sizes.
4. **Implement** — reproduce the *behavior* from spec, in a single
   class in your project's library directory. Never copy source.
   Defend against every abuse case and stay within every performance
   mandate enumerated in step 3.
5. **Verify** — run all three test suites against the new impl; loop
   on failure until all three are clean. An abuse failure is a real
   vulnerability you just shipped. A perf failure on user-controlled
   input is a DoS bug. Neither gets silenced.
6. **PRD + theseus.json** — write `lib-theseus/<package>/PRD.md`
   (human-readable) **and** `lib-theseus/<package>/theseus.json`
   (machine-readable: which version we studied, which CVEs we
   defend against, every abuse case → test mapping, every
   performance mandate → benchmark mapping).
7. **Cleanup** — remove the original from the manifest, lockfile,
   and `node_modules/`; delete `_research/`; confirm `npm install`
   (or the language equivalent) is a no-op.

Don't skip. Don't reorder. Each phase has explicit "done when"
criteria in PROTOCOL.md.

### Why abuse cases?

The single most likely way to ruin a rewrite project is to
accidentally rebuild a CVE the original library already fixed. The
`marked@4.0.10` patch closed a ReDoS hole; if your reimplementation
uses a backtracking regex on a heading, you've shipped that hole
back into your codebase, with the additional disadvantage that no
public CVE database will ever flag your code. **The abuse-case
discipline is the dam.** Every replaced library lists its known
CVEs, lists its abuse-case scenarios, and has a runnable test for
each. Without that, the rewrite makes the project's security
posture *worse* than depending on the original — and you wouldn't
know.

### Why performance mandates?

A re-implementation that's correct and hardened but ten times slower
than the original is a regression dressed up as a replacement. Worse,
slow code on a user-controlled input is itself a DoS — the line
between "merely sluggish" and "denial of service" is whichever input
shape an attacker chooses. Performance mandates anchor the new code
to measurements you took from the original (Phase 2), encode the
user-visible budget (≤100ms for tab-switch renders, a few ms for
per-request server work, etc.), and turn "feels fast enough" into a
benchmark with a number. The mandate is on the algorithm — fix the
algorithm, not the threshold.

### Why theseus.json?

The PRD is for humans. The `theseus.json` is for machines. Tools
that audit the codebase ("what version of marked did we study?",
"is that version now known to be vulnerable to a newly-disclosed
CVE?", "show me every library where we copied source") need a
structured record. The schema is in `PROTOCOL.md §11`. The scanner
validates every `theseus.json` on every run and exits non-zero on
malformed records.

---

## Languages supported

| Language | Source | Manifests |
|---|---|---|
| JavaScript / TypeScript / HTML | `.js .mjs .cjs .jsx .ts .tsx .html .htm` | `package.json` |
| Python | `.py` | `requirements.txt`, `pyproject.toml`, `setup.py`, `Pipfile` |
| Rust | `.rs` | `Cargo.toml` |
| Go | `.go` | `go.mod` |
| Ruby | `.rb .rake .ru` | `Gemfile`, `*.gemspec` |
| Java / Kotlin | `.java .kt .kts` | `pom.xml`, `build.gradle`, `build.gradle.kts` |
| C / C++ | `.c .h .cc .cpp .cxx .hpp .hxx .cppm .ipp .tpp .inl` | `conanfile.txt`, `conanfile.py`, `vcpkg.json`, `CMakeLists.txt` |
| C# / F# / VB.NET | `.cs .fs .vb` | `*.csproj`, `*.fsproj`, `*.vbproj`, `packages.config`, `Directory.{Packages,Build}.props` |
| Swift | `.swift` | `Package.swift`, `Podfile`, `Cartfile` |

Adding another language is one file under `scanners/`. The plugin
contract is in `PROTOCOL.md §15`.

---

## Files in this directory

```
lib-theseus/
├── README.md                   ← this file
├── PROTOCOL.md                 ← the rules; the contract
├── scan.js                     ← driver, language-agnostic
├── exceptions.example.json     ← config template
├── exceptions.json             ← project-specific config (you create this)
└── scanners/
    ├── javascript.js
    ├── python.js
    ├── rust.js
    ├── go.js
    └── ruby.js
```

After your first rewrite, you'll also have:

```
├── INVENTORY.md                ← running ledger of rewrite progress
└── <package-name>/
    ├── PRD.md                  ← per-library product requirements doc
    ├── theseus.json            ← per-library provenance + security record (machine-readable)
    ├── fixtures/               ← parity inputs (real-world)
    ├── tests/                  ← parity test scripts
    ├── abuse-fixtures/         ← attacker-crafted inputs
    ├── abuse-tests/            ← abuse test scripts (one per known CVE + attack class)
    ├── perf-fixtures/          ← representative inputs for benchmarking
    ├── perf-tests/             ← performance benchmarks (one per mandate)
    └── _research/              ← gitignored; deleted in Phase 7
```

---

## Updating

To pull in a newer scanner / protocol revision into an existing
project, replace these files (the "framework" — PROTOCOL.md is
generic, scan.js and scanners/ are universal):

```sh
cp -r ~/.claude/skills/lib-theseus/lib-theseus/PROTOCOL.md  ./lib-theseus/
cp -r ~/.claude/skills/lib-theseus/lib-theseus/scan.js      ./lib-theseus/
cp -r ~/.claude/skills/lib-theseus/lib-theseus/scanners     ./lib-theseus/
cp -r ~/.claude/skills/lib-theseus/lib-theseus/exceptions.example.json ./lib-theseus/
```

**Do not overwrite** `exceptions.json`, `INVENTORY.md`, or any
`<package>/` work folders — those are project state.

---

## License

(Decide per host project.) The implementations of any rewritten
libraries inherit the host project's license. The lib-theseus scanner
and protocol themselves are project tooling — apply whatever the host
project applies, or treat them as public-domain-ish in a private
repo. There is, by design, no third-party code in here, so no
upstream license obligations attach.
