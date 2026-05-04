# lib-theseus

> *If, over the years, every plank of the Ship of Theseus is replaced
> with one we built ourselves — is it still the same ship?*
> **Yes. And now it's actually ours.**

A portable, polyglot **protocol + scanner** for driving a codebase to
zero public dependencies. Replace npm / pip / cargo / go-mod /
rubygems / Maven / NuGet / Conan / SwiftPM packages with native
first-party code — behavior-equivalent, hardened against the
original's CVE history, and held to performance budgets anchored to
measurements taken from the original.

No upstream maintainer can sink a ship made of planks you built. No
typo-squatter can poison a registry you don't pull from. No CVE
database can grow new entries against versions you never installed.
The hull is the same shape; every plank is something you made,
tested, and audited yourself.

## What it gives you

- **A scanner** (`lib-theseus/scan.js`, ~900 lines, pure Node, **no
  dependencies of its own**) that walks any project and reports every
  third-party package reference across nine ecosystems
  (JavaScript / TypeScript / HTML, Python, Rust, Go, Ruby, Java /
  Kotlin, C / C++, C# / F# / VB.NET, Swift). It splits findings into
  **IN USE** (need the rewrite procedure) and **ORPHANED** (listed in
  a manifest but never imported — just delete the line). Exit `0`
  when clean, exit `1` with a grouped report otherwise — suitable
  for CI gates and pre-commit hooks.
- **A protocol** (`lib-theseus/PROTOCOL.md`) describing how to
  replace each library: the seven phases (identify → study → write
  parity, abuse, *and* performance tests → implement → verify → PRD
  + theseus.json → cleanup), the licensing safety rules (clean-room,
  no source copying), the parity-abuse-and-performance gate, an
  anti-cheat table for LLMs.
- **A `theseus.json` schema** — per-library machine-readable record
  capturing which version was studied, which CVEs it had, which
  abuse cases your re-implementation defends against, and which
  performance mandates it must meet. The scanner validates these on
  every run.
- **A skill packaged for both Claude Code and OpenAI Codex.** The
  same `SKILL.md` works for either tool's skill discovery (both
  honor `name:` / `description:` frontmatter). `agents/openai.yaml`
  carries the Codex skill UI metadata. `AGENTS.md` at the repo root
  is the equivalent orientation for Cursor, Devin, Aider, and other
  agents that follow the cross-tool `AGENTS.md` convention.

## Install

lib-theseus is distributed as a single tarball (`lib-theseus.tar.gz`)
linked from the blog post that introduced it. There is no public
package registry to install from and no public git remote to clone;
you download once, extract, and use locally.

### 1. Download and extract

```sh
# Replace the URL with the actual link from the blog post.
curl -O https://example.com/lib-theseus.tar.gz
tar -xzf lib-theseus.tar.gz
```

This produces a `lib-theseus/` directory containing the skill
files at the top, plus a nested `lib-theseus/lib-theseus/` payload
that's the part you drop into a host project.

### 2. Install for your agent (or skip to step 3 for manual use)

**As a Claude Code skill:**

```sh
mv lib-theseus ~/.claude/skills/lib-theseus
```

In any project, then: `/lib-theseus`. Claude detects whether the
payload is installed in your project, copies it in if not, asks one
short question per detected language to populate `exceptions.json`,
runs the first scan, and recommends what to tackle first.

**As an OpenAI Codex skill:**

```sh
mv lib-theseus ~/.codex/skills/lib-theseus
```

In any project, then: `$lib-theseus`. Same flow as Claude.

**With Cursor / Devin / Aider / any other agent:**

Keep the extracted `lib-theseus/` directory somewhere your agent can
read (e.g. open it as a workspace alongside your host project). The
agent picks up `AGENTS.md` automatically — it has the same
install / scan / phase-walkthrough instructions in tool-agnostic
language.

### 3. Or use it manually (no agent required)

```sh
# Copy just the inner payload into your host project.
cp -r lib-theseus/lib-theseus /your/project/lib-theseus
cp /your/project/lib-theseus/exceptions.example.json \
   /your/project/lib-theseus/exceptions.json
# Edit exceptions.json to list any platform exceptions per language.
node /your/project/lib-theseus/scan.js
```

The scanner is pure Node 18+, zero dependencies of its own. CI gate
in one line.

## Repository layout

