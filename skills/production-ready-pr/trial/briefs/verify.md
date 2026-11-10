<!-- Verification brief, one subagent per batch of cases. Fill every {{PLACEHOLDER}}:
  {{CASES}}    backticked case ids, e.g. `prr-me3132-blind`, `prr-me3134v2-blind`
  {{N}}        number of cases
  {{RESULTS}}  results dir (default ~/.pi-workbench/evals/results/prr-faceoff)
  {{S}}        scratch dir holding verify/ and ratings/
  {{TRIAL}}    this trial/ dir
Launch on {{MODEL}} = anthropic/claude-opus-5-5, {{EFFORT}} = high, read-only on the repos. -->
Run the verification pass for a reviewer face-off. A first blind Opus judge labelled every reviewer finding with a known-defect id, `valid` or `noise`. You re-check each label against the real code.

**Cases:** {{CASES}}.

**Inputs:**
- **Adjudication:** `{{RESULTS}}/adjudications/<case>.json`.
  - `labels[]` has `index`, `label`, `cluster` and `reason`.
  - `items[]` holds the finding text (`file`, `line`, `problem`). Join items to labels on `item.index`, never on position. Ignore `sources`, so you stay blind to which model wrote what.
- **Case definition:** the case's entry in `{{TRIAL}}/faceoff.json` `cases`: `repo`, `base`, `proposed` (the head), and `defects` with descriptions for replay cases. The base may be another PR's head, not main. Repo paths are under `repos`.
- **Code:** read files at the pinned head with `git -C <repo> show <proposed>:<path>`, and the change with `git -C <repo> diff <base> <proposed>`. Check the base with `git show <base>:<path>` before you call a problem pre-existing. `git fetch` the PR ref only if a SHA is missing. Never check out, branch, commit or modify the checkout.

**Label rules** (the first judge's):
- **A known-defect id:** only when the finding describes that same failure (the same broken rule and consequence), not merely the same file or line.
- **`valid`:** a real defect the change introduces or leaves in its changed behaviour, that a careful maintainer would fix before merging.
- **`noise`:** wrong, speculative, style or naming only, out of scope, or pre-existing.

Judge each finding on its merits; don't defer to the existing label. Run a quick check only if it is cheap and decisive.

**Output:** write `{{S}}/verify/<case>.json` in exactly the format of an existing file in `{{S}}/verify/` (read one first): `{"case", "verdicts":[{"index","original","label","agree","confidence","evidence"}]}`.
- Cover **every** label: known, valid and noise. If the file already exists (a new model added findings), keep its verdicts and add only the missing indexes.
- `original` is the first judge's label; `label` is yours; `agree` is whether they match; `confidence` is `high`, `medium` or `low`.
- `evidence` is one or two sentences citing file:line at the head.

**Constraints:** never modify the repos, the results dir or the face-off files; GitHub is read-only; never print secrets.

Done means: {{N}} JSON files, each with a `verdicts` entry for every `labels[].index` of that case (check with `python3 -m json.tool` and a count).
Stop and ask only if: never.
Expected output: at most 6 lines: per case, how many verdicts and how many disagreements by direction (real→noise, noise→real, known↔valid), plus the most significant flip.
