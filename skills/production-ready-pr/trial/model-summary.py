#!/usr/bin/env python3
"""Per-model summary of a face-off: what each model found, what a review costs, and how much plan
quota a review uses. Usage: model-summary.py [results-dir] [cases-file] > models.md
(cases-file: a campaign's cases JSON; default faceoff.json `cases`)

Problems are adjudicated clusters (known defects and valid extras; noise excluded), from rep 0 so
every model reviewed each PR once. Quota per review comes from provider blocks whose start and end
readings are fresh on the same window: the window's percent used, shared across the block's
trials in proportion to their tokens. Readings have 1% resolution, so short blocks read 0.
"""
import collections, glob, json, math, os, statistics, sys

def set_stats(s, cover, wall, tokens, problems_of, n_cases):
    """Every number of a review set comes from one cohort: the cases where every member has a judged rep-0 trial.
    cover: arm -> {case}; wall, tokens: (arm, case) -> minutes, tokens; problems_of(arm) -> {(case, cluster)}."""
    C = set.intersection(*(cover[a] for a in s))
    per = [max(wall[(a, c)] for a in s) for c in C]
    tk = [[tokens[(a, c)] for c in C if (a, c) in tokens] for a in s]
    return {"cases": C, "n": len(C), "full": len(C) == n_cases, "problems": {p for a in s for p in problems_of(a) if p[0] in C},
            "minutes": statistics.median(per) if per else math.nan,
            "tokens": sum(statistics.mean(t) if t else math.nan for t in tk)}

def ranked(st):
    """Only full-coverage sets with known minutes and tokens are ranked or enter a Pareto front."""
    return st["full"] and not math.isnan(st["minutes"]) and not math.isnan(st["tokens"])

def selfcheck():
    P = {"a": {("c1", "x"), ("c2", "y"), ("c3", "z")}, "b": {("c1", "w")}, "d": {("c2", "v")}}
    cover = {"a": {"c1", "c2", "c3"}, "b": {"c1"}, "d": {"c2"}}
    wall = {("a", "c1"): 1, ("a", "c2"): 5, ("a", "c3"): 9, ("b", "c1"): 0.5, ("d", "c2"): 2}
    tokens = {k: 10 for k in wall}
    st = lambda *s: set_stats(s, cover, wall, tokens, P.__getitem__, 3)
    assert st("a")["minutes"] == 5 and ranked(st("a"))
    # Adding a partial arm: the set is measured on its 1-PR cohort only, flagged, and never ranked.
    ab = st("a", "b")
    assert ab["n"] == 1 and not ab["full"] and ab["problems"] == {("c1", "x"), ("c1", "w")} and ab["minutes"] == 1 and not ranked(ab)
    # Disjoint coverage: an empty cohort, nan minutes, no problems, kept out of every ranking.
    bd = st("b", "d")
    assert bd["n"] == 0 and not bd["problems"] and math.isnan(bd["minutes"]) and not ranked(bd)
    print("selfcheck ok")

if sys.argv[1:] == ["--selfcheck"]:
    selfcheck(); sys.exit(0)

def load_cases(cases_file):
    """A campaign's cases: cases_file plus one cases.d/<id>.json per registered case (faceoff.mjs readCasesFile)."""
    cases = json.load(open(cases_file)) if os.path.exists(cases_file) else []
    ids = {c["id"] for c in cases}
    extra = [json.load(open(f)) for f in glob.glob(os.path.join(os.path.dirname(cases_file), "cases.d", "*.json"))]
    return cases + sorted((c for c in extra if c["id"] not in ids), key=lambda c: (c.get("registeredAt", ""), c["id"]))


out = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/.pi-workbench/evals/results/prr-faceoff")
trials = {}
for line in open(os.path.join(out, "trials.jsonl")):
    r = json.loads(line)
    trials[r["key"]] = r
done = [r for r in trials.values() if r.get("status") == "done"]
arms = sorted({r["arm"] for r in trials.values()})

