# Composition — choosing the shape of a Surface and writing its copy

The kernel has no opinion about layout; the material decides the shape. Runnable starting points
are in `recipes/`: `list-detail.html`, `document.html`, `frontier.html`, and `direction-board.html`.
Standard renderers and content patterns ship as [building blocks](#building-blocks).

## Choose the composition

Establish four things first:

1. **Human job** — what they must understand, compare, decide, annotate, or change.
2. **Content topology** — one connected argument, repeated independent items, competing
   alternatives, a sequence or dependency graph, a queue with detail, or spatial/temporal material.
3. **Visibility dependency** — which facts must stay visible together for a sound judgment, and
   which detail can be disclosed in place.
4. **Interaction granularity and scale** — what can be answered independently, how many targets
   exist, and whether the human scans, reads, or moves between them.

### Content shapes

Offer the shape that fits the problem. None is mandatory, and none is the default for every
Surface (owner decision 2026-10-06, [ADR 0007](../docs/adr/0007-static-lint-blocks-and-content-shapes.md)).

| Shape | Fits the problem | Keep together | Blocks and hosts |
|---|---|---|---|
| Claim tree | A plan, design, or direction: is this chain of statements true? | Each claim with its one exhibit | [`<atelier-claims>`](#claim-tree); one `layout="anchored" collapsible` host beside it |
| Evidence and decision board | A review queue or a direction round: several independent questions, each with what was liked, disliked, known, missing | One question, its findings, its options with their reasons | `<atelier-tabs>` (or `side`), each tab `<atelier-findings>` + `<atelier-decision>`; a host per tab or one collapsible host beside |
| Flow with drill-down | A pipeline: its stages and gates, and whether they are enough | The map at one zoom level and the explanation of the selected node | `<atelier-flow>` (overview → stage → gate), `<atelier-timeline>` for one item through it; a host per stage |
| Comparison | Options judged against the same criteria | Options, criteria, differences, consequences | A table, one row per option, or `<atelier-compare>`; one host under it |
| Timeline | A history: how one item or decision got here | Each step with its evidence and who said what | `<atelier-timeline>`; one host beside it |
| List/detail | Triage of many records before inspecting one | Scannable list state and the selected record | One host per record, inside it; a reveal resolver selects the record |
| Worklist | Repeated items, each understandable alone | One item, its state, actions, and Thread | One host per item, under it |
| Fluent document | One argument that builds in reading order | Prose, examples, evidence, embedded actions | One `layout="anchored"` host beside the text |
| Canvas or media | Position or time carries meaning | Artifact, anchors, playback or zoom, feedback | `<atelier-video>`, `<atelier-mock>`, an image; one host beside the artifact |
| Frontier | A grilling round: every open question at once | Each question with its evidence and options | One host directly under each questioned passage |

When two compositions remain plausible **and would change the human's workflow**, offer two or
three concrete options before building — the human path, what each keeps visible, its trade-off —
and recommend one. Otherwise choose. Cosmetic variants are presentation work, not options.

Use the screen: a workspace fills the viewport and scrolls inside its panes; prose caps its line
length at about 75ch while tables, diagrams, and diffs take their full width. Any CSS works — the
recipes use plain CSS, and a library such as daisyUI over the Tailwind browser build also works,
because kernel chrome carries its own styles. Anything wider than a phone needs its own
`overflow-x: auto` container; nothing measures overflow before handoff, so build it in.

- **A side panel of Threads folds.** Mark a host beside the content `collapsible`: the human folds
  it with the ⇥ icon and it reserves no width; any card opening unfolds it.
- **Independent questions get tabs**, not one long page: `<atelier-tabs>` across the top, or
  `<atelier-tabs side>` as a foldable side navigation. Hidden panels stay in the DOM, so a Thread in
  one still resolves and revealing it switches the tab.

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

The material decides what the human looks at. Before writing prose, ask what shows it best:

| Material | Form |
|---|---|
| A plan, design, or direction question | `<atelier-tabs>`, one per question, each with `<atelier-findings>` and `<atelier-decision>`; or a [claim tree](#claim-tree) |
| What was liked, disliked, known, or missing | `<atelier-findings>` |
| A question with real alternatives | `<atelier-decision>`, each option's context inside it |
| A pipeline the human drills into, stage by stage | `<atelier-flow>`: overview → stage → gate, beside its explanation |
| How one item went through a process | `<atelier-timeline>`: each step with screenshots and reviewers' comments |
| A flow, sequence, or state machine to read whole | `<atelier-mermaid>`, as a [flow explainer](#flow-explainer) |
| Options judged on shared criteria | A table, one row per option |
| Numbers, or settings × values | `<atelier-chart>` (Vega-Lite), or a heatmap |
| A graph whose layout matters, or whose every node carries a Thread | Graphviz, [by hand](#a-renderer-of-your-own) |
| Before and after | `<atelier-compare>`, changes marked in both |
| A UI that does not exist yet | `<atelier-mock>`; a click-through prototype when the interaction is the question |
| A video, or anything where time carries meaning | `<atelier-video>` with time-stamped marks |
| Media, layout, or a visual defect | The image or frame itself, with Threads on points |
| A file, code, or a diff | `<atelier-file>` — see [Show files](#show-files) |
| Proof that a change works | An [evidence review](#evidence-review) |
| One argument that builds | Short prose with examples beside the claims |

### Claim tree

An optional shape, for when the material is a plan, a design, or a direction question: what the
human must judge is whether a chain of statements is true. Use another shape when the material is a
queue, media, or a comparison. Adapted from html-plan
([anthropics/claude-plugins-community](https://github.com/anthropics/claude-plugins-community), MIT).

- **A tree of claims: why › what › how › where.** Each level answers one question; split the top
  level by behavior or outcome, never by file or order of work.
- **Each claim is one sentence that can be true or false** — "A user can hold 50 scheduled
  messages at most.", not "Message limit".
- **One exhibit per claim** — a block, a table, a quote. A second exhibit means a second claim.
- **A decision sits on the claim it changes:** anchor its Proposal to the claim's sentence, the
  suggested option being the claim as written.
- **The closed tree is the summary.** Read the top-level claims alone; they must tell the whole
  story, so write no TL;DR and no list of sections.
- **At most 5 children and 3 levels.** The lint enforces both, and that each claim opens with its `<p>`.

`<atelier-claims>` numbers the claims (1, 1.2, 1.2.1) and folds each into a `<details>`; `open="1"`
starts the first level open. Every claim is an ordinary `atl-key` Region, so it takes Threads, Proposals and
Readys by its key, and `reveal()` unfolds the way to an anchor inside it:

```html
<atelier-claims open="1">
  <section atl-key="send-later"><p>The user can pick a time in the composer.</p>
    <atelier-mock frame="none" w="440" alt="Composer with Send and Send later"><template>…</template></atelier-mock>
    <section atl-key="limit"><p>A user can hold 50 scheduled messages at most.</p>
      <atelier-file lang="ts" name="limits.ts · sketch"><script type="text/plain">
        if (await store.countScheduled(userId) >= 50) throw new LimitError(50)
      </script></atelier-file>
    </section>
  </section>
</atelier-claims>
```

`recipes/direction-board.html` is a direction board in the evidence-and-decision shape whose
questions are claims.

### Evidence review

When a worker shows that a change works, the human accepts or sends back each claim on its own.

- **One Region per claim** — one behavior a check can prove, such as "Escape closes an open card",
  not one per fix or per file.
- **Proof sits on its claim, open:** the human's words it answers, quoted; its own diff hunk in the
  [file viewer](#show-files); the check that covers it with the
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

### Building blocks

`assets/atelier-blocks.mjs` ships content elements so you write a short text body, not renderer
markup or code. Each takes its source in a first-child `<script type="text/plain">` (so `<`, `>` and
`&` need no escaping), loads its library on first use from a pinned version, keeps text for a reader
without the renderer, draws again when a Ready swaps its Region in, and sets `data-rendered="true"` —
or `"error"`, showing the error and its source in place. A block is content: put it inside a Region,
anywhere a Thread can reach it. Every block takes an optional `caption="…"`, one sentence on what to
notice; the lint reads captions and `alt` as prose.

| Block | Body | Attributes |
|---|---|---|
| `<atelier-claims>` | `atl-key` claims, each opening with a `<p>` | `open="0…3"` |
| `<atelier-mermaid>` | Mermaid source (mermaid 12.1.0) | `alt` (required) |
| `<atelier-chart>` | Vega-Lite JSON (vega-embed 7.3.0, SVG) | `alt` (required) |
| `<atelier-file>` | inline source, or none with `src=`/`diff=` | `src`, `diff`, `lang`, `name` |
| `<atelier-video>` | one mark per line: `m:ss what happens` | `src`, `poster`, `label`, `small`, `compare` |
| `<atelier-compare>` | two child elements, or none with images | `before`, `after`, `before-label`, `after-label` |
| `<atelier-mock>` | a `<template>` holding the mockup | `frame="none|browser|phone"`, `w`, `url`, `alt` |
| `<atelier-findings>` | one per line: `liked|disliked|fact|gap: text` | — |
| `<atelier-decision>` | `? question`, then `* recommended` / `- alternative` options, each with indented `+ for`, `- against`, or plain context lines | — |
| `<atelier-flow>` | one node per line, `Name: what it does`; children indented under their parent; `\|\| ` runs in parallel with the sibling before | — |
| `<atelier-timeline>` | a step per unindented line; indented under it `![alt](src)`, `> who: comment`, or a note | — |
| `<atelier-tabs>` | child `atl-key` Regions, one per tab, named by `atl-label` or their heading | `side` |

Text in findings, decisions, flows and timelines is plain; `[label](url)` makes a link. Labels a
block draws (Liked, Recommended, Overview) follow `<html lang>`, as the kernel's do.

```html
<atelier-mermaid alt="Draft build, then HIGH build, then review.">
  <script type="text/plain">
  flowchart LR
    draft[Draft build] --> high[HIGH build] --> review{Review}
  </script>
</atelier-mermaid>

<atelier-video src="/media/24-final.mp4">
  <script type="text/plain">
  0:00 Hook: 25 cards fan out
  0:03.5 The guest scans the QR code
  </script>
</atelier-video>

<atelier-compare before="/shots/old.png" after="/shots/new.png" caption="The headline moves above the fold."></atelier-compare>

<atelier-mock frame="browser" w="600" url="app.test/compose" alt="Composer with a Send later button">
  <template><style>button { padding: 8px }</style><button>Send later ▾</button></template>
</atelier-mock>
```

- **Mermaid:** give every node a short, stable name (`high[HIGH build]`); a Thread on a box finds it
  again by that name after the diagram changes. It draws at full size inside its own horizontal
  scroller: a diagram shrunk to fit shows half-size labels that page zoom does not enlarge. Lay a
  chain of more than five steps out top to bottom (`flowchart TB`).
- **Chart:** a Thread anchors to a point on the chart, not to one mark.
- **Video:** each mark is a line of text with a seek button, so a Thread anchors to a moment by
  quoting its mark; the mark playing now is highlighted. A video is large by default; the human
  toggles it small (`small` starts it small). Sibling `<atelier-video>`s are alternatives shown one
  at a time; mark `compare` on them only when the human compares them side by side.
- **Decision:** the block shows the options and their reasons; the human answers in the Proposal
  you anchor to the question's words. Options are all visible — never fold the alternatives away.
- **Flow:** the map shows one level; a node with children zooms in, a breadcrumb zooms out, and
  every node's explanation sits in the pane beside it, so a Thread quotes it at any zoom.
- **Mockup:** it renders at `w` pixels in a shadow root — its CSS and the page's cannot touch each
  other — and scales down to the column. The kernel cannot see inside it, so a Thread on a mockup
  anchors a point on it. Draw the smallest region that makes the point.
- The lint checks each body statically: Mermaid's diagram-type header (not its shapes — only
  Mermaid's own parser can), the chart's JSON, each video mark's time, the findings, decision, flow
  and timeline syntax. It does not run a renderer; a Mermaid error the lint cannot see shows in
  place as the block's error.

### A renderer of your own

For a library no block covers — Graphviz
(`import { instance } from 'https://cdn.jsdelivr.net/npm/@viz-js/viz@3/+esm'`, then
`el.append((await instance()).renderSVGElement(dot))`, every node with an `id`) — keep the source in
a `<script type="text/plain">` so the lint sees text a Thread may quote, keep a fallback caption, run
again on `atelier:ready`, and dispatch `atelier:rendered` on `document` when done so anchors inside it
resolve.

### Show files

Render a file the human must judge — Markdown, source code, or a patch — with `<atelier-file>`, in a
block of its own rather than inside a sentence. It keeps the text as real DOM, one element per source
line, so Threads anchor to any line; Markdown gets GitHub styling and its ` ```mermaid ` fences draw:

```html
<atelier-file src="/docs/plan.md"></atelier-file>        <!-- GitHub-styled Markdown -->
<atelier-file src="/src/server.mjs"></atelier-file>      <!-- highlighted, numbered code -->
<atelier-file diff="/review/fix.patch"></atelier-file>   <!-- side-by-side diff -->
<atelier-file lang="ts" name="limits.ts · sketch"><script type="text/plain">
export const LIMIT = 50;
</script></atelier-file>
```

- Paths are served by the Surface server from `ROOT`, so a file outside it must be copied in first.
  The lint reads each `src=` file through the server so a Thread quoting a line in it still resolves.
- Long lines wrap, so nothing hides past the box edge. A diff shows side by side when its box is at
  least 1100px wide and unified below that; give a diff the full content width.
- For one hunk beside a claim, cut that hunk into its own `.patch` file rather than showing the
  whole diff.


## Write the finding

Every sentence is about the subject. Write the finding, not the process: current facts, the
recommendation, and what the human must judge.

- **Open on the subject.** The first screen states the subject, the current finding, its
  consequence, and the decision the human owns, in about 60 words; the material follows directly.
- **Every sentence stays true with the layout removed.** Read each sentence as plain text in a
  chat and keep only sentences about the subject. Carry the meaning in the material itself: label
  the box "Gate: lint", title the list "Unverified: paste, drag-and-drop", name the rule you mean. A
  sentence that only makes sense on this page — a legend, a reading direction, a pointer, a note
  about the page's status — is meta commentary; delete it. The lint's `PROSE` gate lists the
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
  and its controls form one visible unit. Write so the human can act without the session
  transcript or an unexplained label; that is an authoring outcome, not a separate reading pass.
  Apply the `write-for-humans` skill to all visible copy.

## Rules from the 2026-10-06 variant verdict

Each rule names the defect the owner marked on a live variant (private evidence:
atelier/docs/variant-verdict-20261006.md).

- **Tabs over one long page.** Put independent questions in `<atelier-tabs>`, one each. *Source:*
  variant B's tabs were marked "the tabs instead of everything as long text"; the single long pages
  of A and C drew "far too much text".
- **Decision context inside the option.** Each option carries its own reasons; nothing about an
  option sits in a separate element below the question. *Defect:* variant D put the options' table
  under the decision, so the answer and its reasons were apart. The lint fails a table, list or
  `<details>` right after an `<atelier-decision>` (`DECISION_CONTEXT`); the kernel's Proposal card
  keeps each option's explanation inside the option.
- **Only what changes the decision.** Cut evidence lines and receipts that would not move the
  answer; keep each Region under about 120 words of prose. *Defect:* "far too much text" (C) and "is
  that really important?" on a receipts line (A). The lint warns over the budget (`WORDS`).
- **Write the page language natively.** Write German as German, not translated English, and set
  `<html lang>` to it so the kernel's labels match. *Defect:* German that "sounds odd" (A, B). The
  lint fails a German page under `lang="en"` and the reverse (`LANG`).
- **Open with a plain "what it's about".** One or two sentences in everyday words before any
  evidence. *Source:* C opened with "what it's about" in plain words and was marked "good explanation".

- **Icons, compact and horizontal.** Kernel and block actions are icons whose label is the tooltip
  and accessible name; labels sit inline before their text. *Defect:* text buttons ("Explain") cost
  vertical space (C, B); subtitles on their own lines (A, D).
- **Videos large, one at a time.** `<atelier-video>` is large with a small/large toggle; sibling
  videos share one group that shows one at a time. *Defect:* videos too small (D, P3) and side by side
  without a comparison (D). The lint fails several videos visible at once unless marked `compare`
  (`VIDEO`).
- **Threads fold away.** A side host is `collapsible` and reserves no width when folded. *Defect:*
  the Thread panel ate width and could not collapse (A ×2, C).

## Styling

- `atelier.css` ships a default theme modeled on the 2026-10-06 variant B: paper `#f7f4ec`, ink
  `#242c2a`, a deep green accent `#305b45`, Georgia headings over a system sans body, as `--atl-*`
  tokens. Content defaults use zero-specificity `:where()` rules, so any authored rule or library
  overrides them without `!important`.
- Kernel chrome lives in `<atelier-host>`, `<atelier-activity>`, and `.atl-*`; its labels follow
  `<html lang>` (German or English). Leave its styling alone; it reads as protocol, not content.
- Theme choice stays in authored HTML/CSS; the kernel stores no theme preference.

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
