---
name: lib-theseus
description: Drives a project to zero public dependencies by rewriting third-party libraries in-tree, behavior-equivalent and hardened against the original's CVE history. Named for the Ship of Theseus — replace every plank with one we built ourselves and the ship is now actually ours. Use when the user says "vendor everything," "remove all npm/pip/cargo deps," "supply chain audit," "no node_modules in CI," "zero deps," "lib-theseus," or wants to systematically replace public packages with native code. The skill installs a portable scanner+protocol and walks the seven-phase procedure (identify, study, write tests for parity AND abuse cases, implement, verify, PRD + theseus.json, cleanup).
---

# lib-theseus

> *If, over the years, every plank of the Ship of Theseus is replaced
> with one we built ourselves — is it still the same ship?*
> **Yes. And now it's actually ours.**

A portable, polyglot protocol + scanner for driving a codebase to zero
public dependencies. Currently supports JavaScript / TypeScript / HTML,
Python, Rust, Go, and Ruby. Adding a new language is a single
self-contained plugin file.

The bundled payload — the `lib-theseus/` directory you copy into a host
project — lives next to this file at
`~/.claude/skills/lib-theseus/lib-theseus/`.

Two artifacts make a rewrite "shipped":

- **`PRD.md`** — the human-readable product requirements doc per
  replaced library (purpose, API surface, **abuse cases**, behavior
  contract, deviations).
- **`theseus.json`** — the machine-readable provenance + security
  record per replaced library (which package, which version, which
  license, when studied, every known CVE → mitigation, every abuse
  case → test). The scanner validates these on every run.

---

## When to use

Trigger phrases (any of):

- "zero dependencies", "no public deps", "vendor everything in-tree"
- "remove npm packages", "kill node_modules", "remove pip deps"
- "supply chain audit", "supply chain risk", "CVE scanner is noisy"
- "rewrite marked / mermaid / requests / serde / etc. ourselves"
- "make `npm install` a no-op", "make `cargo build` a no-op"
- The user references `lib-theseus/PROTOCOL.md`, `lib-theseus/scan.js`,
  the seven phases, the parity gate, or the library PRD format.

Also use when the user runs `/lib-theseus` as a slash command, with or
without arguments (see "Invocations" below).

## When NOT to use

- The user is debugging a third-party package or upgrading its
  version. They want to *use* the dep, not replace it.
- The user wants to *vendor* a single package as a copy (i.e., copy
  source verbatim under a new path). lib-theseus forbids verbatim
  copies — it requires clean-room reimplementation. If the user wants
  raw vendoring, this is the wrong skill; tell them so.
- The project is greenfield with no third-party deps yet. There's
  nothing to scan; offer instead to set up a `package.json` /
  `Cargo.toml` etc. with the prime directive in mind.
- The user wants to add a new dependency. Refuse and cite
  `PROTOCOL.md §9`.

## Invocations

| Form | What you do |
|---|---|
| `/lib-theseus` (no args) | Detect install state. If not installed, run the install flow. If installed, run the scanner and present a summary. |
| `/lib-theseus scan` | Run `node lib-theseus/scan.js`, summarize. Highlight what's new since last scan if there's an `INVENTORY.md`. |
| `/lib-theseus install` | Force the install flow even if `lib-theseus/` already exists (use only when the user explicitly asks to overwrite or update). |
| `/lib-theseus update` | Replace `PROTOCOL.md`, `scan.js`, `scanners/`, `exceptions.example.json` with the latest from the skill payload. **Never** overwrite `exceptions.json`, `INVENTORY.md`, or per-package work folders. |
| `/lib-theseus phase <N>` | Walk through phase N of `PROTOCOL.md §5` for whichever package the user is currently focused on. Ask the user to specify the package if it isn't obvious. |
| `/lib-theseus phase <N> <pkg>` | Same, scoped to the named package. |
| `/lib-theseus status <pkg>` | Read `lib-theseus/<pkg>/PRD.md` if present, or `INVENTORY.md`, and summarize what phase the package is in and what's next. |

