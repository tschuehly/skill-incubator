# Reviewer face-off: the method, end to end

Rerun this when a new model comes out. Every step resumes: completed trials, labels, verdicts and ratings stay, and only what is new gets run.

```sh
T=~/IdeaProjects/skill-incubator/skills/production-ready-pr/trial   # this dir
R=~/.pi-workbench/evals/results/prr-faceoff                          # results: trials, logs, adjudications
S=~/.pi-workbench/scratch/ws-reviewer-model-faceoff-20261109         # verify/, ratings/, sheets
```

The verify and ratings data currently live in the Workstream scratch folder `$S`, not in `$R`; keep pointing `$S` there.

| Output | Where |
|---|---|
| trials, blocks, stages, logs, finals | `$R/trials.jsonl`, `$R/blocks.jsonl`, `$R/stages.jsonl`, `$R/logs/`, `$R/finals/` |
| first-judge labels | `$R/adjudications/<case>.json` |
| second-judge verdicts | `$S/verify/<case>.json` |
| problems and ratings | `$S/ratings/problems.json`, `$S/ratings/opus.json`, `$S/ratings/sol.json` |
| sheets | `$S/models-<date>.md`, `$S/weighted-<date>.md`, `$S/combinations-<date>.md` |
| report, case pages | `~/.pi-workbench/evals/reports/prr-faceoff-<date>.md`, `~/.pi-workbench/evals/reports/prr-faceoff-cases/` |

## 1. Register a case

Add an entry to `faceoff.json` `cases`, then build and check it:

```sh
node $T/faceoff.mjs build-cases                 # writes ~/.pi-workbench/evals/cases/<id>/
node $T/faceoff.mjs setup-check --cases <id>    # the patch is identical, the defect is present, the fix touches it
```

- **Replay (has an answer key):** a reviewed PR with a later fix commit. `proposed` is the parent of the review fix, `base` the merge-base, `fix` the fix commit. Each `defects[]` entry has `id`, `description`, `ranges` and `present: [path, regex]` matching the defect in `proposed`. Hits count as known defects (recall).
- **Blind (no answer key):** an unreviewed PR. Set `base` and `proposed` (the head), `defects: []`, no `fix`. Only valid findings score. Id suffix `-blind`.
- Set `exploratory: true` when the answer key was picked after seeing the reviews; its hits then count as real problems, not as recall.
- Changing a case's `defects` (or the judge prompt) relabels all of its findings on the next adjudication, so its verify file and problem ids go stale; re-verify that case.

## 2. Add a model arm

Add `arms.<name>`: `{model: "<provider>/<id>", effort, provider, estimateMinutes}`. A new provider also needs `providers.<p>` (`quota` id, `maxTrials`; `stopOnFirstFailure: true` for an untried provider; `admissionQuotaProvider` if the routing policy does not know it) and its Pi extension in `piExtensions`. Mark a dropped arm `retired: "<reason>"`; reports and sets skip it.

Probe before spending a run:

```sh
pi --model <provider>/<id> --thinking <effort> -p 'Reply with OK'      # model answers at all
node $T/faceoff.mjs quota                                                # its quota reads fresh
node $T/faceoff.mjs run --arms <name> --cases prr-me3367-java-version-line --reps 1 --no-adjudicate --out $PI_TMP/probe
```

The last line runs one sandboxed trial (a small diff) through the real harness into a throwaway dir; it must end `done` with findings and `creds=clean`.

## 3. Floors and caps (`faceoff.json`)

- `stopBelowPercent` (35): a provider block stops when a fresh quota window falls below it. Stale telemetry never stops a block.
- `providers.<p>.maxTrials`: a campaign-wide trial cap per provider; `null` means none.
- `minFreeDiskGB` (25): no trial launches below it.
- `deadline` (07:00) and `adjudicationReserveMinutes` (75): no trial launches after deadline minus the reserve; at the deadline, trials are killed and the partial report is written.
- Adjudication stops at the same quota threshold for `adjudicator.quota`.
- Campaigns (`--campaign eval`) use `floors` (skip, not stop), `maxTrialsPerPass` and their own `minFreeDiskGB` instead.

