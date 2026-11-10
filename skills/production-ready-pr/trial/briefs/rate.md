<!-- Rating brief, one subagent per rater. Fill every {{PLACEHOLDER}}:
  {{RATER}}    opus (launch on anthropic/claude-opus-5-5) or sol (launch on openai-codex/gpt-6.1-sol); effort {{EFFORT}} = high
  {{OTHER}}    the other rater's name
  {{IDS}}      the ids `build-problems.py` printed as unrated by {{RATER}}, or "every id in problems.json"
  {{N}}        how many ids that is
  {{S}}        scratch dir holding verify/ and ratings/
  {{RESULTS}}  results dir; {{TRIAL}} this trial/ dir
Run the two raters one after the other or in parallel; neither sees the other's file. -->
Rate real code-review problems on three axes. You are one of two independent raters (`{{RATER}}`); the other rater's scores are averaged with yours. You don't know which reviewer model found each problem, and that must not matter.

**Independence:** rate from the code and the problem text only. Don't open `{{S}}/ratings/{{OTHER}}.json` or any other rater's output.

**Problems to rate:** {{IDS}}, from `{{S}}/ratings/problems.json`. Each entry has:
- `id`, `case`, `pr`, `repo`, `base`, `proposed`;
- `knownDefect`, set when a later fix commit confirmed the problem;
- `findings`: up to 3 reviewer statements, with file, line and problem;
- `judgeReason` and `verifierEvidence`, from two judges who confirmed the problem is real. The full verdicts are in `{{S}}/verify/<case>.json`.

Repo paths are under `repos` in `{{TRIAL}}/faceoff.json`.

**Reading code:** read-only. Use `git -C <repo> show <proposed>:<path>` or `git -C <repo> diff <base> <proposed>`. Don't create worktrees, branches or commits, and don't fetch. Read enough code to judge likelihood and detectability honestly.

**Axes** (integers; use the anchors):
- **impact:** what happens if it ships.
  - 1: cosmetic, or a test or eval gap with no runtime effect.
  - 2: wrong behaviour with a workaround, or a degraded dev or CI loop.
  - 3: wrong results users see, lost or wrong cost or accounting data, or a gate that blocks work.
  - 4: data loss or corruption, a security hole or secret exposure, or an outage.
- **likelihood:** how often real use triggers it.
  - 1: only a contrived or malformed input.
  - 2: an unusual but legitimate path.
  - 3: common paths, some of the time.
  - 4: every run, or the default configuration.
- **detectability:** would anything else catch it before production.
  - 1: this PR's own CI or tests already fail on it.
  - 2: an obvious smoke test or first manual use catches it.
  - 3: only a careful human reviewer would catch it.
  - 4: silent until it hurts in production.

If `{{S}}/ratings/{{RATER}}.json` already has ratings, read 5 of them first and apply the anchors the same way.

**Output:** append to `{{S}}/ratings/{{RATER}}.json`, shape `{"rater": "{{RATER}}", "ratings": [{"id", "impact", "likelihood", "detectability", "rationale"}]}`, one entry per problem, ids exactly as given, `rationale` one sentence with file:line. Create the file in that shape if it is missing. Leave existing ratings unchanged.

**Constraints:** never modify repos, the results dir or face-off files; never touch GitHub; never print secrets.

**Check:** `VERIFY_DIR={{S}}/verify python3 {{TRIAL}}/build-problems.py {{S}}/ratings {{RESULTS}}` prints `unrated by {{RATER}}: 0`.

Done means: the file parses as JSON, the {{N}} new ratings are in it, earlier ratings are unchanged, and the check passes.
Stop and ask only if: never.
Expected output: at most 6 lines: the count, the score distribution per axis, the 3 highest impact × likelihood problems, and the check result.
