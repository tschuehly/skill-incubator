#!/usr/bin/env python3
"""Per-model summary of a face-off: what each model found, what a review costs, and how much plan
quota a review uses. Usage: model-summary.py [results-dir] > models.md

Problems are adjudicated clusters (known defects and valid extras; noise excluded), from rep 0 so
every model reviewed each PR once. Quota per review comes from provider blocks whose start and end
readings are fresh on the same window: the window's percent used, shared across the block's
trials in proportion to their tokens. Readings have 1% resolution, so short blocks read 0.
"""
import collections, glob, json, os, sys

out = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/.pi-workbench/evals/results/prr-faceoff")
trials = {}
for line in open(os.path.join(out, "trials.jsonl")):
    r = json.loads(line)
    trials[r["key"]] = r
done = [r for r in trials.values() if r.get("status") == "done"]
arms = sorted({r["arm"] for r in trials.values()})

cfg = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "faceoff.json")))
exploratory = {c["id"] for c in cfg["cases"] if c.get("exploratory")}
found = collections.defaultdict(lambda: collections.defaultdict(set))  # (arm, rep) -> kind -> {(case, cluster)}
noise = collections.Counter()
for f in glob.glob(os.path.join(out, "adjudications", "*.json")):
    a = json.load(open(f))
    items = {i["index"]: i for i in a["items"]}
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

# Review sets: members run in parallel, so per PR the set takes as long as its slowest member; the set's runtime
# is the median over PRs every member reviewed (rep 0).
import itertools, statistics
live = [a for a in arms if a in cfg["arms"] and not cfg["arms"][a].get("retired") and any(r["arm"] == a and r["rep"] == 0 for r in done)]
wall = {(r["arm"], r["case"]): r["wallMs"] / 60000 for r in done if r["rep"] == 0}
tok = {a: statistics.mean(r["tokens"] for r in done if r["arm"] == a and r["rep"] == 0 and r.get("tokens")) for a in live}
def set_minutes(s):
    per = [max(wall[(a, c)] for a in s) for c in {c for (_, c) in wall} if all((a, c) in wall for a in s)]
    return statistics.median(per) if per else float("nan")
print(f"\n## Review sets (rep 0, {len(everyone)} problems; retired models excluded)\n")
print("| set | problems | median minutes (slowest member per PR) | tokens/review |\n|---|---|---|---|")
rows = [(len(set().union(*(problems(a) for a in s))), s) for k in (1, 2, 3) for s in itertools.combinations(live, k)]
for k in (1, 2, 3):
    best = sorted((r for r in rows if len(r[1]) == k), key=lambda r: (-r[0], set_minutes(r[1])))[:6]
    for n, s in best:
        print(f"| {' + '.join(s)} | {n} | {set_minutes(s):.1f} | {sum(tok[a] for a in s)/1e6:.1f}M |")

# Repeat consistency on matched cases only: a case counts when both reps of that model completed it.
print("\n## Repeat consistency (cases where both repetitions completed)\n")
print("| model | matched cases | rep 0 | rep 1 | found both times | union |\n|---|---|---|---|---|---|")
for a in arms:
    both = {r["case"] for r in done if r["arm"] == a and r["rep"] == 0} & {r["case"] for r in done if r["arm"] == a and r["rep"] == 1}
    if not both:
        continue
    p0 = {x for x in problems(a, "0") if x[0] in both}; p1 = {x for x in problems(a, "1") if x[0] in both}
    print(f"| {a} | {len(both)} | {len(p0)} | {len(p1)} | {len(p0 & p1)} | {len(p0 | p1)} |")
