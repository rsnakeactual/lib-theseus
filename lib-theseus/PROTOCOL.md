# LIB-THESEUS PROTOCOL

> *"If, over the years, every plank of the Ship of Theseus is replaced
> with one we built ourselves — is it still the same ship?"*
>
> **Yes. And now it's actually ours.** No upstream maintainer can sink
> it. No registry typo-squatter can poison it. No CVE database can
> quietly grow new entries against versions we never installed. The
> hull is the same shape; every plank is something we made, tested,
> and audited ourselves.
>
> That is what this protocol does to a codebase. We replace public
> dependencies one library at a time, behavior-equivalent, until the
> project's `npm install` (or `pip install`, or `cargo build`, etc.)
> downloads nothing. The ship sails the same. The ship is now ours.

> **Read this top-to-bottom before writing one line of code.**
> This document is the contract. If anything in this file conflicts with
> something else in the host project (a `CLAUDE.md`, an existing comment,
> a habit), **this file wins** for any work involving third-party
> libraries. If you cannot satisfy this contract, **stop and ask the
> human.** Do not ship a workaround.

---

## 0. PORTABILITY & SCOPE

This `lib-theseus/` directory is **portable**. It is a self-contained
protocol intended to be dropped into any codebase that wants to drive
its public-dependency count to zero. To apply it to a new project:

1. Copy this entire directory into the project root.
2. Copy `exceptions.example.json` to `exceptions.json` and fill it in
   for the host project (see §3.1).
3. Run `node lib-theseus/scan.js` to produce the starting inventory.

The only file you should edit per-project is `exceptions.json`.
`PROTOCOL.md` and `scan.js` are universal — **do not** add
project-specific package names, paths, or conventions to them.

