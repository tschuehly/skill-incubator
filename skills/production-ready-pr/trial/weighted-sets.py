#!/usr/bin/env python3
"""Rank reviewer models and review sets by how much their finds matter, not how many there are.

Usage: VERIFY_DIR=<verify dir> weighted-sets.py <ratings dir> [results dir] > weighted.md
The ratings dir holds one <rater>.json per rater ({"ratings": [{"id": "<case>::<cluster>", "impact",
"likelihood", "detectability"}]}). A problem's weight is mean(impact x likelihood) x a detectability
multiplier (1 -> 0.5, 4 -> 1.5): a silent bug only a reviewer catches is worth three times one CI catches.
Problems no rater scored weigh the median weight, and are listed.
"""
import contextlib, glob, io, itertools, json, os, runpy, statistics, sys

ratings_dir = sys.argv[1]
sys.argv = [sys.argv[0]] + sys.argv[2:]
with contextlib.redirect_stdout(io.StringIO()):
    g = runpy.run_path(os.path.join(os.path.dirname(os.path.abspath(__file__)), "model-summary.py"))
problems, set_minutes, live, everyone = g["problems"], g["set_minutes"], g["live"], g["everyone"]

def det_mult(d):
    return 0.5 + (d - 1) / 3

by_id = {}
for f in sorted(glob.glob(os.path.join(ratings_dir, "*.json"))):
    if os.path.basename(f) == "problems.json":
        continue
    for r in json.load(open(f))["ratings"]:
        by_id.setdefault(r["id"], []).append(r)
weight, spread = {}, {}
for pid, rs in by_id.items():
    weight[pid] = statistics.mean(r["impact"] * r["likelihood"] for r in rs) * det_mult(statistics.mean(r["detectability"] for r in rs))
    spread[pid] = max(max(r[k] for r in rs) - min(r[k] for r in rs) for k in ("impact", "likelihood", "detectability"))
fallback = statistics.median(weight.values()) if weight else 1.0
pid = lambda p: f"{p[0]}::{p[1]}"
unrated = sorted(pid(p) for p in everyone if pid(p) not in weight)
w = lambda ps: sum(weight.get(pid(p), fallback) for p in ps)
total = w(everyone)

print(f"# Reviewer models weighted by impact x likelihood x detectability\n")
print(f"{len(everyone)} problems (rep 0), total weight {total:.1f}. Raters: {', '.join(sorted({os.path.basename(f)[:-5] for f in glob.glob(os.path.join(ratings_dir, '*.json'))} - {'problems'}))}.\n")
print("| model | problems | weight | share of total | median minutes |\n|---|---|---|---|---|")
for a in sorted(live, key=lambda a: -w(problems(a))):
    print(f"| {a} | {len(problems(a))} | {w(problems(a)):.1f} | {w(problems(a)) / total:.0%} | {set_minutes((a,)):.1f} |")

rows = [(w(set().union(*(problems(a) for a in s))), set_minutes(s), s) for k in range(1, len(live) + 1) for s in itertools.combinations(live, k)]
print("\n## Best set per size\n\n| models | set | weight | share | median minutes |\n|---|---|---|---|---|")
for k in range(1, len(live) + 1):
    b = max((r for r in rows if len(r[2]) == k), key=lambda r: (r[0], -r[1]))
    print(f"| {k} | {' + '.join(b[2])} | {b[0]:.1f} | {b[0] / total:.0%} | {b[1]:.1f} |")
print("\n## Fastest set for each weight level (Pareto: weight vs minutes)\n\n| set | weight | share | median minutes |\n|---|---|---|---|")
front, best = [], -1
for r in sorted(rows, key=lambda r: (r[1], -r[0], len(r[2]))):
    if r[0] > best + 1e-9:
        front.append(r); best = r[0]
for r in front:
    print(f"| {' + '.join(r[2])} | {r[0]:.1f} | {r[0] / total:.0%} | {r[1]:.1f} |")

print("\n## Problems by weight\n\n| problem | weight | rater spread |\n|---|---|---|")
for p in sorted(everyone, key=lambda p: -weight.get(pid(p), fallback)):
    s = spread.get(pid(p))
    print(f"| {pid(p).removeprefix('prr-')} | {weight.get(pid(p), fallback):.1f} | {'unrated' if s is None else s}{' (flag)' if s is not None and s >= 2 else ''} |")
if unrated:
    print(f"\nUnrated (weighted at the median {fallback:.1f}): " + ", ".join(unrated))

if __name__ == "__main__" and os.environ.get("SELFCHECK"):
    assert det_mult(1) == 0.5 and det_mult(4) == 1.5
