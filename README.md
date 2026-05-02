# lib-theseus

> *If, over the years, every plank of the Ship of Theseus is replaced
> with one we built ourselves — is it still the same ship?*
> **Yes. And now it's actually ours.**

A portable, polyglot **protocol + scanner** for driving a codebase to
zero public dependencies. Replace npm / pip / cargo / go-mod / rubygems
packages with native first-party code — behavior-equivalent, hardened
against the original's CVE history, with full provenance recorded.

No upstream maintainer can sink a ship made of planks you built. No
typo-squatter can poison a registry you don't pull from. No CVE
database can grow new entries against versions you never installed.
The hull is the same shape; every plank is something you made,
tested, and audited yourself.

## What it gives you

- **A scanner** (`lib-theseus/scan.js`, ~750 lines, pure Node, **no
  dependencies of its own**) that walks any project and reports every
  third-party package reference across JavaScript / TypeScript / HTML,
  Python, Rust, Go, and Ruby. Exit `0` when clean, exit `1` with a
  grouped report otherwise — suitable for CI gates and pre-commit hooks.
- **A protocol** (`lib-theseus/PROTOCOL.md`) describing how to replace
  each one: the seven phases (identify → study → write parity, abuse,
  *and* performance tests → implement → verify → PRD + theseus.json →
  cleanup), the licensing safety rules (clean-room, no source
  copying), the parity-abuse-and-performance gate, an anti-cheat
  table for LLMs.
- **A `theseus.json` schema** — per-library machine-readable record
  capturing which version was studied, which CVEs it had, which abuse
  cases your re-implementation defends against, and which performance
  mandates it must meet. The scanner validates these on every run.
- **A Claude Code skill** (`SKILL.md`) that walks an LLM through the
  whole flow when you say `/lib-theseus`.

## Install

### As a Claude Code skill (recommended for Claude users)

```sh
git clone git@github.com:rsnakeactual/lib-theseus.git ~/.claude/skills/lib-theseus
```

Then in any project, type `/lib-theseus`. Claude detects whether the
payload is installed in your project, copies it in if not, asks one
short question per detected language to populate `exceptions.json`,
runs the first scan, and recommends what to tackle first.

### Manually (no Claude Code required)

```sh
git clone git@github.com:rsnakeactual/lib-theseus.git
cp -r lib-theseus/lib-theseus /your/project/lib-theseus
cp /your/project/lib-theseus/exceptions.example.json \
   /your/project/lib-theseus/exceptions.json
# edit exceptions.json to list your platform exceptions per language
node /your/project/lib-theseus/scan.js
```

## Repository layout

```
SKILL.md                          ← Claude Code skill descriptor
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
    └── ruby.js
```

The repo's directory layout is intentionally identical to the
expected skill install layout, so `git clone … ~/.claude/skills/lib-theseus`
works as a one-line install.

## Languages supported in v1

| Language | Source | Manifests |
|---|---|---|
| JavaScript / TypeScript / HTML | `.js .mjs .cjs .jsx .ts .tsx .html .htm` | `package.json` |
| Python | `.py` | `requirements.txt`, `pyproject.toml`, `setup.py`, `Pipfile` |
| Rust | `.rs` | `Cargo.toml` |
| Go | `.go` | `go.mod` |
| Ruby | `.rb .rake .ru` | `Gemfile`, `*.gemspec` |

Adding a new language is one file under `scanners/`. The plugin
contract is in `lib-theseus/PROTOCOL.md §15`. Java/Kotlin, C/C++, C#,
and Swift are documented as deferred (each has language-specific
parsing or build-system gotchas) — open an issue if you'd like them
added.

## Why?

1. **Supply-chain attack surface = 0.** A package you don't depend on
   cannot be typo-squatted, hijacked, or post-install-scripted.
2. **CVE scanners go quiet.** No `package@version` in any lockfile
   means no match against the CVE database. Vulnerabilities, if any,
   live or die in *your* code — which is the only review that
   actually matters.
3. **License hygiene.** No transitive surprise (GPL hidden three deps
   deep). Every line is yours, under the project's chosen license.
4. **Version drift = 0.** No "works on my machine because I have
   `marked@18` and CI has `marked@19`."
5. **Reviewability.** A reviewer can read every byte the app runs.
6. **Provenance.** Every replaced library has a `theseus.json` —
   "we studied marked@18.0.0 on 2026-04-30; we defend against
   CVE-2022-21680 with a linear-time tokenizer; here's the test
   that proves it."

## What this is NOT

- **Not a vendoring tool.** lib-theseus *forbids* copying source code
  from a package, even MIT-licensed, even with attribution. The
  rewrite must be clean-room from the public spec or observed
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

v1. Five language plugins. The scanner is self-hosting — it has no
public dependencies and validates that on its own source.

## License

[MIT](LICENSE) — Copyright (c) 2026 Robert "RSnake" Hansen.

## Contributing

Issues and PRs welcome. The protocol applies to itself: any
contribution that adds a public dependency to the scanner or its
plugins will be rejected. (The scanner needs to live by the rule
it enforces.)
