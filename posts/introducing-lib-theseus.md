# Introducing lib-theseus: drive your codebase to zero public dependencies

*2026-05-03*

> *If, over the years, every plank of the Ship of Theseus is replaced
> with one we built ourselves — is it still the same ship?*
> **Yes. And now it's actually ours.**

The average production application in 2026 sits on top of a few
hundred to a few thousand third-party packages. Every one of them is
a contract you signed without reading: trust the maintainer to ship
clean code, trust them to fix security issues quickly, trust them not
to disappear, trust the registry not to serve a poisoned tarball,
trust the *transitive* maintainers three levels deep not to do any of
those things either. Most of the time it works. When it doesn't, you
get an `event-stream`, a `colors`, an `xz`, a `solana-web3.js`, a
Log4Shell, an `eslint-scope` token leak, an `ua-parser-js` cryptominer,
or any of the dozen-per-year supply-chain incidents that have stopped
being newsworthy because they're routine.

[**lib-theseus**](https://github.com/rsnakeactual/lib-theseus) is a
protocol and a scanner for getting out of the contract. You replace
every public dependency with a first-party reimplementation —
behavior-equivalent, hardened against the original's CVE history,
held to a performance budget — until `npm install` (or `pip install`,
or `cargo build`, or `bundle install`) downloads nothing on a clean
checkout. The hull is the same shape. Every plank is yours.

This isn't about hand-rolling everything from scratch on day one.
It's about a structured, defensible *path* from "we depend on 200
public packages" to "we depend on zero," with a seven-phase procedure,
machine-checked test suites, and an audit trail you can hand to a
compliance officer.

---

## What lib-theseus actually is

Three artifacts in one repo, all under MIT, with the scanner itself
having zero dependencies of its own (the tool eats its own dog food):

- **A protocol** (`PROTOCOL.md`) — the seven-phase procedure for
  replacing a single library. Identify → study → write tests (parity,
  abuse, *and* performance) → implement → verify → write the PRD and
  the `theseus.json` provenance record → cleanup. Each phase has
  explicit "done when" criteria. The licensing safety section tells
  you exactly what to do (and what *not* to do) to stay clean of
  copyleft contamination.
- **A scanner** (`scan.js`) — a polyglot, language-agnostic driver
  with one plugin per ecosystem. v1 ships nine: JavaScript /
  TypeScript / HTML, Python, Rust, Go, Ruby, Java / Kotlin, C / C++,
  C# / F# / VB.NET, and Swift. The scanner walks any project tree,
  reports every reference to a third-party package (imports,
  manifest entries, CDN tags, `node_modules`-relative loads, the
  works), validates the `theseus.json` records for libraries you've
  already replaced, and exits 1 until the project is clean. Drop it
  in a CI pipeline.
- **A Claude Code skill** — for teams using LLM-assisted development,
  the protocol ships as a Claude skill. `/lib-theseus` walks an LLM
  through the seven-phase procedure, refusing to skip steps and
  refusing to introduce new dependencies along the way. The skill is
  the operational embodiment of the protocol; the protocol is the
  spec the skill follows.

`PROTOCOL.md` is the contract. `scan.js` is the enforcer. The skill
is the assistant. None of them is magic; the work is real
engineering. The protocol just structures the work.

---

## What it enables

### 1. Future CVEs against versions you never installed simply don't apply to you

The CVE database lives on `package@version` matches. When `marked@9.1.7`
gets a CVE filed against it next year, every project that has
`"marked": "^9"` in their lockfile gets a finding — including the
projects nobody is actively maintaining, the projects whose CI
notification was muted, the projects whose lead developer left and
nobody has the keys anymore. lib-theseus removes you from that
mailing list. There is no `marked@9.x` in your lockfile because there
is no `marked` in your lockfile. You wrote a `Markdown` class. It
parses CommonMark from the spec. It does not exhibit the CVE,
because the CVE was about an implementation detail of `marked`'s
tokenizer that you never wrote.

This is the **biggest single benefit**, and it's the easiest one for
people new to the idea to dismiss as cosmetic. It is not cosmetic. It
is the difference between getting paged at 3 AM because someone
shipped a `marked` patch through three layers of transitive
dependencies and *nothing happening to you because the package isn't
in your tree*.

### 2. Code that isn't used can't have a vulnerability that's later exploited

A typical npm package exports 80+ functions. Your project uses 4. The
remaining 76 are dead code in *your* deployment, but they're alive
code in *your binary*: they're loaded, they're parseable, they're
reachable through the package's surface area, they're available to
anyone who finds a way to call them. When a CVE drops against one of
those 76 functions next year — perhaps an obscure HTML escaping
function that a clever attacker found a way to reach via prototype
pollution — your project is vulnerable, even though *your code never
called the buggy function*.

lib-theseus's protocol mandates **minimum viable surface**: you
implement the 4 functions you use. The other 76 don't exist in your
tree. They can't have CVEs because they aren't there. Your attack
surface is exactly the surface you actually use, with nothing extra
to be exploited later.

### 3. Real, currently-known vulnerabilities get rewritten away

The protocol's Phase 3b (abuse cases) requires you to look up every
CVE in the studied version's history, write a test that reproduces
each attack, and assert your implementation does not exhibit it. So
when you replace `marked@18`, you write a ReDoS test that
demonstrates the original `marked@<4.0.10` was vulnerable to
catastrophic backtracking on crafted headings, and that asserts your
linear-time tokenizer is not. You are *actively engineering against*
the original's bug history.

A side-effect: your implementation often comes out *better than* the
original. You knew the bugs going in. The original's maintainers
fixed them after they happened.

### 4. Vulnerabilities that remain become harder to find

Every public CVE database — the npm advisory DB, OSV, GHSA, MITRE —
indexes by package name and version. An attacker scans your
`package-lock.json` (or your build pipeline output, or a leaked
manifest), finds known-vulnerable versions, picks one, walks in.
This is how most supply-chain post-exploitation actually works in
2026. It is automated, it is scripted, and it is fast.

When your lockfile says `dependencies: {}`, that workflow goes from
"automated grep" to "actually understand the application." Real
zero-day research against a custom in-tree implementation is
expensive. It requires reading and understanding *your* code, not
running someone else's exploit script. **Security through obscurity
is not a defense in depth** — it is a *layer* of defense in depth,
and it's a layer that lib-theseus turns on for free as a side-effect
of the rewrite.

### 5. Compliance becomes much easier

Most compliance regimes that touch software (SOC 2, ISO 27001,
HIPAA, PCI-DSS, the EU CRA, FedRAMP) have some equivalent of
"maintain an inventory of third-party software components." When
that inventory is empty, the question shrinks. SBOMs become almost
trivial — you have one component, your application, with a curated
list of `theseus.json` records describing the libraries you
*used to* depend on and the spec each in-tree replacement
implements. License review becomes "read your project's LICENSE";
there's no transitive surprise. Vendor risk assessment of your
dependencies becomes "we have none."

This is, frankly, the benefit that pays for the work in regulated
industries. Auditors stop asking about your `package.json`.

### 6. You stop being one `npm publish` away from a bad day

The most under-appreciated benefit isn't security; it's
*organizational*. Your shipping cadence stops being coupled to
upstream maintainers' shipping cadence. You don't need to track
their breaking changes. You don't need to migrate when they decide
to renumber their major version. You don't need a designated
"dependency-update PR" person. The library does what your project
needs it to do. When your project's needs change, you change the
implementation. There's no "we can't upgrade because the new major
breaks our usage" in a tree where every library is in your tree.

---

## What it costs (and where it can hurt)

This is the section where people who've actually shipped software
nod and the people who haven't say "wait, that's a downside?" The
benefits above are real. The costs are also real.

### You still need SAST. Possibly more than before.

The "obscurity" benefit cuts both ways. When you depended on
`requests`, the entire security research community was looking at
`requests` for bugs. Your code, post-rewrite, has exactly *one*
security researcher: you. Or your team. Or the one consultant you
hire annually.

That's a smaller pool of eyeballs. The mitigation is **static
analysis** (CodeQL, Semgrep, SonarQube, Snyk Code, GitHub
Advanced Security, etc.) plus **fuzzing** plus **periodic
manual review**. lib-theseus is not a substitute for those tools;
it's a substitute for the *transitive-dependency CVE noise* that
those tools used to compete with for attention. The signal-to-
noise ratio of your security tooling improves; the *amount* of
work doesn't decrease, it just shifts.

If your team isn't running SAST today, it should not start a
lib-theseus rewrite. Do SAST first. Then come back. The
sequence matters.

### You will introduce new bugs

A reimplementation is new code. New code has bugs. The protocol's
Phase 3 (test cases) is the structural defense — parity tests
against the original, abuse tests against the CVE history,
performance tests against measured baselines — and it's a real
defense, but it's not perfect. You will ship a bug your tests
didn't catch, eventually. Probably more than one.

The honest assessment is that the bugs you ship in your
reimplementation are typically *less severe* than the CVEs you avoid
by not using the original (because most CVEs are in obscure code
paths that nobody uses, while your bugs are in the code paths your
users actually exercise, where they're caught early). But "less
severe on average" is not "zero," and a team that pursues
lib-theseus needs an active QA + observability + bug-bash discipline.
This work is for teams that ship software to themselves carefully,
not teams that ship-and-pray.

### Copyleft / copyright is real, and *I am not a lawyer*

This is the section where you need real legal advice, not advice
from a blog post. The lib-theseus protocol is structured to keep you
out of trouble, but the protocol is not a guarantee, and the
guarantee is what your lawyer signs off on, not what I or anyone
else writes here.

The protocol's discipline is:

- **Never copy source from any package, regardless of license.** Not
  to scaffold, not as a starting point, not as a comment with
  attribution. The implementation is written from the public
  *specification* (RFC, WHATWG standard, language grammar) or from
  observed input/output behavior, not from the original's source.
- **For copyleft licenses (GPL/LGPL/AGPL/MPL/EPL), do not read the
  source at all.** Use the spec only. This is the standard "clean
  room" discipline.
- **For permissive licenses (MIT/BSD/ISC/Apache-2.0), reading for
  understanding is allowed, transcribing is not.** When in doubt,
  treat it like copyleft.
- **Record the original's license in `theseus.json`** under the
  `license.confirmation` field, including a one-sentence statement
  of *how* the implementation was derived. The scanner enforces
  this field on every run.

That's the structural discipline. It's not legal advice. **IANAL.**
Different jurisdictions handle clean-room reimplementation
differently. Different licenses have different reach (the AGPL's
network-use clause is a famous gotcha). If your project is
revenue-generating, talk to a real lawyer before publishing
something derived from a copyleft dependency, even via the protocol.
The protocol gives you a clean process and an audit trail; what it
doesn't give you is a substitute for jurisdiction-specific legal
review.

### Maintenance ownership is forever

You now own the code. When the spec evolves, *you* track it. When a
new abuse case emerges in the wild, *you* test for it. When the
performance budget needs to be re-measured on new hardware, *you*
do the re-measurement. The `theseus.json` records and the per-library
PRDs make this manageable — they document everything you'd need to
remember — but the maintenance bill doesn't go to zero. It goes
*to you*.

For libraries with active upstream maintainers fixing bugs and
adding features you'd actually want, this is a real cost. For
libraries that are essentially feature-complete (a markdown parser, a
YAML reader, a CRC implementation), the cost is low. The protocol's
Phase 1 (Identify) plus the Inventory's status-flipping discipline
helps you triage which libraries are worth replacing first; the ones
where upstream is doing useful work for you are not the ones to
prioritize.

---

## Who this is for, and who it isn't

**Probably for you if:**

- You ship security-sensitive software (financial, healthcare,
  identity, defense, anything regulated).
- You operate in an air-gapped or restricted-network environment
  where `npm install` is itself a hard problem.
- Your auditors keep asking about your `package.json` and you
  keep wishing they'd stop.
- Your supply-chain CVE noise is drowning out your actual security
  signal.
- You have an LLM-augmented engineering org and the cost of
  reimplementing a 500-line library has dropped below the cost of
  reviewing a major version upgrade.

**Probably not for you if:**

- You're a small team shipping a CRUD app where supply-chain risk is
  not your top-N security concern. Use `npm audit` and patch
  dependencies; that's good enough.
- You depend on a library where the public API is huge and
  shifting (think: a full UI framework, a database driver for a
  hundred backends, a browser-grade TLS stack). The minimum-viable-
  surface argument breaks down when the surface itself is moving.
- You don't have static analysis or any active QA discipline. Fix
  that first.

---

## Get started

```sh
# As a Claude Code skill (one-line install for Claude users):
git clone git@github.com:rsnakeactual/lib-theseus.git ~/.claude/skills/lib-theseus

# Manually (any Node 18+ environment):
git clone git@github.com:rsnakeactual/lib-theseus.git
cp -r lib-theseus/lib-theseus /your/project/lib-theseus
cp /your/project/lib-theseus/exceptions.example.json /your/project/lib-theseus/exceptions.json
node /your/project/lib-theseus/scan.js
```

The first scan will tell you exactly which packages exist in your
tree and surface them grouped by language. That output is your
inventory and your roadmap. Pick the easiest single-purpose library
first (a frontmatter parser, a UUID generator, a date library —
something with a small spec and a clear contract). Walk it through
the seven phases. Ship it. Run the scanner. Watch one row disappear
from the report. Pick the next one.

The repo is MIT-licensed and lives at
[github.com/rsnakeactual/lib-theseus](https://github.com/rsnakeactual/lib-theseus).
Issues and PRs welcome. The one rule that applies to contributions
is the rule the protocol enforces: any PR that adds a public
dependency to the scanner or its plugins will be rejected. The
scanner needs to live by the rule it enforces.

---

— *Robert "RSnake" Hansen*
