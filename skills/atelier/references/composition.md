# Composition — choosing the shape of a Surface

The kernel gives you identity, state, and behavior. It gives you no opinion about layout, and that
is the point: the material decides the shape. This is how to choose it.

## Establish four prerequisites first

1. **Human job** — what they must understand, compare, decide, annotate, or change.
2. **Content topology** — one connected argument, repeated independent items, competing
   alternatives, a sequence or dependency graph, a queue with detail, or spatial/temporal material.
3. **Visibility dependency** — which facts must stay visible together for a sound judgment, and
   which detail can be disclosed in place.
4. **Interaction granularity and scale** — what can be answered independently, how many targets
   exist, and whether the human scans, reads, or moves between them.

No composition is the default.

| Composition | Use when | Keep together |
|---|---|---|
| Fluent document | One argument builds in reading order | Prose, examples, evidence, and embedded actions |
| Worklist | Repeated items are independently understandable | One item, its state, actions, and Thread |
| Comparison | Alternatives must be judged against the same criteria | Options, criteria, differences, and consequences |
| List/detail | The human triages many records before inspecting one | Scannable list state and the selected record |
| Flow or timeline | Sequence, causality, or dependency is the judgment | Nodes, transitions, blockers, and local actions |
| Canvas or media | Position or time carries meaning | Artifact, anchors, playback or zoom, and feedback |
| Frontier | A grilling round: every open question at once | Each question with its evidence and its options |

When two compositions remain materially plausible **and would change the human's workflow**, offer
two or three concrete options before building: name the human path, what each keeps visible, and its
trade-off, and recommend one. Choose directly when the evidence favors one shape. Cosmetic variants
are presentation work, not composition options.

## Divide the material into Regions

A Region is one thing the human forms a judgment about. That is the whole test.

- **Too coarse** and a comment cannot say what it is about; a `changed` marker tells them a screen
  of material moved, so they re-read all of it.
- **Too fine** and every paragraph carries its own marker; the Surface becomes a field of badges and
  the human stops reading them.
- Give each Region a key from the **task**, never from DOM position or visual container:
  `provider`, `step-3`, `risk-budget`. The path to it is its address forever, so renaming a parent
  renames every child's Thread address.
- Nest to mirror the material, not to make the markup tidy. Nesting exists so `count` can roll up
  and so a parent can be published in one Ready.
- Regions do not need visual containers. A Region can be an `<article>`, a table row, a `<figure>`,
  or a `<section>` with nothing around it.

## Place the Thread

| Placement | Right when | Cost |
|---|---|---|
| `below` (default) | Anything the other two rows do not claim | Pushes later content down as the Thread grows |
| `side` | The content is narrow — a comparison, a list, a table — and the Thread should sit next to it | Needs ~900px; stacks below that automatically |
| `sheet` | The Region is taller than the viewport, or the human must compare two places while writing | The Thread does not exist on the page until they open it |

`below` and `side` mount a composer the human can see. `sheet` mounts nothing until they click, so a
Surface where every Region is `sheet` offers no visible place to write anywhere — which is what one
reviewed Surface did, across twelve Regions, while its human hunted for somewhere to comment.

So `sheet` is the override, and it needs a reason you could defend if asked. "Tall or dense" is not
that reason: nearly every Region an agent writes is dense, so that test picks `sheet` every time and
empties the Surface of composers. Mixing placements on one Surface is normal: `side` on the summary,
`sheet` on the one Region that genuinely runs past the viewport, `below` on the rest.

## Place Attention

- `dot` in a heading: the cheapest "something here" marker; use it on most Regions.
- `badge` (default): shows the most urgent kind and carries the ✓ that clears a change marker. Use
  it where the human is expected to act.
- `count` in a header or nav: rolls up every descendant, so one at the root is the Surface's total.
- `<atelier-cockpit>`: add one as soon as the Surface is taller than a screen or has more than a
  handful of Regions. Keep it viewport-reachable throughout the reading path in a Surface-authored
  sticky rail or compact narrow-screen bar. A dynamic Surface also registers the reveal resolver
  from [protocol.md](protocol.md#atelier-cockpit--every-open-loop) so its own filters, selection,
  and conditional Region mount run before the kernel returns to the exact interaction. Below one
  screen it repeats what the human can already see.

## Choose the message shape

Three channels, and picking the wrong one is what makes a Surface feel like chat again.

- **Reply in the Thread** when the human asked. Always the answer to their comment, never a new
  topic.
- **Update** when they need to know something and no answer is required: a batch finished, a source
  changed, six Regions were re-rendered. It is durable and dismissible; it never asks.
- **Proposal** when work cannot continue without their judgment. Name real options, put the
  recommendation first, and state what each one costs. A Proposal with one option is an Update; a
  Proposal whose answer you could have discovered yourself is a research failure, not a question.

Nothing else is a channel. If a message fits none of these, it is prose looking for a chat window.

## Reading path and decision context

Treat every control as a cold entry point.

- Define terms, symbols, option names, and prerequisite facts before first use. State shared context
  once in the reading flow, then project the relevant parts beside each affected control.
- Keep a question, its recommendation, its alternatives, their consequences, and its controls in one
  visible unit.
- Progressive disclosure moves **inward** from that complete unit — summary, then example, then
  expandable evidence — never sideways into another tab or back into the transcript.
- Read the Surface twice: once from the top, once by jumping straight to each control. Needing the
  session transcript or an unexplained label to act is a defect.
- Apply the `write-for-humans` skill to all visible copy.

## Styling

- The content library is your choice; daisyUI 5 over the Tailwind browser build is the default and
  is what `examples/` use. Tailwind's browser build watches the document, so Regions swapped in by a
  Ready are styled correctly with no extra work.
- Kernel chrome lives under `.atl-*` and is deliberately plain so it reads as protocol rather than
  content. Do not restyle it to match your theme; it is supposed to look like the frame, not the
  picture.
- Theme choice stays in authored HTML/CSS. Load daisyUI's `themes.css`, set a fixed choice with
  `<html data-theme="…">`, or author a system/light/dark control when the human's task needs one.
  The kernel's sheet and gutter use `--color-base-200` and `--color-base-content` when supplied and
  fall back to system colors; the kernel stores no theme preference.
- Preflight fails horizontal overflow at 1440 and 390. Anything that must scroll sideways — a wide
  table, a diagram — needs its own scroll container.
- A rendered diagram must mark itself `data-diagram-ready="true"`, keep prose behind
  `[data-diagram-fallback]`, and draw an SVG of a readable size. Preflight checks all three, so a
  blank box cannot reach the human.