If the user types something free-form (e.g., "audit our deps", "what's
left to rewrite?"), pick the closest invocation above. When in doubt,
default to `/lib-theseus scan`.

---

## Install flow (run this when lib-theseus/ is missing)

The skill payload is a self-contained `lib-theseus/` directory at
`~/.claude/skills/lib-theseus/lib-theseus/`. Steps:

1. **Detect.** Look for `<project root>/lib-theseus/scan.js`. If the
   working directory isn't a git repo, ask the user where the project
   root is. Don't guess.
2. **Confirm.** Tell the user what you're about to do: copy ~6 files
   into `lib-theseus/`, write a starter `exceptions.json`, run an
   initial scan. Wait for explicit yes — this is a tool the user is
   adding to their repo.
3. **Copy.** From `~/.claude/skills/lib-theseus/lib-theseus/`, copy:
   - `PROTOCOL.md`
   - `README.md`
   - `scan.js`
   - `exceptions.example.json`
   - `scanners/` (the whole directory)
   to `<project root>/lib-theseus/`.
4. **Configure.** Create `<project root>/lib-theseus/exceptions.json`.
   Start by detecting the project's languages (presence of
   `package.json`, `Cargo.toml`, `go.mod`, `pyproject.toml`,
   `requirements.txt`, `Gemfile`). Ask the user one short question
   per language about platform exceptions:
   - JS/Node: "Are there packages you can't reasonably rewrite —
     e.g., `electron` or native-binding packages? List them or say
     'none'."
   - Python: "Any C-extension packages or runtime exceptions
     (e.g., `numpy`, `torch`)?"
   - Rust: "Any platform crates (e.g., `windows-sys`)?"
   - Go: "Any cgo / native bindings to keep?"
   - Ruby: "Any native gems to keep (e.g., `nokogiri`)?"
   Default to `[]` per language if the user is unsure. Better to
   start strict and loosen than the reverse.
5. **First scan.** Run `node lib-theseus/scan.js` from the project
   root. Capture the output. Summarize: number of languages active,
   total packages still to rewrite, top 5 by site count.
6. **Next steps.** Point the user at:
   - `lib-theseus/README.md` for the user-facing tour
   - `lib-theseus/PROTOCOL.md §5` for the seven-phase workflow
   - The package they should tackle first (cheap-and-isolated wins:
     simple parsers, single-purpose utilities, one-line wrappers)

Do **not** add `lib-theseus/` to `.gitignore`. Do **not** add it to
`package.json` scripts unless the user asks. The directory is
project artefact, intentionally checked in.

---

## Update flow (when the user already has lib-theseus/ but wants the latest)

`/lib-theseus update` replaces only the framework files. Steps:

1. Confirm with the user before overwriting (they may have local
   patches in the scanner or protocol; a diff first is friendly).
2. Copy these from the payload into `<project root>/lib-theseus/`:
   - `PROTOCOL.md`, `scan.js`, `scanners/`, `exceptions.example.json`,
     `README.md`
3. **Never** touch: `exceptions.json`, `INVENTORY.md`, any
   `<package>/` work folder, any `_research/` folder.
4. Re-run the scanner. The output may differ if the new scanner is
   stricter (e.g., catches a previously-missed import pattern).
   Surface those differences as discoveries, not regressions.

---

## Scan flow (when lib-theseus/ is already installed)

1. Run `node lib-theseus/scan.js` from the project root.
2. Parse the output. The summary line is the headline; the per-language
   sections are the detail.
3. If there is an `INVENTORY.md`, compare. Mention any package whose
   site count went up since the last scan (regression — usually a
   new import added to a not-yet-rewritten package).
4. Recommend a next package to tackle. Heuristics:
   - Single-site packages (cheap wins) before sprawling ones.
   - Pure parsers / formatters before protocol clients.
   - Pure-JS / pure-Python before things with native bindings.
5. Don't auto-start a rewrite. Wait for the user to pick a package
   and say "do phase N" or similar.

---

## Phase walkthroughs

When invoked with `/lib-theseus phase <N> [pkg]`, follow
`PROTOCOL.md §5` strictly. Quick map:

