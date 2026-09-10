# Craft apply pass — curated checklist

The single post-review refactoring step, run **once** after the review board is clean — not a lens
on the board and never a blocking gate. Distilled from Clean Code, The Pragmatic Programmer, and
Fowler's Refactoring — the items that survive contact with real diffs. It ranks suggestions for the
`/simplify` apply pass. A finding must name a concrete defect a maintainer would hit — "I'd have
written it differently" is not a finding. Suggestions must preserve behavior exactly; anything that
changes behavior is a Correctness matter, not this pass.

## Naming & intent

- Names say what, not how: `getOrCreatePolaroid`, not `handlePolaroid`. Rename beats comment.
- One word per concept per codebase (don't mix `fetch`/`retrieve`/`get` for the same idea).
- Boolean names read as predicates (`isExpired`, `hasSubmission`) and are positive, not negated.
- No comment that restates the code; comments state what the code *can't* (constraints, why).

## Functions & shape

- A function does one thing at one level of abstraction; mixed altitude (business rule +
  string formatting in one body) is the smell that matters, not raw length.
- Flag arguments split behavior — prefer two functions over `doThing(flag = true)`.
- Guard clauses over nested conditionals; early return over accumulator flags.
- Command/query separation: a function that returns a value shouldn't also mutate.

## Coupling & knowledge (Pragmatic Programmer)

- DRY is about *knowledge*, not text: two similar-looking blocks encoding different decisions
  may stay; one business rule encoded twice may not — even if the code looks different.
- Law of Demeter for chains that reach through layers (`a.b().c().d()` across module
  boundaries); chains inside one data structure are fine.
- Orthogonality: would this change force edits in unrelated modules? Name the coupling.
- No broken windows: if the diff touches a line adjacent to obvious rot, fixing it in-Chapter
  is in scope only when trivial; otherwise journal it as follow-up, don't churn.

## Errors & honesty

- Crash early beats limp on: a violated invariant throws at the boundary, not three layers in.
- Don't return null where a type can say more (sealed result, empty collection, Optional).
- Exceptions carry context (ids, state) — a bare `IllegalStateException("error")` is a defect.

## Tests as design feedback (advisory here; blocking lives in the Test Adversary)

- A test that needs three mocks to compile is telling you about coupling, not testing.
- Test names state behavior, not method names: `rejects expired magic link`, not `testAuth2`.

## Fowler smell baseline (Refactoring, ch. 3)

A fixed vocabulary of smells matched against the diff — invoke the *names*; the reviewer
already knows the concepts deeply, the label is what activates them. Each reads *what it
is* → *how to fix*. Where a smell overlaps a section above, the section's nuance refines it.

- **Mysterious Name** — a function, variable, or type whose name doesn't reveal what it does
  or holds. → rename it; if no honest name comes, the design's murky.
- **Duplicated Code** — the same logic shape in more than one hunk or file of the change.
  → extract the shared shape, call it from both. (Refined by DRY-as-knowledge above: two
  similar blocks encoding *different decisions* may stay.)
- **Feature Envy** — a method that reaches into another object's data more than its own.
  → move the method onto the data it envies.
- **Data Clumps** — the same few fields or params keep travelling together (a type wanting
  to be born). → bundle them into one type, pass that.
- **Primitive Obsession** — a primitive or string standing in for a domain concept that
  deserves its own type. → give the concept its own small type.
- **Repeated Switches** — the same `switch`/`if`-cascade on the same type recurs across the
  change. → replace with polymorphism, or one map both sites share.
- **Shotgun Surgery** — one logical change forces scattered edits across many files in the
  diff. → gather what changes together into one module.
- **Divergent Change** — one file or module edited for several unrelated reasons. → split so
  each module changes for one reason.
- **Speculative Generality** — abstraction, parameters, or hooks added for needs the Spec
  doesn't have. → delete it; inline back until a real need shows.
- **Message Chains** — long `a.b().c().d()` navigation the caller shouldn't depend on.
  → hide the walk behind one method on the first object. (Refined by the Demeter rule above:
  chains inside one data structure are fine.)
- **Middle Man** — a class or function that mostly just delegates onward. → cut it, call the
  real target direct.
- **Refused Bequest** — a subclass or implementer that ignores or overrides most of what it
  inherits. → drop the inheritance, use composition.

## Discipline for this pass

- Max 10 findings per Chapter, ranked by maintainer pain. Below the cut → silence, not noise.
- A documented deliberate choice (doc-comment, ADR, CLAUDE.md rule) is out of bounds — where
  the repo endorses something a baseline smell would flag, suppress the smell.
- Every baseline smell is a labelled judgement call ("possible Feature Envy") — name the
  smell in the finding summary; never present one as a hard violation.
- Skip anything tooling (lint, formatter, compiler) already enforces.
- Suggestions must preserve behavior exactly — anything else belongs to the Correctness lens.
