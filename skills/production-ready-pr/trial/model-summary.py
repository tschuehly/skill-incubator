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

found = collections.defaultdict(lambda: collections.defaultdict(set))  # arm -> kind -> {(case, cluster)}
noise = collections.Counter()
for f in glob.glob(os.path.join(out, "adjudications", "*.json")):
    a = json.load(open(f))
    items = {i["index"]: i for i in a["items"]}
    for l in a["labels"]:
        for s in items[l["index"]]["sources"]:
            case, arm, rep = s.split("|")
            if rep != "0":
                continue
            if l["label"] == "noise":
                noise[arm] += 1
            else:
                found[arm]["known" if l["label"] != "valid" else "valid"].add((case, l["cluster"]))

def problems(arm):
    return found[arm]["known"] | found[arm]["valid"]

everyone = set().union(*(problems(a) for a in arms)) if arms else set()

# Quota per token, per provider window, from blocks with fresh readings at both ends.
blocks = [json.loads(l) for l in open(os.path.join(out, "blocks.jsonl"))]
per_token = collections.defaultdict(list)  # (provider, window) -> [(pct used, tokens)]
for b in blocks:
    qs, qe = b.get("quotaStart") or {}, b.get("quotaEnd") or {}
    if qs.get("state") != "fresh" or qe.get("state") != "fresh":
        continue
    ts = [r for r in done if r["provider"] == b["provider"] and b["startedAt"] <= r["startedAt"] <= b.get("endedAt", "~") and r.get("tokens")]
    tok = sum(r["tokens"] for r in ts)
    end = {w["id"]: w["percentRemaining"] for w in qe.get("windows", [])}
    for w in qs.get("windows", []):
        if w["id"] in end and tok:
            per_token[(b["provider"], w["id"])].append((max(0, w["percentRemaining"] - end[w["id"]]), tok))

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
    print(f"| {arm} | {rs[0]['effort']} | {len(rs)} | {len(problems(arm))} ({len(found[arm]['known'])} known) | {len(problems(arm) - others)} | {noise[arm]} | {tpr/1e6:.2f}M | {cost:.2f} | {mins:.1f} | {qtxt} |" if tpr else f"| {arm} | {rs[0]['effort']} | {len(rs)} | {len(problems(arm))} | {len(problems(arm) - others)} | {noise[arm]} | unknown | - | {mins:.1f} | not measured |")

print("\n## What each model found (rep 0)\n")
for arm in arms:
    ps = sorted(problems(arm))
    if not ps:
        continue
    print(f"- **{arm}**: " + "; ".join(f"{c.removeprefix('prr-')} {k}{' (known)' if (c, k) in found[arm]['known'] else ''}" for c, k in ps))

print("\n## Problems found by no other model\n")
for arm in arms:
    others = set().union(*(problems(a) for a in arms if a != arm))
    only = sorted(problems(arm) - others)
    if only:
        print(f"- **{arm}**: " + "; ".join(f"{c.removeprefix('prr-')} {k}" for c, k in only))
