# Composition — choosing the shape of a Surface and writing its copy

The kernel has no opinion about layout; the material decides the shape. Runnable starting points
are in `recipes/`: `list-detail.html`, `document.html`, `frontier.html`, and
[diagram-and-files.md](../recipes/diagram-and-files.md).

## Choose the composition

Establish four things first:

1. **Human job** — what they must understand, compare, decide, annotate, or change.
2. **Content topology** — one connected argument, repeated independent items, competing
   alternatives, a sequence or dependency graph, a queue with detail, or spatial/temporal material.
3. **Visibility dependency** — which facts must stay visible together for a sound judgment, and
   which detail can be disclosed in place.
4. **Interaction granularity and scale** — what can be answered independently, how many targets
   exist, and whether the human scans, reads, or moves between them.

No composition is the default.

| Composition | Use when | Keep together | Host placement |
|---|---|---|---|
| List/detail | The human triages many records before inspecting one | Scannable list state and the selected record | One per record, inside it; a reveal resolver selects the record |
| Worklist | Repeated items are independently understandable | One item, its state, actions, and Thread | One per item, under it |
| Fluent document | One argument builds in reading order | Prose, examples, evidence, and embedded actions | One `layout="anchored"` host beside the text |
| Comparison | Alternatives must be judged against the same criteria | Options, criteria, differences, and consequences | One under the comparison, or one per alternative |
| Flow or timeline | Sequence, causality, or dependency is the judgment | Nodes, transitions, blockers, and local actions | One per stage, beside or under it |
| Canvas or media | Position or time carries meaning | Artifact, anchors, playback or zoom, and feedback | One beside the artifact |
| Frontier | A grilling round: every open question at once | Each question with its evidence and its options | One directly under each questioned passage |

When two compositions remain plausible **and would change the human's workflow**, offer two or
three concrete options before building — the human path, what each keeps visible, its trade-off —
and recommend one. Otherwise choose. Cosmetic variants are presentation work, not options.

Use the screen: a workspace fills the viewport and scrolls inside its panes; prose caps its line
length at about 75ch while tables, diagrams, and diffs take their full width. Any CSS works — the
recipes use plain CSS, and a library such as daisyUI over the Tailwind browser build also works,
because kernel chrome carries its own styles. Anything wider than a phone needs its own
`overflow-x: auto` container; preflight fails horizontal overflow at 1440, 390, and 412 px.

### Divide the material into Regions

A Region is one thing the human forms a judgment about. That is the whole test.

- **Too coarse** and a changed marker tells them a screen of material moved; a Proposal about one
  item has no item to sit on. **Too fine** and changed markers fragment until nobody reads them.
- Make each item the human can answer on its own — a record, a check row, a setting value, an
  option, a step — its own Region.
- Give each Region a key from the **task**, never from DOM position: `v03`, `safe-zone`,
  `cutover`. The path is its address forever, so renaming a parent renames every child's address.
- `atl-key` goes on whatever element already holds the item — a row, a list item, an article, a
  diagram box. No wrapper is needed.

### Choose the form

Before writing prose, ask what shows the material best:

