---
name: lib-theseus
description: Drive a project to zero public dependencies by replacing third-party libraries with in-tree, clean-room implementations. Use when an agent (Claude Code, OpenAI Codex, or any other) is asked to remove npm, pip, Cargo, Go, Ruby, Java, C/C++, .NET, or Swift packages; perform a supply-chain audit; make installs a no-op; run lib-theseus; or follow the seven-phase rewrite protocol with parity, abuse, and performance gates.
---

# lib-theseus

Portable protocol and scanner for driving a host codebase to zero
public dependencies. The scanner payload is the `lib-theseus/`
directory next to this `SKILL.md` inside the installed skill folder.

Before rewrite work, read the host project's
`lib-theseus/PROTOCOL.md`. It is the authoritative contract. If this
skill conflicts with the protocol, the protocol wins.

The scanner currently covers JavaScript / TypeScript / HTML, Python,
Rust, Go, Ruby, Java / Kotlin, C / C++, C# / F# / VB.NET, and Swift.

## Core Rule

Do not add a new public dependency. If the user asks to vendor a
package verbatim, copy package source, add a wrapper around the
original package, or add a new dependency, refuse and cite
`PROTOCOL.md §4` and `§9`.

## User Intents

Map common requests to one of these actions:

| User request | Action |
|---|---|
| "Use lib-theseus", "zero deps", "audit dependencies" | Detect install state. Install if missing; otherwise run the scanner. |
| "scan", "what deps are left?", "supply-chain status" | Run `node lib-theseus/scan.js` from the host project root and summarize. |
| "install lib-theseus" | Copy the payload into the host project and create `exceptions.json`. |
| "update lib-theseus" | Refresh only framework files from the skill payload after confirming with the user. |
| "phase N", "rewrite <pkg>", "continue <pkg>" | Follow `PROTOCOL.md §5` for the selected package. Ask for the package only if it is unclear. |
| "status <pkg>" | Read `lib-theseus/<pkg>/PRD.md` or `INVENTORY.md` and summarize phase, blockers, and next action. |

When a user invokes the skill explicitly (`/lib-theseus` in Claude
Code, `$lib-theseus` in OpenAI Codex, or by name in any other agent),
follow the same mapping. If the wording is ambiguous, default to scan.

## Install Flow

Run when `<project root>/lib-theseus/scan.js` is missing.

1. Identify the host project root. If the current directory is not the
   host project root and it is not obvious from context, ask for the
   path.
2. Tell the user that you will copy the checked-in scanner/protocol
   payload into `<project root>/lib-theseus/`, create a starter
   `exceptions.json`, and run an initial scan. Wait for explicit
   confirmation before adding this tool to their repo.
3. Locate the skill directory as the parent directory of this
   `SKILL.md`; the payload is `<skill dir>/lib-theseus/`.
4. Copy the payload directory into the host project as
   `<project root>/lib-theseus/`.
5. Create `<project root>/lib-theseus/exceptions.json` from
   `exceptions.example.json`.
6. Detect languages from manifests:
   `package.json`, `Cargo.toml`, `go.mod`, `pyproject.toml`,
   `requirements.txt`, `Gemfile`, `pom.xml`, `build.gradle`,
   `*.csproj`, `Package.swift`, `conanfile.txt`, `vcpkg.json`,
   `CMakeLists.txt`.
7. For each detected language, ask one short question about packages
   that cannot reasonably be rewritten, such as runtime packages,
   native bindings with no pure-language equivalent, or build-only
   tools that do not ship. Default to `[]` when the user is unsure.
8. Run `node lib-theseus/scan.js` from the host project root.
9. Summarize the active languages, ORPHANED packages, IN USE packages,
   and the cheapest isolated package to tackle first.

Do not add `lib-theseus/` to `.gitignore`. Do not add package scripts
unless the user asks. The directory is a checked-in project artifact.

## Update Flow

Run when the user asks to update an existing installation.

1. Diff or inspect local changes first, then confirm before
   overwriting framework files.
2. Replace only `PROTOCOL.md`, `README.md`, `scan.js`,
   `exceptions.example.json`, and `scanners/` from the skill payload.
3. Never overwrite `exceptions.json`, `INVENTORY.md`, package work
   folders, or `_research/` folders.
4. Re-run the scanner and surface any new findings as discoveries.

## Scan Flow

1. Run `node lib-theseus/scan.js` from the host project root.
2. Treat the scanner as mechanical truth. If it reports findings,
   work remains. If it false-positives, fix scanner logic rather than
   silencing the result.
3. Summarize the number of active languages.
4. List ORPHANED packages first; these are cheap wins because the
   manifest entry can usually be deleted without a rewrite.
5. List IN USE packages and recommend a starting candidate:
   single-site packages, pure parsers, formatters, UUID generators,
   and small utilities before large protocol clients or native
   bindings.

Do not auto-start a rewrite unless the user asked for rewrite work.

## Seven Phases

Follow `PROTOCOL.md §5` strictly.

| Phase | Work | Done when |
|---|---|---|
| 1 - Identify | Run scanner, remove ORPHANED manifest entries, populate `INVENTORY.md` for IN USE packages. | Every IN USE package is inventoried and ORPHANED entries are gone. |
| 2 - Study | Install/research the original only under `lib-theseus/<pkg>/_research/`; find public spec, API behavior, license, and CVE history. | API surface, spec, license, and known CVEs are recorded. |
| 3 - Tests | Write parity, abuse, and performance suites against the original. | All three suites pass against the original; every CVE and performance mandate has a test. |
| 4 - Implement | Reproduce behavior from public spec and observed behavior, never source. Defend against abuse cases and meet performance mandates. | API surface is implemented and defensive choices are documented. |
| 5 - Verify | Run parity, abuse, and performance suites against the new implementation. | All three suites pass against the replacement. |
| 6 - PRD + theseus.json | Write human and machine records, update inventory, include provenance, CVEs, abuse cases, and performance mandates. | Scanner validation for theseus records passes. |
| 7 - Cleanup | Flip imports, remove manifest entries, run install, delete `_research/`, run scanner. | Scanner reports zero imports for that package and no invalid records. |

## Hard Rules

- Do not add new dependencies. Refuse requests that require doing so.
- Do not copy third-party package source, structure, variable names, or
  implementation details.
- Do not write a wrapper that internally imports the original package.
- Do not leave research installs in manifests, lockfiles, or
  `node_modules` at the end of the turn.
- Do not silence the scanner. Fix the cause or scanner logic.
- Do not edit `PROTOCOL.md` to make a rule easier without explicit
  human approval.
- Do not mark a rewrite complete until parity, abuse, performance,
  provenance, cleanup, and scanner gates all pass.

## Adding A Language

The plugin contract is in `PROTOCOL.md §15`. Add a new file under
`lib-theseus/scanners/`; do not edit the scanner driver unless the
protocol explicitly requires it.

Each plugin must:

1. Use zero external dependencies, only Node built-ins.
2. Strip language-appropriate comments and string contents before
   matching imports.
3. Distinguish stdlib, project-local, platform exceptions, and
   third-party dependencies.
4. Parse the language's manifest formats.
5. Validate specs defensively to prevent false positives.

Test new plugins against a synthetic mini-project in `$TMPDIR` with
stdlib, project-local, third-party, and platform-exception examples.

## Source Of Truth

1. `lib-theseus/PROTOCOL.md` in the host project.
2. `lib-theseus/scan.js` in the host project.
3. This `SKILL.md`, which only orchestrates installation, scanning,
   and phase walkthroughs for whatever agent invokes it.