cfg = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "faceoff.json")))
cases = load_cases(sys.argv[2]) if len(sys.argv) > 2 else cfg["cases"]
exploratory = {c["id"] for c in cases if c.get("exploratory")}
found = collections.defaultdict(lambda: collections.defaultdict(set))  # (arm, rep) -> kind -> {(case, cluster)}
noise = collections.Counter()
for f in glob.glob(os.path.join(out, "adjudications", "*.json")):
    a = json.load(open(f))
    items = {i["index"]: i for i in a["items"]}
    # VERIFY_DIR=<dir>: a second judge's <case>.json verdicts replace the first judge's labels for that case.
    vf = os.path.join(os.environ.get("VERIFY_DIR", ""), os.path.basename(f))
    if os.environ.get("VERIFY_DIR") and os.path.exists(vf):
        v = {x["index"]: x["label"] for x in json.load(open(vf))["verdicts"]}
        lab = lambda l: v.get(l["index"], l["label"])
        # A finding moved onto a known defect joins that defect's cluster, as the first judge's contract requires.
        a["labels"] = [{**l, "label": lab(l), "cluster": lab(l) if lab(l) not in ("valid", "noise") else l["cluster"]} for l in a["labels"]]
    for l in a["labels"]:
        for s in items[l["index"]]["sources"]:
            case, arm, rep = s.split("|")
            if (trials.get(s) or {}).get("status") != "done":
                continue  # a later retry or quota repair superseded this attempt
            if l["label"] == "noise":
                if rep == "0":
                    noise[arm] += 1
                continue
            # Exploratory answer keys were picked after seeing answers: a hit counts as a real problem, not a known defect.
            kind = "valid" if l["label"] == "valid" else ("exploratory" if case in exploratory else "known")
            found[(arm, rep)][kind].add((case, l["cluster"]))

def problems(arm, rep="0"):
    k = found[(arm, rep)]
    return k["known"] | k["valid"] | k["exploratory"]

everyone = set().union(*(problems(a) for a in arms)) if arms else set()

# Quota per token, per provider window. Overlapping blocks of one provider share the same quota window, so they
# merge into one interval; an interval where any reading rose (a window reset) is skipped. Tokens include failed
# attempts, which also consume quota.
blocks = sorted((json.loads(l) for l in open(os.path.join(out, "blocks.jsonl"))), key=lambda b: b["startedAt"])
intervals = []  # [provider, start, end, [blocks]]
for b in blocks:
    if not b.get("endedAt"):
        continue
    cur = next((i for i in intervals if i[0] == b["provider"] and b["startedAt"] <= i[2]), None)
    if cur:
        cur[2] = max(cur[2], b["endedAt"]); cur[3].append(b)
    else:
        intervals.append([b["provider"], b["startedAt"], b["endedAt"], [b]])
measured_arms = set()
per_token = collections.defaultdict(list)  # (provider, window) -> [(pct used, tokens)]
for prov, start, end, bs in intervals:
    first, last = bs[0].get("quotaStart") or {}, max(bs, key=lambda b: b["endedAt"]).get("quotaEnd") or {}
    if first.get("state") != "fresh" or last.get("state") != "fresh":
        continue
    tok = sum(r["tokens"] for r in trials.values() if r["provider"] == prov and start <= r["startedAt"] <= end and r.get("tokens"))
    endw = {w["id"]: w["percentRemaining"] for w in last.get("windows", [])}
    for w in first.get("windows", []):
        rose = any(
            {x["id"]: x["percentRemaining"] for x in (b.get("quotaEnd") or {}).get("windows", [])}.get(w["id"], 0)
            > {x["id"]: x["percentRemaining"] for x in (b.get("quotaStart") or {}).get("windows", [])}.get(w["id"], 101)
            for b in bs)
        if w["id"] in endw and tok and not rose:
            measured_arms |= {r["arm"] for r in trials.values() if r["provider"] == prov and start <= r["startedAt"] <= end and r.get("tokens")}
        if w["id"] in endw and tok and not rose and endw[w["id"]] <= w["percentRemaining"]:
            per_token[(prov, w["id"])].append((w["percentRemaining"] - endw[w["id"]], tok))

def pct_per_review(provider, tokens_per_review):
    res = {}
    for (p, wid), obs in per_token.items():
        if p == provider:
            used, tok = sum(o[0] for o in obs), sum(o[1] for o in obs)
            res[wid] = used / tok * tokens_per_review if tok else None
    return res

