---
name: write-for-humans
description: >-
  Minimize reader effort when creating or reviewing substantial human-facing prose while
  preserving technical depth and meaning. Use for fidelity-sensitive adaptations and alongside
  format-specific skills.
---

# Write for humans

Minimize the reader's effort to find the point, understand it, and act on it. Make the text:

- **relevant:** it serves the reader's goal;
- **findable:** its answer, evidence, and actions are easy to locate;
- **understandable:** its language and relationships are clear to the intended reader;
- **usable:** the reader can decide, act, or continue without reconstructing missing context.

## 1. Model the reader

Before drafting, infer from the request and available context:

- what the reader wants to understand, decide, or do;
- what the reader probably already knows;
- which facts, terms, and constraints are new to them;
- how much detail they need now.

Match the language to the reader's knowledge rather than to superficial vocabulary. Preserve
expert depth for expert readers. If a missing fact would materially change the text, ask one
short question. Otherwise, choose a reasonable reader model and proceed.

This step is complete when the reader's goal, knowledge, needed detail, and material unknowns
are explicit enough to guide the draft.

## 2. Draft by reader value

Apply every relevant rule below.

### Make the point findable

- Open with the answer for a question, the outcome for completed work, or the required action
  for instructions. When the answer is a command, path, value, or snippet, put it in the first
  line and let prose follow it.
- Start on the substance. Delete an opening sentence that announces what you are about to say
  or do ("Great question", "Let me look at", "To answer your question").
- Give each paragraph one job and put its point near the beginning.
- Use short, descriptive headings when readers may scan or return to the text.
- Put prerequisites before the action that needs them and warnings beside the affected step.
- Separate the critical path from background, alternatives, and optional improvements.
- For long text, provide a concise orientation that identifies the important sections without
  repeating the full conclusion.

### Write clearly

- Use common, concrete words and direct sentence structures.
- Keep necessary technical terms. Define an unfamiliar term on first use, then use it
  consistently.
- Expand an unfamiliar acronym on first use.
- Make implied relationships explicit: who does what, what causes what, which condition
  controls an action, and what pronouns refer to.
- Use useful repetition when it prevents ambiguity.
- Use literal language for instructions, warnings, decisions, and other text where an implied
  meaning could mislead. Use a metaphor only when it improves understanding and explain it
  when the reader may not share it.
- Write UI and status copy from the reader's vantage point: state what happened or what the reader
  can do, not what was attached to, sent to, or received by the agent. Reserve system and transport
  language for developer-facing documentation and logs.
- Use connected prose for explanations, bullets for choices, and numbered lists for steps.
- Keep the tone direct, calm, and respectful. Describe the actual effort instead of labeling a
  task “easy” or “simple.”
- Report a failure matter-of-factly: where it happened, the cause, and the fix. Say “Test fails
  at `auth.spec.ts:42`: expected 200, got 401. Cause: missing auth header. Fix: add the
  `Authorization` header to the request,” not “Uh oh, there seems to be a problem.”

### Make action easy

- Before a multi-step procedure, state its goal and observable completion result. Include
  prerequisites, required resources, or a brief overview when the reader needs them. Give an
  effort or time estimate only when evidence supports it; state the assumptions and use a range
  when uncertainty matters. State it in concrete units: “about 15 minutes if tests already cover
  this, an afternoon if not,” never “some work” or “a bit.”
- Give each numbered step one bounded action. Include necessary intermediate steps rather than
  making the reader infer them.
- Use the fewest steps that still work. Fold a trivial step into the one before it and cut a
  step the reader does not need. A short path finished beats a complete path abandoned.
- Keep the critical path short. Group branches as conditions: “If X, do Y.”
- Show exact commands, values, locations, and expected results where they help the reader act.
- When several items compete for attention, separate what to do now from what can wait. Rank a
  competing list and keep about five items in view; move the rest to “later.”
- When work remains, end with one obvious next action, small enough to start in under two
  minutes. When the task is complete, end with the result rather than a ceremonial closing.

### Reduce memory work

Keep the information needed for an action on screen and near that action. Prefer explicit nouns
over ambiguous references to earlier text. In a continuing exchange, restore only the state
needed to resume: what is complete, the current position, and the next move. Name the position
concretely: “Step 3 of 5 done: schema updated. Next: backfill the new column.” When a task or
plan tool is available, let its checklist carry the state instead of narrating the plan as prose.

Make progress visible in concrete terms. Say what now works, what remains blocked, or which
artifact changed, and how the reader can see it. Finish the reader's primary goal before raising
a discovered second issue, then raise it once, as its own question. Answer a mid-work question
yourself when you can and fold the result in.

### Explain in a useful order

For a concept, give the direct answer or mental model, then one concrete example, then explain
how it works. Put limits, trade-offs, edge cases, and formal detail after the core idea.

For instructions, apply the action and memory rules above in execution order.

### Preserve meaning

Preserve every needed condition, exception, number, unit, warning, uncertainty, scope boundary,
and causal link. Keep a rewrite at the source's level of detail unless the reader asks for a
summary. Pair precise wording with a plain explanation when plain wording alone would weaken the
claim.

When adapting source material, run a separate fidelity pass. Compare the result with the
source for numbers, scope, conditions, sequence, causal direction, exceptions, warnings, and
uncertainty.

For documentation, describe only the supported current workflow and intended state, and use
interface and code terms exactly.

This step is complete when the draft applies every relevant rule and preserves the required
meaning, scope, and detail.

## 3. Verify from the reader's position

Before finishing, silently check:

- Can the intended reader understand the first paragraph without hidden context?
- Is the main point easy to find?
- Are unfamiliar terms, pronouns, conditions, and expected results clear?
- Is each instruction independently visible, bounded, and complete?
- Can the reader identify the next action or the completed result?
- Can the reader resume without reconstructing relevant state from earlier messages?
- Is every detail useful for the reader's goal?
- Can any sentence or section be removed without losing necessary meaning or usability?
- Did the text preserve the source's scope and meaning?

Then delete before sending:

1. A first sentence that announces what you are about to say or do.
2. A closing recap of work the text already showed, and closing pleasantries (“Hope this helps,”
   “Let me know if you need anything else”).
3. Any “by the way” sidebar.
4. Hedging that carries no uncertainty. Keep a hedge that reports real uncertainty; removing it
   manufactures confidence.
5. Idioms and figurative phrases in instructions (“circle back,” “get the ball rolling”). Use
   the literal action instead.

Finally, read only the first line and the last line: together they should still tell the reader
what happened and what to do next.

Keep the checklist internal. Revise until every applicable check passes or report an unresolved
constraint explicitly.

For a draft of at least 800 words, a fidelity-sensitive adaptation, or a consequential decision,
follow [`references/independent-review.md`](references/independent-review.md). For content that
claims cognitive accessibility, validate with representative users; model review is
comprehension and fidelity evidence, not accessibility evidence.

Verification is complete when every applicable check passes, every blocking independent-review
finding is resolved, any required representative-user validation is complete, and any remaining
constraint is visible to the reader. If representative-user validation is unavailable, remove
the cognitive-accessibility claim or label it as unvalidated.

## Foundations

When evaluating or changing this skill's principles, consult
[`references/foundations.md`](references/foundations.md) for their sources, scope, and authority.
