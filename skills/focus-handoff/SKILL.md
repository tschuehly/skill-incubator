---
name: focus-handoff
description: >-
  Focused handoff: create a compact, paste-ready prompt for a fresh session working on one
  bounded subset of the current session. Use when work should spin off into a narrowly scoped
  session with only the relevant files and prior context.
---

# Focus handoff

Produce a **mission brief** for a fresh session to complete one bounded slice of the current work.

## 1. Pin the mission

Treat the user's invocation text as the intended slice. When it names a durable continuation source,
inspect that source before inferring from the conversation. Ask one short question when different
interpretations would change the task or file set.

Complete this step when the mission fits in one imperative sentence with a clear boundary.

## 2. Map the minimum context

Prefer an authoritative continuation source such as a Workstream, issue, or plan. Use it as authority
for what it states; it is sufficient only when reachable and when it supplies the bounded mission,
applicable constraints and decisions, and observable completion criteria.

Inspect the current conversation and workspace only far enough to identify:

- any domain skill the fresh session should use;
- information missing from the continuation source;
- live state that a stored checkpoint or status must be reconciled against.

Emit only the missing information. Account for current diffs when they affect the mission. If the
mission, constraints, or completion criteria remain unavailable, ask one short question instead of
producing an under-specified handoff.

Complete this step when every selected item changes how the fresh session should act and the session
can begin without broad rediscovery.

## 3. Write the mission brief

Return only one paste-ready prompt in a fenced block. When a sufficient continuation source exists,
the complete prompt contains only any required domain skill, the exact source identifier, and an
instruction to reconcile its checkpoint or stored status with live state before continuing. The
source replaces mission, file, context, and completion restatement.

When the source is insufficient, include only the missing sections from this detailed shape:

```text
<one direct paragraph>

Relevant files
- <repo-relative path> — <why to read or change it>

Context from this session
- <only a fact the source and files do not supply>

Done when
- <observable outcome>
```

Keep the complete prompt at or below 220 words. Use the smallest sufficient file set, with no entries
when the continuation source already identifies them and at most eight otherwise. Include at most
three context bullets. Name symbols or sections when they provide a better starting point than a bare
path. Replace sensitive values with the safe source from which the fresh session can retrieve them.

The brief is complete when a fresh agent can determine exactly what to do, where to start, which
prior facts matter, and how to recognize completion from the prompt and its named sources.