| Material | Form |
|---|---|
| A flow, pipeline, sequence, state machine, or timeline | Mermaid, as a [flow explainer](#flow-explainer) |
| Options judged on shared criteria | A table, one row per option |
| Numbers, or settings × values | A Vega-Lite chart or heatmap |
| A graph whose layout matters, or whose every node carries a Thread | Graphviz |
| Before and after | Two columns side by side, changes marked in both |
| A UI, interaction, or state change | A click-through prototype or embedded app |
| Media, layout, or a visual defect | The image or frame itself, with Threads on points |
| Proof that a change works | An [evidence review](#evidence-review) |
| One argument that builds | Short prose with examples beside the claims |

Diagram and file-viewer snippets: [recipes/diagram-and-files.md](../recipes/diagram-and-files.md).

### Evidence review

When a worker shows that a change works, the human accepts or sends back each claim on its own.

- **One Region per claim** — one behavior a check can prove, such as "Escape closes an open card",
  not one per fix or per file.
- **Proof sits on its claim, open:** the human's words it answers, quoted; its own diff hunk in the
  [file viewer](../recipes/diagram-and-files.md#show-files); the check that covers it with the
  command and the exact output line; and before/after images.
- **Every gap sits on each claim it weakens.** Give each claim a compact Before / After image slot,
  left visibly empty with a short label when no image exists. Beside its check and exact result,
  mark what applies: missing visual proof, a scripted check of a human action (a synthetic paste, a
  dispatched click), a behavior no check exercises, and no human use yet. A reason shared by every
  claim is stated once, before the claims.
- **When the change is to the review tool itself,** every step and sentence about its controls
  sits inside an element marked `data-subject-ui`, beside the claim it tests.
- **One Proposal per claim, anchored to the claim:** Accept or Rework. A claim with a gap
  recommends checking it first, and no option calls it proven.

### Flow explainer

When the human judges a pipeline or process — its stages, its gates, whether they are enough — the
diagram carries the page.

- **The diagram is on the first screen**, after at most about 60 words naming the subject, the
  finding, and the decision. Mark each gap on its node (color, a badge). Its fallback caption stays
  hidden once it draws. Check that every node is readable and nothing is clipped.
- **Draw the forward route in stage order.** Stage 1 and its first gates sit at the top. Put a side
  lane beside the stage it branches from, and draw feedback as a labelled note or a short local
  return. Keep labels full-size and the whole route within its column at 1440px; when it will not
  fit, split it into consecutive diagrams that link to each other.
- **One Region per stage, one per gate inside it.** A gate's Region says what it checks, what it
  proves, and — only where it changes the verdict — its gap, in one sentence.
- **Each finding lives at its gate** as a Proposal anchored there. A cross-stage finding gets one
  Region of its own and is named nowhere else.

## Write the finding

Every sentence is about the subject. Write the finding, not the process: current facts, the
recommendation, and what the human must judge.

- **Open on the subject.** The first screen states the subject, the current finding, its
  consequence, and the decision the human owns, in about 60 words; the material follows directly.
- **Every sentence stays true with the layout removed.** Read each sentence as plain text in a
  chat and keep only sentences about the subject. Carry the meaning in the material itself: label
  the box "Gate: lint", title the list "Unverified: paste, drag-and-drop", name the rule you mean. A
  sentence that only makes sense on this page — a legend, a reading direction, a pointer, a note
  about the page's status — is meta commentary; delete it. Preflight's `WARN PROSE` lists the
  sentences it suspects.
- **Show the source being judged.** Quote the passage, clause, rule, or diff hunk verbatim and
  anchor the Thread or Proposal to that quote, so the question sits on its evidence. Your analysis
  sits beside it, shorter than it.
- **Every reference opens.** Make each file, commit, issue, pull request, and URL a link — a commit
  or issue to its page on the forge, a local file to its path on the Surface server.
- **Each fact appears once.** Put a real gap — something missing, unproven, or not yet active — in
  one sentence on the one item where it changes the human's judgment.
- **Define before use.** Terms, symbols, and option names are explained before or beside the first
  control that needs them; a question, its recommendation, its alternatives, their consequences,
  and its controls form one visible unit. Read the Surface twice: from the top, and by jumping
  straight to each control. Apply the `write-for-humans` skill to all visible copy.

## Choose the message shape

Three channels; picking the wrong one is what makes a Surface feel like chat again.

- **Reply in the Thread** when the human asked. Always the answer to their comment, never a new
  topic.
- **Update** when they need to know something and no answer is required: a batch finished, a source
  changed, six Regions were re-rendered. It waits in Activity, never in the content; it never asks.
- **Proposal** when work cannot continue without their judgment, anchored at its subject. Name real
  options, put the recommendation first, and state what each one costs. A Proposal with one option
  is an Update; a Proposal whose answer you could have discovered yourself is a research failure,
  not a question. A list of open choices in the content is a set of Proposals written as prose:
  post each as a Proposal instead.

Nothing else is a channel. If a message fits none of these, it is prose looking for a chat window.
