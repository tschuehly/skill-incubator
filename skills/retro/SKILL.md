---
name: retro
description: "Conduct a retrospective on a Pi session: suggest changes to the agent's environment, not the code."
disable-model-invocation: true
---

The user has asked for a **retrospective**. You suggest improvements to the agent's **environment** so future runs go better. You change nothing until the user picks a candidate.

Adapted from Matt Pocock's `retro` (mattpocock/skills 2b47ffc).

## Steps

1. Load the `writing-for-agents` skill; every candidate that edits an agent-facing document follows it.

2. **Find the session.** Default: the current one (`PI_SESSION_ID`). Otherwise use the session the user names, found with `python3 ~/IdeaProjects/pi-workbench.installed/tools/session-logs/cli.py list|read` (see its `README.md`). Never pick a session by recency alone. Done when one session id is fixed.

3. **Read it bounded.** Never load a whole session file. Check its size first; use the CLI, `jq` and `rg` slices to pull the moments that cost time: long searches, failed tool calls, repeated corrections from the user, rework, stalls. Prefer repository evidence (commits, diffs, failing checks) over the transcript's own claims. Done when each moment you'll cite has a session offset or a commit.

4. **Find candidates** in these categories:

   - **Navigation**: the agent took long to find a file or fact. Would a **navigation pointer** in `AGENTS.md`, a skill description, or a doc fix it?
   - **Automated checks**: the agent made a mistake a check could catch. Read the repo's own check commands and CI first: a check that exists but is unwired or broken is the finding, not a new one. A repo with no **guardrail** (no pre-commit hook, no CI running lint/typecheck/test) is a finding on its own.
   - **Coding standards**: `code-review` missed a mistake. A **mechanical** violation (banned API, import shape, file location) gets a deterministic check: a linter rule, hook, or CI job. Only **judgement calls** go into the repo's documented standards, which `code-review` reads.
   - **Steering files**: global or repo `AGENTS.md` instructions that belong in standards or a check instead, and **no-ops** (instructions that change no behavior).
   - **Tool economy**: expensive tool calls, oversized outputs, a tool or MCP that wastes tokens.
   - **Information access**: a fact the agent needed but could not reach (dev server logs, test DB, browser, third-party read access).
   - **Skills**: a skill that misfired, did not trigger, or was missing.

5. **Present** the candidates to the user, worst first: one line each with the category, the evidence pointer, and the concrete change (file and wording, or the check to add). Done when every candidate names its change and its evidence.

## Reference

The implementation agent carries the most **context pressure** (exploration, code, debugging); the review agent gets a diff and little else. So coding standards are enforced at review (`code-review`), not loaded into implementation.

`AGENTS.md` is in every agent's context: keep it to navigation pointers. Long reference belongs in docs or skills reached by a pointer.