print("# Reviewer models: findings, cost and quota\n")
print(f"Results: `{out}`. {len(everyone)} distinct real problems found by any model in one review per PR.\n")
print("| model | effort | reviews | real problems | only this model | noise | tokens/review | list $/review | min/review | plan quota per review |")
print("|---|---|---|---|---|---|---|---|---|---|")
for arm in arms:
    rs = [r for r in done if r["arm"] == arm and r["rep"] == 0]
    if not rs:
        continue
    tk = [r["tokens"] for r in rs if r.get("tokens")]
    tpr = sum(tk) / len(tk) if tk else None
    cost = sum((r.get("usage") or {}).get("cost", 0) or 0 for r in rs) / len(rs)
    mins = sum(r["wallMs"] for r in rs) / len(rs) / 60000
    others = set().union(*(problems(a) for a in arms if a != arm))
    q = pct_per_review(rs[0]["provider"], tpr) if tpr else {}
    qtxt = ", ".join(f"{w}: {v:.2f}%" for w, v in q.items() if v is not None) or "not measured"
    if q and arm not in measured_arms:
        qtxt += " (extrapolated: no measured interval ran this model)"
    print(f"| {arm} | {rs[0]['effort']} | {len(rs)} | {len(problems(arm))} ({len(found[(arm, "0")]['known'])} known) | {len(problems(arm) - others)} | {noise[arm]} | {tpr/1e6:.2f}M | {cost:.2f} | {mins:.1f} | {qtxt} |" if tpr else f"| {arm} | {rs[0]['effort']} | {len(rs)} | {len(problems(arm))} | {len(problems(arm) - others)} | {noise[arm]} | unknown | - | {mins:.1f} | not measured |")

print("\n## What each model found (rep 0)\n")
for arm in arms:
    ps = sorted(problems(arm))
    if not ps:
        continue
    print(f"- **{arm}**: " + "; ".join(f"{c.removeprefix('prr-')} {k}{' (known)' if (c, k) in found[(arm, '0')]['known'] else ' (exploratory key)' if (c, k) in found[(arm, '0')]['exploratory'] else ''}" for c, k in ps))

print("\n## Problems found by no other model\n")
for arm in arms:
    others = set().union(*(problems(a) for a in arms if a != arm))
    only = sorted(problems(arm) - others)
    if only:
        print(f"- **{arm}**: " + "; ".join(f"{c.removeprefix('prr-')} {k}" for c, k in only))

# Review sets: members run in parallel, so per PR the set takes as long as its slowest member. Problems, minutes and
# tokens all come from the set's cohort (set_stats); only full-coverage sets are ranked.
import itertools
judged = {os.path.basename(f)[:-5] for f in glob.glob(os.path.join(out, "adjudications", "*.json"))}
case_ids = [c["id"] for c in cases]
live = [a for a in arms if a in cfg["arms"] and not cfg["arms"][a].get("retired") and any(r["arm"] == a and r["rep"] == 0 for r in done)]
rep0 = [r for r in done if r["rep"] == 0 and r["case"] in case_ids and r["case"] in judged]
cover = {a: {r["case"] for r in rep0 if r["arm"] == a} for a in live}
wall = {(r["arm"], r["case"]): r["wallMs"] / 60000 for r in rep0}
tokens = {(r["arm"], r["case"]): r["tokens"] for r in rep0 if r.get("tokens")}
stats = lambda s: set_stats(s, cover, wall, tokens, problems, len(case_ids))
flag = lambda st: "" if st["full"] else f" (partial: {st['n']}/{len(case_ids)} PRs)"
print(f"\n## Review sets (rep 0, {len(everyone)} problems; retired models excluded)\n")
print(f"Each set is measured on its cohort: the PRs every member reviewed. Only sets covering all {len(case_ids)} PRs are ranked; the best partial sets follow, flagged.\n")
print("| set | PRs | problems | median minutes (slowest member per PR) | tokens/review |\n|---|---|---|---|---|")
rows = [(s, stats(s)) for k in (1, 2, 3) for s in itertools.combinations(live, k)]
order = lambda r: (-len(r[1]["problems"]), r[1]["minutes"])
for k in (1, 2, 3):
    sized = [r for r in rows if len(r[0]) == k]
    for s, st in sorted((r for r in sized if ranked(r[1])), key=order)[:6] + sorted((r for r in sized if not ranked(r[1])), key=order)[:3]:
        print(f"| {' + '.join(s)}{flag(st)} | {st['n']} | {len(st['problems'])} | {st['minutes']:.1f} | {st['tokens']/1e6:.1f}M |")

# Repeat consistency on matched cases only: a case counts when both reps of that model completed it.
print("\n## Repeat consistency (cases where both repetitions completed)\n")
print("| model | matched cases | rep 0 | rep 1 | found both times | union |\n|---|---|---|---|---|---|")
for a in arms:
    both = {r["case"] for r in done if r["arm"] == a and r["rep"] == 0} & {r["case"] for r in done if r["arm"] == a and r["rep"] == 1}
    if not both:
        continue
    p0 = {x for x in problems(a, "0") if x[0] in both}; p1 = {x for x in problems(a, "1") if x[0] in both}
    print(f"| {a} | {len(both)} | {len(p0)} | {len(p1)} | {len(p0 & p1)} | {len(p0 | p1)} |")
