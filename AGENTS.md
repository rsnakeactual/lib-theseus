# AGENTS.md — orientation for LLM agents

This file is read by OpenAI Codex, Cursor, Devin, Aider, and any other
LLM-driven dev tool that picks up `AGENTS.md` from a project tree. If
you're a Claude Code user, see `SKILL.md` instead — it's
Claude-Code-specific (slash commands, skill discovery), but the
instructions in this file are equivalent and you can read it for
extra orientation.

---

## What this repo is

`lib-theseus` is a portable protocol + scanner for driving any
codebase to **zero public dependencies**. The repo holds:

- `PROTOCOL.md` — the rewrite contract (the seven phases, the
  parity-and-abuse-and-performance gate, licensing safety, the
  anti-cheat table for LLMs). **This is the authoritative spec.
  Read it before doing rewrite work.**
- `scan.js` + `scanners/` — a polyglot, zero-dependency scanner.
  One driver, one plugin per ecosystem. Currently nine languages:
  JavaScript / TypeScript / HTML, Python, Rust, Go, Ruby,
  Java / Kotlin, C / C++, C# / F# / VB.NET, Swift.
- `exceptions.example.json` — the per-project config template.
- `README.md` — the on-ramp for human readers, also installed as
  `lib-theseus/README.md` once dropped into a host project.

The repo at `github.com/rsnakeactual/lib-theseus` is the *tooling*.
Most of the work happens in **someone else's project** that's
*using* lib-theseus. Don't confuse "working on lib-theseus" with
"using lib-theseus on a host project."

---

## When to invoke lib-theseus on a host project

Trigger phrases (any of):

- "zero dependencies", "no public deps", "vendor everything in-tree"
- "remove npm packages", "kill node_modules", "remove pip deps"
- "supply chain audit", "supply chain risk", "CVE scanner is noisy"
- "rewrite [some library] ourselves"
- "make `npm install` a no-op", "make `cargo build` a no-op"
- the user references `PROTOCOL.md`, `scan.js`, the seven phases,
  the parity-and-abuse-and-performance gate, or the library PRD format

## When NOT to invoke it

- The user is debugging or upgrading a third-party package. They want
  to use it, not replace it.
- The user wants a verbatim *vendoring* of a single package (copy
  source under a new path). lib-theseus forbids verbatim copies — it
  requires clean-room reimplementation. Tell the user this is the
  wrong tool if that's their goal.
- The project is greenfield with no third-party deps yet.
- The user wants to add a *new* dependency. Refuse and cite
  `PROTOCOL.md §9`.

---

## Installing into a host project

The `lib-theseus/` subdirectory of this repo is the drop-in payload.
To use lib-theseus on a host project:

1. Confirm the host project's root path. If you're not sure, ask.
2. Copy the payload:
   ```sh
   cp -r /path/to/lib-theseus-repo/lib-theseus /path/to/host-project/lib-theseus
   ```
3. Create the per-project config:
   ```sh
   cp /path/to/host-project/lib-theseus/exceptions.example.json \
      /path/to/host-project/lib-theseus/exceptions.json
   ```
4. Detect the project's languages (look for `package.json`,
   `Cargo.toml`, `go.mod`, `pyproject.toml`, `requirements.txt`,
   `Gemfile`, `pom.xml`/`build.gradle`, `*.csproj`, `Package.swift`,
   `conanfile.txt`/`vcpkg.json`/`CMakeLists.txt`).
5. For each detected language, ask the user one short question:
   "Are there any packages you can't reasonably rewrite (the
   runtime your app compiles against, native bindings with no
   pure-language equivalent, build-only tools that don't ship)?"
   Default to `[]` per language if the user is unsure. Better to
   start strict and loosen than the reverse.
6. Run `node lib-theseus/scan.js` from the project root.
7. Summarize:
   - Number of languages active.
   - **ORPHANED** packages (cheap wins — just delete the manifest
     entry; no rewrite needed). These are the user's first action
     items.
   - **IN USE** packages (need the seven-phase rewrite). Recommend
     a starting candidate: cheap-and-isolated first
     (frontmatter parsers, UUID generators, simple utilities)
     before sprawling-and-protocol-heavy (DOM implementations, mail
     clients, terminal emulators).