| Phase | What to do | "Done when" |
|---|---|---|
| 1 — Identify | Run scanner; populate `INVENTORY.md`. | Every reported package is a row in INVENTORY.md. |
| 2 — Study | `npm install`/`pip install`/etc. into `lib-theseus/<pkg>/_research/`. Find the public spec/RFC. **Look up the original's CVE history** (npm advisory DB, OSV, GHSA). Record license. | You know the API surface, the spec, the license, and every known CVE in the studied version's history. |
| 3 — Test cases (parity AND abuse) | Write parity fixtures + tests in `fixtures/` + `tests/` against the *original*. **Also** write abuse fixtures + tests in `abuse-fixtures/` + `abuse-tests/`: one test per known CVE (reproduce the attack and assert it fails against original; pass it through to the new impl as the "must not regress" gate), plus the OWASP-shaped attack-class checklist for this library type (DoS, injection, parser desync, info disclosure, resource exhaustion, logic flaws). | Both suites green against the original; every CVE has a paired test. |
| 4 — Implement | Write a single class in the project's library dir. Reproduce *behavior* from spec; never copy source. **Defend against every abuse case enumerated in phase 3.** | API surface implemented; defensive measures named in code comments or PRD. |
| 5 — Verify | Run BOTH suites against the new impl. Loop to phase 4 on any failure. An abuse failure = a new vulnerability you just shipped; do not silence the test. | Both suites green against new impl. |
| 6 — PRD + theseus.json | Finalize `PRD.md` per `PROTOCOL.md §10` (must include the §4 abuse-cases section). Write `theseus.json` per `PROTOCOL.md §11` (machine-readable provenance + every CVE → mitigation + every abuse case → test). Update `INVENTORY.md`. | Both documents complete; scanner's theseus-record validation passes. |
| 7 — Cleanup | Atomic: flip imports, remove from manifest, run install, delete `_research/`, run scanner. | Scanner reports zero imports for the package and zero invalid theseus records. |

Critical clarifications:

- Phase 3: "copy the functionality" means reproduce behavior, NOT copy
  source code. Re-derive from the public spec or observed input/output
  behavior. See `PROTOCOL.md §6`.
- Phase 3 abuse cases: the single most likely failure mode is rebuilding
  a CVE the original library already fixed. Look up the CVE history.
  Read the spec's "Security Considerations" section. Don't skip this.
- Phase 6: PRD and theseus.json are not duplicative. PRD is for humans
  ("what does this do? should we extend it?"). theseus.json is for
  tooling ("what version did we study? is that version newly
  vulnerable? do we have a test for that CVE?"). Both are required.

---

## Hard rules you (the LLM) must obey

These come from `PROTOCOL.md §4`. Do not relax any of them:

1. Do not add a new dep — see PROTOCOL.md §9. If the user asks to,
   refuse and cite §9.
2. Do not copy source from a package. Even MIT-licensed. Even with
   attribution. See §6.
3. Do not write a thin wrapper that internally requires the original
   package.
4. Do not leave a "research install" in `package.json` /
   `requirements.txt` / etc. across the end of a turn — every
   research install must be removed by phase 7.
5. Do not silence the scanner. If it false-positives, fix the scanner
   logic. If it surfaces something unexpected, treat that as a
   discovery, not noise.
6. Do not edit `PROTOCOL.md` to make a rule easier on yourself.
   Changes need explicit human approval.

If you find yourself reasoning "the spirit of the rule allows
this..." — the answer is no. Ask the user.

---

## When asked to add a new language

The plugin contract is in `PROTOCOL.md §14`. Do **not** edit
`scan.js` (the driver) — add a new file under `scanners/`. The
plugin must:

1. Have zero external dependencies (pure `node:fs` / `node:path`).
2. Strip language-appropriate comments and string contents before
   matching imports.
3. Distinguish stdlib (allowed), project-local (allowed), and
   third-party (reported).
4. Parse the language's manifest format(s) for declared deps.
5. Validate specs defensively to prevent false positives.

Test it against a synthetic mini-project in `$TMPDIR/` with one each
of stdlib / project-local / third-party / platform-exception, before
relying on it.

For genuinely hard languages (Java/C++/C#/Swift), build the plugin
against a real-world repo and write a per-plugin PRD documenting the
parsing strategy, stdlib allowlist, and test fixtures.

---

## Source of truth

- The skill payload at `~/.claude/skills/lib-theseus/lib-theseus/` is
  the canonical, latest version. Future projects inherit from it.
- The version installed inside any specific project is a *copy* and
  may drift if the user has applied local patches. When in doubt, the
  skill payload wins.
- This `SKILL.md` describes the orchestration — how Claude invokes
  and walks the protocol. The protocol itself, with all the rules
  and rationale, lives in `PROTOCOL.md`. They are different
  documents; do not merge them.