## 4. Run

```sh
node $T/faceoff.mjs run --dry-run --arms <name> --reps 1     # plan, ETA, quota, disk
node $T/faceoff.mjs run --arms <name> --reps 1 > $R/stage-<name>.log 2>&1 &
```

Run it on every case, so the new arm is comparable. A new arm needs only rep 0; the sheets read rep 0. The run refuses to start if the trial environment still carries a GitHub credential.

## 5. Judge

`run` adjudicates at the end (blind Opus medium, `adjudicator` in `faceoff.json`). Only new findings get labels; earlier labels and clusters stay fixed. To re-run alone: `node $T/faceoff.mjs adjudicate --cases a,b`.

## 6. Verify

One Opus-high subagent per batch of a few cases, with `briefs/verify.md` filled in. It adds a verdict for every label in `$S/verify/<case>.json`, joined on `item.index`, citing file:line at the head via `git show`. For a case that already has a verify file, it adds only the new indexes. `build-problems.py` (step 7) names any label still without a verdict.

## 7. Build the problem list

```sh
VERIFY_DIR=$S/verify python3 $T/build-problems.py $S/ratings $R
```

It appends one `problems.json` entry per new `<case>::<cluster>` with a non-noise label after verification (model-summary.py's `VERIFY_DIR` rule), leaves existing entries untouched, and prints the ids each rater has not rated yet. Self-check: `python3 $T/build-problems.py --selfcheck`.

## 8. Rate

Two independent raters, `opus` (Opus) and `sol` (Sol), each with `briefs/rate.md` and the ids step 7 printed for them. Each appends 1–4 impact, likelihood and detectability to `$S/ratings/<rater>.json`. Sol must not read `opus.json`, and Opus must not read `sol.json`. Re-run step 7 until both print `unrated: 0`.

## 9. Sheets

```sh
D=$(date +%F)
VERIFY_DIR=$S/verify python3 $T/model-summary.py $R > $S/models-$D.md
VERIFY_DIR=$S/verify python3 $T/weighted-sets.py $S/ratings $R > $S/weighted-$D.md
VERIFY_DIR=$S/verify python3 $T/combinations.py $R > $S/combinations-$D.md
```

Each sheet is regenerated whole; carry over any hand-written sections of the previous sheet (verification notes, recommendation, caveats) yourself.

## 10. Pages

```sh
node $T/faceoff.mjs report             # the campaign report (first-judge labels)
python3 $T/case-pages.py $R            # one page per case, every model's review side by side
```

## 11. What to compare

- The new arm's real problems and the ones no other model found (`models`), at the same cases and rep 0.
- Its weight share and whether it enters the best set per size or the Pareto front (`weighted`).
- Whether any set containing it beats the current default pair on problems at equal or fewer minutes and tokens (`combinations`).
- Minutes, tokens and plan quota per review; quota marked "extrapolated" was not measured on that model.

## Caveats

- **One rep:** most arms ran once, and a second review by the same model finds a noticeably different set.
- **Sample size:** about 60 problems from 23 PRs; a few PRs dominate the counts.
- **Ties:** treat gaps of 1–3 problems between models or sets as ties.
- **Spark:** Muse Spark medium (`muse-medium`), Sol medium and Luna reviewed only the first 11 PRs, so their counts are not comparable with arms that ran all 23; Spark's quota is extrapolated.
- **Absent arms:** the Gemini arms are retired (provider uninstalled over ToS risk) and have no rep-0 coverage of the later cases; Ember high/low and Grok low miss one of the 23.
- `problems.json` holds more ids than the sheets count (64 vs 60 now): it also takes problems found only in rep 1 or by a superseded attempt; the sheets read rep 0.