The scanner ships with first-class plugins for **JavaScript /
TypeScript / HTML, Python, Rust, Go, and Ruby**. Other ecosystems
(Java/Kotlin, C/C++, C#, Swift, PHP, etc.) follow the same principles.
Adding a new language is one self-contained file under
`lib-theseus/scanners/` and **does not** require touching the
driver — see §15.

---

## 1. WHO THIS IS FOR

This file has **two audiences**, and you are always one of them:

| Role | When you are this role | What this file forces you to do |
|------|------------------------|---------------------------------|
| **Rewriter** | You were asked to replace a third-party package with native code. | Follow §5 (the seven phases), §6 (licensing), §7 (code bar), §8 (parity gate). |
| **Developer** | You are doing any other work in the host project — features, bug fixes, tests, refactors. | Follow §4 (hard rules) at all times. **You may not introduce a new dependency.** |

You do not get to decide which role you are based on convenience. If
the work touches `package.json`, `node_modules/`, or any `require()` /
`import` of a name that does not start with `.`, `/`, or `node:`, you
are under this protocol.

---

## 2. PRIME DIRECTIVE

> **The host project's package-install command must be a no-op.**
> Running it on a clean checkout must download nothing, build nothing,
> and create no vendored entries from a public registry. Every byte of
> behavior the app relies on must live inside the project repository,
> written by us, owned by us, audit-able by a single human in an
> afternoon.
>
> Concretely, on a clean clone, every one of these commands prints
> "nothing to do" (or its equivalent), in every language the project
> uses:
>
> | Ecosystem | Install command | Vendored under |
> |---|---|---|
> | JavaScript / Node | `npm install` (or `pnpm install` / `yarn`) | `node_modules/` |
> | Python | `pip install -r requirements.txt`, `poetry install`, `pip-sync` | `site-packages/`, `.venv/` |
> | Rust | `cargo build` (registry fetch step) | `target/`, `~/.cargo/registry/` |
> | Go | `go mod download` | `$GOPATH/pkg/mod/`, `vendor/` |
> | Ruby | `bundle install` | `vendor/bundle/`, `~/.gem/` |
>
> Platform exceptions enumerated in `exceptions.json` are the **only**
> third-party fetches permitted, per language.

The reasons, ranked, so you can make judgment calls when the rules
don't cover an edge case:

1. **Supply-chain attack surface = 0.** A package we don't depend on
   cannot be typo-squatted, hijacked, or post-install-scripted.
2. **CVE scanners go quiet.** No `package@version` in the lockfile
   means no match against the CVE database. Vulnerabilities, if any,
   must be found by reviewing *our* code — which is the only review
   that actually matters.
3. **License hygiene.** No transitive surprise (GPL hidden three deps
   deep). Every line is ours, under the project's chosen license.
4. **Version drift = 0.** No "works on my machine because I have
   `marked@18` and CI has `marked@19`."
5. **Reviewability.** A reviewer can read every byte the app runs.
6. **Smaller, faster, fewer features.** We only implement what the
   project actually uses — see §7.4.

If a proposed action does not advance these goals, do not take it.

---

## 3. SCOPE: WHAT COUNTS AS A "DEPENDENCY"

A **dependency**, for this protocol, is any of the following:

- An entry in `dependencies`, `devDependencies`, `optionalDependencies`,
  `peerDependencies`, or `bundleDependencies` in `package.json`.
- A `require('xxx')` / `import 'xxx'` where `xxx` does **not** start
  with `.`, `/`, or `node:`.
- A `<script src="https://...">` tag in any HTML file.
- A `<link rel="stylesheet" href="https://...">` in any HTML file.
- A `<script src="…/node_modules/…">` or `<link href="…/node_modules/…">`
  — same dependency wearing a relative-path costume.
- A `fetch('https://cdn...')` or dynamic `import('https://...')` of
  code meant to be executed by the renderer.
- A binary, `.wasm`, or pre-built artifact pulled at install time,
  build time, or run time from a third-party server.
- A tool invoked via `npx`, `pnpx`, `bunx`, `yarn dlx`, or equivalent
  during build / test / runtime.

These are **not** dependencies and may be used freely:

- **Node built-ins:** anything addressable as `node:fs`, `node:crypto`,
  `node:http`, `node:https`, `node:tls`, `node:net`, `node:dns`,
  `node:os`, `node:path`, `node:url`, `node:vm`, `node:child_process`,
  `node:zlib`, `node:stream`, `node:buffer`, `node:events`,
  `node:worker_threads`, etc. Prefer the `node:` prefix in new code.
- **Web platform APIs** in renderers: `fetch`, `WebSocket`,
  `crypto.subtle`, `URL`, `TextEncoder`, `MutationObserver`,
  `IntersectionObserver`, etc. The browser is the platform.
- **The host project's own modules:** referenced via relative paths
  only.

### 3.1 Platform exceptions (config-driven, kept short)

Some "dependencies" are not libraries — they are **the platform the
project runs on**. You do not reimplement the platform. Common
candidates:

- The runtime / shell the project compiles against (an Electron,
  a Tauri, a Node itself when shipped as the runtime).
- Native bindings with no pure-JS equivalent that would also force
  every contributor to install the same C/C++ toolchain.
- Build-only tooling that never ships inside the artifact (packagers,
  signers, code-signers).

Platform exceptions are enumerated in `lib-theseus/exceptions.json`
under `platformExceptions`, **keyed by language**, so a polyglot
project can list separate exceptions per ecosystem:

```json
{
  "platformExceptions": {
    "javascript": ["electron", "node-pty"],
    "python": [],
    "rust": []
  }
}
```

For backward compatibility, an array under `platformExceptions` is
auto-promoted to the JavaScript list (the original single-language
schema). New code should use the keyed form.

**Rules for adding a platform exception:**

- It must appear in `exceptions.json` under the correct language key.
- It must be justified in writing in this section (§3.1) of the host
  project's PROTOCOL.md, with one short paragraph explaining *why*
  reimplementing it is out of scope.
- The list should be measurable in single digits per language,
  indefinitely. If you find yourself adding a fourth exception in a
  given language, the urge is wrong — stop and ask.

If you think you have found a new platform exception, you have not.
**Stop and ask.**

---

## 4. HARD RULES

These are non-negotiable. Violating any of them invalidates the work
even if it "passes tests" or "looks fine":

1. **DO NOT** add anything to `dependencies`, `devDependencies`,
   `optionalDependencies`, `peerDependencies`, or `bundleDependencies`
   in `package.json`. The only entries permitted are the platform
   exceptions enumerated in `exceptions.json` (§3.1).
2. **DO NOT** add a `<script src="https://...">` or
   `<link href="https://...">` to any HTML file. Bring the asset
   in-tree (verbatim, with checksum) only if a human has explicitly
   approved it for that file.
3. **DO NOT** copy/paste source code from a third-party package into
   this repo, even with attribution, even if the license permits it.
   Copy/paste is the failure mode this protocol exists to prevent.
   See §6 for the only correct approach.
4. **DO NOT** write a "thin wrapper" whose internals dynamically
   require the original package (e.g.,
   `module.exports = require('marked')`). This is a dependency
   wearing a costume.
5. **DO NOT** install a package "temporarily" and forget to remove it.
   Every research install (Phase 2 / §5) must be undone by Phase 7.
   The end-of-turn state of `package.json`, `package-lock.json`, and
   `node_modules/` must be no different from the start-of-turn state,
   except for files you are intentionally promoting under §5/Phase 7.
6. **DO NOT** invoke `npx`, `pnpx`, `bunx`, `yarn dlx`, or fetch a
   tool over the network as part of build, test, or runtime.
7. **DO NOT** suppress a CVE alert, audit warning, or lockfile
   violation by editing the warning out. Fix the cause: remove the
   dependency.
8. **DO NOT** introduce a new programming language or runtime to skirt
   this protocol (e.g., "I'll write it in Rust and shell out"). The
   rule applies per-language: zero public deps in JS today, zero in
   the next language we add.
9. **DO NOT** mark a rewrite "done" until §8 (the parity gate) passes
   *and* the original package has been removed from `package.json`
   *and* confirmed deleted from `node_modules/`.
10. **DO NOT** edit this file to make a rule easier on yourself.
    Changes to this protocol require explicit human approval, recorded
    in a commit message that says so.
11. **DO NOT** consider any change "shipped" until
    `node lib-theseus/scan.js` exits 0 against the entire repo. The
    scanner is the mechanical truth of this protocol — see §14.

If you find yourself reasoning "the spirit of the rule allows
this..." — **the answer is no, ask the human.**

---

## 5. THE SEVEN PHASES OF A REWRITE

Every replacement of a public package follows seven phases, in order.
Skipping or reordering them produces broken work. Each phase has a
specific input, a specific output, and a specific "done" condition.

```
                           ┌─────────────────┐
                           │ 5. Verify        │
                           │ (re-run tests)   │
                           └──────┬───────────┘
                                  │ fail
                                  ▼
   1. Identify ─► 2. Study ─► 3. Test cases ─► 4. Implement
                                                    │ pass
                                                    ▼
                                            6. PRD ─► 7. Cleanup
```

### Phase 1 — Identify the third parties

**Goal:** know exactly which public packages the codebase touches.
Nothing else is decided yet.

**Procedure:**

- Run `node lib-theseus/scan.js` from the project root. The scanner
  surfaces every external import, CDN reference, `node_modules/`
  relative load, and `package.json` entry that is not a platform
  exception (§3.1). It also exits non-zero — that exit code is the
  signal "rewrite work remains."
- For each package the scanner reports, add a row to
  `lib-theseus/INVENTORY.md` (format in §11) with a status of
  `pending`.
- Decide a tractable order. Cheap-and-isolated first (frontmatter
  parsers, UUID generators, small utilities) before sprawling-and-
  protocol-heavy (DOM implementations, mail clients, terminal
  emulators).

**Done when:** every line of the scanner's report is a row in the
inventory.

**Do not** start writing code yet. Knowing the list is its own phase.

### Phase 2 — Study the library

**Goal:** understand what the original package actually does, what
parts of it the host project actually uses, and where the real
specification of its behavior lives. The original package is
**reference material**, never the source of code.

**Procedure:**

- Find every call site in the host project for the package under
  study. Use ripgrep:
  `rg -nP "require\(['\"]<pkg>['\"]\)|from ['\"]<pkg>['\"]" --type js --type html`
- Record, in `lib-theseus/<package>/PRD.md` (the document you will
  finalize in Phase 6 — start it now), every exported name used,
  every argument shape passed in, every property read off the return
  value, every option/flag set.
- Find the **public specification** the package implements (RFC,
  WHATWG Living Standard, IETF draft, language grammar, etc.). The
  spec is always cleaner than any implementation; the original
  package contains a decade of bug-compat with broken inputs from the
  wild that you do not need.
- Record the original's **license** in PRD.md. Required.
- If you need to understand behavior empirically — encoding edge
  cases, error handling, output shape — you may run `npm install <pkg>`
  in `lib-theseus/<package>/_research/` (which is in `.gitignore`).
  Read the source **only** if the license is permissive
  (MIT/BSD/ISC/Apache-2.0/Unlicense/CC0). For copyleft licenses
  (GPL/LGPL/AGPL/MPL/EPL), see §6 — do not read the source at all.

**Done when:** PRD.md describes (a) the API surface the host project
uses, (b) the public spec the implementation must conform to, and
(c) the original's license.

### Phase 3 — Write the test cases (parity, abuse, *and* performance)

**Goal:** capture **what the library is supposed to do** (parity
cases), **what attackers will try to make it do** (abuse cases), and
**how fast it has to do it** (performance mandates) as runnable
tests, written **before** the implementation. Together these become
the parity-and-abuse-and-performance gate the new code must clear.

This phase produces three complementary test suites:

```
lib-theseus/<package>/
├── fixtures/         ← parity inputs (real-world content the library handles)
├── tests/            ← parity-test scripts; assert behavior matches original
├── abuse-fixtures/   ← attacker-crafted inputs (DoS, injection, parser tricks)
├── abuse-tests/      ← abuse-test scripts; assert defensive behavior
├── perf-fixtures/    ← representative inputs for benchmarking
└── perf-tests/       ← performance benchmarks; assert timing/memory bounds
```

#### 3a. Parity cases — "the library does what it says"

- Collect representative inputs from the host project's real usage
  into `lib-theseus/<package>/fixtures/`. Real markdown files. Real
  emails. Real HTML. Real terminal escape sequences.
- For each fixture, run it through the **original** package (still
  installed in `_research/`) and capture the output as a golden file
  in `fixtures/`. Pair convention: `input-foo.md` →
  `expected-foo.html`.
- Write parity tests in `tests/` that:
  - Execute every API the PRD lists.
  - Run every fixture through the (future) replacement.
  - Compare output byte-for-byte against the golden files.
  - Exit non-zero on any mismatch.
- Run the parity suite **against the original** to confirm it passes
  when the original is in place. If it doesn't, the suite is wrong —
  fix the suite, not the original.

#### 3b. Abuse cases — "the library doesn't do what it shouldn't"

This is the half that prevents you from accidentally rebuilding
yesterday's CVEs into your fresh codebase. **Every replaced library
gets explicit abuse-case coverage. No exceptions.**

For each library, enumerate what an attacker would try, then encode
each scenario as a fixture + assertion:

- **Look up known CVEs** for the original package (the npm advisory
  DB, GitHub Security Advisories, OSV, MITRE). For every CVE in the
  studied version's history — *fixed or unfixed* — add an abuse case
  that demonstrates the attack pattern and asserts your impl does
  not exhibit it. Cite each CVE by ID. Recreating an old CVE
  unintentionally is the single most likely failure mode of this
  kind of work; this step is the dam.
- **Apply the attack-class checklist** (whichever apply to this
  library type):
  | Category | Example for a markdown parser | Example for an IMAP client |
  |---|---|---|
  | DoS / resource exhaustion | deeply nested blockquotes, ReDoS-bait | server sends multi-GB literal |
  | Injection | XSS via `<img onerror=…>`, `javascript:` URLs | header smuggling, CRLF injection |
  | Parser desync / smuggling | ambiguous fence delimiters | literal-length boundary fuzz |
  | Information disclosure | path traversal in image refs | logging of bearer tokens |
  | Resource handles | unbounded file opens | unbounded sockets |
  | Logic flaws | comment leakage from sandboxed input | folder-rename atomicity |
  Anything from the OWASP Top 10 that maps onto the library's
  responsibilities.
- **Source from the public spec.** RFCs and standards have explicit
  "Security Considerations" sections. Read them. Each one is an
  abuse case waiting to be written.
- For each abuse case, place a malicious-input fixture in
  `abuse-fixtures/` and a test in `abuse-tests/` asserting the
  defensive behavior (e.g. "completes within Nms," "throws specific
  error type," "produces escaped output," "rejects with a
  diagnostic," "never invokes `eval`/`exec`," etc.).
- Each abuse case is recorded in `theseus.json` with an `id` (e.g.
  `AC-001`), `title`, `category`, `scenario`, `ourDefense`, and
  `test` path. See §11 for the schema. The abuse-case list and the
  `theseus.json` list must agree exactly.

#### 3c. Performance mandates — "the library does it fast enough"

A re-implementation that's correct and hardened but ten times slower
than the original is **a regression**, not a replacement. Performance
mandates are the third dimension of the test suite: explicit
timing/memory/throughput bounds the new impl must meet, anchored to
measurements taken from the original during Phase 2.

This is also a **subtle security boundary** — a slow re-implementation
is a denial-of-service vulnerability waiting for the right input
shape, even if no specific input crashes it. (See §7.6.)

For each library, identify the performance-critical paths and encode
each as a runnable benchmark + assertion:

- **Profile the original.** During Phase 2, while the research install
  is live, run the original against representative fixtures (the same
  ones that will go in `perf-fixtures/`) and capture timings, memory
  high-water marks, and any other relevant metric (allocations,
  syscalls, file descriptors). These become the *baseline*.
- **Identify the user-visible budget.** Where does the library sit
  in the host project's hot path? Is its output rendered on
  tab-switch (≤100ms is human-perceptible)? Is it called per-request
  in a server (a few ms tops)? Is it offline batch (seconds OK)? Set
  the *mandate* — the bound your impl must meet — accordingly.
- **Set the mandate as a multiple of the baseline, not an absolute.**
  E.g. "≤1.5× the original's wall-clock on the canonical fixture"
  rather than "≤80ms". Multiples survive hardware changes and CI
  runner variability; absolutes don't. If the original is slow, an
  absolute mandate may be fine; otherwise prefer multiples.
- **Cover at least these axes** (whichever apply):
  | Axis | What to measure |
  |---|---|
  | Wall-clock latency | end-to-end time on a representative input |
  | Asymptotic complexity | timing curve across input sizes (1KB, 100KB, 10MB) — the slope, not just one point |
  | Memory high-water | peak resident set during the run |
  | Allocation count / GC pressure | for long-lived servers |
  | Throughput | ops/sec under sustained load (for protocol clients, parsers in tight loops) |
  | Cold-start cost | time-to-first-result (matters for CLI tools, serverless) |
- **Write benchmarks in `perf-tests/`** that:
  - Run the impl against fixtures in `perf-fixtures/`.
  - Take N samples (e.g. 50), discard outliers, report a percentile
    (p50 / p95).
  - Assert the result against the mandate; exit non-zero on
    violation.
  - Print enough detail that a regression is debuggable (which
    fixture, what was measured, what the threshold was).
- Each performance mandate is recorded in `theseus.json` with an
  `id` (e.g. `PM-001`), `title`, `scenario`, `baseline` (measured
  from the original), `mandate` (the bound your impl must meet), and
  `test` path. See §11 for the schema.

#### 3d. Confirm the suites work against the original (where applicable)

- Parity suite must pass against the original package.
- Abuse suite: any case asserting the original was *vulnerable* (a
  reproduction of a known CVE in the studied version) should produce
  the bad behavior against the original — that's how you know the
  test is real. Cases asserting general defensive behavior should
  pass against any non-vulnerable version.
- Performance suite: should run against the original to capture or
  confirm the recorded `baseline` numbers. The mandates the new impl
  will face are derived from these measurements.

**Done when:**
- Every API in the PRD has ≥1 parity test.
- Every fixture has a paired expected-output file.
- Every CVE listed in `theseus.json#knownVulnerabilities` has a
  paired abuse test.
- Every abuse-case category that applies to this library type has
  at least one test.
- Every user-visible performance-critical path has a mandate in
  `theseus.json#performanceMandates` with a paired benchmark in
  `perf-tests/` and a recorded baseline from the original.
- All three suites have been executed and the results recorded in
  PRD.md.

The point of writing tests *before* code is that the tests now
encode "what we mean by correct," "what we mean by hardened," *and*
"what we mean by fast enough," independent of how anyone (LLM or
otherwise) chooses to implement it.

### Phase 4 — Implement (copy the *behavior*, not the *code*)

**Goal:** produce a replacement that satisfies the test suite from
Phase 3, written from scratch by us, with no source copied from the
original.

> **Critical clarification.** When this protocol says "copy the
> functionality," it means **reproduce the behavior** — the input/
> output relationship, the error semantics, the format the spec
> defines. It does **not** mean copy source code, copy structure
> verbatim, copy variable names, or transcribe the original. That is
> what §6 forbids. "Copy functionality" and "do not copy code" are
> not contradictory; they are the entire point of clean-room
> reimplementation.

**Procedure:**

- Land the new code in the host project's library directory (e.g.,
  `src/lib/`, `lib/`, whatever convention the project already uses),
  following the project's existing module-naming and class-naming
  conventions.
- **One class per file.** The file exports the class. No grab-bag
  modules with seven unrelated functions.
- **Object-oriented; state on instances, not at module scope.** This
  is what enables real reuse across pages, processes, and platforms.
- **No dynamic `require`.** All imports at the top of the file. No
  conditional `require('foo')` based on runtime.
- **No top-level side effects.** Importing the file must do nothing
  except register the class. Construction is explicit.
- **`node:` prefix on all built-ins** in new code.
- **Comments only where the WHY is non-obvious.** Don't narrate the
  code; explain hidden constraints, references to spec sections,
  surprising bug-compat behaviors.
- **Minimum viable surface.** If the original exports 80 functions
  and the project uses 4, write 4. If the original supports 12
  options and the project sets 3, support 3. The PRD is the scope.

**Done when:** the implementation file exists and exports the API
the PRD lists, **and** every abuse case from Phase 3 has a matching
defensive measure documented in code comments or the PRD (e.g. "max
input length enforced," "linear-time tokenizer," "shell args passed
as array, never concatenated"), **and** the algorithmic complexity
of the hot paths is appropriate for the performance mandates from
Phase 3c (linear/quasilinear where the mandate demands it; no
quadratic loops on user-controlled input lengths). Whether it
actually meets the mandates is Phase 5's job.

### Phase 5 — Verify; loop back to Phase 4 on failure

**Goal:** prove the implementation behaves correctly by running all
three suites from Phase 3 against it, and iterate until they're all
green.

**Procedure:**

- Point all three test suites at the new implementation (replace the
  `require('<pkg>')` in tests with the relative path to the new
  module — see Phase 7 for the global flip).
- Run the parity suite. Every test must pass.
- Run the abuse suite. Every test must pass — **including** every
  test that reproduces a known CVE against the original. The new
  impl must not exhibit any of those weaknesses.
- Run the performance suite. Every benchmark must come in under its
  recorded mandate. A perf failure is not "we'll optimize later" —
  it's a parity-gate failure. Loop back to Phase 4 and fix the
  algorithm, not the benchmark.
- For each parity failure, return to Phase 4 and fix the
  implementation — **never** the test, unless the test itself
  encodes a behavior the host project does not actually need (in
  which case update the PRD to remove that behavior from scope, and
  remove the test).
- For each abuse failure, return to Phase 4 and **harden**, never
  weaken the test. An abuse failure is a real vulnerability you just
  introduced; it does not get to be silenced.
- For each performance failure, return to Phase 4 and **fix the
  algorithm**. Loosening a mandate "because our impl is slower" is
  the same anti-pattern as silencing an abuse test — the mandate is
  what the user-visible budget actually demands. If a mandate truly
  cannot be met without a different design, surface that to the
  human as a finding; do not paper over it.
- Loop until all three suites are clean. There is no "good enough."
  A test that cannot be made to pass is a finding to surface to the
  human, not a reason to skip it.

**Done when:** all three suites pass against the new implementation;
any parity diff between original-output and new-output is either
zero or documented in the PRD as an intentional deviation with a
written justification; every abuse case asserts the desired
defensive behavior; every performance mandate is met with the
recorded measurement included in PRD.md.

### Phase 6 — Document the library PRD *and* the `theseus.json` record

**Goal:** produce the durable record of *what was built and why*, so
that a future contributor (or LLM) can audit, extend, or remove the
replacement without re-deriving everything from scratch.

This phase produces **two** artifacts:

- `lib-theseus/<package>/PRD.md` — the human-readable Product
  Requirements Document. Format in §10.
- `lib-theseus/<package>/theseus.json` — the machine-readable
  provenance + security record. Schema in §11.

These are not duplicates. The PRD is for humans deciding "should we
extend this? what does it do?" The `theseus.json` is for tooling
asking "what version of marked did we study? was that version
vulnerable to CVE-X? do we have a test for that?" Both must exist.

**Procedure:**

- **Finalize `PRD.md`** per §10's required structure. Every
  replacement gets a complete PRD; "trivial cases" don't get a
  shorter version. Capture: purpose, API surface, behavior contract,
  spec references, the original's license, the confirmation that no
  source was copied, the test suite location, every abuse case and
  its defense, every performance mandate with its recorded
  measurement, every intentional deviation from the original, known
  limits.
- **Write `theseus.json`** per §11's schema. The required fields
  capture the provenance (which package, which version, which
  license, when studied, by whom), the replacement (where it lives,
  when it shipped, which commit), the security record (every CVE in
  the studied version's history and our mitigation), the abuse
  cases (each with id, scenario, defense, and the test path that
  proves it), and the performance mandates (each with id, scenario,
  baseline, mandate, and the benchmark path). The `scan.js` will
  validate this file on every run (§14.5); incomplete or malformed
  `theseus.json` is a parity-gate failure.
- **Update `lib-theseus/INVENTORY.md`:** status `pending → replaced`,
  with the commit hash and date.

**Done when:** `PRD.md` is complete and committed; `theseus.json`
exists and validates; the inventory reflects the new state.

The PRD is the single artifact future humans reach for. The
`theseus.json` is the single artifact future tooling reads. The impl
can be regenerated from a complete PRD; the PRD cannot be
reconstructed from the impl alone; the security history cannot be
reconstructed from either without `theseus.json`.

### Phase 7 — Cleanup (cut the cord)

**Goal:** leave the repo in the canonical post-rewrite state. The
prime directive must hold — `npm install` is a no-op — when this
phase ends.

**Procedure (atomic; do all of these in one commit):**

1. Replace every `require('<pkg>')` / `import '<pkg>'` /
   `<script src="…/node_modules/<pkg>/…">` / CDN load in the host
   project to point at the new module.
2. Remove the package from `package.json`
   (`dependencies`, `devDependencies`, `peerDependencies`, etc.).
3. Run `npm install` and confirm the package is gone from
   `package-lock.json` and `node_modules/`.
4. Delete the research install at
   `lib-theseus/<package>/_research/`.
5. Run `npm install` once more on a clean state to confirm the prime
   directive: it must be a no-op (no downloads from the registry —
   platform exceptions excluded).
6. Run `node lib-theseus/scan.js`. The replaced package must no
   longer appear in any section of the output.

**Done when:** all six steps succeed and the scanner agrees.

If any of those six steps cannot be completed, the rewrite is **not
done**. Do not commit a half-replacement that leaves both the old
package and the new one wired up.

The per-package folder under `lib-theseus/` (PRD.md, fixtures/,
tests/) **stays** as the audit trail. Only `_research/` is deleted.

---

## 6. LICENSING SAFETY (READ THIS, IT MATTERS)

Copying source code from a package — even one byte, even with
attribution, even MIT-licensed — defeats this protocol. The rewrite
exists so that every line in the project is **ours**, written by us,
with provenance we control. That requirement is stronger than any
license allows.

But the more dangerous case is **copyleft contamination**: copying
or even closely paraphrasing GPL / LGPL / AGPL / MPL / EPL source can
force the host project itself to be released under that license.
This is not a hypothetical risk. This is how copyleft works.

**Rules in priority order:**

1. **Never paste source from any package, regardless of license.** Not
   to scaffold. Not as a comment. Not as a "starting point I'll
   modify." Not via the LLM's training data — if you can recite a
   library's source, that is the same as pasting it. Build from the
   spec or from observed behavior, not from memory of source.
2. **For copyleft-licensed packages (GPL/LGPL/AGPL/MPL/EPL), do not
   read the source at all.** Implement only from the public
   specification, public documentation, and observed input/output
   behavior. This is the standard "clean room" discipline. If no
   public spec exists, the rewrite is blocked — stop and ask.
3. **For permissive packages (MIT/BSD/ISC/Apache-2.0/Unlicense/CC0),
   reading the source for *understanding* is allowed, but the
   implementation must still be written from the spec/behavior, not
   transcribed.** When in doubt, treat it like copyleft.
4. **Check the license before you start.** Run
   `npm view <pkg> license` or read the package's `LICENSE` file
   during the Phase 2 research install. Record the license in PRD.md.
5. **Attribution does not save you.** A "Based on marked, MIT
   License, Copyright X" comment over copy-pasted source is still
   copy-paste. It is not what we are doing.
6. **The LLM rule:** if you, as the model writing this code, find
   yourself outputting code that you recognize as matching a
   library's source verbatim (even from training data), stop.
   Re-derive from the spec.

When in doubt, the human is the escape hatch. Stop and ask.

---

## 7. CODE QUALITY BAR

Rewrites must clear all of these. None is "nice to have."

### 7.1 Object-oriented and reusable

A rewrite is wrong if:
- Two pages each have their own copy of the parsing logic.
- The "class" is a single-method bag with no state.
- Helpers live as free functions in some page-specific file instead
  of on the class.

A rewrite is right if:
- One file in the project's library directory exports a single class.
- Every consumer (renderer pages, main process, mobile bridge if
  applicable) imports that class.
- State (caches, parser instances, configuration) lives on instances,
  not at module scope.

### 7.2 Code parity, not feature parity

You must reproduce the **behavior the host project depends on**, not
every feature the original package shipped. The PRD is the contract.
Anything outside the PRD is intentional dead code we are not
writing. If a future feature needs more of the surface, the PRD is
updated and the implementation extended — at that point, not
preemptively.

### 7.3 No CVE re-introduction

The single most likely failure mode of this kind of work is
**accidentally rebuilding a CVE the original library already fixed**.
Phase 3b (abuse cases) is the structural defense, but it only works
if you actually look up the originals' CVE history and write
matching tests.

Common patterns LLMs reach for that re-introduce known CVEs:

- Naïve regex-based HTML parsing → XSS via crafted attribute
  injection. Use a real tokenizer.
- String concatenation into shell commands → command injection. Use
  `execFile` with an args array; never `exec` with a string built
  from input.
- `eval` / `new Function` on user input → arbitrary code execution.
  Never. Use a real parser.
- Path joins with user input → path traversal. Resolve and verify
  the result is inside the expected root.
- Email header parsing without folding/unfolding rules → header
  injection / smuggling. Implement RFC 5322 §2.2 unfolding.
- Protocol parsers handled by ad-hoc `split()` → parser desync.
  Implement the literal-length / boundary protocol exactly.
- Catastrophic backtracking regex on user-controlled strings → ReDoS.
  Use linear-time tokenizers; reject pathological input lengths.
- Recursive descent without a depth bound → stack overflow DoS.
  Iterative parser, or explicit max-depth check.
- `JSON.parse` on attacker input without size limit → memory DoS.
  Cap input size before parsing.
- Unbounded resource acquisition (file handles, sockets, child
  processes, listeners) → resource exhaustion. Bound and recycle.

If the spec describes a security boundary, your implementation must
honor it. "It works on the happy path" is not a passing rewrite.

**Hard requirement:** every CVE listed in
`theseus.json#knownVulnerabilities` for the studied version's
history must have a paired test in `abuse-tests/` proving the new
implementation does not exhibit that weakness. The test must
reproduce the bad behavior against the original (when applicable)
and pass against the new impl. Without this paired test, the
mitigation is unverified — and unverified mitigations against
known CVEs are how supply-chain replacement projects produce
worse-than-original code.

### 7.4 Minimum viable surface

If the original package exports 80 functions and the project uses 4,
write 4. If the original supports 12 extensions and the project uses
3, support 3. The PRD is your scope; nothing outside it ships.

### 7.5 No comments restating the code

Comments only where the WHY is non-obvious. The rewrite is not an
excuse to narrate. A `// implements RFC 5322 §3.6.4 unfolding because
raw headers in our fixtures contain CRLF+WSP continuations` is a good
comment. A `// parse the line` over `parseLine()` is not.

### 7.6 Performance must not regress

A re-implementation that's correct and hardened but materially
slower than the original is a regression dressed up as a
replacement. Worse, slow code on a user-controlled input is
itself a security flaw — the line between "merely sluggish" and
"DoS" is whichever input shape an attacker chooses.

The discipline:

- **Profile, don't guess.** Phase 2 captures baseline timings from
  the original. Phase 3c encodes per-library mandates. Phase 5
  asserts they're met. No "feels fast enough."
- **Algorithmic before micro.** A linear-time impl on naïve code
  beats an O(n²) impl with hand-tuned hot paths every time. The
  spec almost always permits a linear approach; if you find
  yourself reaching for a clever optimization, double-check that
  the algorithm is right first.
- **No quadratic loops on user-controlled lengths.** A nested loop
  over an input string is a DoS bug waiting for the right input
  size. Use linear data structures (Maps, Sets) over array search.
- **Bound everything that's bounded in the spec.** If the spec
  caps something (max header length, max nesting depth, max
  message size), enforce the cap explicitly. If the spec is silent,
  pick a defensible cap; don't ship "unbounded" as the default.
- **Don't allocate in tight loops.** A parser that creates a new
  object per token will spend more time in GC than parsing. Reuse
  buffers; emit tokens through a callback or a pre-sized array.
- **Cold start counts.** Top-level `require` of every plugin a
  CLI tool *might* use makes startup linear in plugin count. Lazy-
  load. The host project's library is part of its boot path.

**Hard requirement:** every performance mandate listed in
`theseus.json#performanceMandates` must have a paired benchmark
in `perf-tests/` that runs against the new implementation and
asserts the bound. The benchmark must include enough output to
debug a regression — which fixture, what was measured, what the
threshold was, what the actual was. A passing benchmark with no
diagnostic output isn't useful when it eventually fails on
someone else's machine.

---

## 8. THE PARITY-AND-ABUSE-AND-PERFORMANCE GATE

A rewrite is **not done** until every check below is green. The
checklist goes in `lib-theseus/<package>/PRD.md` under a "Gate"
section, ticked, with the test outputs.

**Parity:**

- [ ] **Every API in the PRD is implemented.** Run the test for each
  entry; record pass/fail.
- [ ] **Every fixture in `fixtures/` produces byte-identical output**
  to the original (or a documented intentional difference with a
  written justification).
- [ ] **All call sites in the host project still work.** Grep
  confirms the `require('<pkg>')` count is zero. The app boots, the
  relevant flow exercises the new code path manually.

**Security (abuse cases):**

- [ ] **Every CVE in the studied version's history is enumerated** in
  `theseus.json#knownVulnerabilities` with a paired test path in
  `abuse-tests/`.
- [ ] **Every abuse case in `theseus.json#abuseCases` has a runnable
  test** in `abuse-tests/` that asserts the defensive behavior.
- [ ] **The abuse suite passes** against the new implementation —
  every CVE-reproduction test that produced the bad behavior on the
  original now demonstrates the new impl does not.
- [ ] **The attack-class checklist** from §5/Phase 3b has been
  considered (DoS, injection, parser desync, info disclosure,
  resource exhaustion, logic flaws). For each category that applies
  to this library type, ≥1 abuse case exists.
- [ ] **The spec's "Security Considerations" section has been read**
  and every applicable item has a matching abuse case.

**Performance:**

- [ ] **Every user-visible performance-critical path has a mandate**
  in `theseus.json#performanceMandates`, anchored to a baseline
  measurement taken from the original.
- [ ] **Every mandate has a runnable benchmark** in `perf-tests/`
  that asserts the bound and prints diagnostic detail on failure.
- [ ] **The performance suite passes** against the new
  implementation. Every benchmark is at or under its mandate.
- [ ] **Asymptotic complexity has been verified** on the hot paths —
  no quadratic or exponential behavior on user-controlled input
  lengths.
- [ ] **Cold-start cost has been measured** if the library sits in a
  CLI / serverless / boot-path position.
- [ ] **The mandate values themselves have been reviewed** by a
  human against the host project's actual user-visible budgets, not
  guessed by the LLM that wrote them.

**Provenance & licensing:**

- [ ] **`theseus.json` exists and validates** against the schema in
  §11. `scan.js` confirms.
- [ ] **License of original recorded** in `theseus.json` and PRD.md.
- [ ] **`license.sourceCopied: false`** in `theseus.json`, with a
  written confirmation in `license.confirmation`.

**Cleanup:**

- [ ] **No leftover install.** `package.json` no longer lists the
  package. `package-lock.json` no longer mentions it. `node_modules/`
  no longer contains it. `lib-theseus/<package>/_research/` is gone.
- [ ] **`npm install` on a clean clone is a no-op for this package.**

**Engineering:**

- [ ] **OO check:** the new code is a class, lives in the project's
  library directory, and every consumer imports the same class.
- [ ] **Inventory updated.** `lib-theseus/INVENTORY.md` status
  flipped to `replaced`.
- [ ] **`node lib-theseus/scan.js` exits 0 for the full repo,** and
  the package being replaced no longer appears in any section of
  the output (imports, manifests, theseus records).

If a check is yellow, it is red. There is no "good enough."

---

## 9. WHEN YOU THINK YOU NEED A NEW PACKAGE

You don't. Read the rest of this section anyway.

The temptation:
- "I just need a tiny utility for X, the package is 30 lines."
- "It's only a dev dependency, it doesn't ship."
- "It's the standard solution, everyone uses it."
- "Writing it myself would take an hour."

The response, in order:

1. **Is it in `node:` built-ins?** Almost certainly yes for: HTTP,
   crypto, hashing, file I/O, process spawning, timers, streams,
   URLs, paths, OS info, DNS, TLS, networking, compression, events,
   buffers, worker threads, child processes, VM contexts.
2. **Is it in the web platform?** Renderers have `fetch`,
   `crypto.subtle`, `URL`, `TextEncoder/Decoder`, `WebSocket`,
   `MutationObserver`, `IntersectionObserver`, `structuredClone`,
   `BroadcastChannel`. Use them.
3. **Is the "30-line package" actually 30 lines of logic?** Then
   write the 30 lines in the project's library directory. That is
   *less* code than adding a dependency, because the dependency
   comes with `package.json` churn, lockfile churn, security review,
   license review, and a permanent obligation.
4. **Is this a "dev only" tool?** Dev-only packages are still
   dependencies. They still introduce supply-chain risk during
   `npm install` (post-install scripts run on every dev's machine).
   Same rule.
5. **Have you checked `lib-theseus/INVENTORY.md`?** Maybe a class
   already exists for this. Reuse before you write.
6. **Stop and ask the human.** Describe what you need, the input/
   output contract, and how big the implementation would be. Wait
   for direction.

There is no rule 7.

---

## 10. THE LIBRARY PRD — REQUIRED FORMAT

Every replaced library has a PRD at `lib-theseus/<package-name>/PRD.md`
(scoped names: replace `/` with `__`, e.g.,
`@xterm/xterm` → `@xterm__xterm/PRD.md`). The required structure:

```markdown
# <package-name> — Library PRD

## 1. Purpose
One paragraph: what problem this library solves for the host project.
Why it exists in our tree at all.

## 2. Original
- Package: `<name>`
- Version studied: `<x.y.z>`
- License of original: `<MIT | BSD-2 | …>`
- Public spec / standard: `<RFC link, spec URL, grammar reference>`
- Confirmation: no source from the original was copied into this
  implementation. Implemented from spec and observed behavior.

## 3. Use cases (API surface — the contract this impl must satisfy)
Enumerate every export, method, option, and behavior the host
project relies on. For each:
- Name
- Signature (argument types, return type)
- Behavior in one sentence
- Reference to the test in `tests/` that verifies it

Anything not listed here is explicitly **out of scope** and not
implemented.

## 4. Abuse cases (the contract this impl must NOT violate)
Enumerate every attack scenario this implementation defends against.
For each:
- ID (e.g. `AC-001`)
- Title
- Category (DoS / Injection / Parser desync / Info disclosure /
  Resource exhaustion / Logic flaw)
- Scenario (one-paragraph attacker model)
- Our defense (the property of our impl that prevents it)
- Reference to the test in `abuse-tests/` that proves the defense
- If this case maps to a known CVE in the original, cite the CVE ID

This section is **not optional** and "no abuse cases apply" is rarely
true — even the simplest parser has DoS-shaped edges. See §7.3 for
the attack-class checklist and the CVE-mapping requirement.

## 5. Performance mandates (the contract this impl must MEET)
Enumerate every user-visible performance budget this implementation
must clear. For each:
- ID (e.g. `PM-001`)
- Title
- Scenario (what work is being done and why timing matters here)
- Baseline (measured timing/memory/throughput of the original on
  the canonical fixture, including hardware class)
- Mandate (the bound your impl must meet — prefer a multiple of the
  baseline like "≤1.5× original" over an absolute number)
- Reference to the benchmark in `perf-tests/` that proves the bound

This section is **not optional** and "performance doesn't matter
here" is rarely true. A re-implementation that's 10× slower than
the original is a regression dressed up as a replacement, and on
user-controlled input it's a DoS bug. See §7.6 for the discipline
and the attack-axis list.

## 6. Behavior contract
Describe input/output, error modes, format quirks, and any spec-
defined edge cases the implementation honors. Cite spec sections,
including the spec's "Security Considerations" entries.

## 7. Fixtures & tests
- Parity fixtures: `lib-theseus/<package>/fixtures/`
- Parity tests:    `lib-theseus/<package>/tests/`
- Abuse fixtures:  `lib-theseus/<package>/abuse-fixtures/`
- Abuse tests:     `lib-theseus/<package>/abuse-tests/`
- Perf fixtures:   `lib-theseus/<package>/perf-fixtures/`
- Perf tests:      `lib-theseus/<package>/perf-tests/`
- How to run: `<command>`.
- Coverage summary: every fixture, every API entry, every abuse
  case, every performance mandate.

## 8. Intentional deviations from the original
List every place output differs from the original, with reason.
("Original preserves CRLF; we normalize to LF on output. Reason:
host project's renderer normalizes anyway. Harmless.")
If this section is empty, say so explicitly.

## 9. Gate (§8 of PROTOCOL)
Tick every parity / security / performance / provenance / cleanup /
engineering box. Record commit hashes for each. Link to the test
runs and the benchmark outputs (with measured values, not just
pass/fail).

## 10. Known limits
What this implementation does NOT do, vs. the original. What inputs
it will refuse or fail on. The list of things a future contributor
would need to extend if a new feature requires more of the original
package's surface.

## 11. Maintenance notes
How to extend it. Which spec sections govern which file. What to
re-test if you change <X>. Where the corresponding `theseus.json`
lives and what to update there if the PRD changes. **When you change
the implementation, re-run all three suites — parity, abuse, and
performance.** A change that doesn't break parity can still tank
performance silently; the perf suite is your regression net.
```

The PRD is the artifact future *humans* reach for. The companion
`theseus.json` (§11) is what *tooling* reads. Both must exist for
every replaced library; they are not duplicative.

---

## 11. `theseus.json` — THE PROVENANCE & SECURITY RECORD

Every replaced library has a sibling `theseus.json` next to its PRD,
at `lib-theseus/<package-name>/theseus.json`. The PRD is for human
auditors; this file is for **machines** — SBOM tooling, CVE
scanners, the `scan.js` parity gate, and any future automation that
needs to answer "what version of X did we study, and is that
version now known to be vulnerable?"

The file is JSON. The scanner validates it on every run (see §14.5)
and exits non-zero if any required field is missing or malformed.

### 11.1 Schema (v1)

```json
{
  "schemaVersion": 1,
  "original": {
    "name":       "marked",
    "ecosystem":  "npm",
    "version":    "18.0.0",
    "license":    "MIT",
    "registry":   "https://www.npmjs.com/package/marked",
    "repository": "https://github.com/markedjs/marked",
    "studiedAt":  "2026-04-30",
    "studiedBy":  "Jane Doe <jane@example.com>"
  },
  "specifications": [
    { "name": "CommonMark 0.31.2",
      "url":  "https://spec.commonmark.org/0.31.2/" },
    { "name": "GFM",
      "url":  "https://github.github.com/gfm/" }
  ],
  "replacement": {
    "path":        "src/lib/markdown.js",
    "class":       "Markdown",
    "completedAt": "2026-05-15",
    "commit":      "def456abc",
    "linesOfCode": 412
  },
  "license": {
    "originalLicense":      "MIT",
    "sourceCopied":         false,
    "implementationBasis":  "spec",
    "confirmation":         "Implemented from CommonMark 0.31.2 spec; no source from marked@18.0.0 was transcribed or paraphrased."
  },
  "knownVulnerabilities": [
    {
      "id":              "CVE-2022-21680",
      "affectsVersions": "<4.0.10",
      "title":           "ReDoS via crafted heading",
      "ourMitigation":   "Linear-time tokenizer; no backtracking regex on user input.",
      "abuseCaseRef":    "AC-002"
    }
  ],
  "abuseCases": [
    {
      "id":          "AC-001",
      "title":       "Deeply nested blockquotes",
      "category":    "DoS",
      "scenario":    "Attacker submits markdown with 100,000 levels of nested '>' blockquotes; goal is stack overflow.",
      "ourDefense":  "Iterative parser; max nesting depth 1000; rejects input above with a diagnostic.",
      "test":        "abuse-tests/deep-nesting.test.js"
    },
    {
      "id":          "AC-002",
      "title":       "ReDoS via heading regex",
      "category":    "DoS",
      "scenario":    "Reproduction of CVE-2022-21680: attacker submits a heading with thousands of repeated whitespace runs to trigger catastrophic backtracking.",
      "ourDefense":  "Tokenizer is linear-time over input length; no backtracking constructs on user input.",
      "test":        "abuse-tests/redos-heading.test.js"
    }
  ],
  "performanceMandates": [
    {
      "id":         "PM-001",
      "title":      "Render 1MB markdown in tab-switch budget",
      "scenario":   "The host project renders ~1MB of markdown when the user switches into a notes tab; rendering is on the user-visible path. >100ms is perceptible.",
      "baseline":   "marked@18.0.0 takes p95 ≈ 85ms on perf-fixtures/large.md (M-series Mac, 16GB, Node 22).",
      "mandate":    "≤1.5× original (≤128ms p95) on the same fixture and hardware class.",
      "test":       "perf-tests/large-render.bench.js"
    },
    {
      "id":         "PM-002",
      "title":      "Linear-time scaling on input size",
      "scenario":   "User inputs are user-controlled in size; quadratic behavior is a DoS edge.",
      "baseline":   "marked@18.0.0 timing curve on 1KB / 100KB / 10MB fixtures fits a linear regression with R² > 0.99.",
      "mandate":    "Our impl's timing curve over the same input sizes must also fit a linear (or quasi-linear, n log n) regression with R² > 0.95.",
      "test":       "perf-tests/scaling.bench.js"
    }
  ]
}
```

### 11.2 Required fields

The scanner enforces these. Missing or wrong-typed = parity-gate
failure.

| Field | Type | Notes |
|---|---|---|
| `schemaVersion` | integer | Must be `1`. Bump only when the schema changes. |
| `original.name` | string | The package name on the registry. |
| `original.ecosystem` | string | One of: `npm`, `pypi`, `cargo`, `gomod`, `rubygems`, `maven`, `nuget`, `composer`, `pub`, `swift`, `other`. |
| `original.version` | string | The exact version studied (e.g., `18.0.0`, not `^18`). |
| `original.license` | string | SPDX identifier when possible. |
| `original.studiedAt` | string | ISO-8601 date or datetime. |
| `replacement.path` | string | Project-relative path to the in-tree implementation. |
| `replacement.completedAt` | string | ISO-8601. When Phase 7 was completed. |
| `license.sourceCopied` | boolean | Must be `false`. If `true`, the rewrite is not protocol-conformant. |
| `license.confirmation` | string | One- or two-sentence statement of *how* the impl was derived (spec / behavior / both) and confirmation no source was copied. |
| `knownVulnerabilities` | array | May be empty, but the field must be present (signals "we checked"). Each entry: `id`, `affectsVersions`, `title`, `ourMitigation`. Optional: `abuseCaseRef`. |
| `abuseCases` | array | May be empty, but the field must be present. Each entry: `id`, `title`, `category`, `scenario`, `ourDefense`, `test`. |
| `performanceMandates` | array | May be empty *only* if the library has no user-visible performance-critical path (rare). Each entry: `id`, `title`, `scenario`, `baseline`, `mandate`, `test`. |

### 11.3 Optional but recommended fields

- `original.registry` — URL to the package's registry page.
- `original.repository` — upstream source repo URL.
- `original.studiedBy` — person who did Phase 2.
- `specifications` — array of `{name, url}`. List every standard the
  impl conforms to. Empty array if the library has no public spec
  (rare; flag it).
- `replacement.class` — class name in the impl file.
- `replacement.commit` — git hash where Phase 7 landed.
- `replacement.linesOfCode` — useful for sizing future maintenance.
- `knownVulnerabilities[*].abuseCaseRef` — link a CVE to the abuse
  case ID that proves we don't exhibit it.

### 11.4 Allowed values

**`ecosystem`** is closed-set: pick the closest of `npm`, `pypi`,
`cargo`, `gomod`, `rubygems`, `maven`, `nuget`, `composer`, `pub`,
`swift`, `other`. The scanner uses this to dispatch ecosystem-aware
checks (e.g., "is this version still in the npm registry?").

**`abuseCases[*].category`** is closed-set: `DoS`, `Injection`,
`ParserDesync`, `InfoDisclosure`, `ResourceExhaustion`, `LogicFlaw`,
`AuthBypass`, `MemorySafety`, `Other`. New categories require a
schema bump.

**`license.implementationBasis`** is one of: `spec` (implemented
from a public specification), `behavior` (implemented from observed
input/output of the original, when no spec exists), `both`. Anything
else suggests source-copying — don't pick `other`.

### 11.5 Updating an existing record

If a library is later extended (new API surface added, new abuse
case discovered, the studied version is found to have a newly-
disclosed CVE), update the same `theseus.json`. Bump no field,
write no changelog inside the JSON — the git history is the
changelog. **Don't** delete entries: a CVE we mitigated in 2026
should still be listed in 2030; future maintainers need to know
the design pressure that shaped the impl.

### 11.6 Aggregated view (optional)

Tooling can recursively walk `lib-theseus/*/theseus.json` to produce
an SBOM-shaped summary. The protocol does not mandate generating
this; per-library files are the source of truth.

---

## 12. THE INVENTORY — `lib-theseus/INVENTORY.md`

The live status of every public dependency. It is the project's
authoritative ledger of rewrite progress. Update on every status
change.

**Required columns:**

| Package | Role | License | Approach | Status | Owner/Commit |
|---|---|---|---|---|---|

**Statuses (only these values):**

- `pending` — present in the codebase, no work started.
- `studying` — Phase 2 in progress (research install live).
- `tests-written` — Phase 3 complete; suite passes against original.
- `implementing` — Phase 4/5 in progress.
- `verified` — Phase 5 complete; all tests pass against new impl.
- `replaced` — Phase 7 complete; original removed from
  `package.json`, `node_modules/`, and all call sites.
- `exempt-platform` — listed in `exceptions.json`. Not subject to
  rewrite. Justification appears in PROTOCOL.md §3.1.

When every row is `replaced` or `exempt-platform`, the prime
directive holds.

The inventory is created by Phase 1 of the first rewrite to use this
protocol in a host project. It does not need to exist before that.

---

## 13. ANTI-CHEAT (LLM FAILURE MODES)

These are the specific ways past LLM attempts have broken this kind
of rule. They are listed not because they are clever but because they
are the things you will be tempted to do when stuck. Don't.

| Cheat | What it looks like | Why it's banned |
|---|---|---|
| The thin wrapper | A new `<lib>/foo.js` that does `module.exports = require('foo')` | Dependency in disguise. §4.4. |
| The dynamic require | `const m = require(['fo','o'].join(''))` | Same as above plus obfuscation. §4.4. |
| The CDN script tag | `<script src="https://cdn.jsdelivr.net/...">` in HTML | Network dep that ships in the binary. §3 / §4.2. |
| The `node_modules` relative load | `<script src="../node_modules/foo/dist/foo.js">` | Same dep, relative path. §3. |
| The temporary install that stays | `npm i foo` for "research" left in `package.json` at end of turn | Defeats the entire protocol. §4.5 / Phase 7. |
| The vendored copy-paste | `// from foo v18, MIT, copyright ...` followed by transcribed source | License contamination + provenance loss. §4.3 / §6. |
| The "spirit of" reading | "The rule says no public deps but this is a community fork so..." | Rules aren't rewritten by argument. §4.10. |
| The dev-only smuggle | "It's only `devDependencies`, it doesn't ship" | Still a supply-chain entry. §4.1. |
| The npx end-run | `"build": "npx esbuild ..."` in scripts | Network at build time. §4.6. |
| The "I'll fix it later" | New code added that uses a non-vendored helper, with a TODO | TODOs for protocol violations are lies. §4.1. |
| Suppressing audit | `npm audit --omit=dev` to make warnings disappear | Treats the symptom. §4.7. |
| New language smuggle | "I'll implement this in Rust and shell out" | Same problem in a costume. §4.8. |
| Recitation from training | LLM "writes from scratch" code that exactly matches the upstream source | Indistinguishable from copy-paste. §6.6. |
| Confusing "copy functionality" with "copy code" | Phase 4 says copy the functionality; the LLM copies the source and calls it functionality | Phase 4 is reimplementation; §6 is binding. Read §5/Phase 4 again. |
| Silencing the scanner | Adding the package to `exceptions.json` to stop the warning | Platform exceptions are for non-libraries (§3.1), not "things I haven't rewritten yet." |

If you notice yourself doing any of these, undo the action and
re-enter the protocol from §4.

---

## 14. THE SCANNER — `lib-theseus/scan.js`

The scanner is the mechanical, automated form of this protocol. The
text of this document is the spec; the scanner is the enforcer. **If
the scanner exits non-zero, the rewrite is not done — full stop.**
Writing prose that says "yes I rewrote it" while the scanner still
reports the package is the most common LLM failure mode and will not
be accepted.

### 14.1 Architecture

The scanner is one **language-agnostic driver** (`scan.js`) plus a
set of **language plugins** under `lib-theseus/scanners/`. The driver
does not know what JavaScript is, what Python is, what a `Cargo.toml`
is. It walks the tree, asks each plugin "is this file yours?", and
delegates parsing/classification to the plugin. Adding a language is
one new file under `scanners/`. The driver is never edited per
project. See §15 for the plugin contract.

### 14.2 What it does

Given a directory (default: the repo root), it walks every file in
the tree (skipping `node_modules/`, `.git/`, `out/`, `build/`,
`dist/`, `.cache/`, `_research/`, `__pycache__/`, `target/`,
`vendor/`, `.gradle/`, `.idea/`, `.vscode/`, `venv/`, `.venv/`, plus
any directories listed in `exceptions.json#skipDirs`) and asks the
plugins to classify each one.

Each plugin handles its own language's source files and manifest
files. As of v1, the bundled plugins are:

| Plugin | Source extensions | Manifests | Stdlib detection |
|---|---|---|---|
| `javascript` | `.js .mjs .cjs .jsx .ts .tsx .html .htm` | `package.json` | hardcoded Node built-ins + `node:` prefix |
| `python` | `.py` | `requirements.txt`, `pyproject.toml`, `setup.py`, `Pipfile` | hardcoded Python 3 stdlib list |
| `rust` | `.rs` | `Cargo.toml` | `std/core/alloc/proc_macro/test`, `crate/self/super` |
| `go` | `.go` | `go.mod` | "first segment has no `.`" heuristic + `module …` line |
| `ruby` | `.rb .rake .ru` | `Gemfile`, `*.gemspec` | hardcoded Ruby stdlib list |

For each, the scanner surfaces every import / `require` /
`use` / etc. that points at a third-party package, every manifest
entry that declares one, and (for HTML) every CDN load and every
`<script src="…/node_modules/…">` style relative load.

It then **exits 1 if any of those exist**, after printing them
grouped by language and package with `file:line` for each call
site. Exit 0 means clean across every language.

### 14.3 What it allows

Per language, the scanner allows:

- Anything in that language's standard library / built-ins.
- Anything resolving to a relative or absolute path inside the
  project (not inside a vendored-deps directory like `node_modules/`,
  `target/`, `vendor/`, `site-packages/`).
- Anything in that language's `projectPackages` — auto-detected from
  manifests (Cargo.toml `[package].name`, `go.mod` module line,
  `pyproject.toml [project].name`, top-level dirs containing
  `__init__.py`, etc.) plus anything explicitly listed under
  `exceptions.json#projectPackages.<language>`.
- Exactly the names listed in
  `exceptions.json#platformExceptions.<language>`. Nothing else.

The platform-exception lists are project-local; the scanner is not.
Adding a name without justifying it in PROTOCOL.md §3.1 is a
violation.

### 14.4 How to run it

```
node lib-theseus/scan.js                  # scan repo root, all languages
node lib-theseus/scan.js src              # scan a subtree
node lib-theseus/scan.js --quiet          # only print summary line
node lib-theseus/scan.js --json           # machine-readable
node lib-theseus/scan.js --language=python   # restrict to one plugin
```

It depends on nothing — pure `node:fs` / `node:path`. Plugins must
stay that way too.

### 14.5 `theseus.json` validation

After the import scan, the scanner walks `lib-theseus/*/` and
validates the `theseus.json` for every per-package work folder it
finds (anything that isn't `scanners/`, isn't hidden, and contains
either a `PRD.md` or a `theseus.json`). For each:

- The file must exist.
- The file must parse as JSON.
- `schemaVersion` must equal `1`.
- Every required field listed in §11.2 must be present and the
  correct type.
- Closed-set fields must use a recognized value (`ecosystem`,
  `abuseCases[*].category`, `license.implementationBasis`).
- `license.sourceCopied` must be `false` (a `true` here is a hard
  fail — that record is documenting a license violation).
- The path in `replacement.path` must point at an existing file in
  the project tree.
- For each entry in `knownVulnerabilities` whose `abuseCaseRef` is
  set, the referenced abuse-case `id` must exist in `abuseCases`.
- For each `abuseCases[*].test`, the path must exist on disk
  (relative to the package folder).
- For each `performanceMandates[*]`, all required fields (`id`,
  `title`, `scenario`, `baseline`, `mandate`, `test`) must be
  present and non-empty, and `test` must point at an existing path
  on disk relative to the package folder.

Failures are reported in their own section of the scan output
(separate from the import-scan section) and contribute to the
non-zero exit code:

```
=== THESEUS RECORDS — INVALID ===

  marked
    lib-theseus/marked/theseus.json: missing required field "license.confirmation"

  jsdom
    lib-theseus/jsdom/theseus.json: file not found
    (a per-package folder with a PRD.md exists, but no theseus.json
     accompanies it)
```

A package whose folder exists but has no `theseus.json` is treated
as "rewrite in progress, not yet shipped" — the validator surfaces
it but allows the user to mark it explicitly in `INVENTORY.md` as
in a non-`replaced` status. Once a package's INVENTORY status is
`replaced`, `theseus.json` is mandatory.

### 14.6 How to read its output

```
=== JAVASCRIPT — UNREWRITTEN ===

  <package>  (3 sites)
    main.js:1441                     <package>
    package.json:0                   <package>
    src/foo.html:1783                ../node_modules/<package>/dist/<package>.js

  [CDN] https://unpkg.com/x@1/x.js   (1 site)
    src/dashboard.html:12            https://unpkg.com/x@1/x.js

=== PYTHON — UNREWRITTEN ===

  requests  (2 sites)
    src/app.py:5                     requests
    requirements.txt:1               requests

lib-theseus scan: REWRITE STILL NEEDED — N site(s),
K unique package(s), L language(s).
Resolve per lib-theseus/PROTOCOL.md and re-run.
```

A package is **fully replaced** when, and only when, the scanner
stops mentioning it in *every* section for its language. Removing
the import sites but leaving it in the manifest is a half-rewrite,
and vice versa.

### 14.7 When the scanner finds something you didn't expect

If the scanner reports a package you didn't know was in use, treat
that as the discovery of a new rewrite target — add it to
`INVENTORY.md`, follow §5 from Phase 1. Do not silence the scanner.
Do not exclude the file. If the report is wrong (a genuine false
positive), fix the scanner's logic — never the symptom — and
document the change in this section.

### 14.8 The scanner is part of the protocol

`scan.js` is not a "helper script." It is the mechanical authority
for whether a rewrite is complete. Treat its output the way you
would treat a failing test: not done until green. Treat changes to
the allowlists the way you would treat a constitutional amendment:
rare, deliberate, and recorded.

---

## 15. ADDING A NEW LANGUAGE PLUGIN

The driver is small and dumb on purpose. All language-specific
knowledge lives in a single self-contained file under
`lib-theseus/scanners/<language>.js`. Adding a language is one
file, no driver edits, no protocol edits beyond updating §14.2's
table. **The same zero-dependency rule applies to plugins** — pure
`node:fs` / `node:path` / strings, nothing else.

### 15.1 The plugin contract

Every plugin file exports an object shaped exactly like this:

```js
module.exports = {
  // Required. The canonical language name used in output and config.
  language: 'rust',

  // Either provide arrays and let the driver build matchers, or
  // provide matchSource/matchManifest functions yourself.
  sourceExtensions: ['.rs'],
  manifestFiles:    ['Cargo.toml'],
  // matchSource(filePath)   -> bool   (defaults to extension check)
  // matchManifest(filePath) -> bool   (defaults to basename, with *.x glob)

  // Called once per scan, given the list of manifest paths the
  // driver found anywhere in the tree. Use this to populate
  // ctx.projectPackages (for things like the project's own crate
  // name, the Go module path, the pyproject [project].name) so
  // classify() can recognize project-local imports.
  discoverContext(manifestPaths, ctx, projectRoot) { ... },

  // Return [{ spec, line, kind?, package?, version? }, ...] for each
  // import/use/require/etc. found in source.
  scanSource(src, filePath, ctx) { ... },

  // Return the same shape for each dependency declared in a manifest.
  scanManifest(src, filePath, ctx) { ... },

  // Decide whether `spec` is allowed (stdlib, project-local, or in
  // platformExceptions) or a violation. Returns:
  //   { allowed: true }                              - silent
  //   { allowed: false, packageName, reason? }       - report
  classify(spec, ctx, ref) { ... },
};
```

The `ctx` object passed in is per-language and is built by the
driver from `exceptions.json` plus your `discoverContext` output:

```
ctx = {
  projectRoot:        absolute path,
  platformExceptions: Set<string>,   // from exceptions.json
  projectPackages:    Set<string>,   // from config + your discoverContext
  discovered:         object,        // free-form notes you set
}
```

### 15.2 The minimum useful plugin

In order, every plugin should:

1. **Strip comments and string contents** before scanning so a comment
   like `// require('foo')` does not produce a false positive. Each
   language has its own quirks (Python triple-quoted strings, Rust
   raw strings `r#"…"#`, Go backtick raw strings, Ruby `=begin/=end`
   blocks, JavaScript regex literals — all handled in the bundled
   plugins; mimic the closest one).
2. **Distinguish three classes of import:**
   - Standard library (allowed). Hardcode the language's stdlib
     names; do not load them from the network.
   - Project-local (allowed). Auto-detect from manifests where
     possible; fall back to `exceptions.json#projectPackages`.
   - Third-party (reported). Everything else.
3. **Parse manifests** for the dependency declarations the language's
   package manager understands. For most languages a small regex
   pass over a TOML/YAML/JSON-shaped file is enough — full TOML/YAML
   parsing is NOT required and would itself be a dependency
   violation if pulled from a library.
4. **Validate specs defensively.** Even with good comment-stripping,
   pattern matching can pick up false positives. Apply a tight
   "what shape is a real package name in this language?" filter
   before emitting.

### 15.3 Languages worth adding (and the gotchas)

Some ecosystems have well-defined structure and are quick to add
(Elixir's `mix.exs`, PHP's `composer.json`, Dart's `pubspec.yaml`).
Others have genuinely hard edges and deserve their own design pass:

- **Java / Kotlin:** dependencies in Maven `pom.xml` (XML) or Gradle
  `build.gradle` / `build.gradle.kts` (Groovy / Kotlin DSL). Source
  imports look like `import com.example.X;` and you cannot tell
  third-party from project-local without the project's `groupId` or
  the actual classpath. Plan: parse the build file for groupId,
  treat anything matching as local.
- **C / C++:** `#include <…>` vs `#include "…"` is *not* a reliable
  signal of system-vs-project. Real distinction needs build-system
  awareness (CMake, Bazel, conan, vcpkg). Probably scan
  `conanfile.txt` / `vcpkg.json` / CMakeLists.txt for explicit
  external deps and accept that source-side `#include` cannot be
  fully classified.
- **C# / .NET:** `.csproj` is XML. Dependencies via `<PackageReference>`.
  Source-side `using` statements need namespace-vs-package mapping.
- **Swift:** `Package.swift` is *Swift code*, not a declarative
  manifest. A reliable parser needs to evaluate
  `dependencies: [.package(...)]` array literals. Source-side
  `import Foundation` etc. needs the Apple-frameworks allowlist.

When you add a plugin for one of these, write its own **PRD** under
`lib-theseus/scanners/<lang>/PRD.md` describing the parsing
strategy, the stdlib allowlist, and the test fixtures used to
validate it. This is the same standard we apply to any rewrite —
the scanner code is no exception.

### 15.4 Testing a new plugin

Build a minimal synthetic project for the language under
`$TMPDIR/lr-<lang>-test/` containing:
- A manifest with two real third-party deps and (if applicable) one
  project-local "dep."
- A source file that imports both stdlib modules and one each of
  third-party / project-local.
- A platform-exception entry to confirm the allowlist works.

Run `node /path/to/scan.js .` against it. The third-party deps
should appear in the report once each (importing twice = 2 sites of
the same package), the stdlib + project-local + exception should
not appear, and the exit code should be 1.

---

## 16. THE SHORT VERSION (ONE SCREEN)

If you read nothing else, internalize this:

1. The host project's package install (`npm install`,
   `pip install`, `cargo build`, `go mod download`, `bundle install`,
   …) must be a no-op for **every language the project uses**.
   Manifest files must contain nothing except platform exceptions
   enumerated under their language key in
   `lib-theseus/exceptions.json` and justified in §3.1.
2. To replace a package, run the seven phases in §5: **identify,
   study, write tests, implement, verify (loop on failure), document
   the PRD, cleanup.** Do not skip. Do not reorder.
3. Never copy source. Implement from spec/behavior. Treat every
   package as if it were copyleft (§6).
4. Never add a new dependency. Use the language's standard library
   or write the thirty lines yourself (§9).
5. When in doubt, **stop and ask the human.** That is always the
   correct fallback. There is no penalty for stopping. There is a
   penalty for shipping a half-rewrite, a license violation, or a
   smuggled dependency.
6. **`node lib-theseus/scan.js` must exit 0 before you call any
   change done.** The scanner is one driver and a set of language
   plugins (§14, §15); together they are the truth. If any
   language's section is non-empty, you aren't done — even if
   everything looks fine to you.

— end of protocol —
