# Quality Loop

The Quality Loop builds a substantial system change while the human controls architecture and
delivery. The human approves the system design before implementation and accepts the resulting
system before the final integration PR. Agents implement, test, and review routine code between
those gates.

## Run the Quality Loop

Install the skill into the active runtime:

```sh
./link.sh quality-loop
```

Then invoke:

```text
/quality-loop <outcome, discovery brief, or GitHub Issue>
```

The active runtime supplies collaborators and model bindings. The Quality Loop owns the durable
Run, human gates, semantic Chapters, evidence, and delivery state.

## Human gates

The Run has two mandatory human gates:

1. **Design Atelier:** approve the specification, domain model, architecture, risks, and semantic
   Chapter plan. Product code remains unchanged until the exact Surface revision is approved.
2. **System Story Atelier:** understand and accept the resulting architecture, behavior, semantic
   trace, and evidence. The final integration PR remains closed until the exact Surface revision is
   accepted.

The human also owns mode changes, Decision Inbox answers, provisional-ADR ratification, material
deviations, and the final merge.

The Driver operates each ready Surface through Atelier's documented protocol and one
monitor-owned poller or Atelier's documented `--once` fallback. Human approval buttons post
`/api/event` with `wake:true` and the reviewed revision; the Driver never edits the store directly.

## Autonomous middle

After Design approval, the loop repeatedly selects the dependency-ready semantic Chapter and:

1. captures any configured broad baseline at the untouched Chapter base;
2. implements it with a valid RED and minimal coherent GREEN under an exclusive workspace lease;
3. runs configured verification, comparative baseline policy, and any explicit numeric change-size gate;
4. generates deterministic change-shape evidence and dispatches the risk-adaptive independent review board;
5. verifies every finding with quoted evidence;
6. applies routine fixes and one final Craft pass;
7. passes deterministic delivery preflight;
8. integrates locally or through an approved focused PR boundary.

A Chapter is a coherent, independently testable part of the system story. It is not a file group,
workflow phase, or automatic PR.

## Decisions and deviations

In Supervised mode, contained choices enter the batched Decision Inbox and block only affected
Chapters and their dependents. Independent Chapters continue.

AFK mode requires a human-approved decision envelope for the current Design revision. Inside that
envelope, the loop may select a conservative reversible option and record a provisional ADR.
Delivery waits until the human ratifies or revises every provisional ADR.

A changed invariant, scope, architecture route, product behavior, or high/critical impact is a
material deviation. It freezes the Run and returns to the Design Atelier. Execution resumes only
after approval of the revised Design and explicit resolution of the deviation.

## Durable dispatch

The Run Record lives under `.scratch/quality-loop/<run-slug>/`. `state.json` is written only by the
Ledger. Immutable gate logs and manifests live under `evidence/<chapter>/`. Approved artifacts,
stable keys, decisions, evidence, and journal entries survive context and session boundaries.
Atelier state remains durable in its store; a resumed Driver health-checks the server, reads open
review work, and restores the URL-bound monitor poller.

On every invocation, the Driver runs:

```sh
skills/quality-loop/scripts/next.sh [<run-dir>]
```

The command prints the authoritative action, expert reference, Run directory, and Chapter when
applicable. Every Run binds the active session id and expected semantic scope before work. Design, every
Chapter, System Story, and delivery use separate sessions. At a required boundary, `RESUME` is the
concise Run handoff; the fresh session binds its scope through the Ledger.

## Mechanical guarantees

The scripts enforce:

- Design approval before Chapter execution;
- fresh-session scope binding between Design, Chapters, Story, and delivery;
- rejection of reusing one bound runtime session id across semantic scopes;
- dependency order and selective decision blocking;
- valid RED and GREEN evidence plus durable baseline/comparison attempt logs;
- review-round limits and any explicitly configured numeric change-size limit;
- monotonic impact and material-deviation freezes;
- AFK envelope, ADR budget, and ratification requirements;
- accepted System Story before final delivery;
- passing CI and external-review evidence before completion.

Reviewer isolation, finding quality, and the judgment that an AFK choice is conservative and
reversible remain semantic responsibilities. The journal, evidence, and System Story expose them
for human audit.