```
SKILL.md                          ← skill descriptor (Claude Code + OpenAI Codex)
agents/openai.yaml                ← Codex skill UI metadata
AGENTS.md                         ← orientation for Cursor/Devin/Aider/etc.
lib-theseus/                      ← the payload — drop this into any project
├── PROTOCOL.md                   ← the rules; read this first
├── README.md                     ← on-ramp once installed
├── scan.js                       ← scanner driver (zero deps, pure Node)
├── exceptions.example.json       ← config template
└── scanners/                     ← one plugin per language
    ├── javascript.js
    ├── python.js
    ├── rust.js
    ├── go.js
    ├── ruby.js
    ├── java.js
    ├── c.js
    ├── csharp.js
    └── swift.js
```

The directory laid out by the tarball is intentionally identical to
the expected skill install layout, so a single `mv` lands you in the
right place for either Claude Code (`~/.claude/skills/lib-theseus/`)
or OpenAI Codex (`~/.codex/skills/lib-theseus/`).

## Languages supported

| Language | Source | Manifests |
|---|---|---|
| JavaScript / TypeScript / HTML | `.js .mjs .cjs .jsx .ts .tsx .html .htm` | `package.json` |
| Python | `.py` | `requirements.txt`, `pyproject.toml`, `setup.py`, `Pipfile` |
| Rust | `.rs` | `Cargo.toml` |
| Go | `.go` | `go.mod` |
| Ruby | `.rb .rake .ru` | `Gemfile`, `*.gemspec` |
| Java / Kotlin | `.java .kt .kts` | `pom.xml`, `build.gradle`, `build.gradle.kts`, `settings.gradle*` |
| C / C++ | `.c .h .cc .cpp .cxx .hpp .hxx .cppm .ipp .tpp .inl` | `conanfile.txt`, `conanfile.py`, `vcpkg.json`, `CMakeLists.txt` |
| C# / F# / VB.NET | `.cs .fs .vb` | `*.csproj`, `*.fsproj`, `*.vbproj`, `packages.config`, `Directory.{Packages,Build}.props` |
| Swift | `.swift` | `Package.swift`, `Podfile`, `Cartfile` |

Adding a new language is one file under `scanners/`. The plugin
contract is in `lib-theseus/PROTOCOL.md §15`. PHP, Dart/Flutter,
Elixir, Haskell, Lua and others follow the same shape; the spec is
designed to be extended.

## Why?

1. **Supply-chain attack surface = 0.** A package you don't depend
   on cannot be typo-squatted, hijacked, or post-install-scripted.
2. **CVE scanners go quiet.** No `package@version` in any lockfile
   means no match against the CVE database. Vulnerabilities, if any,
   live or die in *your* code — which is the only review that
   actually matters.
3. **Orphan deps go away cheaply.** The scanner separates IN USE
   from ORPHANED. Orphans need no rewrite at all; just delete the
   manifest line.
4. **License hygiene.** No transitive surprise (GPL hidden three
   deps deep). Every line is yours, under the project's chosen
   license.
5. **Version drift = 0.** No "works on my machine because I have
   `marked@18` and CI has `marked@19`."
6. **Reviewability.** A reviewer can read every byte the app runs.
7. **Provenance.** Every replaced library has a `theseus.json` —
   "we studied marked@18.0.0 on 2026-04-30; we defend against
   CVE-2022-21680 with a linear-time tokenizer; here's the test
   that proves it."

## What this is NOT

- **Not a vendoring tool.** lib-theseus *forbids* copying source
  code from a package, even MIT-licensed, even with attribution.
  The rewrite must be clean-room from the public spec or observed
  behavior. The point is provenance you fully control, not a free
  ride on someone else's code.
- **Not a CVE scanner.** `npm audit` / `pip-audit` / `cargo audit`
  cover that role for *current* dependencies. lib-theseus is the
  step *after* those: drive your dependency count to zero so those
  tools have nothing to scan.
- **Not magic.** Replacing a real library well is real work. The
  protocol structures the work into seven phases with explicit
  "done when" criteria. It does not skip the work.

## Status

v1. Nine language plugins. The scanner is self-hosting — it has no
public dependencies and validates that on its own source.

## License

[MIT](LICENSE) — Copyright (c) 2026 Robert "RSnake" Hansen.

## Contributing

The protocol applies to itself: any contribution that adds a public
dependency to the scanner or its plugins will be rejected. (The
scanner needs to live by the rule it enforces.)