Do **not** add `lib-theseus/` to `.gitignore`. Do **not** add it to
`package.json` scripts unless the user asks. The directory is a
checked-in project artefact.

---

## The seven phases (summary)

Authoritative version: `PROTOCOL.md §5`. Quick map for navigation:

| Phase | What to do | "Done when" |
|---|---|---|
| 1 — Identify | Run scanner. Resolve **orphans first** (delete manifest line, no rewrite). For IN USE entries, populate `INVENTORY.md`. | Every IN USE package is a row in INVENTORY.md; every ORPHANED package is gone from its manifest. |
| 2 — Study | `npm install`/`pip install`/etc. into `lib-theseus/<pkg>/_research/`. Find the public spec/RFC. **Look up the original's CVE history** (npm advisory DB, OSV, GHSA). Record license. | You know the API surface, the spec, the license, and every known CVE. |
| 3 — Test cases (parity + abuse + performance) | Write three test suites: parity (output matches original), abuse (one test per known CVE + OWASP-shaped attack-class checklist), performance (latency + asymptotic complexity + memory bounds, anchored to baselines measured from the original). | All three suites green against the original; every CVE has a paired test; every user-visible perf path has a mandate. |
| 4 — Implement | Single class in the project's library dir. Reproduce *behavior* from the public spec; never copy source. Defend against every abuse case and stay within every performance mandate. | API surface implemented; defensive measures + algorithmic choices named in code comments or PRD. |
| 5 — Verify | Run all three suites against new impl. Loop to phase 4 on any failure. Abuse failure = vulnerability you just shipped. Perf failure on user-controlled input = DoS bug. Don't silence either. | All three suites green against new impl. |
| 6 — PRD + theseus.json | Write `PRD.md` (human-readable) AND `theseus.json` (machine-readable provenance + security + performance record). Update `INVENTORY.md`. | Both documents complete; scanner's theseus-record validation passes. |
| 7 — Cleanup | Atomic: flip imports, remove from manifest, run install, delete `_research/`, run scanner. | Scanner reports zero imports for the package and zero invalid theseus records. |

## Hard rules (you, the LLM, must obey)

These come from `PROTOCOL.md §4`. Do not relax any of them.

1. **Do not add a new dependency.** See `PROTOCOL.md §9`. If the user
   asks you to, refuse and cite §9.
2. **Do not copy source from a package.** Even MIT-licensed. Even
   with attribution. Even via training-data recall. Build from the
   public spec and observed behavior. See `PROTOCOL.md §6`.
3. **Do not write a thin wrapper that internally requires the
   original package** (`module.exports = require('marked')`). That's
   a dependency in disguise.
4. **Do not leave a "research install" in `package.json` /
   `requirements.txt` / etc. across the end of a turn.** Every
   research install must be removed by phase 7.
5. **Do not silence the scanner.** If it false-positives, fix the
   scanner logic. If it surfaces something unexpected, treat that
   as a discovery, not noise.
6. **Do not edit `PROTOCOL.md` to make a rule easier on yourself.**
   Changes need explicit human approval.
7. **"Copy the functionality" means reproduce the behavior.** It
   does NOT mean copy source code, copy structure verbatim, copy
   variable names, or transcribe the original. Re-derive from spec.

If you find yourself reasoning "the spirit of the rule allows
this..." — the answer is no. Ask the user.

---

## Adding a new language

The plugin contract is in `PROTOCOL.md §15`. Do **not** edit
`scan.js` (the driver) — add a new file under `scanners/`. The
plugin must:

1. Have zero external dependencies (pure `node:fs` / `node:path`).
2. Strip language-appropriate comments and string contents before
   matching imports.
3. Distinguish stdlib (allowed), project-local (allowed), and
   third-party (reported).
4. Parse the language's manifest format(s) for declared deps.
5. Validate specs defensively to prevent false positives.

Test against a synthetic mini-project in `$TMPDIR/` with one each of
stdlib / project-local / third-party / platform-exception, before
relying on it.

---

## Source of truth, in priority order

1. `PROTOCOL.md` — the spec. If anything in this file conflicts
   with the protocol, the protocol wins.
2. `scan.js` — the mechanical truth. If the scanner exits 0, the
   project is conformant. If it exits 1, work remains.
3. This file — orientation for agents. Read PROTOCOL.md for the
   actual rules.
