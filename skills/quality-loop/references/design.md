# Issue and Design

Use this reference for `initialize` and `design` actions from `scripts/next.sh`.

## Optional discovery

Run `/grill-me` first only when the outcome is fuzzy, crosses several domain or architecture
boundaries, or contains unresolved human decisions. Produce a bounded decision brief. Do not create
the Run Record, branches, Chapters, or implementation approval during discovery.

Start the Quality Run directly for a clear bounded outcome or a sound existing Issue.

## Project configuration

Read `<repo>/.claude/quality-loop/project.md` before creating the Run. Require it to define:

- repository, Issue labels, target branch, integration-branch convention, and focused-PR criteria;
- verification order, test command, change-size policy, critical-evidence policy, browser checks,
  and external-review poller; the change-size policy is either reviewer judgment or an explicit
  numeric budget with exclusions—never an implicit workflow default;
- security surfaces, criticality rubric, and impact rules for architecture, public APIs,
  persistence, concurrency, destructive behavior, money, consent, secrets, and agent routing;
- domain glossary or `CONTEXT.md`, ADR directory, commit rules, and project skills.

Derive discoverable values from project instructions. Ask only for choices that materially change
the workflow, then write and confirm the configuration before continuing.

## Initialize the Run

1. Create or adopt one GitHub Issue from [templates.md](templates.md).
2. Set `QL_RUN_DIR=.scratch/quality-loop/<run-slug>` and run
   `<skill-dir>/scripts/ledger.sh init <run-slug>`.
3. Record the Issue and integration branch, then create that branch from the configured target.
4. Gather facts from code and domain documentation. Resolve checkable facts yourself; expose only
   genuine choices to the human.
5. Create the Design Atelier defined in [surfaces.md](surfaces.md) and record its URL and store with
   `ledger.sh design surface`.

## Design the semantic build path

Produce `spec.md`, `design.md`, `concepts.md`, `timeline.md`, and Chapter drafts.

- Specify behavior, boundaries, exclusions, acceptance criteria, and behavioral seams.
- Define components, relationships, flows, invariants, risks, and verification seams.
- Give every concept and architecture element a stable key.
- Plan dependency-ordered Chapters as coherent, independently testable parts of the system story.
  Use vertical tracer bullets; use expand-contract Chapters for wide refactors.
- Record each Chapter’s purpose, behavior, concept and architecture keys, invariants, acceptance
  criteria, test matrix, dependencies, criticality, impact, change-size policy, and any genuine
  focused-PR boundary.

Register and revise the plan only while Design is open:

```sh
<skill-dir>/scripts/ledger.sh add-chapter <id> <criticality> <impact> [<blocked-by-csv>]
<skill-dir>/scripts/ledger.sh chapter <id> links <concepts-csv> <architecture-csv>
<skill-dir>/scripts/ledger.sh chapter <id> plan <criticality> <impact> [<blocked-by-csv>]
<skill-dir>/scripts/ledger.sh timeline proposed <chapter-csv>
```

## Design gate

Pause until the human understands and approves the current Design Atelier revision. Treat shape
confirmation or partial feedback as insufficient. Record the exact approved revision with
`ledger.sh design approve <revision>`; the Ledger freezes the plan digest.

An approved Design is stable. When execution discovers changed product behavior, scope, invariants,
architecture route, or high/critical impact:

1. Record the deviation immediately.
2. Block affected execution.
3. Run `ledger.sh design reopen <deviation-id>` and return the evidence, alternatives, and
   recommendation to the Design Atelier.
4. After the human approves the revised Design, resolve every material deviation against that exact
   revision and resume blocked Chapters explicitly.

Do not classify ordinary test failures, implementation details, refactoring choices, or routine
review findings as material unless they imply a semantic change.
