# System Story and delivery

Use this reference for `story`, `delivery`, and `done` actions from `scripts/next.sh`.

## Begin the System Story

Run `<skill-dir>/scripts/ledger.sh story begin` only after every Chapter is integrated, material
deviations are resolved, Decision Inbox entries are answered, and provisional ADRs are ratified or
revised. The Ledger must refuse the transition when any condition is missing.

Build the System Story Atelier from the approved Design and semantic trace recorded during
execution, following [surfaces.md](surfaces.md). Do not infer intent from the final diff.

Present these layers:

1. **Map:** resulting concepts, components, boundaries, relationships, and impact distribution.
2. **Story:** what the system does and why.
3. **Chapters:** semantic changes, rationale, affected concepts, and outcomes.
4. **Timeline:** proposed and actual dependency-ordered build paths plus deviations.
5. **Evidence:** behavior-linked tests, gates, runtime observations, and focused excerpts.
6. **Raw:** complete diff, collapsed by default.

Expand code automatically only for high- and critical-impact Chapters. Show the smallest excerpt
that proves each architectural claim while keeping the complete diff accessible.

## Understanding gate

Pause until the human understands and accepts the resulting architecture, behavior, evidence, and
material deviations. Record only the exact accepted Surface revision with
`ledger.sh story accept <revision>`. Partial review or revision acknowledgement is not acceptance.

## Final integration PR

Run:

```sh
<skill-dir>/scripts/delivery-preflight.sh final \
  --default-branch <name> --target <target>
```

After it passes:

1. Push the integration branch and open one final integration PR using [templates.md](templates.md).
2. Link the GitHub Issue and both Atelier records. Mirror the System Story in the PR summary; keep
   the full diff for traceability.
3. Record the PR with `ledger.sh final-pr open <number>`.
4. Service CI and external review autonomously. Classify every comment, fix or refute it with
   evidence, and record CI, review evidence, and feedback rounds.
5. Reopen the relevant semantic deviation and Atelier gate for comments that change intent.
6. Mark the PR ready only after CI and external-review evidence pass.
7. Run `ledger.sh finish` only when the PR is decision-ready. Leave the merge to the human.

For `done`, report the Issue, accepted Design and Story revisions, integration branch, final PR,
and any audit-relevant decisions. Perform no further delivery action.
