# quality-loop: a gitignored file ledger is the state machine

Run state lives in `.scratch/quality-loop/<run-slug>/` — `state.json` (owned exclusively by
`ledger.sh`, which enforces slice status transitions) plus append-only `journal.md` (every
finding disposition, rejection, skip, and block, written the moment it occurs). This replaces
loop-feature's Linear labels as the durable memory and deliberately absorbs `/handoff`: any
fresh session re-enters by reading state + spec + journal tail. We considered committing the
run dir (Ralph committed its workspaces) and rejected it: loop bookkeeping in the PR diff
pollutes review, and git commits already carry the durable cross-machine truth. Consequence:
kill any session at any instant and the run continues from files alone — "if it isn't in the
ledger, it didn't happen."
