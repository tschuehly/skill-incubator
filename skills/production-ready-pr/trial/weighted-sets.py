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
problems, stats, ranked, live, everyone, n_cases = g["problems"], g["stats"], g["ranked"], g["live"], g["everyone"], len(g["case_ids"])

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
# A set's weight, share and minutes all come from its cohort (model-summary.py set_stats); share is of the weight on that cohort.
def row(s):
    st = stats(s)
    return (w(st["problems"]), st["minutes"], s, st, w({p for p in everyone if p[0] in st["cases"]}))
share = lambda r: f"{r[0] / r[4]:.0%}" if r[4] else "-"
flag = lambda st: "" if st["full"] else f" (partial: {st['n']}/{n_cases} PRs)"
print(f"Each set is measured on its cohort: the PRs every member reviewed. Only sets covering all {n_cases} PRs are ranked; share is of the total weight on the set's cohort.\n")
print("| model | PRs | problems | weight | share of cohort weight | median minutes |\n|---|---|---|---|---|---|")
for r in sorted((row((a,)) for a in live), key=lambda r: (not ranked(r[3]), -r[0])):
    print(f"| {r[2][0]}{flag(r[3])} | {r[3]['n']} | {len(r[3]['problems'])} | {r[0]:.1f} | {share(r)} | {r[1]:.1f} |")

rows = [row(s) for k in range(1, len(live) + 1) for s in itertools.combinations(live, k)]
full = [r for r in rows if ranked(r[3])]
print("\n## Best full-coverage set per size\n\n| models | set | weight | share | median minutes |\n|---|---|---|---|---|")
for k in range(1, max((len(r[2]) for r in full), default=0) + 1):
    b = max((r for r in full if len(r[2]) == k), key=lambda r: (r[0], -r[1]))
    print(f"| {k} | {' + '.join(b[2])} | {b[0]:.1f} | {share(b)} | {b[1]:.1f} |")
print("\n## Best partial set per size (not ranked: measured on fewer PRs)\n\n| models | set | PRs | weight | share | median minutes |\n|---|---|---|---|---|---|")
for k in (1, 2, 3):
    b = max((r for r in rows if len(r[2]) == k and not ranked(r[3]) and r[3]["n"]), key=lambda r: (r[0], -r[1]), default=None)
    if b:
        print(f"| {k} | {' + '.join(b[2])} | {b[3]['n']} | {b[0]:.1f} | {share(b)} | {b[1]:.1f} |")
print("\n## Fastest full-coverage set for each weight level (Pareto: weight vs minutes)\n\n| set | weight | share | median minutes |\n|---|---|---|---|")
front, best = [], -1
for r in sorted(full, key=lambda r: (r[1], -r[0], len(r[2]))):
    if r[0] > best + 1e-9:
        front.append(r); best = r[0]
for r in front:
    print(f"| {' + '.join(r[2])} | {r[0]:.1f} | {share(r)} | {r[1]:.1f} |")

print("\n## Problems by weight\n\n| problem | weight | rater spread |\n|---|---|---|")
for p in sorted(everyone, key=lambda p: -weight.get(pid(p), fallback)):
    s = spread.get(pid(p))
    print(f"| {pid(p).removeprefix('prr-')} | {weight.get(pid(p), fallback):.1f} | {'unrated' if s is None else s}{' (flag)' if s is not None and s >= 2 else ''} |")
if unrated:
    print(f"\nUnrated (weighted at the median {fallback:.1f}): " + ", ".join(unrated))

if __name__ == "__main__" and os.environ.get("SELFCHECK"):
    assert det_mult(1) == 0.5 and det_mult(4) == 1.5
